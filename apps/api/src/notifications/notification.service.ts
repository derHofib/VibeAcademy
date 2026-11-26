import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import type pg from 'pg';
import { APP_CONFIG, type AppConfig } from '../config';
import { DbService } from '../db/db.service';
import { RedisService } from '../redis/redis.service';
import { MAIL_PROVIDER, PUSH_PROVIDER, SMS_PROVIDER, type MailProvider, type PushProvider, type SmsProvider } from './providers';
import { render, TRANSLATED_TEMPLATES, type TemplateName } from './templates';
import { recipientLanguage } from '../i18n/recipient-language';

export interface EnqueueInput {
  tenantId: string | null;
  accountId?: string | null;
  channel: 'mail' | 'sms' | 'push';
  recipient: string;
  template: TemplateName;
  /** wird protokolliert */
  data: Record<string, unknown>;
  /** wird nur kurzlebig in Redis gehalten (Codes, Links mit Token) */
  secret?: Record<string, string>;
}

const QUEUE = 'notify';
const SECRET_TTL_S = 7 * 24 * 3600;
const MAX_ATTEMPTS = 5;

/**
 * Outbox-Muster (E-12): enqueue() schreibt in der fachlichen Transaktion, dispatch() stößt nach dem Commit den Versand an.
 * Ein Sweeper holt Nachrichten nach, deren dispatch() verloren ging.
 */
@Injectable()
export class NotificationService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(NotificationService.name);
  private queue!: Queue;
  private worker?: Worker;
  private sweeper?: NodeJS.Timeout;

  constructor(
    private readonly db: DbService,
    private readonly redis: RedisService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
  ) {}

  onModuleInit() {
    const prefix = `${this.config.REDIS_PREFIX}bull`;
    this.queue = new Queue(QUEUE, { connection: this.redis.bullConnection(), prefix });
    if (this.config.RUN_WORKERS) {
      this.worker = new Worker(QUEUE, (job) => this.process(job.data.id, job.data.tenantId), {
        connection: this.redis.bullConnection(),
        prefix,
        concurrency: 5,
      });
      this.worker.on('failed', (job, err) => this.log.warn(`Versand ${job?.data?.id} fehlgeschlagen: ${err.message}`));
      this.sweeper = setInterval(() => void this.sweep().catch((e) => this.log.error(e)), 60_000);
      this.sweeper.unref();
    }
  }

  async onModuleDestroy() {
    if (this.sweeper) clearInterval(this.sweeper);
    await this.worker?.close();
    await this.queue?.close();
  }

  /** In der laufenden Transaktion einreihen. Liefert die ID für dispatch(). */
  async enqueue(client: pg.PoolClient, n: EnqueueInput): Promise<{ id: string; tenantId: string | null }> {
    // E-39: Teilnehmer-Nachrichten in der Sprache der Person (sofern die Vorlage übersetzt ist)
    if (n.data.lang === undefined && TRANSLATED_TEMPLATES.has(n.template) && (await recipientLanguage(client, n.tenantId, n.recipient)) === 'en') {
      n = { ...n, data: { ...n.data, lang: 'en' } };
    }
    const r = await client.query(
      `INSERT INTO notification (tenant_id, account_id, channel, recipient, template, data, has_secret)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [n.tenantId, n.accountId ?? null, n.channel, n.recipient, n.template, n.data, !!n.secret],
    );
    const id = r.rows[0].id as string;
    if (n.secret) await this.redis.client.set(`notif-secret:${id}`, JSON.stringify(n.secret), 'EX', SECRET_TTL_S);
    return { id, tenantId: n.tenantId };
  }

  /** Nach dem Commit aufrufen. */
  async dispatch(items: Array<{ id: string; tenantId: string | null }>): Promise<void> {
    for (const it of items) {
      await this.queue.add('send', it, {
        jobId: it.id,
        attempts: MAX_ATTEMPTS,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      });
    }
  }

  /** Versendet eine Nachricht. Idempotent: bereits versendete werden übersprungen. */
  async process(id: string, tenantId: string | null): Promise<'sent' | 'skipped'> {
    const row = await this.db.txAs({ tenantId, roles: ['system'] }, async (c) => {
      const r = await c.query(
        `UPDATE notification SET status = 'sending', attempts = attempts + 1
          WHERE id = $1 AND status IN ('queued', 'failed') RETURNING *`,
        [id],
      );
      return r.rows[0];
    });
    if (!row) return 'skipped';
    try {
      const secretRaw = row.has_secret ? await this.redis.client.get(`notif-secret:${id}`) : null;
      if (row.has_secret && !secretRaw) throw new Error('Geheimer Inhalt abgelaufen');
      const msg = render(row.template, row.data, secretRaw ? JSON.parse(secretRaw) : null);
      const res =
        row.channel === 'mail'
          ? await this.mail.send({ to: row.recipient, ...msg })
          : row.channel === 'push'
            ? await this.push.send(row.recipient, { title: msg.subject, body: msg.text, url: row.data?.url })
            : await this.sms.send(row.recipient, msg.text);
      await this.db.txAs({ tenantId, roles: ['system'] }, (c) =>
        c.query(
          `UPDATE notification SET status = 'sent', sent_at = now(), provider = $2, provider_message_id = $3, last_error = NULL
            WHERE id = $1`,
          [id, row.channel === 'mail' ? this.mail.name : row.channel === 'push' ? this.push.name : this.sms.name, res.messageId],
        ),
      );
      if (row.has_secret) await this.redis.client.del(`notif-secret:${id}`);
      return 'sent';
    } catch (e) {
      await this.db.txAs({ tenantId, roles: ['system'] }, (c) =>
        c.query(`UPDATE notification SET status = 'failed', last_error = $2 WHERE id = $1`, [
          id,
          (e as Error).message.slice(0, 500),
        ]),
      );
      throw e;
    }
  }

  /** Holt liegengebliebene Nachrichten nach (z. B. Absturz zwischen Commit und dispatch). */
  async sweep(): Promise<number> {
    const r = await this.db.txAs({ roles: ['system'] }, (c) =>
      c.query(`SELECT * FROM app.notification_pending(interval '1 minute', 100)`),
    );
    await this.dispatch(r.rows.map((x) => ({ id: x.id, tenantId: x.tenant_id })));
    return r.rowCount ?? 0;
  }
}
