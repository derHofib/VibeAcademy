import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  decodeText, normalizeName, parseAttendanceTable, secondsWithin, splitTable, type ImportEntry, type ImportFormat,
} from '@sn/shared';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { sha256 } from '../common/crypto';
import { currentRequest } from '../common/request-context';
import { DbService } from '../db/db.service';
import { NotificationService } from '../notifications/notification.service';
import { InvitationService } from '../runs/invitation.service';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage';
import { parseSettings } from '../trainings/settings';
import { AttendanceService } from './attendance.service';
import { RunAccess } from './run-access.service';

export interface BackdatedInput {
  trainingId: string;
  delivery: 'praesenz' | 'live_online';
  kombiniert: boolean;
  startAt: string;
  endAt: string;
  platform?: 'teams' | 'zoom' | 'meet' | 'sonstige' | null;
  meetingUrl?: string | null;
  ort?: string | null;
  trainerPersonId?: string | null;
  completenessPct?: number | null;
  reason: string;
}

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export interface ImportRow {
  index: number;
  line: number;
  name: string;
  email: string | null;
  role: string | null;
  minutes: number | null;
  pct: number | null;
  state: 'vollstaendig' | 'teilweise' | 'ohne_zeiten';
  match: { personId: string; personName: string; by: 'email' | 'name' } | null;
}

interface StoredEntry {
  line: number;
  name: string;
  email: string | null;
  role: string | null;
  intervals: Array<{ inAt: string; outAt: string }>;
}

const XLSX_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const pad = (n: number) => String(n).padStart(2, '0');

/** XLSX → Zeilen: Datumszellen als Ortszeit-Text (Excel speichert ohne Zeitzone), alles andere als Text. */
export async function xlsxRows(buf: Buffer): Promise<string[][]> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const cells: string[] = [];
    for (let i = 1; i <= ws.columnCount; i++) {
      const v = row.getCell(i).value as unknown;
      if (v instanceof Date) {
        cells.push(`${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}`);
      } else if (v && typeof v === 'object' && 'text' in v) cells.push(String((v as { text: unknown }).text ?? ''));
      else if (v && typeof v === 'object' && 'result' in v) cells.push(String((v as { result: unknown }).result ?? ''));
      else cells.push(v === null || v === undefined ? '' : String(v));
    }
    rows.push(cells);
  });
  return rows;
}

/**
 * Nachträgliche Erfassung stattgefundener Termine (E-53/E-54): Präsenz oder Live-Online in der Vergangenheit,
 * Anwesenheit per Checkliste oder Import (Teams-Bericht, CSV, XLSX), Belege, Bestätigung durch die Gegenzeichnung.
 */
