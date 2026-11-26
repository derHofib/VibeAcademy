import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import QRCode from 'qrcode';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, repoPath, type AppConfig } from '../config';
import { Clock } from '../common/clock';
import { sha256 } from '../common/crypto';
import { DbService } from '../db/db.service';
import { JobRunner } from '../jobs/job-runner';
import { RedisService } from '../redis/redis.service';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage';
import { parseSettings, quizRequiredFor } from '../trainings/settings';
import { EVIDENCE_LABELS } from '../i18n/evidence-labels';
import { formatDate, formatDateTimeLong, formatDayMonth, participantLanguage } from '../i18n/language';
import { renderEvidenceHtml, type EvidenceData } from './evidence-template';
import { PDFDocument } from 'pdf-lib';
import { PDF_RENDERER, type PdfRenderer } from './pdf-renderer';
import { SEALER, type Sealer } from './sealer';
import { WebhookEmitter } from '../webhooks/webhook-emitter';

export type EvidenceKind = 'online' | 'praesenz' | 'live' | 'extern';
export interface EvidenceRef {
  invitationId?: string;
  attendanceId?: string;
  externalRecordId?: string;
}
/** Angaben für die öffentliche Prüfung – keine Klarnamen (E-10). */
export interface EvidenceSubject {
  titel: string;
  version?: number | null;
  initialen: string;
}
export interface CollectedEvidence {
  html: string;
  nachweisNr: string;
  tenantName: string;
  /** PDFs, die als Anlage angehängt werden (z. B. Beleg eines externen Nachweises) */
  attachments?: Buffer[];
  /** Dateien, die unverändert als PDF-Dateianhang eingebettet werden (z. B. vom FES/QES-Anbieter signiertes Dokument, E-40) */
  embeddedFiles?: Array<{ name: string; data: Buffer; mimeType: string; description: string }>;
  /** Austrittsdatum der Person → retain_until = Austritt + 3 Jahre (E-24) */
  austritt: string | null;
}
export interface EvidenceHelpers {
  verifyUrl(code: string): string;
  qrSvg(url: string): Promise<string>;
  sealLabel(tenantName: string): string;
  fontDir: string;
  now(): Date;
}
/** Liefert HTML (und optional Anlagen) für einen Nachweis einer bestimmten Art. */
export type EvidenceCollector = (evidenceId: string, tenantId: string, h: EvidenceHelpers) => Promise<CollectedEvidence>;

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = () =>
  Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => ALPHABET[randomInt(0, ALPHABET.length)]).join('')).join('-');

export const TZ = 'Europe/Berlin';
export const dt = (d: Date | string | null, withTime = true) =>
  d
    ? new Intl.DateTimeFormat('de-DE', {
        timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
      }).format(new Date(d))
    : '–';
export const dayMonth = (d: Date | string | null) =>
  d ? new Intl.DateTimeFormat('de-DE', { timeZone: TZ, day: '2-digit', month: '2-digit' }).format(new Date(d)) : '–';
export const mmss = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export const minSec = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min`;
};
export function device(ua: string | null): string {
  if (!ua) return 'unbekannt';
  const kind = /Mobile|Android|iPhone|iPad/i.test(ua) ? 'Mobil' : 'PC';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${kind}, ${browser}`;
}
export const AUTH_LABEL: Record<string, string> = {
  password: 'Passwort (Re-Auth)', otp_mail: 'Einmalcode per E-Mail', otp_sms: 'Einmalcode per SMS', sso: 'Single Sign-on (Step-up)',
};
export const FORMAT_LABEL: Record<string, string> = {
  online: 'Online mit Wissenscheck', praesenz: 'Präsenz', hybrid: 'Hybrid', extern: 'Extern',
};

