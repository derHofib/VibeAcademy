import type {} from 'multer';
import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { DbService } from '../db/db.service';
import { ExternalService, type ExtStatus, type RecordFields } from '../external/external.service';
import type { ReceiptFile } from '../external/receipts';
import { actorPayload } from '../webhooks/actor';
import { WebhookEmitter } from '../webhooks/webhook-emitter';
import { ApiKey, ApiScoped } from './api-key.guard';
import { apiContext, systemContext, type ApiPrincipal } from './api-key.service';
import { EXTERNAL_SELECT, externalDto } from './dto';
import { keysetPage, parsePage } from './pagination';
import { dateTimeFilter, enumFilter, Uuid, uuidFilter } from './uuid.pipe';

const date = z.iso.date('Datum im Format JJJJ-MM-TT');
export const ExternalCreate = z
  .object({
    personIds: z.array(z.uuid('Ungültige Personen-ID')).min(1, 'Bitte mindestens eine Person angeben').max(500),
    requirementId: z.uuid().nullish(),
    trainingId: z.uuid().nullish(),
    title: z.string().trim().min(2).max(300).nullish(),
    provider: z.string().trim().max(300).nullish(),
    heldOn: date.nullish(),
    durationHours: z.number().positive().max(10000).nullish(),
    durationLabel: z.string().trim().max(100).nullish(),
    location: z.string().trim().max(300).nullish(),
    validUntil: date.nullish(),
    isMedical: z.boolean().optional(),
    /** true: zur Prüfung einreichen (Status „eingereicht“) statt sofort freigeben */
    review: z.boolean().default(false),
  })
  .refine((b) => b.review || !!b.heldOn, { message: 'Bitte das Schulungsdatum angeben', path: ['heldOn'] })
  .refine((b) => b.review || b.requirementId || b.trainingId || b.title, { message: 'Bitte eine Pflichtschulung zuordnen oder den Kurs benennen', path: ['title'] });
type ExternalCreate = z.infer<typeof ExternalCreate>;

const STATUS = ['entwurf', 'eingereicht', 'freigegeben', 'zurueckgegeben', 'abgelaufen', 'widerrufen'] as const;
const MAX_FILES = 10;

/** Externe Nachweise lesen (external:read) und als Verwaltung erfassen (external:write, mit Beleg). */
@Controller('v1')
export class V1ExternalController {
  constructor(
    private readonly db: DbService,
    private readonly ext: ExternalService,
    private readonly audit: AuditService,
  ) {}

  @Get('external-records')
  @ApiScoped('external:read')
  list(@ApiKey() k: ApiPrincipal, @Query() q: Record<string, string>) {
    const page = parsePage(q);
    const p = [uuidFilter(q.personId, 'personId'), enumFilter(q.status, 'status', STATUS), dateTimeFilter(q.updatedSince, 'updatedSince')];
    return this.db.txAs(apiContext(k), async (c) => {
      const r = await keysetPage(c, {
        select: EXTERNAL_SELECT,
        from: 'external_record x',
        where: ['($1::uuid IS NULL OR x.person_id = $1)', '($2::text IS NULL OR x.status = $2)', '($3::timestamptz IS NULL OR x.updated_at >= $3)'],
        params: p,
        keys: [['x.updated_at', 'timestamptz'], ['x.id', 'uuid']],
        page,
      });
      return { data: r.rows.map(externalDto), nextCursor: r.nextCursor };
    });
  }

  @Get('external-records/:id')
  @ApiScoped('external:read')
  get(@ApiKey() k: ApiPrincipal, @Param('id', Uuid) id: string) {
    return this.db.txAs(apiContext(k), async (c) => {
      const r = (await c.query(`SELECT ${EXTERNAL_SELECT} FROM external_record x WHERE x.id = $1`, [id])).rows[0];
      if (!r) throw new NotFoundException('Externer Nachweis nicht gefunden');
      return externalDto(r);
    });
  }

