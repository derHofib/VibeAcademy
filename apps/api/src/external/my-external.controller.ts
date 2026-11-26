import type {} from 'multer';
import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Res,
  UnauthorizedException, UploadedFiles, UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { DbContext } from '@sn/db';
import type { Response } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AnyAccount } from '../auth/decorators';
import { ZodBody } from '../common/errors';
import { currentRequest } from '../common/request-context';
import { ComplianceService } from '../compliance/compliance.service';
import { DbService } from '../db/db.service';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage';
import { Inject } from '@nestjs/common';
import { FieldsSchema } from './external.controller';
import { ExternalService, type RecordRow } from './external.service';
import { extractFields } from './ocr';
import type { ReceiptFile } from './receipts';

/** Multipart-Felder kommen als Text – leere Werte = nicht gesetzt. */
const txt = (s: z.ZodType) => z.preprocess((v) => (v === '' || v === undefined ? undefined : v), s.optional());
const CreateForm = z.object({
  personId: txt(z.uuid()),
  requirementId: txt(z.uuid()),
  trainingId: txt(z.uuid()),
  freeTitle: txt(z.string().trim().min(2).max(300)),
  provider: txt(z.string().trim().max(300)),
  heldOn: txt(z.iso.date()),
  durationLabel: txt(z.string().trim().max(100)),
  location: txt(z.string().trim().max(300)),
  isMedical: txt(z.enum(['true', 'false']).transform((v) => v === 'true')),
  submit: txt(z.enum(['true', 'false']).transform((v) => v === 'true')),
});
const SubmitSchema = FieldsSchema.partial();
export const intervalLabel = (m: number) => (m === 12 ? 'jährlich' : m % 12 === 0 ? `alle ${m / 12} Jahre` : `alle ${m} Monate`);

interface Own {
  ctx: DbContext;
  tenantId: string;
  personId: string;
  rec: RecordRow;
}

/**
 * Mitarbeiter reicht eigene externe Nachweise mobil ein (Screen 10). Zugang über das Teilnehmerkonto (E-25):
 * eingereicht wird für die mit dem Konto verknüpfte Person im jeweiligen Mandanten. Schreiben im Systemkontext nach
 * geprüfter Zuordnung (E-27); Lesen nur eigener Datensätze.
 */
