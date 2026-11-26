import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config';
import { DbService } from '../db/db.service';
import { JobRunner } from '../jobs/job-runner';
import { RedisService } from '../redis/redis.service';
import { backoffMs, SecretBox, signPayload } from './crypto';
import { DELIVERY_HEADER, EVENT_HEADER, SIGNATURE_HEADER } from './events';
import { assertPublicTarget } from './url-guard';
import { WEBHOOK_OPTIONS, type WebhookOptions } from './webhook-options';

export const WEBHOOK_USER_AGENT = 'Schulungsnachweis-Webhooks/1.0';
const CLAIM_BATCH = 50;

export interface DeliveryResult {
  status: 'succeeded' | 'pending' | 'failed' | 'skipped';
  responseCode?: number | null;
  error?: string | null;
}

/**
 * Zustellung (E-37, Outbox wie E-12): Ein Poller beansprucht fällige Zustellungen aus der Datenbank
 * (app.webhook_claim_due, FOR UPDATE SKIP LOCKED – mehrere API-Instanzen möglich) und reiht sie in die BullMQ-Queue
 * „webhooks“ ein. Der Worker sendet signiert per HTTP POST. Fehlversuche planen den nächsten Versuch mit
 * exponentiellem Backoff in der Datenbank (next_attempt_at); nach WEBHOOK_MAX_ATTEMPTS ist die Zustellung „failed“,
 * nach WEBHOOK_DISABLE_AFTER_FAILURES Fehlversuchen in Folge wird der Endpunkt deaktiviert.
 */
