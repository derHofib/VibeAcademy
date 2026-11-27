import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { Roles } from '../auth/decorators';
import { DbService } from '../db/db.service';
import { NotificationService } from '../notifications/notification.service';
import { InvitationService } from '../runs/invitation.service';
import { parseSettings } from '../trainings/settings';
import { berlinDate } from '@sn/shared';
import { Clock } from '../common/clock';
import { ComplianceService } from '../compliance/compliance.service';

/** Auswertung (Schritt 1.9): Dashboard (Screen 1) und Lesenachweis je Person (Screen 3). */
@Controller()
export class ReportsController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly invitations: InvitationService,
    private readonly notifications: NotificationService,
    private readonly compliance: ComplianceService,
    private readonly clock: Clock,
  ) {}

  /** Dashboard-Kennzahlen aus Pflichtmatrix und Fristen-Engine (Paket FG): Erfüllungsquote, „läuft in 30 Tagen ab“, eskaliert, externe zu prüfen. */
  private async complianceKpi(c: import('pg').PoolClient) {
    const now = this.clock.now();
    const rows = await this.compliance.rows(c, now);
    const s = this.compliance.summarize(rows);
    const next = rows
      .filter((r) => r.state === 'laeuft_ab' && r.reinviteOn)
      .map((r) => (r.reinviteOn! < berlinDate(now) ? berlinDate(now) : r.reinviteOn!))
      .sort()[0] ?? null;
    const esc = (
      await c.query(
        `SELECT count(DISTINCT i.id)::int AS n FROM invitation i JOIN deadline_notice d ON d.invitation_id = i.id AND d.kind = 'eskalation'
          WHERE i.status NOT IN ('bestaetigt','befreit') AND i.due_at < $1`,
        [now],
      )
    ).rows[0].n;
    const ext = (await c.query(`SELECT count(DISTINCT coalesce(group_id, id))::int AS n FROM external_record WHERE status = 'eingereicht'`)).rows[0].n;
    return {
      compliance: {
        erfuellungsquote: s.erfuellungsquote, gesamt: s.total, erfuellt: s.gueltig + s.laeuft_ab, laeuftAb30: s.laeuft_ab, abgelaufen: s.abgelaufen,
        fehlt: s.fehlt, befreit: s.befreit, naechsteWiedereinladung: next,
      },
      eskaliert: esc,
      externZuPruefen: ext,
    };
  }

  @Get('dashboard')
  // Trainer sehen über RLS nur, was ihnen zusteht (eigene Termine)
  @Roles('admin', 'verantwortlich', 'auditor', 'vorgesetzter', 'trainer')
  dashboard() {
    return this.db.tx(async (c) => {
      const kpi = (
        await c.query(
          `SELECT count(*) FILTER (WHERE i.status = 'bestaetigt')::int AS erledigt,
                  count(*) FILTER (WHERE i.status <> 'befreit')::int AS gesamt,
                  count(*) FILTER (WHERE i.status NOT IN ('bestaetigt','befreit') AND i.due_at < now())::int AS ueberfaellig,
                  count(*) FILTER (WHERE i.status NOT IN ('bestaetigt','befreit') AND i.due_at >= now() AND i.due_at < now() + interval '30 days')::int AS laeuft_ab,
                  count(*) FILTER (WHERE i.status NOT IN ('bestaetigt','befreit'))::int AS offen,
                  count(*) FILTER (WHERE i.status NOT IN ('offen','bestaetigt','befreit'))::int AS geoeffnet
             FROM invitation i`,
        )
      ).rows[0];
      const runs = (
        await c.query(
          `SELECT r.id, coalesce(r.titel, t.titel) AS titel, v.version_no, v.page_count, t.quiz_required, r.deadline,
                  count(i.*)::int AS eingeladen, count(i.*) FILTER (WHERE i.status = 'bestaetigt')::int AS erledigt,
                  count(i.*) FILTER (WHERE i.status NOT IN ('bestaetigt','befreit') AND i.due_at < now())::int AS ueberfaellig
             FROM run r JOIN training t ON t.id = r.training_id JOIN training_version v ON v.id = r.training_version_id
             LEFT JOIN invitation i ON i.run_id = r.id WHERE r.status <> 'beendet'
            GROUP BY r.id, t.id, v.id ORDER BY r.deadline NULLS LAST LIMIT 20`,
        )
      ).rows;
      const overdue = (
        await c.query(
          `SELECT i.id, p.name, coalesce(r.titel, t.titel) AS titel, i.due_at, (current_date - i.due_at::date) AS tage
             FROM invitation i JOIN person p ON p.id = i.person_id JOIN run r ON r.id = i.run_id JOIN training t ON t.id = r.training_id
            WHERE i.status NOT IN ('bestaetigt','befreit') AND i.due_at < now() ORDER BY i.due_at LIMIT 50`,
        )
      ).rows;
      return {
        kpi: { ...kpi, erfuellungsquote: kpi.gesamt ? Math.round((kpi.erledigt / kpi.gesamt) * 100) : null },
        laufend: runs,
        ueberfaellig: overdue,
        ...(await this.complianceKpi(c)),
        termine: [], // Präsenztermine folgen in Phase 2
      };
    });
  }

  /** „Alle erinnern“: Erinnerung an alle Überfälligen, die eine E-Mail-Adresse haben. */
  @Post('dashboard/remind-overdue')
  @Roles('admin', 'verantwortlich')
  async remindOverdue() {
    const queued = await this.db.tx(async (c) => {
      const ids = (
        await c.query(`SELECT i.id FROM invitation i WHERE i.status NOT IN ('bestaetigt','befreit') AND i.due_at < now()`)
      ).rows.map((r) => r.id as string);
      const out = [];
      for (const id of ids) {
        const n = await this.invitations.enqueueMail(c, id, true);
        if (n) out.push(n);
      }
      await this.audit.record(c, { entity: 'invitation', action: 'remind_overdue', payload: { count: out.length } });
      return out;
    });
    await this.notifications.dispatch(queued);
    return { reminded: queued.length };
  }

  /** Lesenachweis je Teilnehmer (Screen 3) – nur Rollen mit Seitendetails. */
  @Get('invitations/:id/report')
  @Roles('admin', 'verantwortlich', 'auditor')
  report(@Param('id', ParseUUIDPipe) id: string) {
    return this.db.tx(async (c) => {
      const r = (
        await c.query(
          `SELECT i.*, p.name AS person_name, p.personalnr, o.name AS org_unit, t.titel, t.quiz_required, coalesce(r.settings_snapshot, t.settings) AS settings,
                  v.version_no, v.page_count, v.sha256, v.id AS version_id
             FROM invitation i JOIN person p ON p.id = i.person_id LEFT JOIN org_unit o ON o.id = p.org_unit_id
             JOIN run r ON r.id = i.run_id JOIN training t ON t.id = r.training_id JOIN training_version v ON v.id = r.training_version_id
            WHERE i.id = $1`,
          [id],
        )
      ).rows[0];
      if (!r) throw new NotFoundException('Einladung nicht gefunden');
      const factor = Math.max(1, Number(r.reading_time_factor));
      const pages = (
        await c.query(
          `SELECT pm.page_no, pm.title, round(coalesce(pm.t_min_manual, pm.t_min_seconds) * $3::numeric) * 1000 AS soll_ms,
                  coalesce(pp.dwell_ms, 0) AS ist_ms, pp.first_seen_at, pp.fulfilled_at
             FROM page_meta pm LEFT JOIN page_progress pp ON pp.page_no = pm.page_no AND pp.invitation_id = $2
            WHERE pm.version_id = $1 ORDER BY pm.page_no`,
          [r.version_id, id, factor],
        )
      ).rows.map((p) => ({ ...p, soll_ms: Number(p.soll_ms), ist_ms: Number(p.ist_ms) }));
      const sessions = (
        await c.query('SELECT id, started_at, last_seen_at, ended_at, end_reason, user_agent FROM read_session WHERE invitation_id = $1 ORDER BY started_at', [id])
      ).rows;
      const attempts = (
        await c.query('SELECT attempt_no, score_pct, passed, submitted_at FROM quiz_attempt WHERE invitation_id = $1 ORDER BY attempt_no', [id])
      ).rows;
      const signature = (await c.query('SELECT signed_at, auth_method FROM signature WHERE invitation_id = $1', [id])).rows[0] ?? null;
      const evidence = (await c.query('SELECT id, status, nachweis_nr, verify_code, pdf_sha256 FROM evidence WHERE invitation_id = $1', [id])).rows[0] ?? null;
      const sessionIds = sessions.map((s) => s.id);
      const audit = (
        await c.query(
          `SELECT ts, entity, action, payload FROM audit_event
            WHERE (entity_id = $1) OR (entity = 'read_session' AND entity_id = ANY($2::text[]))
               OR (entity IN ('signature','quiz_attempt','evidence') AND payload->>'invitationId' = $1)
               OR (entity = 'evidence' AND entity_id = $3)
            ORDER BY seq`,
          [id, sessionIds, evidence?.id ?? null],
        )
      ).rows;
      const ist = pages.reduce((s, p) => s + p.ist_ms, 0);
      const soll = pages.reduce((s, p) => s + p.soll_ms, 0);
      return {
        invitation: { id, status: r.status, sentAt: r.sent_at, openedAt: r.opened_at, readCompletedAt: r.read_completed_at, completedAt: r.completed_at, dueAt: r.due_at },
        person: { name: r.person_name, personalnr: r.personalnr, orgUnit: r.org_unit },
        training: { titel: r.titel, versionNo: r.version_no, pageCount: r.page_count, sha256: r.sha256, quizRequired: r.quiz_required, passPct: parseSettings(r.settings).passPct },
        summary: { sessions: sessions.length, istMs: ist, sollMs: soll, plausibel: !(r.read_completed_at && ist < soll * 0.5) },
        pages, sessions, attempts, signature, evidence, audit,
      };
    });
  }
}
