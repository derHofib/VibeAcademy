import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { Roles } from '../auth/decorators';
import { ZodBody } from '../common/errors';
import { DbService } from '../db/db.service';
import { NotificationService } from '../notifications/notification.service';
import { parseSettings } from '../trainings/settings';
import { InvitationService } from './invitation.service';

const CreateRun = z.object({
  trainingId: z.uuid(),
  titel: z.string().trim().max(300).nullish(),
  deadline: z.iso.datetime({ offset: true }).or(z.iso.date()).nullish(),
});
const Invite = z
  .object({
    personIds: z.array(z.uuid()).max(5000).default([]),
    orgUnitIds: z.array(z.uuid()).max(500).default([]),
    sendMail: z.boolean().default(true),
  })
  .refine((b) => b.personIds.length || b.orgUnitIds.length, { message: 'Bitte Personen oder Org-Einheiten auswählen' });

/** Durchführungen (hier: Online-Kampagnen) und Einladungen – Verwaltungssicht. */
@Controller()
export class RunsController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly invitations: InvitationService,
    private readonly notifications: NotificationService,
  ) {}

  @Post('runs')
  @Roles('admin', 'verantwortlich')
  create(@Body(new ZodBody(CreateRun)) b: z.infer<typeof CreateRun>) {
    return this.db.tx(async (c) => {
      const t = (
        await c.query(
          `SELECT t.id, t.settings, v.id AS version_id FROM training t
             JOIN LATERAL (SELECT id FROM training_version WHERE training_id = t.id AND sprache = 'de' AND published_at IS NOT NULL ORDER BY version_no DESC LIMIT 1) v ON true
            WHERE t.id = $1`,
          [b.trainingId],
        )
      ).rows[0];
      if (!t) throw new BadRequestException('Die Schulung hat noch keine veröffentlichte Version');
      const days = parseSettings(t.settings).deadlineDays;
      const deadline = b.deadline
        ? new Date(b.deadline.length === 10 ? `${b.deadline}T23:59:59+01:00` : b.deadline)
        : new Date(Date.now() + days * 86400_000);
      const r = await c.query(
        `INSERT INTO run (training_id, training_version_id, typ, titel, deadline, status) VALUES ($1, $2, 'kampagne', $3, $4, 'laeuft') RETURNING id`,
        [t.id, t.version_id, b.titel ?? null, deadline],
      );
      await this.audit.record(c, { entity: 'run', entityId: r.rows[0].id, action: 'created', payload: { trainingId: t.id, versionId: t.version_id } });
      return { id: r.rows[0].id as string, deadline };
    });
  }

  @Get('runs')
  @Roles('admin', 'verantwortlich', 'auditor', 'vorgesetzter', 'trainer')
  list() {
    return this.db.tx(async (c) =>
      (
        await c.query(
          `SELECT r.id, r.typ, r.status, r.deadline, r.created_at, coalesce(r.titel, t.titel) AS titel, t.id AS training_id,
                  v.version_no, v.page_count,
                  count(i.*)::int AS invited,
                  count(i.*) FILTER (WHERE i.status = 'bestaetigt')::int AS done,
                  count(i.*) FILTER (WHERE i.status NOT IN ('bestaetigt','befreit') AND i.due_at < now())::int AS overdue
             FROM run r JOIN training t ON t.id = r.training_id JOIN training_version v ON v.id = r.training_version_id
             LEFT JOIN invitation i ON i.run_id = r.id
            GROUP BY r.id, t.id, v.id ORDER BY r.created_at DESC`,
        )
      ).rows,
    );
  }

  @Get('runs/:id')
  @Roles('admin', 'verantwortlich', 'auditor', 'vorgesetzter', 'trainer')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.db.tx(async (c) => {
      const run = (
        await c.query(
          `SELECT r.*, coalesce(r.titel, t.titel) AS titel_effektiv, v.version_no, v.page_count, v.sha256
             FROM run r JOIN training t ON t.id = r.training_id JOIN training_version v ON v.id = r.training_version_id WHERE r.id = $1`,
          [id],
        )
      ).rows[0];
      if (!run) throw new NotFoundException('Durchführung nicht gefunden');
      // Nur Status – keine Seitendetails (Vorgesetzte, SPEZIFIKATION 2)
      const invitations = (
        await c.query(
          `SELECT i.id, i.person_id, p.name AS person_name, o.name AS org_unit_name, i.status, i.sent_at, i.opened_at,
                  i.completed_at, i.due_at, (i.status NOT IN ('bestaetigt','befreit') AND i.due_at < now()) AS overdue,
                  p.email IS NOT NULL AS has_email
             FROM invitation i JOIN person p ON p.id = i.person_id LEFT JOIN org_unit o ON o.id = p.org_unit_id
            WHERE i.run_id = $1 ORDER BY p.name`,
          [id],
        )
      ).rows;
      return { ...run, invitations };
    });
  }

  @Post('runs/:id/invite')
  @Roles('admin', 'verantwortlich')
  async invite(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(Invite)) b: z.infer<typeof Invite>) {
    const res = await this.db.tx(async (c) => {
      const run = (await c.query(`SELECT id, deadline, status FROM run WHERE id = $1 AND typ = 'kampagne'`, [id])).rows[0];
      if (!run) throw new NotFoundException('Durchführung nicht gefunden');
      if (run.status === 'beendet') throw new BadRequestException('Die Durchführung ist beendet');
      const persons = (
        await c.query(
          `WITH RECURSIVE units AS (
             SELECT id FROM org_unit WHERE id = ANY($2::uuid[])
             UNION SELECT o.id FROM org_unit o JOIN units u ON o.parent_id = u.id)
           SELECT p.id, p.reading_time_factor, p.email FROM person p
            WHERE (p.id = ANY($1::uuid[]) OR p.org_unit_id IN (SELECT id FROM units))
              AND (p.austritt_am IS NULL OR p.austritt_am > current_date)`,
          [b.personIds, b.orgUnitIds],
        )
      ).rows;
      let created = 0;
      const withoutEmail: string[] = [];
      const queued: Array<{ id: string; tenantId: string | null }> = [];
      for (const p of persons) {
        const ins = await c.query(
          `INSERT INTO invitation (run_id, person_id, due_at, reading_time_factor) VALUES ($1, $2, $3, $4)
           ON CONFLICT (run_id, person_id) DO NOTHING RETURNING id`,
          [id, p.id, run.deadline, p.reading_time_factor],
        );
        if (!ins.rowCount) continue;
        created++;
        if (!p.email) withoutEmail.push(p.id);
        else if (b.sendMail) {
          const n = await this.invitations.enqueueMail(c, ins.rows[0].id);
          if (n) queued.push(n);
        }
      }
      await this.audit.record(c, { entity: 'run', entityId: id, action: 'invited', payload: { created, mails: queued.length } });
      return { created, skipped: persons.length - created, withoutEmail, queued };
    });
    await this.notifications.dispatch(res.queued);
    return { created: res.created, skipped: res.skipped, mailsQueued: res.queued.length, withoutEmail: res.withoutEmail };
  }

  /** Neuen persönlichen Link erzeugen (zum Kopieren/Drucken, wenn kein Mailversand möglich ist). Alter Link wird ungültig. */
  @Post('invitations/:id/link')
  @Roles('admin', 'verantwortlich')
  link(@Param('id', ParseUUIDPipe) id: string) {
    return this.db.tx(async (c) => {
      const ok = await c.query('SELECT 1 FROM invitation WHERE id = $1', [id]);
      if (!ok.rowCount) throw new NotFoundException('Einladung nicht gefunden');
      const link = await this.invitations.issueLink(c, id);
      await this.audit.record(c, { entity: 'invitation', entityId: id, action: 'link_issued' });
      return { link };
    });
  }

  @Post('invitations/:id/remind')
  @Roles('admin', 'verantwortlich', 'vorgesetzter')
  async remind(@Param('id', ParseUUIDPipe) id: string) {
    const n = await this.db.tx(async (c) => {
      const inv = (await c.query('SELECT status FROM invitation WHERE id = $1', [id])).rows[0];
      if (!inv) throw new NotFoundException('Einladung nicht gefunden');
      if (['bestaetigt', 'befreit'].includes(inv.status)) throw new BadRequestException('Bereits erledigt');
      return this.db.txAs({ ...this.db.requestContext(), roles: ['system'] }, async (sys) => {
        const q = await this.invitations.enqueueMail(sys, id, true);
        if (!q) throw new BadRequestException('Für diese Person ist keine E-Mail-Adresse hinterlegt');
        await this.audit.record(sys, { entity: 'invitation', entityId: id, action: 'reminded' });
        return q;
      });
    });
    await this.notifications.dispatch([n]);
    return { ok: true };
  }
}