@Controller('me/external-records')
export class MyExternalController {
  constructor(
    private readonly db: DbService,
    private readonly ext: ExternalService,
    private readonly audit: AuditService,
    private readonly compliance: ComplianceService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  private accountId(): string {
    const s = currentRequest()?.session;
    if (s?.kind !== 'account') throw new UnauthorizedException('Bitte mit Ihrem Konto anmelden');
    return s.accountId;
  }

  private async linked(accountId: string) {
    return (await this.db.txAs({}, (c) => c.query('SELECT * FROM app.external_targets($1)', [accountId]))).rows as Array<{
      person_id: string; person_name: string; tenant_id: string; tenant_name: string;
    }>;
  }

  private sysCtx(tenantId: string, personId: string, accountId: string): DbContext {
    return { tenantId, personId, accountId, roles: ['system', 'teilnehmer'] };
  }

  /** Eigenen Datensatz finden (RLS „nur eigene“ im Teilnehmerkontext), dann Systemkontext für Lesen/Schreiben. */
  private async own(id: string): Promise<Own> {
    const accountId = this.accountId();
    for (const t of await this.linked(accountId)) {
      const hit = await this.db.txAs({ tenantId: t.tenant_id, accountId, roles: ['teilnehmer'] }, (c) =>
        c.query('SELECT person_id FROM external_record WHERE id = $1', [id]),
      );
      if (hit.rowCount) {
        const ctx = this.sysCtx(t.tenant_id, hit.rows[0].person_id, accountId);
        const rec = await this.db.txAs(ctx, async (c) => (await this.ext.records(c, 'x.id = $1', [id]))[0]!);
        return { ctx, tenantId: t.tenant_id, personId: hit.rows[0].person_id, rec };
      }
    }
    throw new NotFoundException('Nachweis nicht gefunden');
  }

  /** Für wen kann ich einreichen? Verknüpfte Personen je Mandant mit ihren Pflichtschulungen und dem aktuellen Stand. */
  @AnyAccount()
  @Get('targets')
  async targets() {
    const accountId = this.accountId();
    const out = [];
    for (const t of await this.linked(accountId)) {
      const options = await this.db.txAs(this.sysCtx(t.tenant_id, t.person_id, accountId), async (c) => {
        const rows = await this.compliance.rows(c, this.ext.now(), { personId: t.person_id });
        return rows.map((r) => ({
          requirementId: r.requirementId, trainingId: r.trainingId, qualificationName: r.qualificationName, trainingTitle: r.trainingTitle,
          trainingFormat: r.trainingFormat, intervalMonths: r.intervalMonths,
          label: `${r.trainingTitle} · Qualifikation ${r.qualificationName} · ${intervalLabel(r.intervalMonths)}`,
          current: { state: r.state, validUntil: r.validUntil },
        }));
      });
      out.push({ personId: t.person_id, personName: t.person_name, tenantId: t.tenant_id, tenantName: t.tenant_name, options });
    }
    return out;
  }

  /** Eigene externe Nachweise über alle Mandanten. */
  @AnyAccount()
  @Get()
  async list() {
    const accountId = this.accountId();
    const out = [];
    for (const t of await this.linked(accountId)) {
      const rows = await this.db.txAs(this.sysCtx(t.tenant_id, t.person_id, accountId), async (c) => {
        const recs = await this.ext.records(c, `x.person_id = $1 AND x.status <> 'widerrufen'`, [t.person_id]);
        const ev = await this.ext.evidenceFor(c, recs.map((r) => r.id));
        return recs.map((r) => ({
          id: r.id, tenantId: t.tenant_id, tenantName: t.tenant_name, title: r.title, status: r.status, source: r.source, heldOn: r.held_on,
          validUntil: r.valid_until, qualificationName: r.qualification_name, submittedAt: r.submitted_at, reviewedAt: r.reviewed_at, reviewNote: r.review_note,
          evidence: ev.get(r.id) ?? null,
        }));
      });
      out.push(...rows);
    }
    return out;
  }

  /** Foto/PDF hochladen (1–5 Seiten) → Entwurf + OCR-Job; mit submit=true sofort „eingereicht“. */
  @AnyAccount()
  @Post()
  @UseInterceptors(FilesInterceptor('dateien', 5, { limits: { fileSize: 50 * 1024 * 1024 } }))
  async create(@UploadedFiles() files: Express.Multer.File[] = [], @Body() raw: Record<string, string>) {
    const parsed = CreateForm.safeParse(raw ?? {});
    if (!parsed.success) throw new BadRequestException({ message: 'Eingaben unvollständig oder ungültig', fields: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    const b = parsed.data as {
      personId?: string; requirementId?: string; trainingId?: string; freeTitle?: string; provider?: string; heldOn?: string;
      durationLabel?: string; location?: string; isMedical?: boolean; submit?: boolean;
    };
    if (!files.length) throw new BadRequestException('Bitte ein Foto oder PDF des Belegs hochladen (Feld „dateien“)');
    const accountId = this.accountId();
    const linked = await this.linked(accountId);
    const target = b.personId ? linked.find((t) => t.person_id === b.personId) : linked.length === 1 ? linked[0] : undefined;
    if (!target) throw new BadRequestException(linked.length ? 'Bitte die Organisation (personId) auswählen' : 'Ihr Konto ist noch mit keiner Person verknüpft');
    const stored: ReceiptFile[] = [];
    for (const f of files) stored.push(await this.ext.storeReceipt(target.tenant_id, f.buffer, f.originalname));
    const status = b.submit ? 'eingereicht' : 'entwurf';
    const ctx = this.sysCtx(target.tenant_id, target.person_id, accountId);
    const id = await this.db.txAs(ctx, async (c) => {
      if (b.submit && !b.requirementId && !b.trainingId && !b.freeTitle) throw new BadRequestException('Bitte den Kurs angeben');
      const recId = await this.ext.insertRecord(c, {
        personId: target.person_id, groupId: null, files: stored, source: 'selbst', status, submittedByPerson: target.person_id,
        fields: { requirementId: b.requirementId, trainingId: b.trainingId, freeTitle: b.freeTitle, provider: b.provider, heldOn: b.heldOn, durationLabel: b.durationLabel, location: b.location, isMedical: b.isMedical },
      });
      await this.audit.record(c, { entity: 'external_record', entityId: recId, action: status === 'eingereicht' ? 'submitted' : 'draft_created', payload: { files: stored.length } });
      return recId;
    });
    await this.ext.enqueueOcr(target.tenant_id, [id]);
    return { id, status, tenantId: target.tenant_id, ocr: { status: b.isMedical ? 'keine' : 'ausstehend' } };
  }

  @AnyAccount()
  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const o = await this.own(id);
    return this.db.txAs(o.ctx, (c) => this.view(c, o));
  }

  private async view(c: pg.PoolClient, o: Own) {
    const r = (await this.ext.records(c, 'x.id = $1', [o.rec.id]))[0]!;
    const proposal = await this.ext.proposal(c, r.requirement_id, r.training_id, r.held_on);
    const ocr = r.ocr_fields?.lines?.length ? extractFields(r.ocr_fields.lines, r.person_name) : null;
    const ev = (await this.ext.evidenceFor(c, [r.id])).get(r.id) ?? null;
    const label = r.qualification_name ?? r.training_title;
    const validUntil = r.valid_until ?? proposal.validUntil;
    const kind = this.ext.fileKind(r);
    const pages = r.evidence_files.reduce((s, f) => s + f.pages, 0);
    const tenantName = (await c.query('SELECT name FROM tenant WHERE id = $1', [o.tenantId])).rows[0]?.name;
    const submitted = ['eingereicht', 'freigegeben', 'abgelaufen'].includes(r.status);
    return {
      record: this.ext.recordDto(r),
      tenantName,
      files: r.evidence_files.map((f, i) => ({ index: i, name: f.name, mime: f.mime, size: f.size, pages: f.pages, url: `/api/me/external-records/${r.id}/files/${i}` })),
      ocr: { status: r.ocr_status, pages: r.ocr_fields?.pages ?? [], fields: ocr, suggestedRequirementId: r.ocr_fields?.suggestedRequirementId ?? null },
      validity: { proposed: proposal.validUntil, intervalMonths: proposal.intervalMonths },
      credit: label && validUntil ? { label, validUntil } : null,
      reviewerName: await this.ext.reviewerName(c, o.tenantId, r),
      timeline: [
        { step: 'eingereicht', done: submitted, at: r.submitted_at, note: kind ? `${kind}, ${pages} ${pages === 1 ? 'Seite' : 'Seiten'}` : null },
        { step: 'in_pruefung', done: ['freigegeben', 'abgelaufen'].includes(r.status), current: r.status === 'eingereicht', at: null, note: r.status === 'zurueckgegeben' ? `Zurückgegeben: ${r.review_note}` : 'Schulungsverantwortlicher prüft Beleg und Angaben' },
        { step: 'freigegeben', done: ['freigegeben', 'abgelaufen'].includes(r.status), at: r.status === 'freigegeben' ? r.reviewed_at : null, note: label ? `Wird auf „${label}“ angerechnet` : 'Nur Dokumentation' },
      ],
      evidence: ev,
    };
  }

  /** Angaben korrigieren (Entwurf oder zurückgegeben). */
  @AnyAccount()
  @Patch(':id')
  async patch(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(SubmitSchema)) b: z.infer<typeof SubmitSchema>) {
    const o = await this.own(id);
    if (!['entwurf', 'zurueckgegeben'].includes(o.rec.status)) throw new BadRequestException('Der Nachweis ist bereits eingereicht');
    return this.db.txAs(o.ctx, async (c) => {
      await this.ext.applyFields(c, id, b);
      await this.audit.record(c, { entity: 'external_record', entityId: id, action: 'edited_by_person' });
      return this.view(c, o);
    });
  }

  /** Weitere Seite hinzufügen (Screen 10a „+ Weitere Seite“) – OCR läuft erneut. */
  @AnyAccount()
  @Post(':id/files')
  @UseInterceptors(FilesInterceptor('dateien', 5, { limits: { fileSize: 50 * 1024 * 1024 } }))
  async addFiles(@Param('id', ParseUUIDPipe) id: string, @UploadedFiles() files: Express.Multer.File[] = []) {
    const o = await this.own(id);
    if (!['entwurf', 'zurueckgegeben'].includes(o.rec.status)) throw new BadRequestException('Der Nachweis ist bereits eingereicht');
    if (!files.length) throw new BadRequestException('Bitte eine Datei senden (Feld „dateien“)');
    if (o.rec.evidence_keys.length + files.length > 10) throw new BadRequestException('Höchstens 10 Belege je Nachweis');
    const stored: ReceiptFile[] = [];
    for (const f of files) stored.push(await this.ext.storeReceipt(o.tenantId, f.buffer, f.originalname));
    await this.db.txAs(o.ctx, async (c) => {
      await c.query(
        `UPDATE external_record SET evidence_keys = evidence_keys || $2::text[], evidence_sha256 = evidence_sha256 || $3::text[],
                evidence_files = evidence_files || $4::jsonb, ocr_status = CASE WHEN is_medical THEN 'keine' ELSE 'ausstehend' END WHERE id = $1`,
        [id, stored.map((f) => f.key), stored.map((f) => f.sha256), JSON.stringify(stored.map((f) => ({ name: f.name, mime: f.mime, size: f.size, pages: f.pages })))],
      );
      await this.audit.record(c, { entity: 'external_record', entityId: id, action: 'files_added', payload: { files: stored.length } });
    });
    await this.ext.enqueueOcr(o.tenantId, [id]);
    return { ok: true, files: o.rec.evidence_keys.length + stored.length };
  }

  /** „Zur Prüfung einreichen“ (optional mit letzten Korrekturen). */
  @AnyAccount()
  @Post(':id/submit')
  @HttpCode(200)
  async submit(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(SubmitSchema)) b: z.infer<typeof SubmitSchema>) {
    const o = await this.own(id);
    if (!['entwurf', 'zurueckgegeben'].includes(o.rec.status)) throw new BadRequestException('Der Nachweis ist bereits eingereicht');
    return this.db.txAs(o.ctx, async (c) => {
      await this.ext.applyFields(c, id, b);
      const r = (await this.ext.records(c, 'x.id = $1', [id]))[0]!;
      if (!r.title) throw new BadRequestException('Bitte den Kurs angeben');
      if (!r.evidence_keys.length) throw new BadRequestException('Bitte einen Beleg hochladen');
      await c.query(
        `UPDATE external_record SET status = 'eingereicht', submitted_at = $2, reviewed_by = NULL, reviewed_at = NULL WHERE id = $1`,
        [id, this.ext.now()],
      );
      await this.audit.record(c, { entity: 'external_record', entityId: id, action: 'submitted', payload: { resubmitted: r.status === 'zurueckgegeben' } });
      return { id, status: 'eingereicht', submittedAt: this.ext.now(), reviewerName: await this.ext.reviewerName(c, o.tenantId, r) };
    });
  }