/** Nachweis-Generator (Schritt 1.8): HTML → PDF → PAdES-Siegel → WORM-Speicher, prüfbar über /verify/:code. */
@Injectable()
export class EvidenceService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(EvidenceService.name);
  private runner!: JobRunner<{ evidenceId: string; tenantId: string }>;
  private readonly collectors = new Map<EvidenceKind, EvidenceCollector>();

  constructor(
    private readonly db: DbService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(PDF_RENDERER) private readonly renderer: PdfRenderer,
    @Inject(SEALER) private readonly sealer: Sealer,
  ) {}

  /** Weitere Nachweisarten melden ihren Collector hier an (Präsenz/Live, extern). */
  registerCollector(kind: EvidenceKind, fn: EvidenceCollector) {
    this.collectors.set(kind, fn);
  }

  helpers(): EvidenceHelpers {
    return {
      verifyUrl: (c) => this.verifyUrl(c),
      qrSvg: (url) => QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#1D2433', light: '#FFFFFF' } }),
      sealLabel: (tenantName) =>
        this.config.SEAL_MODE === 'none'
          ? 'Elektronisch erstellt und unveränderbar gespeichert. Prüfcode und SHA-256 sind beim Aussteller hinterlegt.'
          : `Elektronisch versiegelt (PAdES-B-T) für ${tenantName} · Zeitstempel nach RFC 3161 in der Signatur${this.config.TSA_URL ? '' : ' (Test-Zeitstempeldienst, nicht qualifiziert)'}.`,
      fontDir: repoPath(this.config.FONT_DIR),
      now: () => this.clock.now(),
    };
  }

  onModuleInit() {
    this.registerCollector('online', async (id, tenantId, h) => {
      const { data, austritt, embeddedFiles } = await this.collect(id, tenantId);
      const L = EVIDENCE_LABELS[data.lang ?? 'de'];
      data.seal.label = data.lang === 'en'
        ? this.config.SEAL_MODE === 'none' ? L.unsealed : L.sealed(data.tenantName, !!this.config.TSA_URL)
        : h.sealLabel(data.tenantName);
      return { html: renderEvidenceHtml(data, h.fontDir), nachweisNr: data.nachweisNr, tenantName: data.tenantName, austritt, embeddedFiles };
    });
    this.runner = new JobRunner('evidence-pdf', this.redis, this.config, (d) => this.generate(d.evidenceId, d.tenantId), 1);
  }
  async onModuleDestroy() {
    await this.runner.close();
    await this.renderer.close?.();
  }

  verifyUrl(c: string) {
    return `${this.config.PUBLIC_BASE_URL}/verify/${c}`;
  }

  /**
   * Nachweis anlegen (Status „ausstehend“) und Erzeugung einreihen. Idempotent je Bezug.
   * Kann in einer laufenden Transaktion (client) oder eigenständig aufgerufen werden.
   */
  async create(tenantId: string, kind: EvidenceKind, ref: EvidenceRef, subject: EvidenceSubject) {
    const col = ref.invitationId ? 'invitation_id' : ref.attendanceId ? 'attendance_id' : 'external_record_id';
    const refId = ref.invitationId ?? ref.attendanceId ?? ref.externalRecordId;
    if (!refId) throw new Error('Nachweis ohne Bezug');
    const ev = await this.db.txAs({ tenantId, roles: ['system'] }, async (c) => {
      const existing = (await c.query(`SELECT id, verify_code, nachweis_nr FROM evidence WHERE ${col} = $1`, [refId])).rows[0];
      if (existing) return existing;
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 1))', [`evidence:${tenantId}`]);
      const year = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, year: 'numeric' }).format(this.clock.now());
      const n = Number((await c.query(`SELECT count(*) AS n FROM evidence WHERE nachweis_nr LIKE $1`, [`N-${year}-%`])).rows[0].n) + 1;
      const r = await c.query(
        `INSERT INTO evidence (${col}, kind, verify_code, nachweis_nr, subject) VALUES ($1, $2, $3, $4, $5) RETURNING id, verify_code, nachweis_nr`,
        [refId, kind, code(), `N-${year}-${String(n).padStart(5, '0')}`, subject],
      );
      return r.rows[0];
    });
    await this.runner.add({ evidenceId: ev.id, tenantId }, { jobId: `evidence-${ev.id}`, attempts: 3, backoff: { type: 'exponential', delay: 10_000 } });
    return { id: ev.id as string, verifyCode: ev.verify_code as string, nachweisNr: ev.nachweis_nr as string };
  }

  async createForInvitation(tenantId: string, invitationId: string) {
    const subject = await this.db.txAs({ tenantId, roles: ['system'] }, async (c) =>
      (
        await c.query(
          `SELECT t.titel, v.version_no AS version, app.initials(p.name) AS initialen
             FROM invitation i JOIN person p ON p.id = i.person_id JOIN run r ON r.id = i.run_id
             JOIN training t ON t.id = r.training_id JOIN training_version v ON v.id = r.training_version_id WHERE i.id = $1`,
          [invitationId],
        )
      ).rows[0] as EvidenceSubject,
    );
    return this.create(tenantId, 'online', { invitationId }, subject);
  }

  private async collect(
    evidenceId: string, tenantId: string,
  ): Promise<{ data: EvidenceData; austritt: string | null; embeddedFiles?: CollectedEvidence['embeddedFiles'] }> {
    return this.db.txAs({ tenantId, roles: ['system'] }, async (c) => {
      const r = (
        await c.query(
          `SELECT e.id, e.verify_code, e.nachweis_nr, e.created_at, i.id AS invitation_id, i.sent_at, i.created_at AS invited_at,
                  i.completed_at, i.reading_time_factor, p.name AS person_name, p.personalnr, p.austritt_am, o.name AS org_unit,
                  t.titel, t.rechtsgrundlage, t.format, t.ansprechpartner, t.quiz_required, t.settings,
                  v.id AS version_id, v.version_no, v.page_count, v.sha256, te.name AS tenant_name,
                  s.image_key, s.signed_at, s.auth_method, s.user_agent, s.ip_hash, s.confirm_text, s.confirm_text_sha256,
                  p.sprache, i.changed_pages, s.typ AS signature_typ, s.provider, s.provider_transaction_id, s.signed_document_key,
                  s.signed_document_sha256, s.signed_document_format, s.signer_info
             FROM evidence e JOIN invitation i ON i.id = e.invitation_id JOIN person p ON p.id = i.person_id
             LEFT JOIN org_unit o ON o.id = p.org_unit_id JOIN run r ON r.id = i.run_id JOIN training t ON t.id = r.training_id
             JOIN training_version v ON v.id = coalesce(i.training_version_id, r.training_version_id) JOIN tenant te ON te.id = e.tenant_id
             JOIN signature s ON s.invitation_id = i.id
            WHERE e.id = $1`,
          [evidenceId],
        )
      ).rows[0];
      if (!r) throw new Error('Nachweisdaten unvollständig');
      const factor = Math.max(1, Number(r.reading_time_factor));
      const pages = (
        await c.query(
          `SELECT pm.page_no, coalesce(pm.t_min_manual, pm.t_min_seconds) AS t, pp.dwell_ms, pp.first_seen_at, pp.fulfilled_at
             FROM page_meta pm LEFT JOIN page_progress pp ON pp.page_no = pm.page_no AND pp.invitation_id = $2
            WHERE pm.version_id = $1 ORDER BY pm.page_no`,
          [r.version_id, r.invitation_id],
        )
      ).rows;
      const sessions = (await c.query('SELECT min(started_at) AS first, count(*)::int AS n FROM read_session WHERE invitation_id = $1', [r.invitation_id])).rows[0];
      const attempts = (
        await c.query(
          `SELECT attempt_no, score_pct, passed, cardinality(question_ids) AS total,
                  (SELECT count(*) FROM jsonb_each(answers) a WHERE (a.value->>'correct')::boolean)::int AS right_count
             FROM quiz_attempt WHERE invitation_id = $1 AND submitted_at IS NOT NULL ORDER BY attempt_no`,
          [r.invitation_id],
        )
      ).rows;
      const settings = parseSettings(r.settings);
      // E-39: Beschriftungen in der Sprache der Person; E-38: Nachschulung nur geänderter Seiten
      const lang = participantLanguage(r.sprache);
      const L = EVIDENCE_LABELS[lang];
      const dt = (d: Date | string | null, withTime = true) => formatDate(lang, d, withTime);
      const dayMonth = (d: Date | string | null) => formatDayMonth(lang, d);
      const onlyPages = ((r.changed_pages ?? []) as number[]).filter((n) => pages.some((p) => p.page_no === n)).sort((a, b) => a - b);
      const required = (n: number) => !onlyPages.length || onlyPages.includes(n);
      const quizRequired = quizRequiredFor(r.quiz_required, settings, onlyPages);
      const soll = pages.filter((p) => required(p.page_no)).reduce((s, p) => s + Math.round(p.t * factor) * 1000, 0);
      const ist = pages.reduce((s, p) => s + Number(p.dwell_ms ?? 0), 0);
      const validUntil = r.completed_at ? new Date(new Date(r.completed_at).getTime()) : null;
      if (validUntil) validUntil.setMonth(validUntil.getMonth() + settings.intervalMonths);
      const png = r.image_key ? await this.storage.get('evidence', r.image_key) : null;
      const signer = r.signer_info as { subject?: string; test?: boolean } | null;
      const embeddedFiles: CollectedEvidence['embeddedFiles'] = r.signed_document_key
        ? [{
            name: `${r.signature_typ}-${r.provider}-${r.provider_transaction_id}.${r.signed_document_format === 'CAdES' ? 'p7m' : 'pdf'}`.replace(/[^\w.-]/g, '_'),
            data: await this.storage.get('evidence', r.signed_document_key),
            mimeType: r.signed_document_format === 'CAdES' ? 'application/pkcs7-mime' : 'application/pdf',
            description: L.levels[r.signature_typ as 'fes' | 'qes'],
          }]
        : undefined;
      const verifyUrl = this.verifyUrl(r.verify_code);
      const qrSvg = await QRCode.toString(verifyUrl, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#1D2433', light: '#FFFFFF' } });
      const data: EvidenceData = {
        tenantName: r.tenant_name,
        nachweisNr: r.nachweis_nr,
        createdAt: dt(this.clock.now()),
        verifyUrl,
        qrSvg,
        training: {
          titel: r.titel, versionNo: r.version_no, rechtsgrundlage: r.rechtsgrundlage, format: L.formats[r.format] ?? r.format,
          pageCount: r.page_count, unterweisender: r.ansprechpartner, sha256: r.sha256,
        },
        person: { name: r.person_name, personalnr: r.personalnr, orgUnit: r.org_unit },
        ablauf: {
          eingeladen: dt(r.sent_at ?? r.invited_at),
          bearbeitet: `${dt(sessions.first, false)}–${dt(r.completed_at, false)}`,
          sitzungen: sessions.n,
          lesezeitIst: minSec(ist),
          lesezeitSoll: minSec(soll),
          plausibel: ist >= soll * 0.5,
        },
        pages: pages.map((p) => ({
          pageNo: p.page_no,
          ist: mmss(Number(p.dwell_ms ?? 0)),
          soll: mmss(Math.round(p.t * factor) * 1000),
          erstmals: dayMonth(p.first_seen_at),
          erfuellt: !!p.fulfilled_at,
          required: required(p.page_no),
        })),
        quiz: {
          required: quizRequired,
          skippedOnReinvite: r.quiz_required && !quizRequired,
          attempts: attempts.map((a) => ({ no: a.attempt_no, right: a.right_count, total: a.total, pct: a.score_pct, passed: a.passed })),
          passPct: settings.passPct,
          maxAttempts: settings.maxAttempts,
        },
        gueltigBis: validUntil ? dt(validUntil, false) : null,
        wiederholung: L.repetitionText(settings.intervalMonths),
        confirmText: r.confirm_text,
        signature: {
          pngBase64: png ? png.toString('base64') : null,
          signedAt: formatDateTimeLong(lang, r.signed_at),
          authMethod: L.authMethods[r.auth_method] ?? r.auth_method,
          device: lang === 'de' ? device(r.user_agent) : device(r.user_agent).replace('Mobil', L.deviceMobile).replace('unbekannt', L.deviceUnknown),
          ipHash: r.ip_hash ? `${String(r.ip_hash).slice(0, 4)}…` : '–',
          confirmSha: r.confirm_text_sha256,
        },
        seal: { label: '' },
        lang,
        reinvite: onlyPages.length ? { pages: onlyPages } : null,
        level: {
          typ: r.signature_typ, provider: r.provider, transactionId: r.provider_transaction_id, signer: signer?.subject ?? null,
          format: r.signed_document_format, sha256: r.signed_document_sha256, test: !!signer?.test,
        },
      };
      return { data, austritt: r.austritt_am, embeddedFiles };
    });
  }

  /** Erzeugt, versiegelt und speichert das PDF. Idempotent. */
  async generate(evidenceId: string, tenantId: string): Promise<void> {
    const st = (await this.db.txAs({ tenantId, roles: ['system'] }, (c) => c.query('SELECT status FROM evidence WHERE id = $1', [evidenceId]))).rows[0];
    if (!st || st.status === 'erzeugt') return;
    try {
      const kind = (await this.db.txAs({ tenantId, roles: ['system'] }, (c) => c.query('SELECT kind FROM evidence WHERE id = $1', [evidenceId]))).rows[0].kind as EvidenceKind;
      const collector = this.collectors.get(kind);
      if (!collector) throw new Error(`Keine Nachweisvorlage für Art „${kind}“`);
      const { html, nachweisNr, attachments, austritt, embeddedFiles } = await collector(evidenceId, tenantId, this.helpers());
      let raw = await this.renderer.render(html);
      if (attachments?.length) raw = await appendPdfs(raw, attachments);
      if (embeddedFiles?.length) raw = await embedFiles(raw, embeddedFiles, this.clock.now());
      const data = { nachweisNr };
      const sealed = await this.sealer.seal(raw);
      const hash = sha256(sealed.pdf);
      const key = `evidence/${tenantId}/${data.nachweisNr}-${hash.slice(0, 12)}.pdf`;
      const lockUntil = new Date(this.clock.now());
      lockUntil.setFullYear(lockUntil.getFullYear() + this.config.EVIDENCE_LOCK_YEARS);
      await this.storage.put('evidence', key, sealed.pdf, { contentType: 'application/pdf', retainUntil: lockUntil });
      await this.db.txAs({ tenantId, roles: ['system'] }, async (c) => {
        await c.query(
          `UPDATE evidence SET status = 'erzeugt', pdf_key = $2, pdf_sha256 = $3, seal_ts = $4, seal_info = $5, error = NULL,
                  retain_until = CASE WHEN $6::date IS NULL THEN NULL ELSE ($6::date + interval '3 years')::date END
            WHERE id = $1`,
          [evidenceId, key, hash, this.clock.now(), sealed.info, austritt],
        );
        await this.audit.record(c, { entity: 'evidence', entityId: evidenceId, action: 'created', payload: { sha256: hash, nachweisNr: data.nachweisNr, seal: sealed.info.level } });
        await WebhookEmitter.emit(c, tenantId, 'evidence.created', { evidenceId }); // E-37
      });
    } catch (e) {
      this.log.error(`Nachweis ${evidenceId}: ${(e as Error).message}`);
      await this.db.txAs({ tenantId, roles: ['system'] }, (c) =>
        c.query(`UPDATE evidence SET status = 'fehler', error = $2 WHERE id = $1 AND status <> 'erzeugt'`, [evidenceId, (e as Error).message.slice(0, 500)]),
      );
      throw e;
    }
  }
}

/** Hängt PDFs (Belege) hinter den Nachweis – vor dem Versiegeln, damit das Siegel alles abdeckt. */
export async function appendPdfs(main: Buffer, extras: Buffer[]): Promise<Buffer> {
  const doc = await PDFDocument.load(main);
  for (const x of extras) {
    const src = await PDFDocument.load(x, { ignoreEncryption: true });
    for (const p of await doc.copyPages(src, src.getPageIndices())) doc.addPage(p);
  }
  return Buffer.from(await doc.save());
}

/** Bettet Dateien unverändert als PDF-Dateianhänge ein (vor dem Versiegeln → vom Siegel abgedeckt, E-40). */
export async function embedFiles(main: Buffer, files: NonNullable<CollectedEvidence['embeddedFiles']>, at: Date): Promise<Buffer> {
  const doc = await PDFDocument.load(main);
  for (const f of files) {
    await doc.attach(f.data, f.name, { mimeType: f.mimeType, description: f.description, creationDate: at, modificationDate: at });
  }
  return Buffer.from(await doc.save());
}
