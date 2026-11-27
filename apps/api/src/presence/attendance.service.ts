import {
  BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, UnauthorizedException,
} from '@nestjs/common';
import {
  CONFIRM_REMINDER_MS, formatDuration, MANUAL_REASON_LABEL, METHOD_LABEL, summarizeAttendance, validateManualCheckout,
  type AttendanceSummary, type CheckInMethod, type CheckOutMethod, type ManualCheckoutReason,
} from '@sn/shared';
import type pg from 'pg';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { StepUpService } from '../auth/step-up.service';
import { Clock } from '../common/clock';
import { sha256 } from '../common/crypto';
import { APP_CONFIG, type AppConfig } from '../config';
import { DbService } from '../db/db.service';
import { EvidenceService } from '../evidence/evidence.service';
import { JobRunner } from '../jobs/job-runner';
import { LiveBus } from '../live/live-bus.service';
import { NotificationService } from '../notifications/notification.service';
import type { ParticipantCtx } from '../participant/participant.service';
import { RedisService } from '../redis/redis.service';
import { InvitationService } from '../runs/invitation.service';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage';
import { parseSettings } from '../trainings/settings';
import { ATTENDANCE_CONFIRM_TEXT, attendanceCollector } from './attendance-evidence';
import { QrRejected, QrService } from './qr.service';
import { RunAccess, type ManageCtx } from './run-access.service';
import { WebhookEmitter } from '../webhooks/webhook-emitter';

type Queued = { id: string; tenantId: string | null };

export interface RunRow {
  id: string;
  tenant_id: string;
  typ: 'termin' | 'live_extern';
  status: 'geplant' | 'laeuft' | 'beendet';
  titel: string;
  training_id: string | null;
  training_version_id: string | null;
  version_no: number | null;
  rechtsgrundlage: string | null;
  provider: string | null;
  ort: string | null;
  start_at: Date;
  end_at: Date;
  started_at: Date | null;
  ended_at: Date | null;
  auto_ended: boolean;
  completeness_pct: number;
  trainer_person_id: string | null;
  trainer_name: string | null;
  countersigned_at: Date | null;
  countersign_name: string | null;
  countersign_method: string | null;
  qr_mode: string | null;
  allow_walk_in: boolean;
  tenant_name: string;
  /** E-51: Gegenzeichnung bei internen Terminen erforderlich (Einstellung der Schulung, eingefroren) */
  countersign_required: boolean;
  anlass_typ: string | null;
  anlass_text: string | null;
}

export const RUN_SQL = `
  SELECT r.id, r.tenant_id, r.typ, r.status, coalesce(r.titel, t.titel) AS titel, r.training_id, r.training_version_id, v.version_no,
         coalesce(r.training_snapshot->>'rechtsgrundlage', t.rechtsgrundlage) AS rechtsgrundlage, r.provider, r.ort, r.start_at, r.end_at, r.started_at, r.ended_at, r.auto_ended, r.completeness_pct,
         r.trainer_person_id, tp.name AS trainer_name, r.countersigned_at, r.countersign_name, r.countersign_method, r.qr_mode,
         r.allow_walk_in, te.name AS tenant_name,
         coalesce((r.settings_snapshot->>'countersignRequired')::boolean, true) AS countersign_required,
         coalesce(r.training_snapshot->>'anlass_typ', t.anlass_typ) AS anlass_typ, coalesce(r.training_snapshot->>'anlass_text', t.anlass_text) AS anlass_text
    FROM run r LEFT JOIN training t ON t.id = r.training_id LEFT JOIN training_version v ON v.id = r.training_version_id
    LEFT JOIN person tp ON tp.id = r.trainer_person_id JOIN tenant te ON te.id = r.tenant_id
   WHERE r.id = $1 AND r.typ IN ('termin','live_extern')`;

export interface IntervalRow {
  attendance_id: string;
  in_at: Date;
  out_at: Date | null;
  in_method: CheckInMethod;
  out_method: CheckOutMethod | null;
  in_offline: boolean;
  out_offline: boolean;
}

export type AttendanceStatus =
  | 'nicht_eingecheckt' | 'nicht_teilgenommen' | 'anwesend' | 'ausgecheckt' | 'vermerk_pruefen' | 'rueckfrage'
  | 'vermerk_akzeptiert' | 'pruefen' | 'bestaetigung_offen' | 'bestaetigt';
export const STATUS_LABEL: Record<AttendanceStatus, string> = {
  nicht_eingecheckt: 'nicht eingecheckt',
  nicht_teilgenommen: 'nicht teilgenommen',
  anwesend: 'anwesend',
  ausgecheckt: 'ausgecheckt',
  vermerk_pruefen: 'Vermerk prüfen',
  rueckfrage: 'Rückfrage gesendet',
  vermerk_akzeptiert: 'Vermerk akzeptiert',
  pruefen: 'Auschecken fehlt – prüfen',
  bestaetigung_offen: 'Bestätigung offen',
  bestaetigt: 'bestätigt',
};

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((w) => w[0]!.toUpperCase()).slice(0, 3).join('');

