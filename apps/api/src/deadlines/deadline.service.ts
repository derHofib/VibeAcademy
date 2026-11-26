import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  berlinDate, DEFAULT_DEADLINE_POLICY, dueReminderStage, escalationDue, isOverdue, noticeKey, reinviteDue, type DeadlinePolicy,
} from '@sn/shared';
import type pg from 'pg';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { ComplianceService } from '../compliance/compliance.service';
import { APP_CONFIG, type AppConfig } from '../config';
import { DbService } from '../db/db.service';
import { JobRunner } from '../jobs/job-runner';
import { NotificationService } from '../notifications/notification.service';
import { RedisService } from '../redis/redis.service';
import { formatDateDe, InvitationService } from '../runs/invitation.service';
import { parseSettings } from '../trainings/settings';

type Queued = { id: string; tenantId: string | null };
type Counts = { reminders: number; escalations: number; overdue: number; reinvitations: number; bookCourse: number; newVersion: number; expiredExternal: number };

export interface DeadlineReport {
  at: string;
  tenants: number;
  reminders: number;
  escalations: number;
  overdue: number;
  reinvitations: number;
  bookCourse: number;
  newVersion: number;
  expiredExternal: number;
}

const DAY = 86_400_000;
/** Ende eines Kalendertags (23:59:59 Europe/Berlin) als Zeitpunkt. */
export function endOfBerlinDay(date: string): Date {
  // 23:59:59 in Berlin = 21:59:59Z (Sommer) bzw. 22:59:59Z (Winter): Offset des Tages bestimmen
  const probe = new Date(`${date}T12:00:00Z`);
  const berlinNoon = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false }).format(probe);
  const offsetH = Number(berlinNoon) - 12;
  return new Date(Date.parse(`${date}T23:59:59Z`) - offsetH * 3600_000);
}

/**
 * Fristen-Engine (Schritt 2.2, SPEZIFIKATION 4.5, E-13/E-24). Nächtlich 02:00 Europe/Berlin, zusätzlich per
 * `POST /api/admin/deadlines/run`. Jede Benachrichtigung wird über einen eindeutigen Schlüssel in `deadline_notice`
 * genau einmal ausgelöst – auch wenn der Job mehrfach läuft (Idempotenz).
 */
