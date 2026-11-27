import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, PayloadTooLargeException } from '@nestjs/common';
import { berlinDate } from '@sn/shared';
import type pg from 'pg';
import QRCode from 'qrcode';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { sha256 } from '../common/crypto';
import { currentRequest } from '../common/request-context';
import { ComplianceService, pgDate } from '../compliance/compliance.service';
import { APP_CONFIG, type AppConfig } from '../config';
import { DbService } from '../db/db.service';
import { dt, EvidenceService, type EvidenceHelpers } from '../evidence/evidence.service';
import { JobRunner } from '../jobs/job-runner';
import { NotificationService } from '../notifications/notification.service';
import { RedisService } from '../redis/redis.service';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage';
import { reviewChecks, type CheckRecord, type Flag, type Hint } from './checks';
import { renderExternalEvidenceHtml } from './external-evidence-template';
import { extractFields, normalize, runOcr, type OcrLine } from './ocr';
import { cleanName, extFor, pageCount, receiptAsPdf, sniffMime, type ReceiptFile, type ReceiptMime } from './receipts';
import { WebhookEmitter } from '../webhooks/webhook-emitter';

export type Queued = { id: string; tenantId: string | null };
export type ExtStatus = 'entwurf' | 'eingereicht' | 'freigegeben' | 'zurueckgegeben' | 'abgelaufen' | 'widerrufen';
export type ExtSource = 'verwaltung' | 'selbst' | 'import';

/** Fachliche Felder eines externen Nachweises (alle optional; Pflicht erst bei Einreichen/Freigabe). */
export interface RecordFields {
  requirementId?: string | null;
  trainingId?: string | null;
  freeTitle?: string | null;
  provider?: string | null;
  heldOn?: string | null;
  durationHours?: number | null;
  durationLabel?: string | null;
  location?: string | null;
  isMedical?: boolean;
}

export const SOURCE_LABEL: Record<ExtSource, string> = { verwaltung: 'von Verwaltung erfasst', selbst: 'selbst eingereicht', import: 'importiert' };
const STAFF = ['admin', 'verantwortlich'];
const de = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : null);
const mmyy = (iso: string | null) => (iso ? `${iso.slice(5, 7)}/${iso.slice(0, 4)}` : null);

/** Gemeinsame Abfrage für Liste und Detail (RLS des Aufrufers). */
const RECORD_SELECT = `
  SELECT x.id, x.tenant_id, x.person_id, x.group_id, x.requirement_id, x.qualification_id, x.training_id, x.free_title, x.provider,
         x.held_on::text AS held_on, x.duration_hours::float8 AS duration_hours, x.duration_label, x.location, x.valid_until::text AS valid_until,
         x.is_medical, x.evidence_keys, x.evidence_sha256, x.evidence_files, x.source, x.status, x.ocr_status, x.ocr_fields, x.flags,
         x.submitted_by, x.submitted_by_person, x.submitted_at, x.reviewed_by, x.reviewed_at, x.review_note, x.supersedes, x.created_at, x.updated_at,
         p.name AS person_name, p.personalnr, p.email AS person_email, p.org_unit_id, o.name AS org_unit_name,
         coalesce(t.titel, x.free_title) AS title, t.titel AS training_title, t.format AS training_format, t.ansprechpartner,
         q.name AS qualification_name,
         (SELECT a.display_name FROM account a WHERE a.id = x.reviewed_by) AS reviewed_by_name,
         (SELECT a.display_name FROM account a WHERE a.id = x.submitted_by) AS submitted_by_name
    FROM external_record x JOIN person p ON p.id = x.person_id LEFT JOIN org_unit o ON o.id = p.org_unit_id
    LEFT JOIN training t ON t.id = x.training_id LEFT JOIN qualification q ON q.id = x.qualification_id`;

export interface RecordRow {
  id: string; tenant_id: string; person_id: string; group_id: string | null; requirement_id: string | null; qualification_id: string | null;
  training_id: string | null; free_title: string | null; provider: string | null; held_on: string | null; duration_hours: number | null;
  duration_label: string | null; location: string | null; valid_until: string | null; is_medical: boolean; evidence_keys: string[];
  evidence_sha256: string[]; evidence_files: Array<{ name: string; mime: ReceiptMime; size: number; pages: number }>; source: ExtSource; status: ExtStatus;
  ocr_status: 'keine' | 'ausstehend' | 'fertig' | 'fehler'; ocr_fields: { engine?: string; pages?: Array<{ width: number; height: number }>; lines?: OcrLine[]; error?: string; suggestedRequirementId?: string | null } | null;
  flags: Flag[]; submitted_by: string | null; submitted_by_person: string | null; submitted_at: Date | null; reviewed_by: string | null;
  reviewed_at: Date | null; review_note: string | null; supersedes: string | null; created_at: Date; updated_at: Date;
  person_name: string; personalnr: string | null; person_email: string | null; org_unit_id: string | null; org_unit_name: string | null;
  title: string | null; training_title: string | null; training_format: string | null; ansprechpartner: string | null; qualification_name: string | null;
  reviewed_by_name: string | null; submitted_by_name: string | null;
}

