import { Body, Controller, Get, GoneException, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { OtpService } from '../auth/otp.service';
import { PasswordService } from '../auth/password.service';
import { ParticipantRoute, Public } from '../auth/decorators';
import { SESSION_COOKIE, SessionService } from '../auth/session.service';
import { StepUpService } from '../auth/step-up.service';
import { APP_CONFIG, type AppConfig } from '../config';
import { sha256 } from '../common/crypto';
import { ZodBody } from '../common/errors';
import { RateLimitService } from '../common/rate-limit.service';
import { currentRequest } from '../common/request-context';
import { DbService } from '../db/db.service';
import { NotificationService } from '../notifications/notification.service';
import { parseSettings, quizRequiredFor } from '../trainings/settings';
import { participantLanguage } from '../i18n/language';
import { ParticipantService } from './participant.service';
import { SsoService } from '../sso/sso.service';

const OpenLink = z.object({ token: z.string().min(20).max(100) });
const Language = z.object({ sprache: z.enum(['de', 'en']) });
const StepUp = z.union([
  z.object({ code: z.string().regex(/^\d{6}$/, 'Bitte den 6-stelligen Code eingeben') }),
  z.object({ password: z.string().min(1).max(200) }),
  z.object({ ssoTicket: z.string().min(20).max(100) }),
]);

export const signaturePurpose = (invitationId: string) => `signature:${invitationId}`;
export const personSubject = (personId: string) => `person:${personId}`;

/** Teilnehmersicht: Einladungslink öffnen, eigene Einladungen, Startbildschirm (5a), Step-up vor der Unterschrift. */
@Controller()
export class ParticipantController {
  constructor(
    private readonly db: DbService,
    private readonly participants: ParticipantService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly otp: OtpService,
    private readonly stepUp: StepUpService,
    private readonly passwords: PasswordService,
    private readonly rate: RateLimitService,
    private readonly notifications: NotificationService,
    private readonly sso: SsoService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Persönlichen Link öffnen → auf diese Einladung beschränkte Sitzung (Teilnehmer ohne Konto). */
  @Public()
  @Post('participant/session')
  @HttpCode(200)
  async open(@Body(new ZodBody(OpenLink)) b: z.infer<typeof OpenLink>, @Res({ passthrough: true }) res: Response) {
    await this.rate.hit(`link:${currentRequest()?.ipHash}`, 60, 900);
    const r = (await this.db.txAs({}, (c) => c.query('SELECT * FROM app.invitation_by_token($1)', [sha256(b.token)]))).rows[0];
    if (!r) throw new NotFoundException('Dieser Link ist ungültig. Bitte den neuesten Link aus der E-Mail verwenden.');
    if (r.expired) throw new GoneException('Dieser Link ist abgelaufen. Bitte wenden Sie sich an die verantwortliche Person.');
    // Ein angemeldetes Konto bleibt angemeldet, wenn die Einladung zu ihm gehört.
    const s = currentRequest()?.session;
    if (s?.kind === 'account') {
      const own = await this.db.txAs({}, (c) => c.query('SELECT 1 FROM app.invitation_for_account($1, $2)', [r.invitation_id, s.accountId]));
      if (own.rowCount) return { invitationId: r.invitation_id };
    }
    const id = await this.sessions.create({ kind: 'invitation', tenantId: r.tenant_id, personId: r.person_id, invitationId: r.invitation_id });
    res.cookie(SESSION_COOKIE, id, this.sessions.cookieOptions(this.config.NODE_ENV === 'production'));
    await this.db.txAs({ tenantId: r.tenant_id, personId: r.person_id, roles: ['system'] }, (c) =>
      this.audit.record(c, { entity: 'invitation', entityId: r.invitation_id, action: 'link_opened' }),
    );
    return { invitationId: r.invitation_id };
  }

  @ParticipantRoute()
  @Get('me/invitations')
  async mine() {
    const s = currentRequest()!.session!;
    if (s.kind === 'invitation') {
      const p = await this.participants.resolve(s.invitationId);
      return this.participants.read(p, async (c) =>
        (
          await c.query(
            `SELECT i.id AS invitation_id, i.tenant_id, te.name AS tenant_name, CASE WHEN r.typ = 'kampagne' THEN t.titel ELSE coalesce(r.titel, t.titel) END AS training_titel, i.status, i.due_at,
                    i.completed_at, r.typ, r.id AS run_id, r.start_at
               FROM invitation i JOIN run r ON r.id = i.run_id LEFT JOIN training t ON t.id = r.training_id JOIN tenant te ON te.id = i.tenant_id
              WHERE i.id = $1`,
            [s.invitationId],
          )
        ).rows,
      );
    }
    return (await this.db.txAs({}, (c) => c.query('SELECT * FROM app.invitations_for_account($1)', [s.accountId]))).rows;
  }

  /** Startbildschirm (5a): Umfang, Frist, Ablauf. Markiert die Einladung beim ersten Öffnen als „geöffnet“. */
  @ParticipantRoute()
  @Get('me/invitations/:id')
  async start(@Param('id', ParseUUIDPipe) id: string) {
    const p = await this.participants.resolve(id);
    await this.participants.write(p, async (c) => {
      const r = await c.query(`UPDATE invitation SET status = 'geoeffnet', opened_at = now() WHERE id = $1 AND status = 'offen' RETURNING id`, [id]);
      if (r.rowCount) await this.audit.record(c, { entity: 'invitation', entityId: id, action: 'opened' });
    });
    return this.participants.read(p, async (c) => {
      const r = (
        await c.query(
          `SELECT i.id, i.status, i.due_at, i.opened_at, i.read_completed_at, i.completed_at, i.reading_time_factor,
                  p.name AS person_name, p.email AS person_email, t.titel, t.kategorie, t.rechtsgrundlage, t.ansprechpartner, t.quiz_required, coalesce(r.settings_snapshot, t.settings) AS settings,
                  v.id AS version_id, v.version_no, v.page_count, v.sha256, te.name AS tenant_name,
                  v.sprache AS version_sprache, p.sprache AS person_sprache, i.changed_pages
             FROM invitation i JOIN person p ON p.id = i.person_id JOIN run r ON r.id = i.run_id
             JOIN training t ON t.id = r.training_id JOIN training_version v ON v.id = coalesce(i.training_version_id, r.training_version_id)
             JOIN tenant te ON te.id = i.tenant_id WHERE i.id = $1`,
          [id],
        )
      ).rows[0];
      if (!r) throw new NotFoundException('Einladung nicht gefunden');
      const pages = (
        await c.query(
          `SELECT page_no, title, coalesce(t_min_manual, t_min_seconds) AS t_min FROM page_meta WHERE version_id = $1 ORDER BY page_no`,
          [r.version_id],
        )
      ).rows;
      const chapters = (await c.query('SELECT idx, title, short_name, from_page, to_page FROM chapter WHERE version_id = $1 ORDER BY idx', [r.version_id])).rows;
      const settings = parseSettings(r.settings);
      const factor = Number(r.reading_time_factor);
      // E-38: nur geänderte Seiten (unbekannte Seitennummern zählen nicht; bleibt nichts übrig → alle Seiten)
      const onlyPages = ((r.changed_pages ?? []) as number[]).filter((n) => pages.some((x) => x.page_no === n)).sort((a, b) => a - b);
      const required = (n: number) => !onlyPages.length || onlyPages.includes(n);
      const quizRequired = quizRequiredFor(r.quiz_required, settings, onlyPages);
      const questionPool = quizRequired
        ? Number((await this.db.txAs({ tenantId: p.tenantId, roles: ['system'] }, (s) =>
            s.query('SELECT count(*) AS n FROM quiz_question q JOIN run r ON r.training_id = q.training_id JOIN invitation i ON i.run_id = r.id WHERE i.id = $1 AND q.active', [id]),
          )).rows[0].n)
        : 0;
      return {
        id: r.id,
        status: r.status,
        dueAt: r.due_at,
        personName: r.person_name,
        personEmail: r.person_email,
        tenantName: r.tenant_name,
        training: { titel: r.titel, kategorie: r.kategorie, rechtsgrundlage: r.rechtsgrundlage, ansprechpartner: r.ansprechpartner },
        version: { id: r.version_id, versionNo: r.version_no, pageCount: r.page_count, sha256: r.sha256 },
        rules: { strictMode: settings.strictMode, passPct: settings.passPct, maxAttempts: settings.maxAttempts },
        totals: {
          pages: r.page_count,
          minReadingSeconds: pages.filter((x) => required(x.page_no)).reduce((s, x) => s + Math.round(x.t_min * Math.max(1, factor)), 0),
          questions: quizRequired ? Math.min(settings.quizQuestionCount, questionPool) : 0,
        },
        chapters,
        pages: pages.map((x) => ({ pageNo: x.page_no, title: x.title, tMinSeconds: Math.round(x.t_min * Math.max(1, factor)), required: required(x.page_no) })),
        hasAccount: !!p.accountId,
        // Phase 3, Paket C: Sprache (E-39), nur geänderte Seiten (E-38), Signaturniveau (E-40)
        sprache: participantLanguage(r.person_sprache),
        documentLanguage: r.version_sprache,
        onlyPages: onlyPages.length ? onlyPages : null,
        quizRequired,
        signatureLevel: settings.signatureLevel,
      };
    });
  }

  /** Sprache der Teilnehmeroberfläche merken (E-39): gilt für künftige Mails und das Nachweis-PDF dieser Person. */
  @ParticipantRoute()
  @Post('me/invitations/:id/language')
  @HttpCode(200)
  async setLanguage(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(Language)) b: z.infer<typeof Language>) {
    const p = await this.participants.resolve(id);
    await this.participants.write(p, async (c) => {
      const changed = (await c.query('SELECT app.set_person_language($1, $2) AS ok', [p.personId, b.sprache])).rows[0].ok;
      if (changed) await this.audit.record(c, { entity: 'person', entityId: p.personId, action: 'language_set', payload: { sprache: b.sprache, invitationId: id } });
    });
    return { sprache: b.sprache };
  }

  /** Bestätigungscode an die E-Mail-Adresse der Einladung (Step-up für Teilnehmer ohne Konto, E-08). */
  @ParticipantRoute()
  @Post('me/invitations/:id/otp')
  @HttpCode(200)
  async sendOtp(@Param('id', ParseUUIDPipe) id: string) {
    const p = await this.participants.resolve(id);
    await this.rate.hit(`otp-send:${id}`, 5, 900);
    const n = await this.participants.write(p, async (c) => {
      const r = (await c.query(
        'SELECT p.email, p.sprache, t.titel FROM invitation i JOIN person p ON p.id = i.person_id JOIN run r ON r.id = i.run_id JOIN training t ON t.id = r.training_id WHERE i.id = $1',
        [id],
      )).rows[0];
      if (!r?.email) throw new NotFoundException('Für Sie ist keine E-Mail-Adresse hinterlegt. Bitte wenden Sie sich an die verantwortliche Person.');
      const code = await this.otp.issue(`sig:${id}`);
      return this.notifications.enqueue(c, {
        tenantId: p.tenantId, channel: 'mail', recipient: r.email, template: 'otp',
        data: participantLanguage(r.sprache) === 'en'
          ? { purposeLabel: `Signature “${r.titel}”`, lang: 'en' }
          : { purposeLabel: `Unterschrift „${r.titel}“` },
        secret: { code },
      });
    });
    await this.notifications.dispatch([n]);
    return { sent: true };
  }

  /** Step-up: Code (ohne Konto) oder Passwort (mit Konto) → einmaliges Token für die Unterschrift (5 min). */
  @ParticipantRoute()
  @Post('me/invitations/:id/step-up')
  @HttpCode(200)
  async doStepUp(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(StepUp)) b: z.infer<typeof StepUp>) {
    const p = await this.participants.resolve(id);
    await this.rate.hit(`stepup:${id}`, 10, 900);
    let method: 'password' | 'otp_mail' | 'sso';
    if ('code' in b) {
      if (!(await this.otp.verify(`sig:${id}`, b.code))) throw new UnauthorizedException('Der Code ist falsch oder abgelaufen');
      method = 'otp_mail';
    } else if ('ssoTicket' in b) {
      // E-36: Ticket aus der erneuten IdP-Anmeldung (GET /auth/sso/step-up/start → Rückleitung #sso=…)
      await this.sso.redeemStepUpTicket(b.ssoTicket, { accountId: p.accountId, purpose: signaturePurpose(id) });
      method = 'sso';
    } else {
      if (!p.accountId) throw new UnauthorizedException('Bitte mit Code bestätigen');
      await this.sso.assertPasswordStepUpAllowed(p.accountId, p.tenantId);
      const hash = (await this.db.txAs({}, (c) => c.query('SELECT app.auth_get_password_hash($1) AS h', [p.accountId]))).rows[0]?.h;
      if (!(await this.passwords.verify(hash, b.password))) throw new UnauthorizedException('Passwort ist falsch');
      method = 'password';
    }
    const token = await this.stepUp.issue({ subject: personSubject(p.personId), purpose: signaturePurpose(id), method });
    return { stepUpToken: token, method, expiresInSeconds: 300 };
  }
}
