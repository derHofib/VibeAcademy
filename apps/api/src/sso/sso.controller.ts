import { Controller, Get, Inject, Logger, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ParticipantRoute, Public } from '../auth/decorators';
import { SESSION_COOKIE, SessionService } from '../auth/session.service';
import { APP_CONFIG, type AppConfig } from '../config';
import { currentRequest } from '../common/request-context';
import { ParticipantService } from '../participant/participant.service';
import { SIGNATURE_PURPOSE, safeNext, SsoError, SsoService } from './sso.service';

export const SSO_BINDING_COOKIE = 'sn_sso';
const BINDING_PATH = '/api/auth/sso';

/**
 * Öffentliche SSO-Endpunkte (E-36). Alle Abläufe sind Browser-Navigationen (GET) und enden mit einer Weiterleitung
 * in die Weboberfläche; Fehler kommen dort als Code an (`/anmelden/sso?fehler=…` bzw. `#sso-fehler=…`).
 */
@Controller('auth/sso')
export class SsoController {
  private readonly log = new Logger('SSO');
  constructor(
    private readonly sso: SsoService,
    private readonly sessions: SessionService,
    private readonly participants: ParticipantService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private get web() {
    return this.config.PUBLIC_BASE_URL;
  }
  private secure() {
    return this.config.NODE_ENV === 'production';
  }
  private code(e: unknown): string {
    if (e instanceof SsoError) return e.code;
    // z. B. Rate-Limit
    if ((e as { status?: number })?.status === 429) return 'rate_limited';
    this.log.error(`SSO-Ablauf fehlgeschlagen: ${(e as Error)?.message}`);
    return 'internal';
  }
  private loginError(res: Response, code: string) {
    res.redirect(302, `${this.web}/anmelden/sso?fehler=${encodeURIComponent(code)}`);
  }
  private toIdp(res: Response, r: { url: string; binding: string }) {
    res.cookie(SSO_BINDING_COOKIE, r.binding, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.secure(),
      path: BINDING_PATH,
      maxAge: 10 * 60 * 1000,
    });
    res.redirect(302, r.url);
  }

  /** Anmeldeseite: Gibt es für diese E-Mail-Domain eine Firmenanmeldung? */
  @Public()
  @Get('discover')
  async discover(@Query('email') email?: string) {
    const hit = typeof email === 'string' && email.length <= 254 ? await this.sso.discover(email) : null;
    if (!hit) return { sso: false };
    return {
      sso: true,
      tenantName: hit.tenantName,
      ssoOnly: hit.ssoOnly,
      startUrl: `/api/auth/sso/start?email=${encodeURIComponent(email!)}`,
    };
  }

  /** `?tenant=<Kurzname|ID>` oder `?email=<Adresse|Domain>`, optional `&weiter=/pfad` → Weiterleitung zum IdP. */
  @Public()
  @Get('start')
  async start(@Query() q: Record<string, unknown>, @Res() res: Response) {
    try {
      const tenantId =
        typeof q.tenant === 'string'
          ? await this.sso.tenantByKey(q.tenant.trim())
          : typeof q.email === 'string'
            ? ((await this.sso.discover(q.email))?.tenantId ?? null)
            : null;
      if (!tenantId) throw new SsoError('unknown_tenant');
      this.toIdp(res, await this.sso.startLogin(tenantId, safeNext(q.weiter)));
    } catch (e) {
      this.loginError(res, this.code(e));
    }
  }

  /** Redirect-URI beim IdP: `<PUBLIC_BASE_URL>/api/auth/sso/callback`. */
  @Public()
  @Get('callback')
  async callback(@Query() q: Record<string, unknown>, @Req() req: Request, @Res() res: Response) {
    const binding = req.cookies?.[SSO_BINDING_COOKIE] as string | undefined;
    res.clearCookie(SSO_BINDING_COOKIE, { path: BINDING_PATH });
    try {
      const r = await this.sso.callback(q, binding);
      if (r.kind === 'login') {
        const old = currentRequest()?.sessionId;
        if (old) await this.sessions.destroy(old);
        res.cookie(SESSION_COOKIE, r.sessionId, this.sessions.cookieOptions(this.secure()));
        const next = r.next ? `?weiter=${encodeURIComponent(r.next)}` : '';
        res.redirect(302, `${this.web}/anmelden/sso${next}`);
      } else {
        res.redirect(302, `${this.web}/teilnahme/${r.invitationId}/abschluss#sso=${r.ticket}`);
      }
    } catch (e) {
      const inv = SsoService.invitationOfError(e);
      if (inv) res.redirect(302, `${this.web}/teilnahme/${inv}/abschluss#sso-fehler=${this.code(e)}`);
      else this.loginError(res, this.code(e));
    }
  }

  /** Step-up vor der Unterschrift: `?purpose=signature:<invitationId>` → IdP mit prompt=login, max_age=0. */
  @Public()
  @Get('step-up/start')
  async stepUpStart(@Query('purpose') purpose: string | undefined, @Res() res: Response) {
    const invitationId = SIGNATURE_PURPOSE.exec(purpose ?? '')?.[1];
    if (!invitationId) return this.loginError(res, 'no_identity');
    const back = (code: string) => res.redirect(302, `${this.web}/teilnahme/${invitationId}/abschluss#sso-fehler=${code}`);
    const s = currentRequest()?.session;
    if (s?.kind !== 'account') return back('login_required');
    try {
      this.toIdp(res, await this.sso.startStepUp(s.accountId, purpose!));
    } catch (e) {
      back(this.code(e));
    }
  }

  /** Welche Step-up-Methoden per SSO gibt es für diese Einladung? (Unterschriftsseite) */
  @ParticipantRoute()
  @Get('step-up/options')
  async stepUpOptions(@Query('invitationId') invitationId?: string) {
    if (!invitationId || !/^[0-9a-f-]{36}$/.test(invitationId)) return { sso: false, required: false };
    const p = await this.participants.resolve(invitationId);
    const o = await this.sso.stepUpOptions(p.accountId, p.tenantId);
    return { ...o, startUrl: o.sso ? `/api/auth/sso/step-up/start?purpose=signature:${invitationId}` : null };
  }
}
