import type {} from 'multer';
import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, Res,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { Roles } from '../auth/decorators';
import { ZodBody } from '../common/errors';
import { currentRequest } from '../common/request-context';
import { ComplianceService } from '../compliance/compliance.service';
import { DbService } from '../db/db.service';
import { NotificationService } from '../notifications/notification.service';
import { ExternalService, type ExtStatus, type RecordFields } from './external.service';
import type { ReceiptFile } from './receipts';
import { WebhookEmitter } from '../webhooks/webhook-emitter';

const date = z.iso.date('Datum im Format JJJJ-MM-TT');
export const FieldsSchema = z.object({
  requirementId: z.uuid().nullish(),
  trainingId: z.uuid().nullish(),
  freeTitle: z.string().trim().min(2).max(300).nullish(),
  provider: z.string().trim().max(300).nullish(),
  heldOn: date.nullish(),
  durationHours: z.number().positive().max(10000).nullish(),
  durationLabel: z.string().trim().max(100).nullish(),
  location: z.string().trim().max(300).nullish(),
  isMedical: z.boolean().optional(),
});
const FlagSchema = z.object({ personId: z.uuid(), code: z.enum(['unterschrift_unleserlich', 'sonstiges']), note: z.string().trim().max(300).nullish() });
const CreateSchema = FieldsSchema.extend({
  mode: z.enum(['einzel', 'gruppe']).default('einzel'),
  personIds: z.array(z.uuid()).min(1, 'Bitte mindestens eine Person auswählen').max(500),
  validUntil: date.nullish(),
  receipts: z
    .object({
      mode: z.enum(['one', 'per']).default('one'),
      uploadIds: z.array(z.uuid()).max(20).default([]),
      perPerson: z.array(z.object({ personId: z.uuid(), uploadIds: z.array(z.uuid()).min(1).max(10) })).max(500).default([]),
    })
    .default({ mode: 'one', uploadIds: [], perPerson: [] }),
  flags: z.array(FlagSchema).max(500).default([]),
  /** Als Entwurf speichern (Screen 9 „Als Entwurf speichern“) */
  draft: z.boolean().default(false),
  /** In die Prüfung geben statt sofort anrechnen (z. B. Papierliste mit unleserlichen Unterschriften) */
  review: z.boolean().default(false),
}).refine((b) => b.mode === 'gruppe' || b.personIds.length === 1, { message: 'Einzelperson: genau eine Person', path: ['personIds'] });
const PreviewSchema = z.object({
  requirementId: z.uuid().nullish(), trainingId: z.uuid().nullish(), heldOn: date.nullish(), personIds: z.array(z.uuid()).max(500).default([]),
  validUntil: date.nullish(),
});
const PatchSchema = FieldsSchema.extend({
  flags: z.array(z.object({ code: z.enum(['unterschrift_unleserlich', 'sonstiges']), note: z.string().trim().max(300).nullish() })).max(20).optional(),
  validUntil: date.nullish(),
  scope: z.enum(['group', 'record']).default('record'),
});
const ApproveSchema = z.object({ validUntil: date.nullish(), scope: z.enum(['group', 'record']).default('group') });
const ReturnSchema = z.object({ reason: z.string().trim().min(5, 'Bitte eine Begründung angeben (mind. 5 Zeichen)').max(2000), scope: z.enum(['group', 'record']).default('group') });
const ScopeSchema = z.object({ scope: z.enum(['group', 'record']).default('group') });

const READ = ['admin', 'verantwortlich', 'vorgesetzter', 'auditor'] as const;
const STAFF = ['admin', 'verantwortlich'] as const;
const STATUSES: ExtStatus[] = ['entwurf', 'eingereicht', 'freigegeben', 'zurueckgegeben', 'abgelaufen', 'widerrufen'];
export const filesUrl = (recordId: string, n: number) => `/api/external-records/${recordId}/files/${n}`;

/** Verwaltungssicht externer Nachweise (Screens 9 und 11). */
@Controller()
export class ExternalController {
  constructor(
    private readonly db: DbService,
    private readonly ext: ExternalService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly compliance: ComplianceService,
  ) {}

  private tenantId() {
    return currentRequest()!.session!.tenantId!;
  }

