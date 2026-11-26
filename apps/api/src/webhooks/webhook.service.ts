import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { DbContext } from '@sn/db';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../config';
import { DbService } from '../db/db.service';
import { keysetPage, type Page, type PageQuery } from '../public-api/pagination';
import { actorPayload, type Actor } from './actor';
import { newWebhookSecret, SecretBox } from './crypto';
import { WEBHOOK_EVENTS } from './events';
import { webhookUrlProblem } from './url-guard';
import { WebhookEmitter } from './webhook-emitter';
import { WEBHOOK_OPTIONS, type WebhookOptions } from './webhook-options';

export const MAX_ENDPOINTS_PER_TENANT = 20;

export const EndpointInput = z.object({
  url: z.string().trim().min(8, 'Bitte eine URL angeben').max(2000, 'Die URL ist zu lang'),
  description: z.string().trim().max(200).nullish(),
  events: z.array(z.enum(WEBHOOK_EVENTS, { error: 'Unbekannter Ereignistyp' })).min(1, 'Bitte mindestens ein Ereignis auswählen').max(WEBHOOK_EVENTS.length),
  active: z.boolean().default(true),
});
export const EndpointPatch = z
  .object({
    url: EndpointInput.shape.url.optional(),
    description: EndpointInput.shape.description,
    events: EndpointInput.shape.events.optional(),
    active: z.boolean().optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: 'Keine Änderungen' });
export type EndpointInput = z.infer<typeof EndpointInput>;
export type EndpointPatch = z.infer<typeof EndpointPatch>;

const ENDPOINT_COLS = `e.id, e.url, e.description, e.events, e.active, e.failure_count, e.disabled_at, e.disabled_reason, e.last_success_at,
  e.last_failure_at, e.created_at, e.updated_at`;

interface EndpointRow {
  id: string; url: string; description: string | null; events: string[]; active: boolean; failure_count: number; disabled_at: Date | null;
  disabled_reason: string | null; last_success_at: Date | null; last_failure_at: Date | null; created_at: Date; updated_at: Date;
}

export const endpointDto = (r: EndpointRow) => ({
  id: r.id, url: r.url, description: r.description, events: r.events, active: r.active, failureCount: r.failure_count,
  disabledAt: r.disabled_at, disabledReason: r.disabled_reason, lastSuccessAt: r.last_success_at, lastFailureAt: r.last_failure_at,
  createdAt: r.created_at, updatedAt: r.updated_at,
});
export type EndpointDto = ReturnType<typeof endpointDto>;

interface DeliveryRow {
  id: string; event_id: string; event_type: string; status: string; attempts: number; next_attempt_at: Date; last_attempt_at: Date | null;
  response_code: number | null; last_error: string | null; duration_ms: number | null; delivered_at: Date | null; redelivery_of: string | null;
  created_at: Date; data: Record<string, unknown>;
}
export const deliveryDto = (r: DeliveryRow) => ({
  id: r.id, eventId: r.event_id, eventType: r.event_type, status: r.status, attempts: r.attempts,
  nextAttemptAt: r.status === 'pending' ? r.next_attempt_at : null, lastAttemptAt: r.last_attempt_at, responseCode: r.response_code,
  lastError: r.last_error, durationMs: r.duration_ms, deliveredAt: r.delivered_at, redeliveryOf: r.redelivery_of, createdAt: r.created_at,
  data: r.data,
});

/**
 * Webhook-Endpunkte verwalten – gemeinsam für die Verwaltung (/api/integrations/webhooks, Sitzung mit Rolle admin)
 * und die API (/api/v1/webhooks, Scope webhooks:manage). Der Aufrufer übergibt den passenden RLS-Kontext.
 */