@Injectable()
export class BackdatedService {
  constructor(
    private readonly db: DbService,
    private readonly access: RunAccess,
    private readonly attendance: AttendanceService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly invitations: InvitationService,
    private readonly notifications: NotificationService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  private accountId() {
    const s = currentRequest()?.session;
    return s?.kind === 'account' ? s.accountId : null;
  }

  async create(b: BackdatedInput) {
    const now = this.clock.now();
    const start = new Date(b.startAt);
    const end = new Date(b.endAt);
    if (end.getTime() > now.getTime()) {
      throw new BadRequestException({ message: 'Eingaben unvollständig oder ungültig', fields: [{ path: 'endAt', message: 'Das Ende muss in der Vergangenheit liegen' }] });
    }
    return this.db.tx(async (c) => {
      const t = (
        await c.query(
          `SELECT t.id, t.settings,
                  (SELECT v.id FROM training_version v WHERE v.training_id = t.id AND v.sprache = 'de' AND v.published_at IS NOT NULL ORDER BY v.version_no DESC LIMIT 1) AS version_id
             FROM training t WHERE t.id = $1 AND t.archived_at IS NULL`,
          [b.trainingId],
        )
      ).rows[0];
      if (!t) throw new BadRequestException('Schulung nicht gefunden');
      if (b.kombiniert && !t.version_id) {
        throw new BadRequestException({
          message: 'Für „Kombiniert“ braucht die Schulung eine veröffentlichte Version (für die Online-Bestätigung).',
          fields: [{ path: 'kombiniert', message: 'Schulung ohne veröffentlichte Version' }],
        });
      }
      const accountId = this.accountId();
      const name =
        (await c.query('SELECT name FROM person WHERE account_id = $1 ORDER BY created_at LIMIT 1', [accountId])).rows[0]?.name ??
        (await c.query('SELECT display_name FROM account WHERE id = $1', [accountId])).rows[0]?.display_name ?? null;
      const pct = b.completenessPct ?? parseSettings(t.settings).completenessPct;
      const r = await c.query(
        `INSERT INTO run (training_id, training_version_id, typ, delivery, platform, meeting_url, start_at, end_at, started_at, ended_at, ort,
                          trainer_person_id, completeness_pct, allow_walk_in, qr_mode, status, followup_required,
                          backdated_at, backdated_by, backdated_by_name, backdated_reason)
         VALUES ($1, $2, 'termin', $3, $4, $5, $6, $7, $6, $7, $8, $9, $10, false, NULL, 'beendet', $11, $12, $13, $14, $15) RETURNING id`,
        [
          t.id, t.version_id, b.delivery, b.delivery === 'live_online' ? (b.platform ?? null) : null,
          b.delivery === 'live_online' ? (b.meetingUrl ?? null) : null, start, end, b.delivery === 'praesenz' ? (b.ort ?? null) : null,
          b.trainerPersonId ?? null, pct, b.kombiniert, now, accountId, name, b.reason.trim(),
        ],
      );
      const id = r.rows[0].id as string;
      await this.audit.record(c, {
        entity: 'run', entityId: id, action: 'backdated_created',
        payload: { trainingId: t.id, delivery: b.delivery, kombiniert: b.kombiniert, startAt: b.startAt, endAt: b.endAt, reason: b.reason.trim() },
      });
      return { id };
    });
  }

  private async backdatedRun(c: pg.PoolClient, runId: string) {
    const run = await this.attendance.loadRun(c, runId);
    if (!run.backdated_at) throw new ConflictException('Nur für nachträglich erfasste Termine');
    if (run.countersigned_at) throw new ConflictException('Der Termin ist bereits gegengezeichnet – Nachweise sind erzeugt');
    return run;
  }

  /** Teilnehmerliste einlesen und Personen zuordnen (noch nicht übernehmen). */
  async importFile(runId: string, file: UploadedFile) {
    const m = await this.access.manage(runId);
    if (!file?.buffer?.length) throw new BadRequestException('Bitte eine Datei auswählen');
    const name = file.originalname || 'teilnehmerliste';
    const isXlsx = file.buffer.subarray(0, 4).equals(XLSX_MAGIC) || /\.xlsx$/i.test(name);
    if (!isXlsx && !/\.(csv|txt|tsv)$/i.test(name) && !/^text\//.test(file.mimetype)) {
      throw new BadRequestException('Bitte eine CSV-, TXT- oder XLSX-Datei hochladen (z. B. den Teams-Anwesenheitsbericht)');
    }
    const rows = isXlsx ? await xlsxRows(file.buffer) : splitTable(decodeText(new Uint8Array(file.buffer)));
    return this.access.sys(m, async (c) => {
      const run = await this.backdatedRun(c, runId);
      const parsed = parseAttendanceTable(rows, { startAt: run.start_at, endAt: run.end_at });
      if (!parsed.entries.length) {
        throw new BadRequestException(parsed.warnings[0] ?? 'In der Datei wurden keine Teilnehmenden gefunden');
      }
      const persons = (await c.query(`SELECT id, name, email FROM person WHERE austritt_am IS NULL OR austritt_am > $1::date`, [run.start_at])).rows as Array<{ id: string; name: string; email: string | null }>;
      const out = this.matchRows(parsed.entries, persons, run);
      const hash = sha256(file.buffer);
      const key = `run-docs/${m.tenantId}/${runId}/${randomUUID()}-${hash.slice(0, 12)}${isXlsx ? '.xlsx' : '.csv'}`;
      await this.storage.put('uploads', key, file.buffer, { contentType: isXlsx ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv' });
      const stored: StoredEntry[] = parsed.entries.map((e) => ({
        line: e.line, name: e.name, email: e.email, role: e.role,
        intervals: e.intervals.map((i) => ({ inAt: i.inAt.toISOString(), outAt: i.outAt.toISOString() })),
      }));
      const doc = await c.query(
        `INSERT INTO run_document (tenant_id, run_id, kind, file_key, file_name, content_type, size_bytes, sha256, format, parsed)
         VALUES ($1, $2, 'import', $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [m.tenantId, runId, key, name.slice(0, 200), isXlsx ? 'xlsx' : 'csv', file.buffer.length, hash, parsed.format, JSON.stringify({ entries: stored, warnings: parsed.warnings })],
      );
      await this.audit.record(c, { entity: 'run', entityId: runId, action: 'attendance_imported', payload: { importId: doc.rows[0].id, format: parsed.format, rows: out.length, sha256: hash } });
      return {
        importId: doc.rows[0].id as string,
        format: parsed.format as ImportFormat,
        fileName: name,
        warnings: parsed.warnings,
        plannedMinutes: Math.round((run.end_at.getTime() - run.start_at.getTime()) / 60000),
        completenessPct: run.completeness_pct,
        rows: out,
      };
    });
  }

  private matchRows(entries: ImportEntry[], persons: Array<{ id: string; name: string; email: string | null }>, run: { start_at: Date; end_at: Date; completeness_pct: number }): ImportRow[] {
    const byEmail = new Map(persons.filter((p) => p.email).map((p) => [p.email!.toLowerCase(), p]));
    const byName = new Map<string, Array<{ id: string; name: string }>>();
    for (const p of persons) byName.set(normalizeName(p.name), [...(byName.get(normalizeName(p.name)) ?? []), p]);
    const planned = (run.end_at.getTime() - run.start_at.getTime()) / 1000;
    return entries.map((e, index) => {
      const viaEmail = e.email ? byEmail.get(e.email.toLowerCase()) : undefined;
      const viaName = !viaEmail ? byName.get(normalizeName(e.name)) : undefined;
      const match = viaEmail
        ? { personId: viaEmail.id, personName: viaEmail.name, by: 'email' as const }
        : viaName?.length === 1
          ? { personId: viaName[0]!.id, personName: viaName[0]!.name, by: 'name' as const }
          : null;
      const secs = e.intervals.length ? secondsWithin(e.intervals, run.start_at, run.end_at) : null;
      const pct = secs === null ? null : Math.floor((secs / planned) * 100);
      return {
        index, line: e.line, name: e.name, email: e.email, role: e.role,
        minutes: secs === null ? null : Math.round(secs / 60), pct,
        state: pct === null ? 'ohne_zeiten' : pct >= run.completeness_pct ? 'vollstaendig' : 'teilweise',
        match,
      };
    });
  }

  /**
   * Anwesenheit übernehmen: je Eintrag eine Person (vorhanden oder neu), Zeiten aus dem Import oder – bei der
   * Checkliste – die geplante Dauer. Erneutes Übernehmen ersetzt die bisherige (unbestätigte) Liste.
   */
  async applyAttendance(
    runId: string,
    b: { importId?: string | null; entries: Array<{ index?: number | null; personId?: string | null; newPerson?: { name: string; email?: string | null } | null; credit?: boolean }> },
  ) {
    const m = await this.access.manage(runId);
    return this.access.sys(m, async (c) => {
      const run = await this.backdatedRun(c, runId);
      let stored: StoredEntry[] = [];
      if (b.importId) {
        const d = (await c.query(`SELECT parsed FROM run_document WHERE id = $1 AND run_id = $2 AND kind = 'import'`, [b.importId, runId])).rows[0];
        if (!d) throw new NotFoundException('Import nicht gefunden');
        stored = (d.parsed?.entries ?? []) as StoredEntry[];
      }
      // bisherige, noch unbestätigte Liste ersetzen
      await c.query(`DELETE FROM attendance WHERE run_id = $1 AND confirmed_at IS NULL`, [runId]);
      const now = this.clock.now();
      const seen = new Set<string>();
      let createdPersons = 0;
      const result: Array<{ personId: string; name: string; state: string; pct: number }> = [];
      for (const e of b.entries) {
        let personId = e.personId ?? null;
        if (!personId && e.newPerson) {
          const email = e.newPerson.email?.trim().toLowerCase() || null;
          const existing = email ? (await c.query('SELECT id FROM person WHERE lower(email) = $1', [email])).rows[0] : null;
          personId = existing?.id ?? (await c.query('INSERT INTO person (name, email) VALUES ($1, $2) RETURNING id', [e.newPerson.name.trim(), email])).rows[0].id;
          if (!existing) createdPersons++;
        }
        if (!personId) throw new BadRequestException('Bitte jedem übernommenen Eintrag eine Person zuordnen');
        if (seen.has(personId)) continue;
        seen.add(personId);
        const person = (await c.query('SELECT id, name, reading_time_factor FROM person WHERE id = $1', [personId])).rows[0];
        if (!person) throw new BadRequestException('Person nicht gefunden');
        const src = e.index !== undefined && e.index !== null ? stored[e.index] : undefined;
        const intervals = src?.intervals.length
          ? src.intervals.map((i) => ({ inAt: new Date(i.inAt), outAt: new Date(i.outAt) }))
          : [{ inAt: run.start_at, outAt: run.end_at }];
        const method = src?.intervals.length ? 'import' : 'trainer';
        const inv = await c.query(
          `INSERT INTO invitation (run_id, person_id, reading_time_factor) VALUES ($1, $2, $3)
           ON CONFLICT (run_id, person_id) DO UPDATE SET person_id = EXCLUDED.person_id RETURNING id`,
          [runId, personId, person.reading_time_factor],
        );
        const att = await c.query(
          `INSERT INTO attendance (run_id, person_id, invitation_id, check_in_method, check_out_method)
           VALUES ($1, $2, $3, $4, $4) RETURNING id`,
          [runId, personId, inv.rows[0].id, method],
        );
        const attId = att.rows[0].id as string;
        for (const iv of intervals) {
          await c.query(
            `INSERT INTO attendance_interval (attendance_id, in_at, out_at, in_method, out_method) VALUES ($1, $2, $3, $4, $4)`,
            [attId, iv.inAt, iv.outAt, method],
          );
        }
        const s = await this.attendance.persistSummary(c, run, attId);
        if (s.state === 'teilweise') {
          await c.query(
            `UPDATE attendance SET release = $2, release_note = $3, released_at = $4, released_by = $5 WHERE id = $1`,
            [attId, e.credit ? 'freigegeben' : 'abgelehnt', 'Nachträgliche Erfassung: unter der Mindestanwesenheit', now, m.accountId],
          );
        }
        result.push({ personId, name: person.name, state: s.state, pct: Math.floor(s.completeness * 100) });
      }
      // Einladungen von Personen, die nicht mehr auf der Liste stehen, entfernen (nur unbearbeitete)
      await c.query(
        `DELETE FROM invitation i WHERE i.run_id = $1 AND NOT (i.person_id = ANY($2::uuid[])) AND i.status = 'offen'
           AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.invitation_id = i.id)`,
        [runId, [...seen]],
      );
      if (b.importId) await c.query('UPDATE run_document SET applied_at = $2 WHERE id = $1', [b.importId, now]);
      await this.audit.record(c, {
        entity: 'run', entityId: runId, action: 'backdated_attendance',
        payload: { count: result.length, importId: b.importId ?? null, createdPersons, partial: result.filter((r) => r.state === 'teilweise').length },
      });
      return { attendances: result, createdPersons };
    });
  }

  /** Beleg (unterschriebene Liste, Bildschirmfoto, PDF) zur Durchführung ablegen. */
  async uploadReceipt(runId: string, file: UploadedFile) {
    const m = await this.access.manage(runId);
    if (!file?.buffer?.length) throw new BadRequestException('Bitte eine Datei auswählen');
    const isPdf = file.buffer.subarray(0, 5).toString() === '%PDF-';
    const isPng = file.buffer.subarray(1, 4).toString() === 'PNG';
    const isJpg = file.buffer[0] === 0xff && file.buffer[1] === 0xd8;
    if (!isPdf && !isPng && !isJpg) throw new BadRequestException('Bitte ein PDF, PNG oder JPG hochladen');
    const type = isPdf ? 'application/pdf' : isPng ? 'image/png' : 'image/jpeg';
    return this.access.sys(m, async (c) => {
      await this.backdatedRun(c, runId);
      const hash = sha256(file.buffer);
      const key = `run-docs/${m.tenantId}/${runId}/${randomUUID()}-${hash.slice(0, 12)}.${isPdf ? 'pdf' : isPng ? 'png' : 'jpg'}`;
      await this.storage.put('uploads', key, file.buffer, { contentType: type });
      const d = await c.query(
        `INSERT INTO run_document (tenant_id, run_id, kind, file_key, file_name, content_type, size_bytes, sha256)
         VALUES ($1, $2, 'beleg', $3, $4, $5, $6, $7) RETURNING id, file_name, sha256, created_at`,
        [m.tenantId, runId, key, (file.originalname || 'beleg').slice(0, 200), type, file.buffer.length, hash],
      );
      await this.audit.record(c, { entity: 'run', entityId: runId, action: 'receipt_added', payload: { documentId: d.rows[0].id, sha256: hash } });
      return d.rows[0];
    });
  }

  async documents(runId: string) {
    const m = await this.access.manage(runId);
    return this.access.sys(m, async (c) =>
      (
        await c.query(
          `SELECT id, kind, file_name, content_type, size_bytes, sha256, format, applied_at, created_at FROM run_document WHERE run_id = $1 ORDER BY created_at`,
          [runId],
        )
      ).rows,
    );
  }

  /** Stand der nachträglichen Erfassung für die Oberfläche (Schritte 2–4). */
  async state(runId: string) {
    const m = await this.access.manage(runId);
    return this.access.sys(m, async (c) => {
      const run = await this.attendance.loadRun(c, runId);
      if (!run.backdated_at) throw new ConflictException('Nur für nachträglich erfasste Termine');
      const atts = (
        await c.query(
          `SELECT a.id, a.person_id, p.name, p.email, a.duration_seconds, a.completeness, a.completeness_state, a.release, a.confirmed_at,
                  a.check_in_method, (SELECT e.verify_code FROM evidence e WHERE e.attendance_id = a.id) AS verify_code
             FROM attendance a JOIN person p ON p.id = a.person_id WHERE a.run_id = $1 ORDER BY p.name`,
          [runId],
        )
      ).rows;
      const docs = (await c.query(`SELECT id, kind, file_name, sha256, created_at FROM run_document WHERE run_id = $1 ORDER BY created_at`, [runId])).rows;
      return {
        run: {
          id: run.id, titel: run.titel, delivery: run.delivery, platform: run.platform, meetingUrl: run.meeting_url, ort: run.ort,
          startAt: run.start_at, endAt: run.end_at, completenessPct: run.completeness_pct, trainerName: run.trainer_name,
          backdatedAt: run.backdated_at, backdatedByName: run.backdated_by_name, reason: run.backdated_reason,
          kombiniert: run.followup_required, followupRunId: run.followup_run_id, countersignedAt: run.countersigned_at,
          countersignName: run.countersign_name, anlassTyp: run.anlass_typ, anlassText: run.anlass_text,
        },
        attendances: atts.map((a) => ({
          id: a.id, personId: a.person_id, name: a.name, email: a.email, minutes: Math.round(a.duration_seconds / 60),
          pct: Math.floor(Number(a.completeness) * 100), state: a.completeness_state, release: a.release,
          confirmedAt: a.confirmed_at, source: a.check_in_method, verifyCode: a.verify_code,
        })),
        documents: docs,
      };
    });
  }

  /** „Kombiniert“: nach der Gegenzeichnung Online-Bestätigung (Lesen/Wissenscheck) für alle Teilnehmenden. */
  async createFollowup(runId: string): Promise<{ followupRunId: string | null; invited: number }> {
    const m = await this.access.manage(runId);
    const res = await this.access.sys(m, async (c) => {
      const run = await this.attendance.loadRun(c, runId, true);
      if (!run.followup_required || run.followup_run_id || !run.countersigned_at) return null;
      const t = (await c.query('SELECT settings FROM training WHERE id = $1', [run.training_id])).rows[0];
      const deadline = new Date(this.clock.now().getTime() + parseSettings(t?.settings).deadlineDays * 86_400_000);
      const f = await c.query(
        `INSERT INTO run (training_id, training_version_id, typ, titel, deadline, status) VALUES ($1, $2, 'kampagne', $3, $4, 'laeuft') RETURNING id`,
        [run.training_id, run.training_version_id, `${run.titel} – Online-Bestätigung`, deadline],
      );
      const followupId = f.rows[0].id as string;
      await c.query('UPDATE run SET followup_run_id = $2 WHERE id = $1', [runId, followupId]);
      const persons = (
        await c.query(`SELECT p.id, p.email, p.reading_time_factor FROM attendance a JOIN person p ON p.id = a.person_id WHERE a.run_id = $1 AND a.confirmed_at IS NOT NULL`, [runId])
      ).rows;
      const queued: Array<{ id: string; tenantId: string | null }> = [];
      for (const p of persons) {
        const ins = await c.query(
          `INSERT INTO invitation (run_id, person_id, due_at, reading_time_factor) VALUES ($1, $2, $3, $4) ON CONFLICT (run_id, person_id) DO NOTHING RETURNING id`,
          [followupId, p.id, deadline, p.reading_time_factor],
        );
        if (ins.rowCount && p.email) {
          const n = await this.invitations.enqueueMail(c, ins.rows[0].id);
          if (n) queued.push(n);
        }
      }
      await this.audit.record(c, { entity: 'run', entityId: runId, action: 'followup_created', payload: { followupRunId: followupId, invited: persons.length } });
      return { followupId, invited: persons.length, queued };
    });
    if (!res) return { followupRunId: null, invited: 0 };
    await this.notifications.dispatch(res.queued);
    return { followupRunId: res.followupId, invited: res.invited };
  }
}