  /** Beleg hochladen (PDF/JPG/PNG), vor dem Speichern des Nachweises (Screen 9: „✓ hochgeladen“). */
  @Post('external-uploads')
  @Roles(...STAFF)
  @UseInterceptors(FileInterceptor('datei', { limits: { fileSize: 50 * 1024 * 1024 } }))
  async upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Bitte eine Datei im Feld „datei“ senden');
    const tenantId = this.tenantId();
    const f = await this.ext.storeReceipt(tenantId, file.buffer, file.originalname);
    return this.db.tx(async (c) => {
      const r = await c.query(
        'INSERT INTO external_upload (key, sha256, name, mime, size, pages) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [f.key, f.sha256, f.name, f.mime, f.size, f.pages],
      );
      return { id: r.rows[0].id as string, name: f.name, mime: f.mime, size: f.size, pages: f.pages, sha256: f.sha256 };
    });
  }

  /** „Was sich ändert“: Vorschlag „gültig bis“ und bisheriger Stand je Person. */
  @Post('external-records/preview')
  @Roles(...STAFF)
  @HttpCode(200)
  preview(@Body(new ZodBody(PreviewSchema)) b: z.infer<typeof PreviewSchema>) {
    return this.db.tx(async (c) => {
      const asg = await this.ext.resolveAssignment(c, { requirementId: b.requirementId, trainingId: b.trainingId });
      const p = await this.ext.proposal(c, asg.requirementId, asg.trainingId, b.heldOn ?? null);
      const validUntil = b.validUntil !== undefined && b.validUntil !== null ? b.validUntil : p.validUntil;
      const label = asg.qualificationId
        ? (await c.query('SELECT name FROM qualification WHERE id = $1', [asg.qualificationId])).rows[0]?.name
        : asg.trainingId ? (await c.query('SELECT titel FROM training WHERE id = $1', [asg.trainingId])).rows[0]?.titel : null;
      const rows = asg.requirementId ? await this.compliance.rows(c, this.ext.now(), { requirementId: asg.requirementId }) : [];
      const persons = (await c.query('SELECT id, name FROM person WHERE id = ANY($1::uuid[]) ORDER BY name', [b.personIds])).rows;
      return {
        label: label ?? null,
        intervalMonths: p.intervalMonths,
        validUntilProposed: p.validUntil,
        validUntil,
        credited: !!validUntil && !!label,
        persons: persons.map((x) => {
          const cur = rows.find((r) => r.personId === x.id);
          return {
            personId: x.id, name: x.name,
            current: cur ? { state: cur.state, validUntil: cur.validUntil } : { state: asg.requirementId ? 'neu' : null, validUntil: null },
            next: { validUntil },
          };
        }),
      };
    });
  }

  /** Verwaltung erfasst (einzeln oder Gruppe; eine Liste für alle oder Beleg je Person). Gilt sofort (Nachweise werden erzeugt). */
  @Post('external-records')
  @Roles(...STAFF)
  async create(@Body(new ZodBody(CreateSchema)) b: z.infer<typeof CreateSchema>) {
    const tenantId = this.tenantId();
    const status: ExtStatus = b.draft ? 'entwurf' : b.review ? 'eingereicht' : 'freigegeben';
    const res = await this.db.tx(async (c) => {
      const uploadIds = [...b.receipts.uploadIds, ...b.receipts.perPerson.flatMap((x) => x.uploadIds)];
      const uploads = new Map<string, ReceiptFile>(
        (await c.query('SELECT id, key, sha256, name, mime, size, pages FROM external_upload WHERE id = ANY($1::uuid[])', [uploadIds])).rows.map((u) => [
          u.id, { key: u.key, sha256: u.sha256, name: u.name, mime: u.mime, size: Number(u.size), pages: u.pages },
        ]),
      );
      if (uploads.size !== new Set(uploadIds).size) throw new BadRequestException('Beleg nicht gefunden – bitte erneut hochladen');
      const persons = (await c.query('SELECT id, name FROM person WHERE id = ANY($1::uuid[])', [b.personIds])).rows;
      if (persons.length !== new Set(b.personIds).size) throw new BadRequestException('Person nicht gefunden');
      const fields: RecordFields = b;
      if (status === 'freigegeben') {
        if (!b.heldOn) throw new BadRequestException('Bitte das Schulungsdatum angeben');
        if (!b.requirementId && !b.trainingId && !b.freeTitle) throw new BadRequestException('Bitte eine Pflichtschulung zuordnen oder den Kurs benennen');
      }
      const asg = await this.ext.resolveAssignment(c, fields);
      const p = await this.ext.proposal(c, asg.requirementId, asg.trainingId, b.heldOn ?? null);
      const validUntil = b.validUntil !== undefined ? b.validUntil : p.validUntil;
      const groupId = b.personIds.length > 1 ? randomUUID() : null;
      const ids: Array<{ id: string; personId: string }> = [];
      for (const personId of b.personIds) {
        const own = b.receipts.mode === 'per' ? (b.receipts.perPerson.find((x) => x.personId === personId)?.uploadIds ?? []) : b.receipts.uploadIds;
        const id = await this.ext.insertRecord(c, {
          personId, groupId, fields, files: own.map((u) => uploads.get(u)!), source: 'verwaltung', status,
          flags: b.flags.filter((f) => f.personId === personId).map((f) => ({ code: f.code, note: f.note ?? null })),
          validUntil: status === 'freigegeben' ? validUntil : (b.validUntil ?? null), reviewed: status === 'freigegeben',
        });
        ids.push({ id, personId });
        await this.audit.record(c, { entity: 'external_record', entityId: id, action: status === 'freigegeben' ? 'recorded_and_approved' : 'recorded', payload: { personId, status, groupId } });
        if (status === 'freigegeben') await WebhookEmitter.emit(c, tenantId, 'external_record.approved', { externalRecordId: id }); // E-37
      }
      return { ids, groupId, validUntil, names: new Map(persons.map((x) => [x.id as string, x.name as string])) };
    });
    const sealed = status === 'freigegeben' ? await this.ext.sealApproved(tenantId, res.ids.map((x) => x.id)) : [];
    if (status !== 'freigegeben') await this.ext.enqueueOcr(tenantId, res.ids.map((x) => x.id));
    return {
      groupId: res.groupId,
      status,
      records: res.ids.map((x) => {
        const ev = sealed.find((s) => s.recordId === x.id)?.evidence;
        return { id: x.id, personId: x.personId, personName: res.names.get(x.personId), status, validUntil: status === 'freigegeben' ? res.validUntil : null, evidence: ev ?? null };
      }),
    };
  }

  /** Warteschlange (Screen 11): Vorgänge je Status + Zähler für die Reiter „Zu prüfen · n | Freigegeben | Zurückgegeben“. */
  @Get('external-records')
  @Roles(...READ)
  list(@Query('status') status = 'eingereicht', @Query('person') person?: string, @Query('source') source?: string) {
    const statuses = status.split(',') as ExtStatus[];
    if (statuses.some((s) => !STATUSES.includes(s))) throw new BadRequestException('Ungültiger Status');
    if (person && !z.uuid().safeParse(person).success) throw new BadRequestException('Ungültige Person');
    if (source && !['verwaltung', 'selbst', 'import'].includes(source)) throw new BadRequestException('Ungültige Quelle');
    return this.db.tx(async (c) => {
      const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<ExtStatus, number>;
      for (const r of (await c.query(`SELECT status, count(DISTINCT coalesce(group_id, id))::int AS n FROM external_record GROUP BY status`)).rows) counts[r.status as ExtStatus] = r.n;
      const records = await this.ext.records(c, `x.status = ANY($1::text[]) AND ($2::uuid IS NULL OR x.person_id = $2) AND ($3::text IS NULL OR x.source = $3)`, [
        statuses, person ?? null, source ?? null,
      ]);
      const items = await this.ext.cases(c, records.slice(0, 2000), this.ext.today());
      return { counts, items: items.slice(0, 300) };
    });
  }

  @Get('external-records/:id')
  @Roles(...READ)
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.db.tx((c) => this.ext.detail(c, id, filesUrl));
  }

  /** Beleg ansehen (Prüfansicht). */
  @Get('external-records/:id/files/:n')
  @Roles(...READ)
  async file(@Param('id', ParseUUIDPipe) id: string, @Param('n', ParseIntPipe) n: number, @Res() res: Response) {
    const r = await this.db.tx(async (c) => (await c.query('SELECT evidence_keys, evidence_files FROM external_record WHERE id = $1', [id])).rows[0]);
    if (!r || !r.evidence_keys[n]) throw new NotFoundException('Beleg nicht gefunden');
    const meta = r.evidence_files[n];
    res.setHeader('content-type', meta.mime);
    res.setHeader('content-disposition', `inline; filename="${encodeURIComponent(meta.name)}"`);
    res.setHeader('cache-control', 'private, no-store');
    res.send(await this.ext.loadReceipt(r.evidence_keys[n]));
  }

  /** Angaben korrigieren / Prüfhinweise setzen (nur vor der Freigabe). */
  @Patch('external-records/:id')
  @Roles(...STAFF)
  patch(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(PatchSchema)) b: z.infer<typeof PatchSchema>) {
    return this.db.tx(async (c) => {
      const { targets } = await this.ext.scope(c, id, b.scope, ['entwurf', 'eingereicht', 'zurueckgegeben']);
      const { scope: _scope, ...fields } = b;
      for (const t of targets) await this.ext.applyFields(c, t.id, fields);
      await this.audit.record(c, { entity: 'external_record', entityId: id, action: 'edited', payload: { ...b, records: targets.length } });
      return { ok: true, updated: targets.length };
    });
  }

  /** Freigeben → versiegelter Nachweis mit Beleg als Anlage, Anrechnung in der Pflichtmatrix. Vorgesetzte: nur selbst eingereichte ihres Teams. */
  @Post('external-records/:id/approve')
  @Roles('admin', 'verantwortlich', 'vorgesetzter')
  @HttpCode(200)
  async approve(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(ApproveSchema)) b: z.infer<typeof ApproveSchema>) {
    const tenantId = this.tenantId();
    const res = await this.db.tx(async (c) => {
      const { targets } = await this.ext.scope(c, id, b.scope, ['entwurf', 'eingereicht', 'zurueckgegeben']);
      return this.ext.approve(c, targets, b.validUntil);
    });
    await this.notifications.dispatch(res.queued);
    const sealed = await this.ext.sealApproved(tenantId, res.results.map((r) => r.id));
    return {
      records: res.results.map((r) => ({ id: r.id, status: 'freigegeben', validUntil: r.validUntil, evidence: sealed.find((s) => s.recordId === r.id)?.evidence ?? null })),
      undoUntil: new Date(this.ext.now().getTime() + this.ext.undoMinutes * 60_000).toISOString(),
    };
  }

  /** Zurückgeben – nur mit Begründung; die Person wird benachrichtigt. */
  @Post('external-records/:id/return')
  @Roles('admin', 'verantwortlich', 'vorgesetzter')
  @HttpCode(200)
  async return(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(ReturnSchema)) b: z.infer<typeof ReturnSchema>) {
    const res = await this.db.tx(async (c) => {
      const { targets } = await this.ext.scope(c, id, b.scope, ['entwurf', 'eingereicht']);
      const queued = await this.ext.returnRecords(c, targets, b.reason);
      return { queued, ids: targets.map((t) => t.id) };
    });
    await this.notifications.dispatch(res.queued);
    return { records: res.ids.map((x) => ({ id: x, status: 'zurueckgegeben' })) };
  }

  /** Rückgängig (Frist EXTERNAL_UNDO_MINUTES, Standard 10 min): Nachweis wird widerrufen, Vorgang liegt wieder zur Prüfung. */
  @Post('external-records/:id/undo')
  @Roles('admin', 'verantwortlich', 'vorgesetzter')
  @HttpCode(200)
  async undo(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(ScopeSchema)) b: z.infer<typeof ScopeSchema>) {
    const tenantId = this.tenantId();
    const { targets } = await this.db.tx(async (c) => {
      const s = await this.ext.scope(c, id, b.scope, ['freigegeben']);
      for (const t of s.targets) {
        const p = await this.ext.permissions(c, t);
        if (!p.undo) throw new BadRequestException(`Rückgängig ist nur ${this.ext.undoMinutes} Minuten nach der Freigabe möglich`);
      }
      return s;
    });
    const out = await this.ext.undo(tenantId, targets);
    return { records: out.map((x) => ({ id: x.newId, replaces: x.oldId, status: 'eingereicht' })) };
  }

  /** Entwurf verwerfen. */
  @Delete('external-records/:id')
  @Roles(...STAFF)
  @HttpCode(200)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.db.tx(async (c) => {
      const r = await c.query(`DELETE FROM external_record WHERE id = $1 AND status = 'entwurf'`, [id]);
      if (!r.rowCount) throw new BadRequestException('Nur Entwürfe können gelöscht werden');
      await this.audit.record(c, { entity: 'external_record', entityId: id, action: 'deleted' });
      return { ok: true };
    });
  }
}