@Injectable()
export class WebhookService {
  private readonly box: SecretBox;

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(WEBHOOK_OPTIONS) private readonly opts: WebhookOptions,
  ) {
    this.box = new SecretBox(config.HMAC_MASTER_SECRET);
  }

  decryptSecret(enc: string) {
    return this.box.decrypt(enc);
  }

  private checkUrl(url: string) {
    const p = webhookUrlProblem(url, this.opts.allowPrivate);
    if (p) throw new BadRequestException({ message: p, fields: [{ path: 'url', message: p }] });
  }

  list(ctx: DbContext): Promise<EndpointDto[]> {
    return this.db.txAs(ctx, async (c) =>
      (await c.query(`SELECT ${ENDPOINT_COLS} FROM webhook_endpoint e ORDER BY e.created_at`)).rows.map(endpointDto),
    );
  }

  get(ctx: DbContext, id: string): Promise<EndpointDto> {
    return this.db.txAs(ctx, async (c) => {
      const r = (await c.query(`SELECT ${ENDPOINT_COLS} FROM webhook_endpoint e WHERE e.id = $1`, [id])).rows[0];
      if (!r) throw new NotFoundException('Webhook nicht gefunden');
      return endpointDto(r);
    });
  }

  /** Legt einen Endpunkt an. Das Geheimnis wird nur in dieser Antwort im Klartext geliefert. */
  async create(ctx: DbContext, b: EndpointInput, actor: Actor): Promise<{ endpoint: EndpointDto; secret: string }> {
    this.checkUrl(b.url);
    const secret = newWebhookSecret();
    return this.db.txAs(ctx, async (c) => {
      const n = Number((await c.query('SELECT count(*) AS n FROM webhook_endpoint')).rows[0].n);
      if (n >= MAX_ENDPOINTS_PER_TENANT) throw new ConflictException(`Höchstens ${MAX_ENDPOINTS_PER_TENANT} Webhooks je Organisation`);
      const r = await c.query(
        `INSERT INTO webhook_endpoint AS e (url, description, secret_enc, events, active, created_by_key)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${ENDPOINT_COLS}`,
        [b.url, b.description ?? null, this.box.encrypt(secret), [...new Set(b.events)], b.active, actor.kind === 'api-key' ? actor.keyId : null],
      );
      const ep = endpointDto(r.rows[0]);
      await this.audit.record(c, { entity: 'webhook_endpoint', entityId: ep.id, action: 'created', payload: actorPayload(actor, { url: b.url, events: ep.events }) });
      return { endpoint: ep, secret };
    });
  }

  async update(ctx: DbContext, id: string, b: EndpointPatch, actor: Actor): Promise<EndpointDto> {
    if (b.url !== undefined) this.checkUrl(b.url);
    return this.db.txAs(ctx, async (c) => {
      const r = await c.query(
        `UPDATE webhook_endpoint e SET
            url = coalesce($2, url),
            description = CASE WHEN $3 THEN $4 ELSE description END,
            events = coalesce($5, events),
            active = coalesce($6, active),
            failure_count = CASE WHEN $6 IS TRUE AND NOT active THEN 0 ELSE failure_count END,
            disabled_at = CASE WHEN $6 IS TRUE THEN NULL WHEN $6 IS FALSE AND active THEN now() ELSE disabled_at END,
            disabled_reason = CASE WHEN $6 IS TRUE THEN NULL WHEN $6 IS FALSE AND active THEN 'manuell deaktiviert' ELSE disabled_reason END
          WHERE e.id = $1 RETURNING ${ENDPOINT_COLS}`,
        [id, b.url ?? null, b.description !== undefined, b.description ?? null, b.events ? [...new Set(b.events)] : null, b.active ?? null],
      );
      if (!r.rowCount) throw new NotFoundException('Webhook nicht gefunden');
      await this.audit.record(c, { entity: 'webhook_endpoint', entityId: id, action: 'updated', payload: actorPayload(actor, { fields: Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined) }) });
      return endpointDto(r.rows[0]);
    });
  }

  async remove(ctx: DbContext, id: string, actor: Actor): Promise<void> {
    await this.db.txAs(ctx, async (c) => {
      const r = await c.query('DELETE FROM webhook_endpoint WHERE id = $1', [id]);
      if (!r.rowCount) throw new NotFoundException('Webhook nicht gefunden');
      await this.audit.record(c, { entity: 'webhook_endpoint', entityId: id, action: 'deleted', payload: actorPayload(actor) });
    });
  }

  async rotateSecret(ctx: DbContext, id: string, actor: Actor): Promise<{ secret: string }> {
    const secret = newWebhookSecret();
    await this.db.txAs(ctx, async (c) => {
      const r = await c.query('UPDATE webhook_endpoint SET secret_enc = $2 WHERE id = $1', [id, this.box.encrypt(secret)]);
      if (!r.rowCount) throw new NotFoundException('Webhook nicht gefunden');
      await this.audit.record(c, { entity: 'webhook_endpoint', entityId: id, action: 'secret_rotated', payload: actorPayload(actor) });
    });
    return { secret };
  }

  /** Testereignis an genau diesen Endpunkt (auch wenn er deaktiviert ist). */
  async ping(ctx: DbContext, id: string, actor: Actor): Promise<{ eventId: string; deliveryId: string }> {
    return this.db.txAs(ctx, async (c) => {
      const ep = (await c.query('SELECT id, tenant_id FROM webhook_endpoint WHERE id = $1', [id])).rows[0];
      if (!ep) throw new NotFoundException('Webhook nicht gefunden');
      const eventId = await WebhookEmitter.emit(c, ep.tenant_id, 'test.ping', { endpointId: id, message: 'Testereignis aus Schulungsnachweis' }, { endpointId: id });
      if (!eventId) throw new ConflictException('Testereignis konnte nicht angelegt werden');
      const d = (await c.query('SELECT id FROM webhook_delivery WHERE event_id = $1 AND endpoint_id = $2', [eventId, id])).rows[0];
      await this.audit.record(c, { entity: 'webhook_endpoint', entityId: id, action: 'pinged', payload: actorPayload(actor, { eventId }) });
      return { eventId, deliveryId: d.id as string };
    });
  }

  /** Zustellprotokoll (neueste zuerst). */
  async deliveries(ctx: DbContext, id: string, page: PageQuery, status?: string): Promise<Page<ReturnType<typeof deliveryDto>>> {
    if (status && !['pending', 'sending', 'succeeded', 'failed'].includes(status)) throw new BadRequestException('Ungültiger Status');
    return this.db.txAs(ctx, async (c) => {
      const ok = await c.query('SELECT 1 FROM webhook_endpoint WHERE id = $1', [id]);
      if (!ok.rowCount) throw new NotFoundException('Webhook nicht gefunden');
      // neueste zuerst: Keyset aufsteigend über die negierte Zeit
      const r = await keysetPage<DeliveryRow>(c, {
        select: `d.id, d.event_id, d.event_type, d.status, d.attempts, d.next_attempt_at, d.last_attempt_at, d.response_code, d.last_error,
                 d.duration_ms, d.delivered_at, d.redelivery_of, d.created_at, v.data`,
        from: 'webhook_delivery d JOIN webhook_event v ON v.id = d.event_id',
        where: ['d.endpoint_id = $1', '($2::text IS NULL OR d.status = $2)'],
        params: [id, status ?? null],
        keys: [['(9999999999 - extract(epoch FROM d.created_at))::numeric(20,6)', 'numeric'], ['d.id', 'uuid']],
        page,
      });
      return { data: r.rows.map(deliveryDto), nextCursor: r.nextCursor };
    });
  }

  /** Erneut zustellen: neue Zustellung (neue ID) für dasselbe Ereignis (gleiche Ereignis-ID im Body). */
  async redeliver(ctx: DbContext, endpointId: string, deliveryId: string, actor: Actor) {
    return this.db.txAs(ctx, async (c) => {
      const d = (
        await c.query('SELECT d.id, d.tenant_id, d.event_id, d.event_type, d.status FROM webhook_delivery d WHERE d.id = $1 AND d.endpoint_id = $2', [deliveryId, endpointId])
      ).rows[0];
      if (!d) throw new NotFoundException('Zustellung nicht gefunden');
      if (['pending', 'sending'].includes(d.status)) throw new ConflictException('Die Zustellung läuft noch');
      const r = await c.query(
        `INSERT INTO webhook_delivery (tenant_id, endpoint_id, event_id, event_type, redelivery_of) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [d.tenant_id, endpointId, d.event_id, d.event_type, deliveryId],
      );
      await this.audit.record(c, { entity: 'webhook_delivery', entityId: r.rows[0].id, action: 'redelivered', payload: actorPayload(actor, { of: deliveryId, eventId: d.event_id }) });
      const row = (
        await c.query(
          `SELECT d.*, v.data FROM webhook_delivery d JOIN webhook_event v ON v.id = d.event_id WHERE d.id = $1`,
          [r.rows[0].id],
        )
      ).rows[0];
      return deliveryDto(row);
    });
  }
}