  @AnyAccount()
  @Get(':id/files/:n')
  async file(@Param('id', ParseUUIDPipe) id: string, @Param('n', ParseIntPipe) n: number, @Res() res: Response) {
    const o = await this.own(id);
    const key = o.rec.evidence_keys[n];
    const meta = o.rec.evidence_files[n];
    if (!key || !meta) throw new NotFoundException('Beleg nicht gefunden');
    res.setHeader('content-type', meta.mime);
    res.setHeader('cache-control', 'private, no-store');
    res.send(await this.ext.loadReceipt(key));
  }

  /** Eigener versiegelter Nachweis als PDF. */
  @AnyAccount()
  @Get(':id/evidence/pdf')
  async evidencePdf(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const o = await this.own(id);
    const e = await this.db.txAs(o.ctx, async (c) =>
      (await c.query(`SELECT pdf_key, nachweis_nr FROM evidence WHERE external_record_id = $1 AND status = 'erzeugt' AND revoked_at IS NULL`, [id])).rows[0],
    );
    if (!e) throw new NotFoundException('Nachweis wird noch erstellt');
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="${e.nachweis_nr}.pdf"`);
    res.setHeader('cache-control', 'private, no-store');
    res.send(await this.storage.get('evidence', e.pdf_key));
  }

  @AnyAccount()
  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    const o = await this.own(id);
    if (o.rec.status !== 'entwurf') throw new BadRequestException('Nur Entwürfe können gelöscht werden');
    await this.db.txAs(o.ctx, async (c) => {
      await c.query(`DELETE FROM external_record WHERE id = $1 AND status = 'entwurf'`, [id]);
      await this.audit.record(c, { entity: 'external_record', entityId: id, action: 'deleted_by_person' });
    });
    return { ok: true };
  }
}