@Injectable()
export class WebhookDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(WebhookDispatcher.name);
  private readonly box: SecretBox;
  private runner!: JobRunner<{ id: string; tenantId: string }>;
  private timer?: NodeJS.Timeout;
  private polling: Promise<unknown> | null = null;
  private stopped = false;
  private lastCleanup = 0;

  constructor(
    private readonly db: DbService,
    private readonly redis: RedisService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(WEBHOOK_OPTIONS) private readonly opts: WebhookOptions,
  ) {
    this.box = new SecretBox(config.HMAC_MASTER_SECRET);
  }

  onModuleInit() {
    this.runner = new JobRunner('webhooks', this.redis, this.config, (d) => this.deliver(d.id, d.tenantId), 5);
    if (this.config.RUN_WORKERS) {
      this.timer = setInterval(() => void this.poll(), this.opts.pollMs);
      this.timer.unref();
    }
  }

  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.polling?.catch(() => undefined);
    await this.runner.close();
  }

  /** Fällige Zustellungen beanspruchen und einreihen. Liefert die Anzahl. */
  poll(): Promise<number> {
    if (this.stopped) return Promise.resolve(0);
    if (this.polling) return this.polling.then(() => 0);
    const run = (async () => {
      try {
        const rows = (await this.db.txAs({ roles: ['system'] }, (c) => c.query('SELECT * FROM app.webhook_claim_due($1)', [CLAIM_BATCH]))).rows;
        for (const r of rows) {
          await this.runner.add({ id: r.id, tenantId: r.tenant_id }, { jobId: `wh-${r.id}-${r.attempts}`, attempts: 1 });
        }
        if (Date.now() - this.lastCleanup > 3600_000) {
          this.lastCleanup = Date.now();
          await this.db.txAs({ roles: ['system'] }, (c) => c.query('SELECT app.webhook_cleanup(make_interval(days => $1))', [this.opts.retentionDays]));
        }
        return rows.length;
      } catch (e) {
        if (!this.stopped) this.log.warn(`Webhook-Poller: ${(e as Error).message}`);
        return 0;
      } finally {
        this.polling = null;
      }
    })();
    this.polling = run;
    return run;
  }

  /** Eine beanspruchte Zustellung senden und das Ergebnis protokollieren. */
  async deliver(id: string, tenantId: string): Promise<DeliveryResult> {
    const ctx = { tenantId, roles: ['system'] };
    const row = (
      await this.db.txAs(ctx, (c) =>
        c.query(
          `SELECT d.id, d.attempts, d.event_type, e.id AS endpoint_id, e.url, e.secret_enc, v.id AS event_id, v.type, v.data, v.created_at AS event_created_at
             FROM webhook_delivery d JOIN webhook_endpoint e ON e.id = d.endpoint_id JOIN webhook_event v ON v.id = d.event_id
            WHERE d.id = $1 AND d.status = 'sending'`,
          [id],
        ),
      )
    ).rows[0];
    if (!row) return { status: 'skipped' };
    const body = JSON.stringify({
      id: row.event_id,
      type: row.type,
      createdAt: new Date(row.event_created_at).toISOString(),
      tenantId,
      data: row.data,
    });
    const started = Date.now();
    let code: number | null = null;
    let error: string | null = null;
    try {
      const secret = this.box.decrypt(row.secret_enc);
      await assertPublicTarget(row.url, this.opts.allowPrivate);
      const res = await fetch(row.url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(this.opts.timeoutMs),
        headers: {
          'content-type': 'application/json',
          'user-agent': WEBHOOK_USER_AGENT,
          [EVENT_HEADER]: row.type,
          [DELIVERY_HEADER]: row.id,
          [SIGNATURE_HEADER]: signPayload(secret, body, Math.floor(Date.now() / 1000)),
        },
        body,
      });
      code = res.status;
      await res.body?.cancel().catch(() => undefined);
      if (code < 200 || code >= 300) error = code >= 300 && code < 400 ? `Weiterleitung (HTTP ${code}) wird nicht verfolgt` : `HTTP ${code}`;
    } catch (e) {
      const err = e as Error;
      error = err.name === 'TimeoutError' ? `Zeitüberschreitung nach ${this.opts.timeoutMs} ms` : (err.message || 'Verbindungsfehler').slice(0, 300);
    }
    const duration = Date.now() - started;
    const ping = row.type === 'test.ping';
    return this.db.txAs(ctx, async (c) => {
      if (!error) {
        await c.query(
          `UPDATE webhook_delivery SET status = 'succeeded', response_code = $2, duration_ms = $3, delivered_at = now(), last_error = NULL WHERE id = $1`,
          [id, code, duration],
        );
        if (!ping) await c.query('UPDATE webhook_endpoint SET failure_count = 0, last_success_at = now() WHERE id = $1', [row.endpoint_id]);
        else await c.query('UPDATE webhook_endpoint SET last_success_at = now() WHERE id = $1', [row.endpoint_id]);
        return { status: 'succeeded' as const, responseCode: code };
      }
      // Testereignisse: genau ein Versuch, zählen nicht für das Abschalten
      const final = ping || row.attempts >= this.opts.maxAttempts;
      await c.query(
        `UPDATE webhook_delivery SET status = $2, response_code = $3, last_error = $4, duration_ms = $5,
                next_attempt_at = now() + make_interval(secs => $6::float8 / 1000) WHERE id = $1`,
        [id, final ? 'failed' : 'pending', code, error, duration, backoffMs(row.attempts, this.opts.backoffBaseMs)],
      );
      if (!ping) {
        await c.query(
          `UPDATE webhook_endpoint SET failure_count = failure_count + 1, last_failure_at = now(),
                  active = CASE WHEN failure_count + 1 >= $2 THEN false ELSE active END,
                  disabled_at = CASE WHEN active AND failure_count + 1 >= $2 THEN now() ELSE disabled_at END,
                  disabled_reason = CASE WHEN active AND failure_count + 1 >= $2 THEN $3 ELSE disabled_reason END
            WHERE id = $1`,
          [row.endpoint_id, this.opts.disableAfterFailures, `automatisch deaktiviert nach ${this.opts.disableAfterFailures} Fehlversuchen in Folge`],
        );
      } else {
        await c.query('UPDATE webhook_endpoint SET last_failure_at = now() WHERE id = $1', [row.endpoint_id]);
      }
      return { status: final ? ('failed' as const) : ('pending' as const), responseCode: code, error };
    });
  }
}