@Injectable()
export class DeadlineService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(DeadlineService.name);
  private runner!: JobRunner<Record<string, never>>;
  readonly policy: DeadlinePolicy = DEFAULT_DEADLINE_POLICY;

  constructor(
    private readonly db: DbService,
    private readonly redis: RedisService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly invitations: InvitationService,
    private readonly compliance: ComplianceService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onModuleInit() {
    this.runner = new JobRunner('deadlines', this.redis, this.config, () => this.run(), 1);
    if (this.config.RUN_WORKERS && this.config.NODE_ENV !== 'test') {
      await this.runner.queue.upsertJobScheduler('deadlines-nightly', { pattern: '0 2 * * *', tz: 'Europe/Berlin' }, { name: 'deadlines' });
    }
  }
  onModuleDestroy() {
    return this.runner.close();
  }

  /** Alle Mandanten scannen. */
  async run(): Promise<DeadlineReport> {
    const now = this.clock.now();
    const tenants = (await this.db.txAs({ roles: ['system'] }, (c) => c.query('SELECT app.deadline_tenants() AS id'))).rows.map((r) => r.id as string);
    const total: DeadlineReport = { at: now.toISOString(), tenants: tenants.length, reminders: 0, escalations: 0, overdue: 0, reinvitations: 0, bookCourse: 0, newVersion: 0, expiredExternal: 0 };
    for (const tenantId of tenants) {
      try {
        const r = await this.runTenant(tenantId, now);
        for (const k of ['reminders', 'escalations', 'overdue', 'reinvitations', 'bookCourse', 'newVersion', 'expiredExternal'] as const) total[k] += r[k];
      } catch (e) {
        this.log.error(`Fristen-Scan für Mandant ${tenantId} fehlgeschlagen: ${(e as Error).message}`);
      }
    }
    return total;
  }

  /** Ein Mandant in einer Transaktion (Advisory-Lock verhindert parallele Läufe). */
  async runTenant(tenantId: string, now: Date) {
    const counts = { reminders: 0, escalations: 0, overdue: 0, reinvitations: 0, bookCourse: 0, newVersion: 0, expiredExternal: 0 };
    const queued: Queued[] = [];
    await this.db.txAs({ tenantId, roles: ['system'] }, async (c) => {
      const lock = await c.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1, 2)) AS ok', [`deadlines:${tenantId}`]);
      if (!lock.rows[0].ok) return;
      const tenantName = (await c.query('SELECT name FROM tenant WHERE id = $1', [tenantId])).rows[0]?.name ?? '';
      await this.invitationStages(c, tenantId, tenantName, now, counts, queued);
      await this.requirementCycles(c, tenantId, tenantName, now, counts, queued);
      await this.newVersions(c, tenantId, now, counts, queued);
      const ex = await c.query(
        `UPDATE external_record SET status = 'abgelaufen' WHERE status = 'freigegeben' AND valid_until IS NOT NULL AND valid_until < $1::date`,
        [berlinDate(now)],
      );
      counts.expiredExternal = ex.rowCount ?? 0;
      if (Object.values(counts).some((n) => n > 0)) {
        await this.audit.record(c, { entity: 'deadlines', action: 'scan', payload: { at: now.toISOString(), ...counts } });
      }
    });
    await this.notifications.dispatch(queued);
    return counts;
  }

  /** Stufe beanspruchen, Nachrichten erzeugen, Protokoll mit den Nachrichten-IDs schreiben. */
  private async notice(
    c: pg.PoolClient, now: Date,
    n: { key: string; kind: string; stage?: string; invitationId?: string; personId?: string; requirementId?: string },
    send: () => Promise<Queued[]>,
  ): Promise<Queued[] | null> {
    await c.query('SAVEPOINT notice');
    const exists = await c.query('SELECT 1 FROM deadline_notice WHERE key = $1', [n.key]);
    if (exists.rowCount) {
      await c.query('RELEASE SAVEPOINT notice');
      return null;
    }
    const ids = await send();
    const r = await c.query(
      `INSERT INTO deadline_notice (key, kind, stage, invitation_id, person_id, requirement_id, notification_ids, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING RETURNING key`,
      [n.key, n.kind, n.stage ?? null, n.invitationId ?? null, n.personId ?? null, n.requirementId ?? null, ids.map((x) => x.id), now],
    );
    if (!r.rowCount) {
      // parallel bereits ausgelöst → eigene Nachrichten verwerfen
      await c.query('ROLLBACK TO SAVEPOINT notice');
      return null;
    }
    await c.query('RELEASE SAVEPOINT notice');
    return ids;
  }

  private async push(c: pg.PoolClient, tenantId: string, personId: string, title: string, body: string, url?: string): Promise<Queued[]> {
    const has = (await c.query('SELECT app.push_has_target($1) AS ok', [personId])).rows[0].ok;
    if (!has) return [];
    return [await this.notifications.enqueue(c, { tenantId, channel: 'push', recipient: `person:${personId}`, template: 'push-message', data: { title, body, url } })];
  }

  // ── 1. Einladungen: Erinnerungen T−7/T−2/T+1, überfällig, Eskalation ──
  private async invitationStages(c: pg.PoolClient, tenantId: string, tenantName: string, now: Date, counts: Counts, queued: Queued[]) {
    const horizon = new Date(now.getTime() + (Math.max(0, -Math.min(...this.policy.reminderOffsetsDays)) + 1) * DAY);
    const rows = (
      await c.query(
        `SELECT i.id, i.person_id, i.status, i.due_at, i.created_at, p.name AS person_name, p.email, p.org_unit_id,
                t.titel AS titel
           FROM invitation i JOIN run r ON r.id = i.run_id JOIN training t ON t.id = r.training_id JOIN person p ON p.id = i.person_id
          WHERE r.typ = 'kampagne' AND r.status <> 'beendet' AND i.status NOT IN ('bestaetigt','befreit')
            AND i.due_at IS NOT NULL AND i.due_at <= $1
            AND (p.austritt_am IS NULL OR p.austritt_am > $2::date)
          ORDER BY i.due_at`,
        [horizon, berlinDate(now)],
      )
    ).rows;
    for (const inv of rows) {
      const due = new Date(inv.due_at);
      // überfällig markieren (nur solange noch nicht fertig gelesen – spätere Status bleiben erhalten)
      if (isOverdue(due, now) && ['offen', 'geoeffnet'].includes(inv.status)) {
        await c.query(`UPDATE invitation SET status = 'ueberfaellig' WHERE id = $1 AND status IN ('offen','geoeffnet')`, [inv.id]);
        const done = await this.notice(c, now, { key: noticeKey.overdue(inv.id), kind: 'ueberfaellig', invitationId: inv.id, personId: inv.person_id }, async () => []);
        if (done) {
          counts.overdue++;
          await this.audit.record(c, { entity: 'invitation', entityId: inv.id, action: 'overdue', payload: { dueAt: due.toISOString() } });
        }
      }
      const stage = dueReminderStage(due, now, new Date(inv.created_at), this.policy);
      if (stage) {
        const ids = await this.notice(c, now, { key: noticeKey.reminder(inv.id, stage.stage), kind: 'erinnerung', stage: stage.stage, invitationId: inv.id, personId: inv.person_id }, async () => {
          const out: Queued[] = [];
          if (inv.email) {
            const m = await this.invitations.enqueueMail(c, inv.id, true);
            if (m) out.push(m);
          }
          out.push(...(await this.push(c, tenantId, inv.person_id, `Erinnerung: ${inv.titel}`, stage.offsetDays > 0 ? `Überfällig seit ${formatDateDe(due)} – bitte jetzt abschließen.` : `Bitte bis ${formatDateDe(due)} abschließen.`)));
          return out;
        });
        if (ids) {
          counts.reminders++;
          queued.push(...ids);
          await this.audit.record(c, { entity: 'invitation', entityId: inv.id, action: 'reminder_sent', payload: { stage: stage.stage, automatic: true } });
        }
      }
      if (escalationDue(due, now, this.policy)) {
        const ids = await this.notice(c, now, { key: noticeKey.escalation(inv.id), kind: 'eskalation', invitationId: inv.id, personId: inv.person_id }, () =>
          this.escalate(c, tenantId, tenantName, inv, due, now),
        );
        if (ids) {
          counts.escalations++;
          queued.push(...ids);
          await this.audit.record(c, { entity: 'invitation', entityId: inv.id, action: 'escalated', payload: { recipients: ids.length } });
        }
      }
    }
  }

  /** Vorgesetzte(r): Leitung der eigenen Org-Einheit, sonst der nächsthöheren; ohne Leitung → Schulungsverantwortliche. */
  private async escalate(
    c: pg.PoolClient, tenantId: string, tenantName: string,
    inv: { id: string; person_id: string; person_name: string; org_unit_id: string | null; titel: string }, due: Date, now: Date,
  ): Promise<Queued[]> {
    const leader = inv.org_unit_id
      ? (
          await c.query(
            `WITH RECURSIVE up AS (
               SELECT o.id, o.parent_id, o.leiter_person_id, 0 AS depth FROM org_unit o WHERE o.id = $1
               UNION ALL SELECT o.id, o.parent_id, o.leiter_person_id, up.depth + 1 FROM org_unit o JOIN up ON o.id = up.parent_id WHERE up.depth < 20)
             SELECT p.id, p.name, p.email FROM up JOIN person p ON p.id = up.leiter_person_id
              WHERE up.leiter_person_id <> $2 ORDER BY up.depth LIMIT 1`,
            [inv.org_unit_id, inv.person_id],
          )
        ).rows[0]
      : null;
    const days = Math.max(1, Math.floor((now.getTime() - due.getTime()) / DAY));
    const data = (name: string) => ({
      supervisorName: name, personName: inv.person_name, trainingTitle: inv.titel, dueDate: formatDateDe(due), daysOverdue: days,
      url: `${this.config.PUBLIC_BASE_URL}/verwaltung`, tenantName,
    });
    const out: Queued[] = [];
    if (leader) {
      if (leader.email) out.push(await this.notifications.enqueue(c, { tenantId, channel: 'mail', recipient: leader.email, template: 'deadline-escalation', data: data(leader.name) }));
      out.push(...(await this.push(c, tenantId, leader.id, `Überfällig: ${inv.person_name}`, `${inv.titel} – Frist ${formatDateDe(due)} verpasst.`)));
      return out;
    }
    const staff = (
      await c.query(
        `SELECT a.email, a.display_name FROM membership m JOIN account a ON a.id = m.account_id
          WHERE m.tenant_id = $1 AND 'verantwortlich' = ANY (m.roles) AND a.disabled_at IS NULL ORDER BY a.created_at LIMIT 3`,
        [tenantId],
      )
    ).rows;
    for (const s of staff) {
      out.push(await this.notifications.enqueue(c, { tenantId, channel: 'mail', recipient: s.email, template: 'deadline-escalation', data: data(s.display_name) }));
    }
    return out;
  }

  // ── 2. Pflichtmatrix: Ablauf → automatische Wiedereinladung bzw. „neuen Termin buchen“ ──
  private async requirementCycles(c: pg.PoolClient, tenantId: string, tenantName: string, now: Date, counts: Counts, queued: Queued[]) {
    const today = berlinDate(now);
    const rows = await this.compliance.rows(c, now);
    const meta = new Map<string, { reinvite_days: number; auto_invite: boolean }>(
      (await c.query('SELECT id, reinvite_days, auto_invite FROM requirement')).rows.map((r) => [r.id, r]),
    );
    for (const row of rows) {
      if (row.state === 'befreit') continue;
      const m = meta.get(row.requirementId);
      if (!m) continue;
      if (!row.validUntil && !m.auto_invite) continue;
      if (!reinviteDue(row.validUntil, today, m.reinvite_days)) continue;
      // bereits offene Einladung zu dieser Schulung → nichts tun
      const open = await c.query(
        `SELECT 1 FROM invitation i JOIN run r ON r.id = i.run_id
          WHERE i.person_id = $1 AND r.training_id = $2 AND i.status NOT IN ('bestaetigt','befreit')
            AND (r.typ <> 'kampagne' OR r.status <> 'beendet') LIMIT 1`,
        [row.personId, row.trainingId],
      );
      if (open.rowCount) continue;
      const t = (
        await c.query(
          `SELECT t.id, t.titel, t.format, t.settings, t.ansprechpartner,
                  (SELECT v.id FROM training_version v WHERE v.training_id = t.id AND v.published_at IS NOT NULL ORDER BY v.version_no DESC LIMIT 1) AS version_id
             FROM training t WHERE t.id = $1`,
          [row.trainingId],
        )
      ).rows[0];
      if (!t) continue;
      const online = ['online', 'hybrid'].includes(t.format) && t.version_id;
      if (online) {
        const ids = await this.notice(
          c, now, { key: noticeKey.reinvite(row.personId, row.requirementId, row.validUntil), kind: 'wiedereinladung', personId: row.personId, requirementId: row.requirementId },
          async () => {
            const settings = parseSettings(t.settings);
            const expiry = row.expiresOn ? endOfBerlinDay(row.expiresOn) : null;
            const due = expiry && expiry.getTime() > now.getTime() + DAY ? expiry : new Date(now.getTime() + settings.deadlineDays * DAY);
            const inv = await this.autoInvite(c, now, { trainingId: t.id, versionId: t.version_id, titel: t.titel, personId: row.personId, due, reason: row.validUntil ? 'ablauf' : 'fehlt' });
            if (!inv) return [];
            const out: Queued[] = [];
            const m2 = await this.invitations.enqueueMail(c, inv, false);
            if (m2) out.push(m2);
            out.push(...(await this.push(c, tenantId, row.personId, `Neue Unterweisung: ${t.titel}`, `Bitte bis ${formatDateDe(due)} abschließen.`)));
            await this.audit.record(c, { entity: 'invitation', entityId: inv, action: 'auto_invited', payload: { requirementId: row.requirementId, validUntil: row.validUntil, reason: row.validUntil ? 'ablauf' : 'fehlt' } });
            return out;
          },
        );
        if (ids) {
          counts.reinvitations++;
          queued.push(...ids);
        }
      } else {
        const ids = await this.notice(
          c, now, { key: noticeKey.bookCourse(row.personId, row.requirementId, row.validUntil), kind: 'termin_buchen', personId: row.personId, requirementId: row.requirementId },
          async () => {
            const p = (await c.query('SELECT name, email FROM person WHERE id = $1', [row.personId])).rows[0];
            const out: Queued[] = [];
            const expired = !!row.expiresOn && row.expiresOn < today;
            if (p?.email) {
              out.push(
                await this.notifications.enqueue(c, {
                  tenantId, channel: 'mail', recipient: p.email, template: 'book-course',
                  data: {
                    personName: p.name, trainingTitle: t.titel, validUntil: row.validUntil ? formatDateDe(`${row.validUntil}T12:00:00Z`) : null,
                    qualification: row.qualificationName, expired: expired || !row.validUntil, contact: t.ansprechpartner, tenantName,
                  },
                }),
              );
            }
            out.push(...(await this.push(c, tenantId, row.personId, `Neuen Termin buchen: ${t.titel}`, row.validUntil ? `Gültig bis ${formatDateDe(`${row.validUntil}T12:00:00Z`)}.` : 'Noch kein Nachweis vorhanden.')));
            await this.audit.record(c, { entity: 'person', entityId: row.personId, action: 'book_course_notice', payload: { requirementId: row.requirementId, validUntil: row.validUntil } });
            return out;
          },
        );
        if (ids) {
          counts.bookCourse++;
          queued.push(...ids);
        }
      }
    }
  }

  /** Einladung in die automatische Kampagne (eine je Version und Monat bzw. je neuer Version). */
  private async autoInvite(
    c: pg.PoolClient, now: Date,
    a: { trainingId: string; versionId: string; titel: string; personId: string; due: Date; reason: 'fehlt' | 'ablauf' | 'neue_version'; changedPages?: number[] | null; runKey?: string; runTitle?: string },
  ): Promise<string | null> {
    const month = berlinDate(now).slice(0, 7);
    const key = a.runKey ?? `wiederholung:${a.versionId}:${month}`;
    const title = a.runTitle ?? `${a.titel} – automatische Wiederholung ${month.slice(5)}/${month.slice(0, 4)}`;
    let runId = (
      await c.query(
        `INSERT INTO run (training_id, training_version_id, typ, titel, status, auto_key, created_at)
         VALUES ($1, $2, 'kampagne', $3, 'laeuft', $4, $5) ON CONFLICT (tenant_id, auto_key) WHERE auto_key IS NOT NULL DO NOTHING RETURNING id`,
        [a.trainingId, a.versionId, title, key, now],
      )
    ).rows[0]?.id as string | undefined;
    if (!runId) runId = (await c.query('SELECT id FROM run WHERE auto_key = $1', [key])).rows[0]?.id;
    if (!runId) return null;
    const person = (await c.query('SELECT reading_time_factor FROM person WHERE id = $1', [a.personId])).rows[0];
    const ins = await c.query(
      `INSERT INTO invitation (run_id, person_id, due_at, reading_time_factor, auto_reason, changed_pages, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (run_id, person_id) DO NOTHING RETURNING id`,
      [runId, a.personId, a.due, person?.reading_time_factor ?? 1, a.reason, a.changedPages ?? null, now],
    );
    return (ins.rows[0]?.id as string | undefined) ?? null;
  }

  // ── 3. Neue inhaltliche Version → Betroffene mit gültigem Nachweis der alten Version neu einladen ──
  private async newVersions(c: pg.PoolClient, tenantId: string, now: Date, counts: Counts, queued: Queued[]) {
    const versions = (
      await c.query(
        `SELECT v.id, v.training_id, v.version_no, v.changed_pages, t.titel, t.settings, t.format
           FROM training_version v JOIN training t ON t.id = v.training_id
          WHERE v.change_kind = 'inhaltlich' AND v.published_at IS NOT NULL AND t.archived_at IS NULL
            AND v.version_no = (SELECT max(x.version_no) FROM training_version x WHERE x.training_id = v.training_id AND x.published_at IS NOT NULL)`,
      )
    ).rows;
    for (const v of versions) {
      const settings = parseSettings(v.settings);
      const persons = (
        await c.query(
          `SELECT DISTINCT i.person_id FROM invitation i JOIN run r ON r.id = i.run_id JOIN training_version ov ON ov.id = r.training_version_id
             JOIN person p ON p.id = i.person_id
            WHERE r.training_id = $1 AND ov.version_no < $2 AND i.status = 'bestaetigt'
              AND i.completed_at + make_interval(months => $3) > $4
              AND (p.austritt_am IS NULL OR p.austritt_am > $5::date)
              AND NOT EXISTS (SELECT 1 FROM invitation j JOIN run rj ON rj.id = j.run_id WHERE j.person_id = i.person_id AND rj.training_version_id = $6)
              AND NOT EXISTS (SELECT 1 FROM invitation j JOIN run rj ON rj.id = j.run_id
                               WHERE j.person_id = i.person_id AND rj.training_id = $1 AND j.status NOT IN ('bestaetigt','befreit'))`,
          [v.training_id, v.version_no, settings.intervalMonths, now, berlinDate(now), v.id],
        )
      ).rows;
      for (const { person_id } of persons) {
        const ids = await this.notice(c, now, { key: noticeKey.newVersion(v.id, person_id), kind: 'neue_version', personId: person_id }, async () => {
          const due = new Date(now.getTime() + settings.deadlineDays * DAY);
          const inv = await this.autoInvite(c, now, {
            trainingId: v.training_id, versionId: v.id, titel: v.titel, personId: person_id, due, reason: 'neue_version', changedPages: v.changed_pages,
            runKey: `neue-version:${v.id}`, runTitle: `${v.titel} – Version ${v.version_no} (inhaltlich geändert)`,
          });
          if (!inv) return [];
          const out: Queued[] = [];
          const m = await this.invitations.enqueueMail(c, inv, false);
          if (m) out.push(m);
          out.push(...(await this.push(c, tenantId, person_id, `Neue Version: ${v.titel}`, `Inhalt geändert – bitte bis ${formatDateDe(due)} erneut bestätigen.`)));
          await this.audit.record(c, { entity: 'invitation', entityId: inv, action: 'auto_invited', payload: { reason: 'neue_version', versionId: v.id, changedPages: v.changed_pages } });
          return out;
        });
        if (ids) {
          counts.newVersion++;
          queued.push(...ids);
        }
      }
    }
  }
}