/** Externe Nachweise (Schritt 2.6): Belege, Erfassung, OCR-Job, Prüfung, Freigabe mit versiegeltem Nachweis. */
@Injectable()
export class ExternalService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ExternalService.name);
  private ocr!: JobRunner<{ tenantId: string; recordId: string }>;

  constructor(
    private readonly db: DbService,
    private readonly redis: RedisService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly evidence: EvidenceService,
    private readonly compliance: ComplianceService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  onModuleInit() {
    this.evidence.registerCollector('extern', (id, tenantId, h) => this.collect(id, tenantId, h));
    this.ocr = new JobRunner('ocr', this.redis, this.config, (d) => this.processOcr(d.tenantId, d.recordId), 1);
  }
  onModuleDestroy() {
    return this.ocr.close();
  }

  get undoMinutes() {
    return this.config.EXTERNAL_UNDO_MINUTES;
  }

  // ── Belege ────────────────────────────────────────────────
  async storeReceipt(tenantId: string, data: Buffer, name: string): Promise<ReceiptFile> {
    if (data.length > this.config.EXTERNAL_UPLOAD_MAX_MB * 1024 * 1024) throw new PayloadTooLargeException(`Beleg ist größer als ${this.config.EXTERNAL_UPLOAD_MAX_MB} MB`);
    const mime = sniffMime(data);
    if (!mime) throw new BadRequestException('Bitte ein PDF, JPG oder PNG hochladen');
    let pages = 1;
    try {
      pages = await pageCount(data, mime);
    } catch {
      throw new BadRequestException('Das PDF ist beschädigt und kann nicht gelesen werden');
    }
    const hash = sha256(data);
    const key = `external/${tenantId}/${hash}.${extFor(mime)}`;
    await this.storage.put('uploads', key, data, { contentType: mime });
    return { key, sha256: hash, name: cleanName(name), mime, size: data.length, pages };
  }

  loadReceipt(key: string) {
    return this.storage.get('uploads', key);
  }

  // ── Datensätze anlegen ────────────────────────────────────
  /** Zuordnung auflösen: Anforderung → Qualifikation + Schulung. */
  async resolveAssignment(c: pg.PoolClient, f: RecordFields) {
    let qualificationId: string | null = null;
    let trainingId = f.trainingId ?? null;
    if (f.requirementId) {
      const r = (await c.query('SELECT qualification_id, training_id FROM requirement WHERE id = $1', [f.requirementId])).rows[0];
      if (!r) throw new BadRequestException('Pflichtschulung nicht gefunden');
      qualificationId = r.qualification_id;
      trainingId = r.training_id;
    } else if (trainingId) {
      const t = await c.query('SELECT 1 FROM training WHERE id = $1', [trainingId]);
      if (!t.rowCount) throw new BadRequestException('Schulung nicht gefunden');
    }
    return { requirementId: f.requirementId ?? null, qualificationId, trainingId };
  }

  async insertRecord(
    c: pg.PoolClient,
    a: {
      personId: string; groupId: string | null; fields: RecordFields; files: ReceiptFile[]; source: ExtSource; status: ExtStatus;
      flags?: Flag[]; submittedByPerson?: string | null; validUntil?: string | null; reviewed?: boolean; supersedes?: string | null;
    },
  ): Promise<string> {
    const asg = await this.resolveAssignment(c, a.fields);
    const med = !!a.fields.isMedical;
    const now = this.clock.now();
    const submitted = a.status === 'eingereicht' || a.status === 'freigegeben';
    const r = await c.query(
      `INSERT INTO external_record (person_id, group_id, requirement_id, qualification_id, training_id, free_title, provider, held_on,
         duration_hours, duration_label, location, valid_until, is_medical, evidence_keys, evidence_sha256, evidence_files, source, status,
         ocr_status, flags, submitted_by_person, submitted_at, reviewed_by, reviewed_at, supersedes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) RETURNING id`,
      [
        a.personId, a.groupId, asg.requirementId, asg.qualificationId, asg.trainingId, a.fields.freeTitle ?? null, a.fields.provider ?? null,
        a.fields.heldOn ?? null, med ? null : (a.fields.durationHours ?? null), med ? null : (a.fields.durationLabel ?? null), med ? null : (a.fields.location ?? null),
        a.validUntil ?? null, med, a.files.map((f) => f.key), a.files.map((f) => f.sha256),
        JSON.stringify(a.files.map((f) => ({ name: f.name, mime: f.mime, size: f.size, pages: f.pages }))),
        a.source, a.status, a.files.length && !med && a.status !== 'freigegeben' ? 'ausstehend' : 'keine', JSON.stringify(a.flags ?? []),
        a.submittedByPerson ?? null, submitted ? now : null, a.reviewed ? currentRequest()?.session?.accountId ?? null : null, a.reviewed ? now : null,
        a.supersedes ?? null,
      ],
    );
    return r.rows[0].id as string;
  }

  /** Gültigkeit vorschlagen (Intervall aus Anforderung bzw. Schulung). */
  async proposal(c: pg.PoolClient, requirementId: string | null, trainingId: string | null, heldOn: string | null) {
    const months = await this.compliance.intervalFor(c, requirementId, trainingId);
    return { intervalMonths: months, validUntil: this.compliance.proposeValidUntil(heldOn, months) };
  }

  /** OCR nach dem Commit einreihen (nur Datensätze mit Status „ausstehend“). */
  async enqueueOcr(tenantId: string, recordIds: string[]) {
    for (const id of recordIds) await this.ocr.add({ tenantId, recordId: id }, { jobId: `ocr-${id}-${Date.now()}`, attempts: 2, backoff: { type: 'fixed', delay: 5000 } });
  }

  /** Texterkennung (E-18): Vorschläge in ocr_fields, bei Entwürfen leere Felder vorbelegen (bleiben editierbar). */
  async processOcr(tenantId: string, recordId: string): Promise<void> {
    const ctx = { tenantId, roles: ['system'] };
    const rec = (await this.db.txAs(ctx, (c) => c.query(`${RECORD_SELECT} WHERE x.id = $1`, [recordId]))).rows[0] as RecordRow | undefined;
    if (rec?.ocr_status === 'fertig') return; // z. B. gemeinsamer Beleg einer Gruppe bereits gelesen
    if (!rec || rec.is_medical || !rec.evidence_keys.length) {
      if (rec) await this.db.txAs(ctx, (c) => c.query(`UPDATE external_record SET ocr_status = 'keine' WHERE id = $1`, [recordId]));
      return;
    }
    try {
      const files = await Promise.all(rec.evidence_keys.map(async (k, i) => ({ data: await this.loadReceipt(k), mime: rec.evidence_files[i]!.mime })));
      const res = await runOcr(files, { tesseract: this.config.TESSERACT_BIN, lang: this.config.OCR_LANG });
      const fields = extractFields(res.lines, rec.person_name);
      await this.db.txAs(ctx, async (c) => {
        const suggested = fields.course ? await this.matchRequirement(c, rec.person_id, fields.course.value) : null;
        const payload = { engine: res.engine, at: this.clock.now().toISOString(), pages: res.pages, lines: res.lines, suggestedRequirementId: suggested?.requirementId ?? null };
        await c.query(
          `UPDATE external_record SET ocr_status = 'fertig', ocr_fields = $2
            WHERE id = $1 OR (group_id IS NOT NULL AND group_id = $3 AND evidence_keys = $4 AND ocr_status <> 'fertig')`,
          [recordId, payload, rec.group_id, rec.evidence_keys],
        );
        if (rec.status === 'entwurf') {
          await c.query(
            `UPDATE external_record SET held_on = coalesce(held_on, $2::date), provider = coalesce(provider, $3),
                    free_title = CASE WHEN training_id IS NULL THEN coalesce(free_title, $4) ELSE free_title END,
                    duration_label = coalesce(duration_label, $5), duration_hours = coalesce(duration_hours, $6),
                    requirement_id = coalesce(requirement_id, $7), qualification_id = coalesce(qualification_id, $8), training_id = coalesce(training_id, $9)
              WHERE id = $1 AND status = 'entwurf'`,
            [
              recordId, fields.date?.normalized ?? null, fields.provider?.value ?? null, fields.course?.value ?? null, fields.duration?.value ?? null,
              typeof fields.duration?.normalized === 'number' ? fields.duration.normalized : null,
              rec.requirement_id || rec.training_id ? null : (suggested?.requirementId ?? null),
              rec.requirement_id || rec.training_id ? null : (suggested?.qualificationId ?? null),
              rec.requirement_id || rec.training_id ? null : (suggested?.trainingId ?? null),
            ],
          );
        }
        await this.audit.record(c, { entity: 'external_record', entityId: recordId, action: 'ocr_done', payload: { engine: res.engine, lines: res.lines.length } });
      });
    } catch (e) {
      this.log.warn(`OCR ${recordId}: ${(e as Error).message}`);
      await this.db.txAs(ctx, (c) =>
        c.query(`UPDATE external_record SET ocr_status = 'fehler', ocr_fields = $2 WHERE id = $1`, [recordId, { error: (e as Error).message.slice(0, 300) }]),
      );
    }
  }

  /** Erkannten Kurstitel einer Pflichtschulung der Person zuordnen (nur Vorschlag). */
  async matchRequirement(c: pg.PoolClient, personId: string, courseText: string) {
    const rows = (
      await c.query(
        `SELECT r.id, r.qualification_id, r.training_id, t.titel FROM requirement r JOIN training t ON t.id = r.training_id
          WHERE r.active AND r.qualification_id IN (SELECT pq.qualification_id FROM person_qualification pq WHERE pq.person_id = $1)`,
        [personId],
      )
    ).rows;
    const text = normalize(courseText);
    const hits = rows.filter((r) => {
      const t = normalize(r.titel);
      return t && (text.includes(t) || t.includes(text));
    });
    return hits.length === 1 ? { requirementId: hits[0].id as string, qualificationId: hits[0].qualification_id as string, trainingId: hits[0].training_id as string } : null;
  }

  // ── Lesen ─────────────────────────────────────────────────
  async records(c: pg.PoolClient, where: string, params: unknown[]): Promise<RecordRow[]> {
    return (await c.query(`${RECORD_SELECT} WHERE ${where} ORDER BY coalesce(x.submitted_at, x.created_at) DESC, p.name`, params)).rows;
  }

  async evidenceFor(c: pg.PoolClient, ids: string[]) {
    const r = await c.query(
      `SELECT external_record_id, id, status, nachweis_nr, verify_code, pdf_sha256, revoked_at FROM evidence WHERE external_record_id = ANY($1::uuid[])`,
      [ids],
    );
    return new Map<string, { id: string; status: string; nachweisNr: string; verifyCode: string; sha256: string | null; revoked: boolean }>(
      r.rows.map((e) => [e.external_record_id, { id: e.id, status: e.revoked_at ? 'widerrufen' : e.status, nachweisNr: e.nachweis_nr, verifyCode: e.verify_code, sha256: e.pdf_sha256, revoked: !!e.revoked_at }]),
    );
  }

  checkRecord(r: RecordRow): CheckRecord {
    return {
      id: r.id, personId: r.person_id, personName: r.person_name, personalnr: r.personalnr, heldOn: r.held_on, provider: r.provider, title: r.title,
      durationLabel: r.duration_label, isMedical: r.is_medical, hasReceipt: r.evidence_keys.length > 0, flags: r.flags ?? [],
    };
  }

  fileKind(r: RecordRow): string | null {
    const f = r.evidence_files[0];
    if (!f) return null;
    if (f.mime === 'application/pdf') return 'PDF';
    return r.source === 'selbst' ? 'Foto' : 'Scan';
  }

  /** Vorgänge (Einzelperson oder Gruppe mit gemeinsamem Beleg) für die Warteschlange. */
  async cases(c: pg.PoolClient, records: RecordRow[], today: string) {
    const groups = new Map<string, RecordRow[]>();
    for (const r of records) {
      const k = r.group_id ?? r.id;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r);
    }
    const out = [];
    for (const [caseId, rs] of groups) {
      const first = rs[0]!;
      const validity = await this.proposal(c, first.requirement_id, first.training_id, first.held_on);
      const { hints, chip } = reviewChecks(rs.map((r) => this.checkRecord(r)), {
        today, ocrLines: first.ocr_fields?.lines ?? null, ocrStatus: first.ocr_status,
        validity: { validUntil: first.valid_until ?? validity.validUntil, intervalMonths: validity.intervalMonths, label: null }, qualificationName: first.qualification_name,
      });
      out.push({
        caseId,
        groupId: first.group_id,
        primaryRecordId: first.id,
        recordIds: rs.map((r) => r.id),
        kind: rs.length > 1 ? 'gruppe' : 'einzel',
        label: rs.length > 1 ? `${first.provider ?? first.title ?? 'Gruppe'} · ${rs.length} Personen` : first.person_name,
        title: first.title,
        persons: rs.map((r) => ({ recordId: r.id, personId: r.person_id, name: r.person_name, status: r.status })),
        status: first.status,
        source: first.source,
        sourceLabel: SOURCE_LABEL[first.source],
        submittedAt: first.submitted_at ?? first.created_at,
        reviewedAt: first.reviewed_at,
        heldOn: first.held_on,
        validUntil: first.valid_until,
        isMedical: first.is_medical,
        fileKind: this.fileKind(first),
        fileCount: first.evidence_keys.length,
        ocrStatus: first.ocr_status,
        chip: chip as { label: string; tone: 'ok' | 'warn' },
        hints: hints as Hint[],
      });
    }
    return out;
  }

  // ── Rechte ────────────────────────────────────────────────
  async permissions(c: pg.PoolClient, r: RecordRow) {
    const roles = currentRequest()?.roles ?? [];
    const staff = roles.some((x) => STAFF.includes(x));
    const own = (await c.query('SELECT $1::uuid IN (SELECT app.my_person_ids()) AS own', [r.person_id])).rows[0].own as boolean;
    const supervisor = roles.includes('vorgesetzter') && r.source === 'selbst'
      && (await c.query('SELECT $1::uuid IN (SELECT p.id FROM person p WHERE p.org_unit_id IN (SELECT app.led_org_units())) AS team', [r.person_id])).rows[0].team;
    const reviewer = (staff || supervisor) && !own;
    const now = this.clock.now().getTime();
    const undoUntil = r.status === 'freigegeben' && r.reviewed_at ? new Date(new Date(r.reviewed_at).getTime() + this.undoMinutes * 60_000) : null;
    return {
      approve: reviewer && ['entwurf', 'eingereicht', 'zurueckgegeben'].includes(r.status),
      return: reviewer && ['eingereicht', 'entwurf'].includes(r.status),
      undo: reviewer && !!undoUntil && undoUntil.getTime() > now,
      edit: staff && ['entwurf', 'eingereicht', 'zurueckgegeben'].includes(r.status),
      undoUntil: undoUntil && undoUntil.getTime() > now ? undoUntil.toISOString() : null,
      own,
    };
  }

  /** Bisherige Gültigkeit (ohne diesen Datensatz) für „Was sich ändert“. */
  async previousValidity(c: pg.PoolClient, personId: string, requirementId: string | null, trainingId: string | null, excludeId: string | null) {
    if (!requirementId && !trainingId) return null;
    const r = (
      await c.query(
        `SELECT max(coalesce(e.valid_until, (e.completed_on + make_interval(months => coalesce(rq.interval_months, 12)))::date))::text AS v
           FROM app.completion_events e LEFT JOIN requirement rq ON rq.id = $2
          WHERE e.person_id = $1 AND (($2::uuid IS NOT NULL AND e.requirement_id = $2) OR e.training_id = $3)
            AND ($4::uuid IS NULL OR e.source_id <> $4)`,
        [personId, requirementId, trainingId, excludeId],
      )
    ).rows[0];
    return r?.v ?? null;
  }

  /** Detailansicht (Screen 11) inkl. Gruppe, Belege, OCR-Vorschläge, Prüfhinweise, Wirkung. */
  async detail(c: pg.PoolClient, id: string, filesUrl: (recordId: string, n: number) => string) {
    const rec = (await this.records(c, 'x.id = $1', [id]))[0];
    if (!rec) throw new NotFoundException('Nachweis nicht gefunden');
    const group = rec.group_id ? await this.records(c, 'x.group_id = $1 AND x.status = $2', [rec.group_id, rec.status]) : [rec];
    const members = group.length ? group : [rec];
    const today = berlinDate(this.clock.now());
    const proposal = await this.proposal(c, rec.requirement_id, rec.training_id, rec.held_on);
    const validUntil = rec.valid_until ?? proposal.validUntil;
    const { checks, hints, chip } = reviewChecks(members.map((r) => this.checkRecord(r)), {
      today, ocrLines: rec.ocr_fields?.lines ?? null, ocrStatus: rec.ocr_status,
      validity: { validUntil, intervalMonths: proposal.intervalMonths, label: null }, qualificationName: rec.qualification_name,
    });
    const ocrFields = rec.ocr_fields?.lines?.length ? extractFields(rec.ocr_fields.lines, rec.person_name) : null;
    const ev = await this.evidenceFor(c, members.map((m) => m.id));
    const previous = await this.previousValidity(c, rec.person_id, rec.requirement_id, rec.training_id, rec.id);
    const label = rec.qualification_name ?? rec.training_title;
    const effect = members.length > 1
      ? { text: `Alle ${members.length} Personen erhalten den Nachweis „${rec.title ?? 'Externe Schulung'}“${validUntil ? ` (gültig bis ${de(validUntil)})` : ''}.`, previousValidUntil: null, newValidUntil: validUntil }
      : !validUntil || !label
        ? { text: rec.is_medical ? 'Teilnahme an der Vorsorge wird dokumentiert.' : 'Nur Dokumentation – keine Anrechnung auf die Pflichtmatrix.', previousValidUntil: null, newValidUntil: null }
        : { text: `${rec.person_name}: ${label} gültig bis ${de(validUntil)}${previous ? ` (bisher bis ${mmyy(previous)})` : ''}.`, previousValidUntil: previous, newValidUntil: validUntil };
    const perms = await this.permissions(c, rec);
    return {
      record: this.recordDto(rec),
      group: members.map((m) => {
        const h = hints.filter((x) => x.personId === m.person_id);
        return { recordId: m.id, personId: m.person_id, name: m.person_name, personalnr: m.personalnr, status: m.status, flags: m.flags, hints: h, evidence: ev.get(m.id) ?? null };
      }),
      files: rec.evidence_files.map((f, i) => ({ index: i, name: f.name, mime: f.mime, size: f.size, pages: f.pages, sha256: rec.evidence_sha256[i], url: filesUrl(rec.id, i) })),
      ocr: {
        status: rec.ocr_status,
        engine: rec.ocr_fields?.engine ?? null,
        pages: rec.ocr_fields?.pages ?? [],
        fields: ocrFields,
        suggestedRequirementId: rec.ocr_fields?.suggestedRequirementId ?? null,
        error: rec.ocr_fields?.error ?? null,
      },
      checks, hints, chip,
      validity: { proposed: proposal.validUntil, current: rec.valid_until, intervalMonths: proposal.intervalMonths, qualificationName: rec.qualification_name },
      effect,
      evidence: ev.get(rec.id) ?? null,
      undo: { possible: perms.undo, until: perms.undoUntil },
      permissions: { approve: perms.approve, return: perms.return, undo: perms.undo, edit: perms.edit },
    };
  }

  recordDto(r: RecordRow) {
    return {
      id: r.id, personId: r.person_id, personName: r.person_name, personalnr: r.personalnr, orgUnitName: r.org_unit_name, groupId: r.group_id,
      status: r.status, source: r.source, sourceLabel: SOURCE_LABEL[r.source], requirementId: r.requirement_id, qualificationId: r.qualification_id,
      qualificationName: r.qualification_name, trainingId: r.training_id, trainingTitle: r.training_title, freeTitle: r.free_title, title: r.title,
      provider: r.provider, heldOn: r.held_on, durationHours: r.duration_hours, durationLabel: r.duration_label, location: r.location,
      validUntil: r.valid_until, isMedical: r.is_medical, flags: r.flags, ocrStatus: r.ocr_status,
      submittedAt: r.submitted_at, submittedByName: r.source === 'selbst' ? r.person_name : r.submitted_by_name,
      reviewedAt: r.reviewed_at, reviewedByName: r.reviewed_by_name, reviewNote: r.review_note, createdAt: r.created_at, supersedes: r.supersedes,
    };
  }

  // ── Freigeben / Zurückgeben / Rückgängig ──────────────────
  /** Datensätze eines Vorgangs, auf die eine Aktion wirkt (Gruppe mit gleichem Status oder nur der eine). */
  async scope(c: pg.PoolClient, id: string, scope: 'group' | 'record', statuses: ExtStatus[]): Promise<{ rec: RecordRow; targets: RecordRow[] }> {
    const rec = (await this.records(c, 'x.id = $1', [id]))[0];
    if (!rec) throw new NotFoundException('Nachweis nicht gefunden');
    if (!statuses.includes(rec.status)) throw new BadRequestException(`Aktion im Status „${rec.status}“ nicht möglich`);
    const targets = scope === 'group' && rec.group_id ? await this.records(c, 'x.group_id = $1 AND x.status = ANY($2::text[])', [rec.group_id, statuses]) : [rec];
    for (const t of targets) {
      const p = await this.permissions(c, t);
      if (p.own) throw new ForbiddenException('Eigene Nachweise muss eine andere Person prüfen');
    }
    return { rec, targets };
  }

  private async notifyPerson(c: pg.PoolClient, r: RecordRow, template: 'external-approved' | 'external-returned', data: Record<string, unknown>): Promise<Queued[]> {
    if (r.source !== 'selbst') return [];
    const out: Queued[] = [];
    const tenantName = (await c.query('SELECT name FROM tenant WHERE id = $1', [r.tenant_id])).rows[0]?.name;
    const d = { personName: r.person_name, title: r.title ?? 'Externer Nachweis', tenantName, ...data };
    if (r.person_email) out.push(await this.notifications.enqueue(c, { tenantId: r.tenant_id, channel: 'mail', recipient: r.person_email, template, data: d }));
    const push = (await c.query('SELECT app.push_has_target($1) AS ok', [r.person_id])).rows[0].ok;
    if (push) {
      out.push(
        await this.notifications.enqueue(c, {
          tenantId: r.tenant_id, channel: 'push', recipient: `person:${r.person_id}`, template: 'push-message',
          data: { title: template === 'external-approved' ? 'Nachweis freigegeben' : 'Nachweis zurückgegeben', body: `${d.title}${template === 'external-returned' ? `: ${data.reason}` : ''}`, url: '/konto' },
        }),
      );
    }
    return out;
  }

  /**
   * Freigeben: Status „freigegeben“, valid_until (Vorschlag oder überschrieben), Prüfer, Benachrichtigung.
   * Die Nachweise werden nach dem Commit erzeugt (sealApproved).
   */
  async approve(c: pg.PoolClient, targets: RecordRow[], validUntilOverride: string | null | undefined): Promise<{ queued: Queued[]; results: Array<{ id: string; validUntil: string | null }> }> {
    const now = this.clock.now();
    const queued: Queued[] = [];
    const results = [];
    for (const t of targets) {
      if (!t.held_on) throw new BadRequestException(`${t.person_name}: Datum fehlt – bitte ergänzen oder zurückgeben`);
      if (t.held_on > berlinDate(now)) throw new BadRequestException(`${t.person_name}: Datum liegt in der Zukunft`);
      if (!t.title) throw new BadRequestException(`${t.person_name}: Kurs fehlt – bitte zuordnen oder benennen`);
      const p = await this.proposal(c, t.requirement_id, t.training_id, t.held_on);
      const validUntil = validUntilOverride !== undefined ? validUntilOverride : (t.valid_until ?? p.validUntil);
      if (validUntil && validUntil < t.held_on) throw new BadRequestException('„Gültig bis“ liegt vor dem Schulungsdatum');
      const u = await c.query(
        `UPDATE external_record SET status = 'freigegeben', valid_until = $2, reviewed_by = $3, reviewed_at = $4, review_note = NULL,
                submitted_at = coalesce(submitted_at, $4)
          WHERE id = $1 AND status IN ('entwurf','eingereicht','zurueckgegeben')`,
        [t.id, validUntil, currentRequest()?.session?.accountId ?? null, now],
      );
      if (!u.rowCount) throw new ForbiddenException('Keine Berechtigung für diesen Nachweis');
      await this.audit.record(c, { entity: 'external_record', entityId: t.id, action: 'approved', payload: { validUntil, proposed: p.validUntil, personId: t.person_id } });
      // E-55: Buchung einer externen Schulung abschließen
      await c.query(`UPDATE external_booking_participant SET status = 'freigegeben', status_at = $2 WHERE external_record_id = $1 AND status = 'eingereicht'`, [t.id, now]);
      await WebhookEmitter.emit(c, t.tenant_id, 'external_record.approved', { externalRecordId: t.id }); // E-37
      queued.push(...(await this.notifyPerson(c, t, 'external-approved', { validUntil: de(validUntil) })));
      results.push({ id: t.id, validUntil });
    }
    return { queued, results };
  }

  async returnRecords(c: pg.PoolClient, targets: RecordRow[], reason: string): Promise<Queued[]> {
    const now = this.clock.now();
    const queued: Queued[] = [];
    for (const t of targets) {
      const u = await c.query(
        `UPDATE external_record SET status = 'zurueckgegeben', review_note = $2, reviewed_by = $3, reviewed_at = $4 WHERE id = $1 AND status IN ('entwurf','eingereicht')`,
        [t.id, reason, currentRequest()?.session?.accountId ?? null, now],
      );
      if (!u.rowCount) throw new ForbiddenException('Keine Berechtigung für diesen Nachweis');
      await this.audit.record(c, { entity: 'external_record', entityId: t.id, action: 'returned', payload: { reason } });
      queued.push(...(await this.notifyPerson(c, t, 'external-returned', { reason })));
    }
    return queued;
  }

  /**
   * Rückgängig innerhalb der Frist (Standard 10 min): Der freigegebene Datensatz wird „widerrufen“, sein Nachweis als
   * widerrufen markiert (bleibt erhalten, /verify zeigt „widerrufen“); ein neuer Datensatz mit denselben Angaben liegt wieder zur Prüfung.
   */
  async undo(tenantId: string, targets: RecordRow[]): Promise<Array<{ oldId: string; newId: string }>> {
    const now = this.clock.now();
    for (const t of targets) {
      if (!t.reviewed_at || new Date(t.reviewed_at).getTime() + this.undoMinutes * 60_000 < now.getTime()) {
        throw new BadRequestException(`Rückgängig ist nur ${this.undoMinutes} Minuten nach der Freigabe möglich`);
      }
    }
    const ctx = { ...this.db.requestContext(), tenantId, roles: ['system'] };
    return this.db.txAs(ctx, async (c) => {
      const out = [];
      for (const t of targets) {
        const u = await c.query(`UPDATE external_record SET status = 'widerrufen' WHERE id = $1 AND status = 'freigegeben'`, [t.id]);
        if (!u.rowCount) throw new BadRequestException('Der Nachweis wurde inzwischen geändert');
        await c.query(`UPDATE evidence SET revoked_at = $2, revoked_reason = 'Freigabe rückgängig gemacht' WHERE external_record_id = $1 AND revoked_at IS NULL`, [t.id, now]);
        const copy = await c.query(
          `INSERT INTO external_record (person_id, group_id, requirement_id, qualification_id, training_id, free_title, provider, held_on, duration_hours,
             duration_label, location, valid_until, is_medical, evidence_keys, evidence_sha256, evidence_files, source, status, ocr_status, ocr_fields, flags,
             submitted_by, submitted_by_person, submitted_at, supersedes)
           SELECT person_id, group_id, requirement_id, qualification_id, training_id, free_title, provider, held_on, duration_hours,
                  duration_label, location, NULL, is_medical, evidence_keys, evidence_sha256, evidence_files, source, 'eingereicht', ocr_status, ocr_fields, flags,
                  submitted_by, submitted_by_person, submitted_at, id
             FROM external_record WHERE id = $1 RETURNING id`,
          [t.id],
        );
        const newId = copy.rows[0].id as string;
        await this.audit.record(c, { entity: 'external_record', entityId: t.id, action: 'approval_undone', payload: { newRecordId: newId } });
        out.push({ oldId: t.id, newId });
      }
      return out;
    });
  }

  /** Nach dem Commit: versiegelte Nachweise mit Beleg als Anlage erzeugen (je Person einer). */
  async sealApproved(tenantId: string, recordIds: string[]) {
    const out = [];
    for (const id of recordIds) {
      const s = (
        await this.db.txAs({ tenantId, roles: ['system'] }, (c) =>
          c.query(
            `SELECT coalesce(t.titel, x.free_title) AS titel, app.initials(p.name) AS initialen
               FROM external_record x JOIN person p ON p.id = x.person_id LEFT JOIN training t ON t.id = x.training_id WHERE x.id = $1`,
            [id],
          ),
        )
      ).rows[0];
      const ev = await this.evidence.create(tenantId, 'extern', { externalRecordId: id }, { titel: s.titel, version: null, initialen: s.initialen });
      out.push({ recordId: id, evidence: ev });
    }
    return out;
  }

  // ── Nachweis-PDF (Collector „extern“) ─────────────────────
  private async collect(evidenceId: string, tenantId: string, h: EvidenceHelpers) {
    const { r, ev, tenantName, austritt } = await this.db.txAs({ tenantId, roles: ['system'] }, async (c) => {
      const e = (await c.query('SELECT id, verify_code, nachweis_nr, external_record_id FROM evidence WHERE id = $1', [evidenceId])).rows[0];
      const rec = (await this.records(c, 'x.id = $1', [e.external_record_id]))[0];
      if (!rec) throw new Error('Externer Nachweis nicht gefunden');
      const extra = (await c.query('SELECT te.name, p.austritt_am::text AS austritt FROM tenant te, person p WHERE te.id = $1 AND p.id = $2', [tenantId, rec.person_id])).rows[0];
      return { r: rec, ev: e, tenantName: extra.name as string, austritt: extra.austritt as string | null };
    });
    const files = await Promise.all(r.evidence_keys.map((k) => this.loadReceipt(k)));
    const attachments = await Promise.all(files.map((b, i) => receiptAsPdf(b, r.evidence_files[i]!.mime)));
    const verifyUrl = h.verifyUrl(ev.verify_code);
    const kindLabel = (m: ReceiptMime) => (m === 'application/pdf' ? 'PDF' : r.source === 'selbst' ? 'Foto' : 'Scan');
    const html = renderExternalEvidenceHtml(
      {
        tenantName,
        nachweisNr: ev.nachweis_nr,
        createdAt: dt(h.now()),
        verifyUrl,
        qrSvg: await QRCode.toString(verifyUrl, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#1D2433', light: '#FFFFFF' } }),
        person: { name: r.person_name, personalnr: r.personalnr, orgUnit: r.org_unit_name },
        course: {
          title: r.title ?? 'Externe Schulung', qualification: r.qualification_name, provider: r.provider, heldOn: de(r.held_on) ?? '–',
          duration: r.duration_label ?? (r.duration_hours ? `${r.duration_hours} Std.` : null), location: r.location,
        },
        isMedical: r.is_medical,
        validUntil: de(r.valid_until),
        validityNote: r.qualification_name ? `angerechnet auf ${r.qualification_name}` : null,
        source: SOURCE_LABEL[r.source],
        submitted: r.submitted_at ? `${dt(r.submitted_at)}${r.source === 'selbst' ? ` von ${r.person_name}` : r.submitted_by_name ? ` von ${r.submitted_by_name}` : ''}` : null,
        reviewed: `${dt(r.reviewed_at)}${r.reviewed_by_name ? ` von ${r.reviewed_by_name}` : ''}`,
        receipts: r.evidence_files.map((f, i) => ({ name: f.name, sha256: r.evidence_sha256[i]!, pages: f.pages, kind: kindLabel(f.mime) })),
        sealLabel: h.sealLabel(tenantName),
      },
      h.fontDir,
    );
    return { html, nachweisNr: ev.nachweis_nr as string, tenantName, attachments, austritt };
  }

  /** Prüfer-Name für „liegt jetzt bei … zur Prüfung“ (Screen 10b). */
  async reviewerName(c: pg.PoolClient, tenantId: string, r: RecordRow): Promise<string | null> {
    if (r.ansprechpartner) return r.ansprechpartner.split(/[,·(]/)[0]!.trim();
    const m = (
      await c.query(
        `SELECT a.display_name FROM membership m JOIN account a ON a.id = m.account_id
          WHERE m.tenant_id = $1 AND 'verantwortlich' = ANY (m.roles) ORDER BY m.created_at LIMIT 1`,
        [tenantId],
      )
    ).rows[0];
    return m?.display_name ?? null;
  }

  today() {
    return berlinDate(this.clock.now());
  }
  now() {
    return this.clock.now();
  }

  /** Felder übernehmen (nur gesetzte Schlüssel) – Verwaltung und Mitarbeiter (Entwurf/zurückgegeben). */
  async applyFields(c: pg.PoolClient, id: string, b: RecordFields & { validUntil?: string | null; flags?: Array<{ code: string; note?: string | null }> }) {
    if (b.requirementId !== undefined || b.trainingId !== undefined) {
      const asg = await this.resolveAssignment(c, { requirementId: b.requirementId ?? null, trainingId: b.trainingId ?? null });
      await c.query('UPDATE external_record SET requirement_id = $2, qualification_id = $3, training_id = $4 WHERE id = $1', [id, asg.requirementId, asg.qualificationId, asg.trainingId]);
    }
    const map: Record<string, string> = {
      freeTitle: 'free_title', provider: 'provider', heldOn: 'held_on', durationHours: 'duration_hours', durationLabel: 'duration_label',
      location: 'location', isMedical: 'is_medical', validUntil: 'valid_until', flags: 'flags',
    };
    const entries = Object.entries(b).filter(([k, v]) => v !== undefined && map[k]);
    if (!entries.length) return;
    const sets = entries.map(([k], i) => `${map[k]} = $${i + 2}`).join(', ');
    await c.query(`UPDATE external_record SET ${sets} WHERE id = $1`, [id, ...entries.map(([k, v]) => (k === 'flags' ? JSON.stringify(v) : v))]);
  }
  pgDate = pgDate;
}
