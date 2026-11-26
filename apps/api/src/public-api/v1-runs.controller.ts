import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import type pg from 'pg';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { ZodBody } from '../common/errors';
import { DbService } from '../db/db.service';
import { NotificationService } from '../notifications/notification.service';
import { InvitationService } from '../runs/invitation.service';
import { parseSettings } from '../trainings/settings';
import { actorPayload } from '../webhooks/actor';
import { ApiKey, ApiScoped } from './api-key.guard';
import { apiContext, systemContext, type ApiPrincipal } from './api-key.service';
import { INVITATION_SELECT, invitationDto, RUN_SELECT, runDto } from './dto';
import { keysetPage, parsePage } from './pagination';
import { dateTimeFilter, enumFilter, Uuid, uuidFilter } from './uuid.pipe';

const Targets = {
  personIds: z.array(z.uuid('Ungültige Personen-ID')).max(5000).default([]),
  orgUnitIds: z.array(z.uuid('Ungültige Org-Einheit')).max(500).default([]),
  /** Einladungsmail senden (Standard). Ohne Mail: Links über die Verwaltung kopieren/drucken. */
  sendMail: z.boolean().default(true),
};
const CreateRun = z.object({
  trainingId: z.uuid('Ungültige Schulung'),
  title: z.string().trim().min(1).max(300).nullish(),
  deadline: z.iso.datetime({ offset: true }).or(z.iso.date()).nullish(),
  ...Targets,
});
const Invite = z.object(Targets).refine((b) => b.personIds.length || b.orgUnitIds.length, { message: 'Bitte Personen oder Org-Einheiten angeben' });
type CreateRun = z.infer<typeof CreateRun>;
type Invite = z.infer<typeof Invite>;

const RUN_TYPES = ['kampagne', 'termin', 'live_extern'] as const;
const RUN_STATUS = ['geplant', 'laeuft', 'beendet'] as const;
const INV_STATUS = ['offen', 'geoeffnet', 'gelesen', 'bestanden', 'bestaetigt', 'ueberfaellig', 'befreit'] as const;

