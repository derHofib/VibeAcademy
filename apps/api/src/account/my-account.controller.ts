import { Body, ConflictException, Controller, Delete, Get, HttpCode, Post, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AnyAccount } from '../auth/decorators';
import { OtpService } from '../auth/otp.service';
import { SESSION_COOKIE, SessionService } from '../auth/session.service';
import { ZodBody } from '../common/errors';
import { RateLimitService } from '../common/rate-limit.service';
import { currentRequest } from '../common/request-context';
import { DbService } from '../db/db.service';
import { NotificationService } from '../notifications/notification.service';

const Code = z.object({ code: z.string().regex(/^\d{6}$/, 'Bitte den 6-stelligen Code eingeben') });
const Link = z.object({ personIds: z.array(z.uuid()).min(1).max(100) });

/** „Meine Nachweise“ (E-25): E-Mail bestätigen, Personen verknüpfen, Nachweise mandantenübergreifend sehen. */
@Controller()
export class MyAccountController {
  constructor(
    private readonly db: DbService,
    private readonly otp: OtpService,
    private readonly notifications: NotificationService,
    private readonly rate: RateLimitService,
    private readonly sessions: SessionService,
  ) {}

  private accountId(): string {
    const s = currentRequest()?.session;
    if (s?.kind !== 'account') throw new UnauthorizedException('Bitte anmelden');
    return s.accountId;
  }

  @AnyAccount()
  @Post('auth/email/verify-request')
  @HttpCode(200)
  async requestVerify() {
    const id = this.accountId();
    await this.rate.hit(`email-verify:${id}`, 5, 900);
    const n = await this.db.txAs({ accountId: id, roles: ['system'] }, async (c) => {
      const a = (await c.query('SELECT email, email_verified_at FROM account WHERE id = $1', [id])).rows[0];
      if (a.email_verified_at) throw new ConflictException('Die E-Mail-Adresse ist bereits bestätigt');
      const code = await this.otp.issue(`email:${id}`);
      return this.notifications.enqueue(c, {
        tenantId: null, accountId: id, channel: 'mail', recipient: a.email, template: 'otp',
        data: { purposeLabel: 'E-Mail-Adresse bestätigen' }, secret: { code },
      });
    });
    await this.notifications.dispatch([n]);
    return { sent: true };
  }

  @AnyAccount()
  @Post('auth/email/verify')
  @HttpCode(200)
  async verify(@Body(new ZodBody(Code)) b: z.infer<typeof Code>) {
    const id = this.accountId();
    if (!(await this.otp.verify(`email:${id}`, b.code))) throw new UnauthorizedException('Der Code ist falsch oder abgelaufen');
    await this.db.txAs({}, (c) => c.query('SELECT app.auth_mark_email_verified($1)', [id]));
    return { verified: true };
  }

  /** Personen mit derselben (bestätigten) E-Mail-Adresse in allen Mandanten. */
  @AnyAccount()
  @Get('me/link-candidates')
  async candidates() {
    const id = this.accountId();
    return (await this.db.txAs({}, (c) => c.query('SELECT * FROM app.link_candidates($1)', [id]))).rows;
  }

  @AnyAccount()
  @Post('me/link')
  @HttpCode(200)
  async link(@Body(new ZodBody(Link)) b: z.infer<typeof Link>) {
    const id = this.accountId();
    const n = (await this.db.txAs({}, (c) => c.query('SELECT app.link_persons($1, $2) AS n', [id, b.personIds]))).rows[0].n;
    return { linked: n };
  }

  @AnyAccount()
  @Get('me/evidence')
  async evidence() {
    const id = this.accountId();
    return (await this.db.txAs({}, (c) => c.query('SELECT * FROM app.evidence_for_account($1)', [id]))).rows;
  }

  /** Konto löschen – trennt nur die Verknüpfung; Nachweise bleiben beim Mandanten (Aufbewahrungspflicht). */
  @AnyAccount()
  @Delete('me/account')
  async remove(@Res({ passthrough: true }) res: Response) {
    const id = this.accountId();
    try {
      await this.db.txAs({}, (c) => c.query('SELECT app.auth_delete_account($1)', [id]));
    } catch (e) {
      if (String((e as Error).message).includes('HAS_MEMBERSHIPS')) {
        throw new ConflictException('Das Konto ist noch Mitglied einer Organisation und kann nicht gelöscht werden');
      }
      throw e;
    }
    const sid = currentRequest()?.sessionId;
    if (sid) await this.sessions.destroy(sid);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { deleted: true };
  }
}