  /**
   * Erfassen wie „Verwaltung erfasst“ (Screen 9): gilt sofort (Status „freigegeben“, versiegelter Nachweis wird erzeugt)
   * oder mit review=true zur Prüfung. JSON-Body oder multipart/form-data mit Feld „data“ (JSON) und Dateien „receipts“
   * (PDF/JPG/PNG, gemeinsamer Beleg für alle Personen).
   */
  @Post('external-records')
  @ApiScoped('external:write')
  @UseInterceptors(FilesInterceptor('receipts', MAX_FILES, { limits: { fileSize: 50 * 1024 * 1024, files: MAX_FILES } }))
  async create(@ApiKey() k: ApiPrincipal, @Body() raw: Record<string, unknown>, @UploadedFiles() files: Express.Multer.File[] = []) {
    let input: unknown = raw;
    if (typeof raw?.data === 'string') {
      try {
        input = JSON.parse(raw.data);
      } catch {
        throw new BadRequestException('Feld „data“ enthält kein gültiges JSON');
      }
    }
    const parsed = ExternalCreate.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Eingaben unvollständig oder ungültig',
        fields: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const b: ExternalCreate = parsed.data;
    const receipts: ReceiptFile[] = [];
    for (const f of files) receipts.push(await this.ext.storeReceipt(k.tenantId, f.buffer, f.originalname));
    const status: ExtStatus = b.review ? 'eingereicht' : 'freigegeben';
    const actor = { kind: 'api-key' as const, keyId: k.keyId };
    const res = await this.db.txAs(systemContext(k), async (c) => {
      const persons = (await c.query('SELECT id FROM person WHERE id = ANY($1::uuid[])', [b.personIds])).rows;
      if (persons.length !== new Set(b.personIds).size) throw new BadRequestException('Mindestens eine Person wurde nicht gefunden');
      const fields: RecordFields = {
        requirementId: b.requirementId, trainingId: b.trainingId, freeTitle: b.title, provider: b.provider, heldOn: b.heldOn,
        durationHours: b.durationHours, durationLabel: b.durationLabel, location: b.location, isMedical: b.isMedical,
      };
      const asg = await this.ext.resolveAssignment(c, fields);
      const proposal = await this.ext.proposal(c, asg.requirementId, asg.trainingId, b.heldOn ?? null);
      const validUntil = b.validUntil !== undefined ? b.validUntil : proposal.validUntil;
      if (validUntil && b.heldOn && validUntil < b.heldOn) throw new BadRequestException('„validUntil“ liegt vor dem Schulungsdatum');
      if (status === 'freigegeben' && b.heldOn && b.heldOn > this.ext.today()) throw new BadRequestException('Das Schulungsdatum liegt in der Zukunft');
      const groupId = b.personIds.length > 1 ? randomUUID() : null;
      const ids: string[] = [];
      for (const personId of [...new Set(b.personIds)]) {
        const id = await this.ext.insertRecord(c, {
          personId, groupId, fields, files: receipts, source: 'verwaltung', status,
          validUntil: status === 'freigegeben' ? validUntil : (b.validUntil ?? null), reviewed: status === 'freigegeben',
        });
        ids.push(id);
        await this.audit.record(c, {
          entity: 'external_record', entityId: id, action: status === 'freigegeben' ? 'recorded_and_approved' : 'recorded',
          payload: actorPayload(actor, { personId, status, groupId }),
        });
        if (status === 'freigegeben') await WebhookEmitter.emit(c, k.tenantId, 'external_record.approved', { externalRecordId: id });
      }
      return { ids, groupId };
    });
    const sealed = status === 'freigegeben' ? await this.ext.sealApproved(k.tenantId, res.ids) : [];
    if (status !== 'freigegeben') await this.ext.enqueueOcr(k.tenantId, res.ids);
    const rows = await this.db.txAs(apiContext({ ...k, scopes: [...k.scopes, 'external:read'] }), async (c) =>
      (await c.query(`SELECT ${EXTERNAL_SELECT} FROM external_record x WHERE x.id = ANY($1::uuid[])`, [res.ids])).rows,
    );
    return {
      groupId: res.groupId,
      status,
      records: res.ids.map((id) => {
        const r = rows.find((x) => x.id === id);
        return { ...(r ? externalDto(r) : { id }), evidenceId: sealed.find((s) => s.recordId === id)?.evidence.id ?? null };
      }),
    };
  }
}