export const evidenceKind = (typ: string) => (typ === 'termin' ? 'praesenz' : 'live') as 'praesenz' | 'live';
const berlin = (d: Date, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', ...opts }).format(d);
export const hhmm = (d: Date | null) => (d ? berlin(d, { hour: '2-digit', minute: '2-digit' }) : '–');
export const ddmmyyyy = (d: Date | null) => (d ? berlin(d, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–');

/**
 * Präsenz und Live-Erfassung (Schritte 2.3/2.4): Termine, QR-Check-in/-out, manuelles Ausloggen mit Vermerk,
 * offizielles Ende, Bestätigung, Gegenzeichnung, Erinnerung nach 48 h. Dauer/Vollständigkeit rechnet ausschließlich
 * der Server (E-17) mit der injizierbaren Uhr (E-14).
 */
@Injectable()
export class AttendanceService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AttendanceService.name);
  private runner!: JobRunner<Record<string, never>>;

  constructor(
    private readonly db: DbService,
    private readonly access: RunAccess,
    private readonly qr: QrService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly notifications: NotificationService,
    private readonly evidence: EvidenceService,
    private readonly bus: LiveBus,
    private readonly redis: RedisService,
    private readonly invitations: InvitationService,
    private readonly auth: AuthService,
    private readonly stepUp: StepUpService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onModuleInit() {
    const collector = attendanceCollector(this.db, this.storage);
    this.evidence.registerCollector('praesenz', collector);
    this.evidence.registerCollector('live', collector);
    this.runner = new JobRunner('presence', this.redis, this.config, () => this.tick());
    if (this.config.RUN_WORKERS && this.config.NODE_ENV !== 'test') {
      await this.runner.queue.upsertJobScheduler('presence-15min', { every: 15 * 60_000 }, { name: 'presence' });
    }
  }
  onModuleDestroy() {
    return this.runner.close();
  }

  participantUrl(invitationId: string) {
    return `${this.config.PUBLIC_BASE_URL}/teilnahme/${invitationId}/live`;
  }

  // ── Laden und Berechnen ───────────────────────────────────

  async loadRun(c: pg.PoolClient, runId: string, lock = false): Promise<RunRow> {
    if (lock) await c.query('SELECT 1 FROM run WHERE id = $1 FOR UPDATE', [runId]);
    const r = (await c.query(RUN_SQL, [runId])).rows[0] as RunRow | undefined;
    if (!r) throw new NotFoundException('Termin nicht gefunden');
    return r;
  }

  summarize(run: RunRow, intervals: Pick<IntervalRow, 'in_at' | 'out_at'>[], now = this.clock.now()): AttendanceSummary {
    return summarizeAttendance(
      intervals.map((i) => ({ inAt: new Date(i.in_at).getTime(), outAt: i.out_at ? new Date(i.out_at).getTime() : null })),
      { startAt: run.start_at.getTime(), endAt: run.end_at.getTime(), endedAt: run.ended_at?.getTime() ?? null },
      now.getTime(),
      run.completeness_pct,
    );
  }

  private async intervalsOf(c: pg.PoolClient, attendanceIds: string[]): Promise<Map<string, IntervalRow[]>> {
    const rows = attendanceIds.length
      ? ((
          await c.query(
            `SELECT attendance_id, in_at, out_at, in_method, out_method, in_offline, out_offline
               FROM attendance_interval WHERE attendance_id = ANY($1::uuid[]) ORDER BY in_at`,
            [attendanceIds],
          )
        ).rows as IntervalRow[])
      : [];
    const m = new Map<string, IntervalRow[]>();
    for (const r of rows) m.set(r.attendance_id, [...(m.get(r.attendance_id) ?? []), r]);
    return m;
  }

  private async persistSummary(c: pg.PoolClient, run: RunRow, attendanceId: string) {
    const iv = (await this.intervalsOf(c, [attendanceId])).get(attendanceId) ?? [];
    const s = this.summarize(run, iv);
    await c.query('UPDATE attendance SET duration_seconds = $2, completeness = $3, completeness_state = $4 WHERE id = $1', [
      attendanceId, Math.floor(s.durationMs / 1000), s.completeness.toFixed(4), s.state,
    ]);
    return s;
  }

  // ── Termine anlegen und einladen ──────────────────────────

  async createTermin(b: {
    typ: 'termin' | 'live_extern'; trainingId?: string | null; titel?: string | null; provider?: string | null; startAt: string; endAt: string;
    ort?: string | null; trainerPersonId?: string | null; qrMode?: 'rotierend' | 'statisch'; completenessPct?: number | null; allowWalkIn?: boolean;
  }) {
    return this.db.tx(async (c) => {
      let training: { id: string; titel: string; settings: unknown; version_id: string | null } | undefined;
      if (b.trainingId) {
        training = (
          await c.query(
            `SELECT t.id, t.titel, t.settings,
                    (SELECT v.id FROM training_version v WHERE v.training_id = t.id AND v.sprache = 'de' AND v.published_at IS NOT NULL ORDER BY v.version_no DESC LIMIT 1) AS version_id
               FROM training t WHERE t.id = $1 AND t.archived_at IS NULL`,
            [b.trainingId],
          )
        ).rows[0];
        if (!training) throw new BadRequestException('Schulung nicht gefunden');
      } else if (b.typ === 'termin') {
        throw new BadRequestException('Für einen Präsenztermin bitte eine Schulung aus dem Katalog wählen');
      }
      const pct = b.completenessPct ?? (training ? parseSettings(training.settings).completenessPct : 90);
      const r = await c.query(
        `INSERT INTO run (training_id, training_version_id, typ, titel, start_at, end_at, ort, trainer_person_id, provider, qr_mode,
                          completeness_pct, allow_walk_in, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'geplant') RETURNING id`,
        [training?.id ?? null, training?.version_id ?? null, b.typ, b.titel?.trim() || null, b.startAt, b.endAt, b.ort ?? null,
          b.trainerPersonId ?? null, b.provider ?? null, b.qrMode ?? 'rotierend', pct, b.allowWalkIn ?? true],
      );
      const id = r.rows[0].id as string;
      await this.audit.record(c, { entity: 'run', entityId: id, action: 'created', payload: { typ: b.typ, trainingId: training?.id ?? null, startAt: b.startAt, endAt: b.endAt } });
      return { id };
    });
  }

  /** Personen/Org-Einheiten einladen: Einladung mit persönlichem Link (Phase 1), Mail mit Termin-Vorlage. */
  async addParticipants(runId: string, b: { personIds: string[]; orgUnitIds: string[]; sendMail: boolean }) {
    const m = await this.access.manage(runId);
    const res = await this.access.sys(m, async (c) => {
      const run = await this.loadRun(c, runId);
      if (run.status === 'beendet') throw new ConflictException('Der Termin ist beendet');
      const persons = (
        await c.query(
          `WITH RECURSIVE units AS (
             SELECT id FROM org_unit WHERE id = ANY($2::uuid[])
             UNION SELECT o.id FROM org_unit o JOIN units u ON o.parent_id = u.id)
           SELECT p.id, p.email FROM person p
            WHERE (p.id = ANY($1::uuid[]) OR p.org_unit_id IN (SELECT id FROM units))
              AND (p.austritt_am IS NULL OR p.austritt_am > current_date)`,
          [b.personIds, b.orgUnitIds],
        )
      ).rows;
      let created = 0;
      const withoutEmail: string[] = [];
      const queued: Queued[] = [];
      for (const p of persons) {
        const ins = await c.query(
          `INSERT INTO invitation (run_id, person_id, due_at) VALUES ($1, $2, $3) ON CONFLICT (run_id, person_id) DO NOTHING RETURNING id`,
          [runId, p.id, new Date(run.end_at.getTime() + CONFIRM_REMINDER_MS)],
        );
        if (!ins.rowCount) continue;
        created++;
        if (!p.email) withoutEmail.push(p.id);
        else if (b.sendMail) queued.push(await this.enqueueInvitationMail(c, run, ins.rows[0].id));
      }
      await this.audit.record(c, { entity: 'run', entityId: runId, action: 'invited', payload: { created, mails: queued.length } });
      return { created, skipped: persons.length - created, withoutEmail, queued };
    });
    await this.notifications.dispatch(res.queued);
    await this.bus.publish(runId, 'attendance');
    return { created: res.created, skipped: res.skipped, mailsQueued: res.queued.length, withoutEmail: res.withoutEmail };
  }

  private async enqueueInvitationMail(c: pg.PoolClient, run: RunRow, invitationId: string): Promise<Queued> {
    const p = (await c.query('SELECT p.name, p.email FROM invitation i JOIN person p ON p.id = i.person_id WHERE i.id = $1', [invitationId])).rows[0];
    const link = await this.invitations.issueLink(c, invitationId);
    const n = await this.notifications.enqueue(c, {
      tenantId: run.tenant_id, channel: 'mail', recipient: p.email, template: 'termin-invitation',
      data: {
        personName: p.name, trainingTitle: run.titel, provider: run.provider, date: ddmmyyyy(run.start_at),
        time: `${hhmm(run.start_at)}–${hhmm(run.end_at)}`, place: run.ort, tenantName: run.tenant_name, reminder: false,
      },
      secret: { link },
    });
    await c.query('UPDATE invitation SET sent_at = $2 WHERE id = $1', [invitationId, this.clock.now()]);
    return n;
  }

  // ── QR-Codes ──────────────────────────────────────────────

  async qrCode(runId: string, kind: 'start' | 'end', printed: boolean) {
    const m = await this.access.manage(runId);
    const run = await this.access.sys(m, (c) => this.loadRun(c, runId));
    if (run.status === 'beendet') throw new ConflictException({ code: 'beendet', message: 'Schulung offiziell beendet – die QR-Codes sind deaktiviert.' });
    const info = { id: run.id, tenantId: run.tenant_id, startAt: run.start_at, endAt: run.end_at, endedAt: run.ended_at };
    if (printed) {
      await this.access.sys(m, (c) => this.audit.record(c, { entity: 'run', entityId: runId, action: 'qr_printed', payload: { kind } }));
      return this.qr.printed(info, kind);
    }
    return this.qr.rotating(info, kind);
  }

  // ── Kern: Ein- und Auschecken ─────────────────────────────

  /** Eincheckzeit `at` ist Serverzeit (online) bzw. signierter Slot-Beginn (offline). */
  private async checkinCore(
    c: pg.PoolClient, run: RunRow, personId: string, invitationId: string | null, at: Date, method: CheckInMethod, offline: boolean,
    extra: Record<string, unknown> = {},
  ) {
    const att = (
      await c.query(
        `INSERT INTO attendance (run_id, person_id, invitation_id, check_in_method) VALUES ($1, $2, $3, $4)
         ON CONFLICT (run_id, person_id) DO UPDATE SET invitation_id = coalesce(attendance.invitation_id, EXCLUDED.invitation_id)
         RETURNING id`,
        [run.id, personId, invitationId, method],
      )
    ).rows[0];
    const a = (await c.query('SELECT id, confirmed_at FROM attendance WHERE id = $1 FOR UPDATE', [att.id])).rows[0];
    if (a.confirmed_at) throw new ConflictException({ code: 'bestaetigt', message: 'Die Teilnahme ist bereits bestätigt.' });
    const last = (
      await c.query('SELECT id, in_at, out_at FROM attendance_interval WHERE attendance_id = $1 ORDER BY in_at DESC LIMIT 1', [a.id])
    ).rows[0];
    if (last && !last.out_at) return { attendanceId: a.id as string, already: true };
    if (last && last.out_at > at) {
      throw new ConflictException({ code: 'reihenfolge', message: 'Der Scan liegt vor dem letzten Auschecken und kann nicht übernommen werden.' });
    }
    // Offline-Scan, der erst nach dem offiziellen Ende ankommt: Intervall endet mit dem offiziellen Ende.
    const closeAt = run.ended_at && run.ended_at > at ? run.ended_at : null;
    await c.query(
      `INSERT INTO attendance_interval (attendance_id, in_at, in_method, in_offline, out_at, out_method) VALUES ($1, $2, $3, $4, $5, $6)`,
      [a.id, at, method, offline, closeAt, closeAt ? 'official_end' : null],
    );
    await c.query('UPDATE attendance SET check_in_method = coalesce(check_in_method, $2) WHERE id = $1', [a.id, method]);
    if (invitationId) {
      await c.query(`UPDATE invitation SET status = 'geoeffnet', opened_at = coalesce(opened_at, $2) WHERE id = $1 AND status = 'offen'`, [invitationId, at]);
    }
    await this.persistSummary(c, run, a.id);
    await this.audit.record(c, { entity: 'attendance', entityId: a.id, action: 'checked_in', payload: { runId: run.id, method, at: at.toISOString(), offline, ...extra } });
    return { attendanceId: a.id as string, already: false };
  }

  private async checkoutCore(
    c: pg.PoolClient, run: RunRow, personId: string, at: Date, method: CheckOutMethod, offline: boolean,
    manual?: { reason: ManualCheckoutReason; note: string }, extra: Record<string, unknown> = {},
  ) {
    const a = (await c.query('SELECT id, confirmed_at FROM attendance WHERE run_id = $1 AND person_id = $2 FOR UPDATE', [run.id, personId])).rows[0];
    if (!a) throw new ConflictException({ code: 'nicht_eingecheckt', message: 'Sie sind nicht eingecheckt.' });
    if (a.confirmed_at) throw new ConflictException({ code: 'bestaetigt', message: 'Die Teilnahme ist bereits bestätigt.' });
    const last = (
      await c.query('SELECT id, in_at, out_at, out_method FROM attendance_interval WHERE attendance_id = $1 ORDER BY in_at DESC LIMIT 1', [a.id])
    ).rows[0];
    let target = last && !last.out_at ? last : null;
    // Offline-Auschecken vor dem offiziellen Ende, das erst danach ankommt: das offizielle Ende wird durch den Scan ersetzt.
    if (!target && offline && last?.out_method === 'official_end' && at < last.out_at) target = last;
    if (!target) throw new ConflictException({ code: 'nicht_eingecheckt', message: 'Sie sind nicht eingecheckt.' });
    if (at < target.in_at) throw new ConflictException({ code: 'reihenfolge', message: 'Der Scan liegt vor dem Einchecken und kann nicht übernommen werden.' });
    await c.query('UPDATE attendance_interval SET out_at = $2, out_method = $3, out_offline = $4 WHERE id = $1', [target.id, at, method, offline]);
    if (manual) {
      await c.query(
        `UPDATE attendance SET check_out_method = $2, check_out_reason = $3, check_out_note = $4, note_review = 'offen',
                note_review_message = NULL, note_reviewed_at = NULL, note_reviewed_by = NULL WHERE id = $1`,
        [a.id, method, manual.reason, manual.note],
      );
    } else {
      await c.query('UPDATE attendance SET check_out_method = $2 WHERE id = $1', [a.id, method]);
    }
    await this.persistSummary(c, run, a.id);
    await this.audit.record(c, {
      entity: 'attendance', entityId: a.id, action: manual ? 'checked_out_manual' : 'checked_out',
      payload: { runId: run.id, method, at: at.toISOString(), offline, ...(manual ? { reason: manual.reason } : {}), ...extra },
    });
    return { attendanceId: a.id as string };
  }

  private tryQr<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof QrRejected) throw new BadRequestException({ code: e.reason, message: e.message });
      throw e;
    }
  }

  /** QR-Scan durch Teilnehmer. Liefert den Termin + (falls nötig) die Daten für eine neue Link-Sitzung (Check-in ohne Einladung). */
  async scan(
    kind: 'start' | 'end',
    b: { token: string; offline?: boolean; deviceTime?: string | null; name?: string | null; email?: string | null },
  ): Promise<{ runId: string; participant: ParticipantCtx; newSession?: ParticipantCtx; already?: boolean }> {
    const payload = this.tryQr(() => this.qr.peek(b.token));
    const info = (await this.db.txAs({}, (c) => c.query('SELECT * FROM app.run_for_qr($1)', [payload.runId]))).rows[0];
    if (!info) throw new BadRequestException({ code: 'format', message: 'Dieser QR-Code gehört zu keinem Termin.' });
    const { scanAt, offline } = this.tryQr(() =>
      this.qr.verify(b.token, { id: payload.runId, tenantId: info.tenant_id, startAt: info.start_at, endAt: info.end_at, endedAt: info.ended_at }, kind, !!b.offline),
    );
    const runId = payload.runId;
    let p = await this.access.participant(runId);
    let newSession: ParticipantCtx | undefined;
    if (!p) {
      if (kind === 'end' || !info.allow_walk_in) throw new UnauthorizedException({ code: 'nicht_angemeldet', message: 'Bitte den persönlichen Link aus der Einladung öffnen.' });
      if (!b.name?.trim() || !b.email?.trim()) {
        throw new UnauthorizedException({ code: 'anmeldung_noetig', message: 'Bitte Name und E-Mail-Adresse angeben, um einzuchecken.', runId });
      }
      p = newSession = await this.walkIn(runId, info.tenant_id, b.name.trim(), b.email.trim().toLowerCase());
    }
    const extra = { ...(b.deviceTime ? { deviceTime: b.deviceTime } : {}) };
    const r = await this.db.txAs(this.access.pctx(p), async (c) => {
      const run = await this.loadRun(c, runId, true);
      if (run.status === 'beendet' && !(offline && run.ended_at && scanAt < run.ended_at)) {
        throw new BadRequestException({ code: 'beendet', message: 'Die Schulung wurde offiziell beendet. Ein- und Auschecken ist nicht mehr möglich.' });
      }
      return kind === 'start'
        ? this.checkinCore(c, run, p.personId, p.invitationId, scanAt, 'qr_start', offline, extra)
        : this.checkoutCore(c, run, p.personId, scanAt, 'qr_end', offline, undefined, extra);
    });
    await this.bus.publish(runId, 'attendance');
    return { runId, participant: p, newSession, already: !!(r as { already?: boolean }).already };
  }

  /** Check-in per Start-QR ohne Einladung (E-07): Person im Mandanten finden oder anlegen, Einladung anlegen. */
  private async walkIn(runId: string, tenantId: string, name: string, email: string): Promise<ParticipantCtx> {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || name.length > 200) throw new BadRequestException('Bitte gültigen Namen und E-Mail-Adresse angeben');
    return this.db.txAs({ tenantId, roles: ['system'] }, async (c) => {
      let person = (await c.query('SELECT id FROM person WHERE email = $1', [email])).rows[0];
      let createdPerson = false;
      if (!person) {
        person = (await c.query('INSERT INTO person (name, email, extern) VALUES ($1, $2, true) RETURNING id', [name, email])).rows[0];
        createdPerson = true;
      }
      const run = await this.loadRun(c, runId);
      const inv = (
        await c.query(
          `INSERT INTO invitation (run_id, person_id, due_at, status, opened_at) VALUES ($1, $2, $3, 'geoeffnet', $4)
           ON CONFLICT (run_id, person_id) DO UPDATE SET opened_at = coalesce(invitation.opened_at, EXCLUDED.opened_at) RETURNING id`,
          [runId, person.id, new Date(run.end_at.getTime() + CONFIRM_REMINDER_MS), this.clock.now()],
        )
      ).rows[0];
      await this.audit.record(c, { entity: 'invitation', entityId: inv.id, action: 'walk_in', payload: { runId, createdPerson } });
      return { tenantId, personId: person.id, invitationId: inv.id, accountId: null };
    });
  }

  /** Ohne QR beenden: Grund + Vermerk (≥ 10 Zeichen) → „Vermerk prüfen“ beim Organisator. */
  async manualCheckout(p: ParticipantCtx, reason: string, note: string) {
    const err = validateManualCheckout(reason, note);
    if (err) {
      const msg = { grund_fehlt: 'Bitte einen Grund auswählen', vermerk_zu_kurz: 'Der Vermerk braucht mindestens 10 Zeichen', vermerk_zu_lang: 'Der Vermerk ist zu lang' }[err];
      throw new BadRequestException({ message: 'Eingaben unvollständig oder ungültig', fields: [{ path: err === 'grund_fehlt' ? 'reason' : 'note', message: msg }] });
    }
    const runId = await this.runOfInvitation(p);
    await this.db.txAs(this.access.pctx(p), async (c) => {
      const run = await this.loadRun(c, runId, true);
      if (run.status === 'beendet') throw new ConflictException({ code: 'beendet', message: 'Die Schulung ist bereits beendet.' });
      return this.checkoutCore(c, run, p.personId, this.clock.now(), 'manual', false, { reason: reason as ManualCheckoutReason, note: note.trim() });
    });
    await this.bus.publish(runId, 'attendance');
    return runId;
  }

  async runOfInvitation(p: ParticipantCtx): Promise<string> {
    const r = (await this.db.txAs(this.access.pctx(p), (c) => c.query(`SELECT i.run_id FROM invitation i JOIN run r ON r.id = i.run_id WHERE i.id = $1 AND r.typ IN ('termin','live_extern')`, [p.invitationId]))).rows[0];
    if (!r) throw new NotFoundException('Termin nicht gefunden');
    return r.run_id;
  }

  // ── Organisator: Start, Kiosk/Trainer, offizielles Ende ───

  async start(runId: string) {
    const m = await this.access.manage(runId);
    const r = await this.access.sys(m, async (c) => {
      const run = await this.loadRun(c, runId, true);
      if (run.status === 'beendet') throw new ConflictException('Der Termin ist bereits beendet');
      if (run.status === 'laeuft' && run.started_at) return { status: run.status, startedAt: run.started_at };
      const now = this.clock.now();
      await c.query(`UPDATE run SET status = 'laeuft', started_at = $2 WHERE id = $1`, [runId, now]);
      await this.audit.record(c, { entity: 'run', entityId: runId, action: 'started', payload: { at: now.toISOString() } });
      return { status: 'laeuft', startedAt: now };
    });
    await this.bus.publish(runId, 'run');
    return r;
  }

  /** Tablet-Kiosk oder Trainer checkt eine Person ein/aus (ohne Smartphone). */
  async staffScan(runId: string, personId: string, method: 'kiosk' | 'trainer', direction: 'in' | 'out') {
    const m = await this.access.manage(runId);
    const r = await this.access.sys(m, async (c) => {
      const run = await this.loadRun(c, runId, true);
      if (run.status === 'beendet') throw new ConflictException({ code: 'beendet', message: 'Der Termin ist beendet.' });
      const person = (await c.query('SELECT id FROM person WHERE id = $1', [personId])).rows[0];
      if (!person) throw new NotFoundException('Person nicht gefunden');
      const now = this.clock.now();
      if (direction === 'in') {
        const inv = (
          await c.query(
            `INSERT INTO invitation (run_id, person_id, due_at) VALUES ($1, $2, $3)
             ON CONFLICT (run_id, person_id) DO UPDATE SET run_id = EXCLUDED.run_id RETURNING id`,
            [runId, personId, new Date(run.end_at.getTime() + CONFIRM_REMINDER_MS)],
          )
        ).rows[0];
        return this.checkinCore(c, run, personId, inv.id, now, method, false);
      }
      return this.checkoutCore(c, run, personId, now, method, false);
    });
    await this.bus.publish(runId, 'attendance');
    return r;
  }

  /** „Offiziell beenden“: offenes Intervall aller noch Eingecheckten endet mit dem offiziellen Ende, QR-Codes ungültig, Push. */
  async end(runId: string) {
    const m = await this.access.manage(runId);
    const res = await this.access.sys(m, async (c) => {
      const run = await this.loadRun(c, runId, true);
      if (run.status === 'beendet') throw new ConflictException('Der Termin ist bereits beendet');
      const now = this.clock.now();
      await c.query(`UPDATE run SET status = 'beendet', ended_at = $2, ended_by = $3, started_at = coalesce(started_at, $2) WHERE id = $1`, [runId, now, m.accountId]);
      await c.query(`UPDATE live_poll SET closed_at = $2 WHERE run_id = $1 AND closed_at IS NULL`, [runId, now]);
      const closed = await this.closeOpenIntervals(c, runId, now);
      const queued = await this.afterEnd(c, { ...run, status: 'beendet', ended_at: now });
      await this.audit.record(c, { entity: 'run', entityId: runId, action: 'ended', payload: { at: now.toISOString(), closed: closed.length, notified: queued.length } });
      return { endedAt: now, closed: closed.length, queued };
    });
    await this.notifications.dispatch(res.queued);
    await this.bus.publish(runId, 'run', 'attendance', 'polls');
    return { status: 'beendet', endedAt: res.endedAt, closedWithOfficialEnd: res.closed, notified: res.queued.length };
  }

  private async closeOpenIntervals(c: pg.PoolClient, runId: string, at: Date, autoClosed = false): Promise<string[]> {
    const closed = (
      await c.query(
        `UPDATE attendance_interval SET out_at = greatest($2::timestamptz, in_at), out_method = 'official_end'
          WHERE out_at IS NULL AND attendance_id IN (SELECT id FROM attendance WHERE run_id = $1) RETURNING attendance_id`,
        [runId, at],
      )
    ).rows.map((r) => r.attendance_id as string);
    if (closed.length) {
      await c.query(
        `UPDATE attendance SET check_out_method = 'official_end', auto_closed = $2,
                note_review = CASE WHEN $2 THEN 'offen' ELSE note_review END WHERE id = ANY($1::uuid[])`,
        [closed, autoClosed],
      );
      for (const id of closed) await this.audit.record(c, { entity: 'attendance', entityId: id, action: autoClosed ? 'auto_closed' : 'closed_official_end', payload: { runId, at: at.toISOString() } });
    }
    return closed;
  }

  /** Nach dem Ende: Dauer festschreiben, alle mit Anwesenheit per Push um Bestätigung bitten. */
  private async afterEnd(c: pg.PoolClient, run: RunRow): Promise<Queued[]> {
    const atts = (await c.query('SELECT id, person_id, invitation_id, confirmed_at FROM attendance WHERE run_id = $1', [run.id])).rows;
    const queued: Queued[] = [];
    for (const a of atts) {
      const s = await this.persistSummary(c, run, a.id);
      const hasIntervals = (await c.query('SELECT 1 FROM attendance_interval WHERE attendance_id = $1', [a.id])).rowCount;
      if (a.confirmed_at || !hasIntervals) continue;
      queued.push(
        await this.notifications.enqueue(c, {
          tenantId: run.tenant_id, channel: 'push', recipient: `person:${a.person_id}`, template: 'attendance-confirm',
          data: { trainingTitle: run.titel, duration: formatDuration(s.durationMs), url: a.invitation_id ? this.participantUrl(a.invitation_id) : null, runId: run.id },
        }),
      );
    }
    return queued;
  }

  // ── Vermerk prüfen, Freigabe bei „teilweise“, Bestätigung ─

  async review(attendanceId: string, decision: 'akzeptiert' | 'rueckfrage', message?: string | null) {
    const ref = await this.access.ref('attendance', attendanceId);
    const m = await this.access.manage(ref.runId);
    const res = await this.access.sys(m, async (c) => {
      const run = await this.loadRun(c, ref.runId);
      const a = (
        await c.query(
          `SELECT a.id, a.note_review, a.check_out_note, a.person_id, a.invitation_id, p.name, p.email
             FROM attendance a JOIN person p ON p.id = a.person_id WHERE a.id = $1 FOR UPDATE OF a`,
          [attendanceId],
        )
      ).rows[0];
      if (!a?.note_review) throw new ConflictException('Für diese Teilnahme gibt es keinen Vermerk zu prüfen');
      if (a.note_review === 'akzeptiert') throw new ConflictException('Der Vermerk ist bereits akzeptiert');
      const now = this.clock.now();
      await c.query(
        'UPDATE attendance SET note_review = $2, note_review_message = $3, note_reviewed_at = $4, note_reviewed_by = $5 WHERE id = $1',
        [attendanceId, decision, message ?? null, now, m.accountId],
      );
      await this.audit.record(c, { entity: 'attendance', entityId: attendanceId, action: 'note_reviewed', payload: { decision, hasMessage: !!message } });
      const queued: Queued[] = [];
      if (decision === 'rueckfrage') {
        const data = { personName: a.name, trainingTitle: run.titel, note: a.check_out_note ?? '', message: message ?? null, organizer: null, url: a.invitation_id ? this.participantUrl(a.invitation_id) : null };
        queued.push(await this.notifications.enqueue(c, { tenantId: run.tenant_id, channel: 'push', recipient: `person:${a.person_id}`, template: 'attendance-note-question', data }));
        if (a.email) queued.push(await this.notifications.enqueue(c, { tenantId: run.tenant_id, channel: 'mail', recipient: a.email, template: 'attendance-note-question', data }));
      }
      return queued;
    });
    await this.notifications.dispatch(res);
    if (decision === 'akzeptiert') await this.finalize(ref.tenantId, [attendanceId]);
    await this.bus.publish(ref.runId, 'attendance');
    return this.organizerRow(ref.runId, attendanceId, m);
  }

  /** „teilweise“ → Anrechnung nur mit Freigabe (SPEZIFIKATION 4.8). */
  async release(attendanceId: string, decision: 'freigegeben' | 'abgelehnt', note?: string | null) {
    const ref = await this.access.ref('attendance', attendanceId);
    const m = await this.access.manage(ref.runId);
    await this.access.sys(m, async (c) => {
      const a = (await c.query('SELECT completeness_state, release FROM attendance WHERE id = $1 FOR UPDATE', [attendanceId])).rows[0];
      const open = (await c.query('SELECT 1 FROM attendance_interval WHERE attendance_id = $1 AND out_at IS NULL', [attendanceId])).rowCount;
      if (open) throw new ConflictException('Die Person ist noch eingecheckt');
      if (a.completeness_state !== 'teilweise') throw new ConflictException('Die Teilnahme ist vollständig – keine Freigabe nötig');
      if (a.release) throw new ConflictException('Über die Anrechnung wurde bereits entschieden');
      await c.query('UPDATE attendance SET release = $2, release_note = $3, released_at = $4, released_by = $5 WHERE id = $1', [
        attendanceId, decision, note ?? null, this.clock.now(), m.accountId,
      ]);
      await this.audit.record(c, { entity: 'attendance', entityId: attendanceId, action: 'release_decided', payload: { decision } });
    });
    await this.finalize(ref.tenantId, [attendanceId]);
    await this.bus.publish(ref.runId, 'attendance');
    return this.organizerRow(ref.runId, attendanceId, m);
  }

  /** Teilnehmer bestätigt die Zusammenfassung (Dauer, Vollständigkeit, Methode, Vermerk). */
  async confirm(attendanceId: string) {
    const ref = await this.access.ref('attendance', attendanceId);
    const p = await this.access.requireParticipant(ref.runId);
    await this.db.txAs(this.access.pctx(p), async (c) => {
      const a = (await c.query('SELECT id, person_id, confirmed_at FROM attendance WHERE id = $1 FOR UPDATE', [attendanceId])).rows[0];
      if (!a || a.person_id !== p.personId) throw new NotFoundException('Teilnahme nicht gefunden');
      if (a.confirmed_at) throw new ConflictException({ code: 'bestaetigt', message: 'Die Teilnahme ist bereits bestätigt.' });
      await this.assertConfirmable(c, attendanceId);
      const run = await this.loadRun(c, ref.runId);
      const s = await this.persistSummary(c, run, attendanceId);
      await c.query(`UPDATE attendance SET confirmed_at = $2, confirmed_via = 'selbst' WHERE id = $1`, [attendanceId, this.clock.now()]);
      await this.audit.record(c, { entity: 'attendance', entityId: attendanceId, action: 'confirmed', payload: { durationSeconds: Math.floor(s.durationMs / 1000), state: s.state } });
    });
    await this.finalize(ref.tenantId, [attendanceId]);
    await this.bus.publish(ref.runId, 'attendance');
    return ref.runId;
  }

  private async assertConfirmable(c: pg.PoolClient, attendanceId: string) {
    const iv = (await c.query('SELECT count(*)::int AS n, count(*) FILTER (WHERE out_at IS NULL)::int AS open FROM attendance_interval WHERE attendance_id = $1', [attendanceId])).rows[0];
    if (!iv.n) throw new ConflictException({ code: 'keine_anwesenheit', message: 'Es ist keine Anwesenheit erfasst.' });
    if (iv.open) throw new ConflictException({ code: 'eingecheckt', message: 'Bitte zuerst auschecken (Ende-QR oder ohne QR beenden).' });
  }

  /** Bestätigung am Tablet des Organisators (Person ohne Smartphone) mit Unterschrift. */
  async kioskConfirm(attendanceId: string, signaturePng: string) {
    const ref = await this.access.ref('attendance', attendanceId);
    const m = await this.access.manage(ref.runId);
    const png = Buffer.from(signaturePng.split(',')[1]!, 'base64');
    if (png.subarray(1, 4).toString() !== 'PNG') throw new BadRequestException('Unterschriftsbild ist kein PNG');
    const key = `kiosk/${ref.tenantId}/${attendanceId}-${sha256(png).slice(0, 12)}.png`;
    await this.access.sys(m, async (c) => {
      const a = (await c.query('SELECT confirmed_at FROM attendance WHERE id = $1 FOR UPDATE', [attendanceId])).rows[0];
      if (a.confirmed_at) throw new ConflictException({ code: 'bestaetigt', message: 'Die Teilnahme ist bereits bestätigt.' });
      await this.assertConfirmable(c, attendanceId);
      await this.persistSummary(c, await this.loadRun(c, ref.runId), attendanceId);
      await this.storage.put('evidence', key, png, { contentType: 'image/png' });
      await c.query(`UPDATE attendance SET confirmed_at = $2, confirmed_via = 'kiosk', kiosk_signature_key = $3 WHERE id = $1`, [attendanceId, this.clock.now(), key]);
      await this.audit.record(c, { entity: 'attendance', entityId: attendanceId, action: 'confirmed', payload: { via: 'kiosk', signatureSha256: sha256(png) } });
    });
    await this.finalize(ref.tenantId, [attendanceId]);
    await this.bus.publish(ref.runId, 'attendance');
    return this.organizerRow(ref.runId, attendanceId, m);
  }

  /** Gegenzeichnung durch den Trainer (interne Präsenz, SPEZIFIKATION 4.6) mit Step-up per Passwort (E-08). */
  async countersign(runId: string, b: { password?: string; stepUpToken?: string }) {
    const m = await this.access.manage(runId);
    const purpose = `countersign:${runId}`;
    const token = b.stepUpToken ?? (b.password ? await this.auth.stepUpWithPassword(b.password, purpose) : null);
    if (!token) throw new UnauthorizedException('Bitte mit Passwort bestätigen');
    const precheck = await this.access.sys(m, (c) => this.loadRun(c, runId));
    if (precheck.typ !== 'termin') throw new ConflictException('Gegenzeichnung gibt es nur bei internen Präsenzterminen');
    if (precheck.status !== 'beendet') throw new ConflictException('Bitte den Termin zuerst beenden');
    if (precheck.countersigned_at) throw new ConflictException('Der Termin ist bereits gegengezeichnet');
    const method = await this.stepUp.consume(token, { subject: m.accountId, purpose });
    const ids = await this.access.sys(m, async (c) => {
      await this.loadRun(c, runId, true);
      const name =
        (await c.query('SELECT name FROM person WHERE account_id = $1 ORDER BY created_at LIMIT 1', [m.accountId])).rows[0]?.name ??
        (await c.query('SELECT display_name FROM account WHERE id = $1', [m.accountId])).rows[0]?.display_name ?? 'Trainer';
      const now = this.clock.now();
      const r = await c.query(
        `UPDATE run SET countersigned_at = $2, countersigned_by = $3, countersign_name = $4, countersign_method = $5
          WHERE id = $1 AND countersigned_at IS NULL RETURNING id`,
        [runId, now, m.accountId, name, method],
      );
      if (!r.rowCount) throw new ConflictException('Der Termin ist bereits gegengezeichnet');
      const atts = (await c.query('SELECT id FROM attendance WHERE run_id = $1 AND confirmed_at IS NOT NULL', [runId])).rows.map((x) => x.id as string);
      await this.audit.record(c, { entity: 'run', entityId: runId, action: 'countersigned', payload: { method, name, confirmed: atts.length } });
      return { atts, now, name };
    });
    const created = await this.finalize(m.tenantId, ids.atts);
    await this.bus.publish(runId, 'run', 'attendance');
    return { countersignedAt: ids.now, countersignName: ids.name, method, evidenceQueued: created.length };
  }

  /**
   * Nachweis erzeugen, sobald alles erfüllt ist: bestätigt, kein offenes Intervall, Vermerk akzeptiert (falls manuell
   * bzw. automatisch geschlossen), bei „teilweise“ über die Anrechnung entschieden, bei interner Präsenz gegengezeichnet.
   */
  async finalize(tenantId: string, attendanceIds: string[]): Promise<string[]> {
    const created: string[] = [];
    for (const id of attendanceIds) {
      const ready = await this.db.txAs({ tenantId, roles: ['system'] }, async (c) => {
        const a = (
          await c.query(
            `SELECT a.*, p.name AS person_name, (SELECT count(*) FROM attendance_interval i WHERE i.attendance_id = a.id AND i.out_at IS NULL)::int AS open,
                    (SELECT 1 FROM evidence e WHERE e.attendance_id = a.id) AS has_evidence
               FROM attendance a JOIN person p ON p.id = a.person_id WHERE a.id = $1`,
            [id],
          )
        ).rows[0];
        if (!a || !a.confirmed_at || a.open || a.has_evidence) return null;
        if (a.note_review && a.note_review !== 'akzeptiert') return null;
        if (a.completeness_state === 'teilweise' && !a.release) return null;
        const run = await this.loadRun(c, a.run_id);
        if (run.typ === 'termin' && run.countersign_required && !run.countersigned_at) return null;
        const credited = a.completeness_state === 'vollstaendig' || a.release === 'freigegeben';
        if (a.invitation_id && credited) {
          await c.query(`UPDATE invitation SET status = 'bestaetigt', completed_at = coalesce(completed_at, $2) WHERE id = $1`, [a.invitation_id, a.confirmed_at]);
          await WebhookEmitter.emit(c, tenantId, 'invitation.completed', { invitationId: a.invitation_id }); // E-37
        }
        await this.audit.record(c, { entity: 'attendance', entityId: id, action: 'finalized', payload: { credited } });
        await WebhookEmitter.emit(c, tenantId, 'attendance.confirmed', { attendanceId: id }); // E-37
        return { kind: evidenceKind(run.typ), subject: { titel: run.titel, version: run.version_no, initialen: initials(a.person_name) + '.' } };
      });
      if (!ready) continue;
      const ev = await this.evidence.create(tenantId, ready.kind, { attendanceId: id }, ready.subject);
      created.push(ev.id);
    }
    return created;
  }

  // ── Job: Zeitfenster abgelaufen, Erinnerung nach 48 h ─────

  async tick() {
    const closed = await this.closeExpiredWindows();
    const reminded = await this.remindUnconfirmed();
    return { closed, reminded };
  }

  /** Termine ohne offizielles Ende: beim Ablauf des Zeitfensters mit dem geplanten Ende schließen, Status „prüfen“ (E-17). */
  async closeExpiredWindows(): Promise<number> {
    const now = this.clock.now();
    const due = (await this.db.txAs({}, (c) => c.query('SELECT * FROM app.runs_window_expired($1, 50)', [now]))).rows;
    for (const d of due) {
      const queued = await this.db.txAs({ tenantId: d.tenant_id, roles: ['system'] }, async (c) => {
        const run = await this.loadRun(c, d.run_id, true);
        if (run.status === 'beendet') return [];
        await c.query(`UPDATE run SET status = 'beendet', ended_at = end_at, auto_ended = true WHERE id = $1`, [run.id]);
        await c.query(`UPDATE live_poll SET closed_at = greatest(opened_at, $2) WHERE run_id = $1 AND closed_at IS NULL`, [run.id, run.end_at]);
        const closed = await this.closeOpenIntervals(c, run.id, run.end_at, true);
        const q = await this.afterEnd(c, { ...run, status: 'beendet', ended_at: run.end_at, auto_ended: true });
        await this.audit.record(c, { entity: 'run', entityId: run.id, action: 'auto_ended', payload: { closed: closed.length } });
        return q;
      });
      await this.notifications.dispatch(queued);
      await this.bus.publish(d.run_id, 'run', 'attendance', 'polls');
    }
    return due.length;
  }

  async remindUnconfirmed(): Promise<number> {
    const now = this.clock.now();
    const cutoff = new Date(now.getTime() - CONFIRM_REMINDER_MS);
    const due = (await this.db.txAs({}, (c) => c.query('SELECT * FROM app.attendance_confirm_due($1, 200)', [cutoff]))).rows;
    for (const d of due) {
      const queued = await this.db.txAs({ tenantId: d.tenant_id, roles: ['system'] }, async (c) => {
        const a = (
          await c.query(
            `SELECT a.id, a.run_id, a.person_id, a.invitation_id, p.name, p.email FROM attendance a JOIN person p ON p.id = a.person_id
              WHERE a.id = $1 AND a.confirmed_at IS NULL AND a.confirm_reminded_at IS NULL FOR UPDATE OF a`,
            [d.attendance_id],
          )
        ).rows[0];
        if (!a) return [];
        const run = await this.loadRun(c, a.run_id);
        const data = { personName: a.name, trainingTitle: run.titel, date: ddmmyyyy(run.start_at), url: a.invitation_id ? this.participantUrl(a.invitation_id) : null };
        const q: Queued[] = [await this.notifications.enqueue(c, { tenantId: d.tenant_id, channel: 'push', recipient: `person:${a.person_id}`, template: 'attendance-confirm-reminder', data })];
        if (a.email) q.push(await this.notifications.enqueue(c, { tenantId: d.tenant_id, channel: 'mail', recipient: a.email, template: 'attendance-confirm-reminder', data }));
        await c.query('UPDATE attendance SET confirm_reminded_at = $2 WHERE id = $1', [a.id, now]);
        await this.audit.record(c, { entity: 'attendance', entityId: a.id, action: 'confirm_reminded', payload: {} });
        return q;
      });
      await this.notifications.dispatch(queued);
    }
    return due.length;
  }

  // ── Sichten ───────────────────────────────────────────────

  runView(run: RunRow) {
    return {
      id: run.id,
      typ: run.typ,
      titel: run.titel,
      trainingId: run.training_id,
      provider: run.provider,
      ort: run.ort,
      startAt: run.start_at,
      endAt: run.end_at,
      plannedSeconds: Math.round((run.end_at.getTime() - run.start_at.getTime()) / 1000),
      status: run.status,
      startedAt: run.started_at,
      endedAt: run.ended_at,
      autoEnded: run.auto_ended,
      completenessPct: run.completeness_pct,
      qrMode: run.qr_mode,
      allowWalkIn: run.allow_walk_in,
      trainer: run.trainer_person_id ? { personId: run.trainer_person_id, name: run.trainer_name } : null,
      countersign: run.countersigned_at ? { at: run.countersigned_at, name: run.countersign_name, method: run.countersign_method } : null,
      tenantName: run.tenant_name,
      confirmText: ATTENDANCE_CONFIRM_TEXT,
      serverTime: this.clock.now(),
    };
  }

  /** Zeilen der Anwesenheitsliste (alle Eingeladenen) bzw. nur die eigene. */
  private async rows(c: pg.PoolClient, run: RunRow, filter: { personId?: string; attendanceId?: string } = {}) {
    const now = this.clock.now();
    const list = (
      await c.query(
        `SELECT i.id AS invitation_id, p.id AS person_id, p.name AS person_name, a.id AS attendance_id, a.check_in_method, a.check_out_method,
                a.check_out_reason, a.check_out_note, a.note_review, a.note_review_message, a.note_reviewed_at, a.auto_closed, a.release, a.release_note,
                a.confirmed_at, a.confirmed_via, a.confirm_reminded_at, e.id AS evidence_id, e.status AS evidence_status, e.nachweis_nr, e.verify_code,
                EXISTS (SELECT 1 FROM live_question q WHERE q.run_id = i.run_id AND q.person_id = p.id) AS asked_question
           FROM invitation i JOIN person p ON p.id = i.person_id
           LEFT JOIN attendance a ON a.run_id = i.run_id AND a.person_id = i.person_id
           LEFT JOIN evidence e ON e.attendance_id = a.id
          WHERE i.run_id = $1 AND ($2::uuid IS NULL OR p.id = $2) AND ($3::uuid IS NULL OR a.id = $3)
          ORDER BY p.name`,
        [run.id, filter.personId ?? null, filter.attendanceId ?? null],
      )
    ).rows;
    const ivs = await this.intervalsOf(c, list.filter((r) => r.attendance_id).map((r) => r.attendance_id));
    const ended = run.status === 'beendet';
    return list.map((r) => {
      const iv = r.attendance_id ? (ivs.get(r.attendance_id) ?? []) : [];
      const s = this.summarize(run, iv, now);
      const open = iv.some((x) => !x.out_at);
      let status: AttendanceStatus;
      if (!iv.length) status = ended ? 'nicht_teilgenommen' : 'nicht_eingecheckt';
      else if (r.confirmed_at) status = 'bestaetigt';
      else if (open) status = 'anwesend';
      else if (r.note_review === 'offen') status = r.auto_closed && !r.check_out_reason ? 'pruefen' : 'vermerk_pruefen';
      else if (r.note_review === 'rueckfrage') status = 'rueckfrage';
      else if (r.note_review === 'akzeptiert' && r.check_out_reason) status = 'vermerk_akzeptiert';
      else status = ended ? 'bestaetigung_offen' : 'ausgecheckt';
      const lastOut = iv.length && !open ? iv[iv.length - 1]!.out_at : null;
      return {
        attendanceId: r.attendance_id as string | null,
        invitationId: r.invitation_id as string,
        personId: r.person_id as string,
        personName: r.person_name as string,
        initials: initials(r.person_name),
        checkedIn: open,
        firstIn: iv[0]?.in_at ?? null,
        lastOut,
        inMethod: (iv[0]?.in_method ?? null) as CheckInMethod | null,
        outMethod: (open ? null : (iv[iv.length - 1]?.out_method ?? null)) as CheckOutMethod | null,
        inMethodLabel: iv[0] ? METHOD_LABEL[iv[0].in_method] : null,
        outMethodLabel: !open && iv.length ? METHOD_LABEL[iv[iv.length - 1]!.out_method!] : null,
        intervals: iv.map((x) => ({
          in: x.in_at, out: x.out_at, inMethod: x.in_method, outMethod: x.out_method, inOffline: x.in_offline, outOffline: x.out_offline,
        })),
        durationSeconds: Math.floor(s.durationMs / 1000),
        plannedSeconds: Math.floor(s.plannedMs / 1000),
        completenessPct: s.pct,
        completenessState: s.state,
        belowThreshold: iv.length > 0 && s.state === 'teilweise',
        manual: r.check_out_reason
          ? { reason: r.check_out_reason as ManualCheckoutReason, reasonLabel: MANUAL_REASON_LABEL[r.check_out_reason as ManualCheckoutReason], note: r.check_out_note as string }
          : null,
        noteReview: r.note_review as 'offen' | 'akzeptiert' | 'rueckfrage' | null,
        noteReviewMessage: r.note_review_message as string | null,
        autoClosed: !!r.auto_closed,
        release: r.release as 'freigegeben' | 'abgelehnt' | null,
        confirmedAt: r.confirmed_at as Date | null,
        confirmedVia: r.confirmed_via as 'selbst' | 'kiosk' | null,
        canConfirm: iv.length > 0 && !open && !r.confirmed_at,
        askedQuestion: !!r.asked_question,
        evidence: r.evidence_id ? { id: r.evidence_id, status: r.evidence_status, nachweisNr: r.nachweis_nr, verifyCode: r.verify_code } : null,
        status,
        statusLabel: STATUS_LABEL[status],
      };
    });
  }

  async organizerAttendanceIn(c: pg.PoolClient, runId: string) {
    const run = await this.loadRun(c, runId);
    const rows = await this.rows(c, run);
    const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
    return {
      kpis: {
        invited: rows.length,
        present: count((r) => r.checkedIn),
        participated: count((r) => r.intervals.length > 0),
        checkedOutQr: count((r) => !r.checkedIn && r.outMethod === 'qr_end'),
        manual: count((r) => !!r.manual),
        notesToReview: count((r) => r.noteReview === 'offen'),
        missing: count((r) => r.intervals.length === 0),
        confirmationsOpen: count((r) => r.canConfirm),
        confirmed: count((r) => !!r.confirmedAt),
      },
      rows,
    };
  }

  async organizerAttendance(runId: string) {
    const m = await this.access.manage(runId);
    return this.access.sys(m, async (c) => ({ run: this.runView(await this.loadRun(c, runId)), ...(await this.organizerAttendanceIn(c, runId)) }));
  }

  private async organizerRow(runId: string, attendanceId: string, m: ManageCtx) {
    return this.access.sys(m, async (c) => (await this.rows(c, await this.loadRun(c, runId), { attendanceId }))[0]);
  }

  /** Eigene Sicht des Teilnehmers (Screen 13): Uhr, Status, Zusammenfassung zur Bestätigung, Nachweis. */
  async participantMeIn(c: pg.PoolClient, runId: string, personId: string) {
    const run = await this.loadRun(c, runId);
    const row = (await this.rows(c, run, { personId }))[0];
    if (!row) throw new NotFoundException('Teilnahme nicht gefunden');
    return row;
  }

  async participantState(p: ParticipantCtx, runId: string) {
    return this.db.txAs(this.access.pctx(p), async (c) => {
      const run = await this.loadRun(c, runId);
      return { run: this.runView(run), invitationId: p.invitationId, me: await this.participantMeIn(c, runId, p.personId) };
    });
  }

  /** Liste der Präsenz-/Live-Termine für die Verwaltung. */
  async list() {
    return this.db.tx(async (c) =>
      (
        await c.query(
          `SELECT r.id, r.typ, r.status, coalesce(r.titel, t.titel) AS titel, r.provider, r.ort, r.start_at, r.end_at, r.ended_at,
                  r.trainer_person_id, tp.name AS trainer_name, r.countersigned_at,
                  (SELECT count(*) FROM invitation i WHERE i.run_id = r.id)::int AS invited,
                  (SELECT count(*) FROM attendance a WHERE a.run_id = r.id AND EXISTS (SELECT 1 FROM attendance_interval x WHERE x.attendance_id = a.id))::int AS participated,
                  (SELECT count(*) FROM attendance a WHERE a.run_id = r.id AND EXISTS (SELECT 1 FROM attendance_interval x WHERE x.attendance_id = a.id AND x.out_at IS NULL))::int AS present,
                  (SELECT count(*) FROM attendance a WHERE a.run_id = r.id AND a.confirmed_at IS NOT NULL)::int AS confirmed,
                  (SELECT count(*) FROM attendance a WHERE a.run_id = r.id AND a.note_review = 'offen')::int AS notes_to_review
             FROM run r LEFT JOIN training t ON t.id = r.training_id LEFT JOIN person tp ON tp.id = r.trainer_person_id
            WHERE r.typ IN ('termin','live_extern') ORDER BY r.start_at DESC`,
        )
      ).rows,
    );
  }

}