/** Durchführungen und Einladungen (runs:read), Kampagne anlegen und einladen (runs:write). */
@Controller('v1')
export class V1RunsController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly invitations: InvitationService,
    private readonly notifications: NotificationService,
  ) {}

  @Get('runs')
  @ApiScoped('runs:read')
  list(@ApiKey() k: ApiPrincipal, @Query() q: Record<string, string>) {
    const page = parsePage(q);
    const p = [
      uuidFilter(q.trainingId, 'trainingId'), enumFilter(q.type, 'type', RUN_TYPES), enumFilter(q.status, 'status', RUN_STATUS),
      dateTimeFilter(q.createdSince, 'createdSince'),
    ];
    return this.db.txAs(apiContext(k), async (c) => {
      const r = await keysetPage(c, {
        select: RUN_SELECT,
        from: 'run r',
        where: ['($1::uuid IS NULL OR r.training_id = $1)', '($2::text IS NULL OR r.typ = $2)', '($3::text IS NULL OR r.status = $3)', '($4::timestamptz IS NULL OR r.created_at >= $4)'],
        params: p,
        keys: [['r.created_at', 'timestamptz'], ['r.id', 'uuid']],
        page,
      });
      return { data: r.rows.map(runDto), nextCursor: r.nextCursor };
    });
  }

  @Get('runs/:id')
  @ApiScoped('runs:read')
  get(@ApiKey() k: ApiPrincipal, @Param('id', Uuid) id: string) {
    return this.db.txAs(apiContext(k), async (c) => {
      const r = (await c.query(`SELECT ${RUN_SELECT} FROM run r WHERE r.id = $1`, [id])).rows[0];
      if (!r) throw new NotFoundException('Durchführung nicht gefunden');
      return runDto(r);
    });
  }

  /** Online-Kampagne zur aktuell veröffentlichten Version anlegen und optional sofort Personen einladen. */
  @Post('runs')
  @ApiScoped('runs:write')
  async create(@ApiKey() k: ApiPrincipal, @Body(new ZodBody(CreateRun)) b: CreateRun) {
    const res = await this.db.txAs(systemContext(k), async (c) => {
      const t = (
        await c.query(
          `SELECT t.id, t.settings, v.id AS version_id FROM training t
             JOIN LATERAL (SELECT x.id FROM training_version x WHERE x.training_id = t.id AND x.published_at IS NOT NULL
                            -- Grundversion Deutsch (E-39, Spalte sprache aus 017), ohne harte Abhängigkeit von der Spalte
                            ORDER BY x.version_no DESC, coalesce(to_jsonb(x)->>'sprache', 'de') = 'de' DESC LIMIT 1) v ON true
            WHERE t.id = $1 AND t.archived_at IS NULL`,
          [b.trainingId],
        )
      ).rows[0];
      if (!t) throw new BadRequestException('Schulung nicht gefunden oder ohne veröffentlichte Version');
      const deadline = b.deadline
        ? new Date(b.deadline.length === 10 ? `${b.deadline}T23:59:59+01:00` : b.deadline)
        : new Date(Date.now() + parseSettings(t.settings).deadlineDays * 86400_000);
      const r = await c.query(
        `INSERT INTO run (training_id, training_version_id, typ, titel, deadline, status) VALUES ($1, $2, 'kampagne', $3, $4, 'laeuft') RETURNING id`,
        [t.id, t.version_id, b.title ?? null, deadline],
      );
      const runId = r.rows[0].id as string;
      await this.audit.record(c, { entity: 'run', entityId: runId, action: 'created', payload: actorPayload({ kind: 'api-key', keyId: k.keyId }, { trainingId: t.id, versionId: t.version_id }) });
      const inv = b.personIds.length || b.orgUnitIds.length ? await this.inviteIn(c, k, runId, b) : null;
      const run = runDto((await c.query(`SELECT ${RUN_SELECT} FROM run r WHERE r.id = $1`, [runId])).rows[0]);
      return { run, inv };
    });
    await this.notifications.dispatch(res.inv?.queued ?? []);
    return { ...res.run, invitations: res.inv ? this.inviteResult(res.inv) : { created: [], skipped: 0, mailsQueued: 0, withoutEmail: [] } };
  }

  @Post('runs/:id/invitations')
  @ApiScoped('runs:write')
  async invite(@ApiKey() k: ApiPrincipal, @Param('id', Uuid) id: string, @Body(new ZodBody(Invite)) b: Invite) {
    const res = await this.db.txAs(systemContext(k), async (c) => {
      const run = (await c.query(`SELECT id, status FROM run WHERE id = $1 AND typ = 'kampagne'`, [id])).rows[0];
      if (!run) throw new NotFoundException('Kampagne nicht gefunden');
      if (run.status === 'beendet') throw new BadRequestException('Die Durchführung ist beendet');
      return this.inviteIn(c, k, id, b);
    });
    await this.notifications.dispatch(res.queued);
    return this.inviteResult(res);
  }

  private inviteResult(r: Awaited<ReturnType<V1RunsController['inviteIn']>>) {
    return { created: r.created, skipped: r.skipped, mailsQueued: r.queued.length, withoutEmail: r.withoutEmail };
  }

  /** Wie „Einladen“ in der Verwaltung (RunsController.invite): Personen/Org-Einheiten (inkl. Unterbäume), ohne Ausgetretene. */
  private async inviteIn(c: pg.PoolClient, k: ApiPrincipal, runId: string, b: { personIds: string[]; orgUnitIds: string[]; sendMail: boolean }) {
    const run = (await c.query('SELECT deadline FROM run WHERE id = $1', [runId])).rows[0];
    const known = (await c.query('SELECT id FROM person WHERE id = ANY($1::uuid[])', [b.personIds])).rows.length;
    if (known !== new Set(b.personIds).size) throw new BadRequestException('Mindestens eine Person wurde nicht gefunden');
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
    const created: Array<{ id: string; personId: string }> = [];
    const withoutEmail: string[] = [];
    const queued: Array<{ id: string; tenantId: string | null }> = [];
    for (const p of persons) {
      const ins = await c.query(
        `INSERT INTO invitation (run_id, person_id, due_at, reading_time_factor) VALUES ($1, $2, $3, $4)
         ON CONFLICT (run_id, person_id) DO NOTHING RETURNING id`,
        [runId, p.id, run.deadline, p.reading_time_factor],
      );
      if (!ins.rowCount) continue;
      created.push({ id: ins.rows[0].id, personId: p.id });
      if (!p.email) withoutEmail.push(p.id);
      else if (b.sendMail) {
        const n = await this.invitations.enqueueMail(c, ins.rows[0].id);
        if (n) queued.push(n);
      }
    }
    await this.audit.record(c, { entity: 'run', entityId: runId, action: 'invited', payload: actorPayload({ kind: 'api-key', keyId: k.keyId }, { created: created.length, mails: queued.length }) });
    return { created, skipped: persons.length - created.length, withoutEmail, queued };
  }

  @Get('invitations')
  @ApiScoped('runs:read')
  invitationsList(@ApiKey() k: ApiPrincipal, @Query() q: Record<string, string>) {
    const page = parsePage(q);
    const p = [
      uuidFilter(q.personId, 'personId'), uuidFilter(q.runId, 'runId'), enumFilter(q.status, 'status', INV_STATUS), dateTimeFilter(q.updatedSince, 'updatedSince'),
    ];
    return this.db.txAs(apiContext(k), async (c) => {
      const r = await keysetPage(c, {
        select: INVITATION_SELECT,
        from: 'invitation i',
        where: ['($1::uuid IS NULL OR i.person_id = $1)', '($2::uuid IS NULL OR i.run_id = $2)', '($3::text IS NULL OR i.status = $3)', '($4::timestamptz IS NULL OR i.updated_at >= $4)'],
        params: p,
        keys: [['i.updated_at', 'timestamptz'], ['i.id', 'uuid']],
        page,
      });
      return { data: r.rows.map(invitationDto), nextCursor: r.nextCursor };
    });
  }

  @Get('invitations/:id')
  @ApiScoped('runs:read')
  invitation(@ApiKey() k: ApiPrincipal, @Param('id', Uuid) id: string) {
    return this.db.txAs(apiContext(k), async (c) => {
      const r = (await c.query(`SELECT ${INVITATION_SELECT} FROM invitation i WHERE i.id = $1`, [id])).rows[0];
      if (!r) throw new NotFoundException('Einladung nicht gefunden');
      return invitationDto(r);
    });
  }
}
