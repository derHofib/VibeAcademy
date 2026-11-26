import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { applyContext } from '@sn/db';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { Clock } from '../common/clock';
import { randomToken, sha256 } from '../common/crypto';
import { RateLimitService } from '../common/rate-limit.service';
import { currentRequest } from '../common/request-context';
import { DbService } from '../db/db.service';
import { RedisService } from '../redis/redis.service';
import { loadOidc, OidcClients } from './oidc-client';
import { emailDomainOf, SsoConfigService, type SsoConfig } from './sso-config.service';

/** Fehlercodes des Anmeldeablaufs – die Weboberfläche zeigt dazu deutsche Texte (features/sso/model.ts). */
export type SsoErrorCode =
  | 'unknown_tenant'
  | 'idp_unreachable'
  | 'state_invalid'
  | 'idp_error'
  | 'token_invalid'
  | 'email_unverified'
  | 'domain_not_allowed'
  | 'no_account'
  | 'no_membership'
  | 'account_disabled'
  | 'person_left'
  | 'login_required'
  | 'no_identity'
  | 'subject_mismatch'
  | 'reauth_required';

export class SsoError extends Error {
  constructor(
    readonly code: SsoErrorCode,
    detail?: string,
  ) {
    super(detail ?? code);
  }
}

interface LoginState {
  kind: 'login';
  tenantId: string;
  verifier: string;
  nonce: string;
  binding: string;
  next: string | null;
}
interface StepUpState {
  kind: 'stepup';
  tenantId: string;
  verifier: string;
  nonce: string;
  binding: string;
  accountId: string;
  invitationId: string;
  purpose: string;
  subject: string;
  /** Start der erneuten Anmeldung (Unix-Sekunden); auth_time muss danach liegen */
  startedAt: number;
}
type FlowState = LoginState | StepUpState;

export type CallbackResult =
  | { kind: 'login'; sessionId: string; next: string | null }
  | { kind: 'stepup'; invitationId: string; ticket: string };

const STATE_TTL_S = 10 * 60;
const TICKET_TTL_S = 5 * 60;
/** Zulässige Uhrabweichung zwischen IdP und Server bei auth_time */
const AUTH_TIME_SKEW_S = 30;
export const SIGNATURE_PURPOSE = /^signature:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** Nur relative, interne Ziele (kein offener Redirect). */
export function safeNext(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || raw.length > 500) return null;
  return raw;
}

/**
 * OIDC-Anmeldung je Mandant (Authorization Code + PKCE, state + nonce in Redis) und Step-up per erneuter IdP-Anmeldung (E-36).
 */
@Injectable()
export class SsoService {
  private readonly log = new Logger('SSO');
  constructor(
    private readonly db: DbService,
    private readonly redis: RedisService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly rate: RateLimitService,
    private readonly clock: Clock,
    private readonly oidc: OidcClients,
    private readonly configs: SsoConfigService,
  ) {}

  // ── Mandant finden ─────────────────────────────────────────
  async tenantByKey(key: string): Promise<string | null> {
    if (!key || key.length > 100) return null;
    const r = await this.db.txAs({}, (c) => c.query('SELECT app.sso_resolve_tenant($1) AS id', [key]));
    return (r.rows[0]?.id as string | null) ?? null;
  }

  /** E-Mail-Adresse oder Domain → Mandant mit aktivem SSO (Anmeldeseite). */
  async discover(emailOrDomain: string) {
    await this.rate.hit(`sso-discover:${currentRequest()?.ipHash ?? 'x'}`, 60, 300);
    const domain = (emailOrDomain.includes('@') ? emailDomainOf(emailOrDomain) : emailOrDomain.trim().toLowerCase()) ?? '';
    if (!/^[a-z0-9.-]{3,253}$/.test(domain)) return null;
    const r = await this.db.txAs({}, (c) => c.query('SELECT * FROM app.sso_tenant_by_domain($1)', [domain]));
    const row = r.rows[0];
    return row ? { tenantId: row.tenant_id as string, tenantName: row.tenant_name as string, ssoOnly: row.sso_only as boolean } : null;
  }

  private async enabledConfig(tenantId: string): Promise<SsoConfig> {
    const cfg = await this.configs.load(tenantId);
    if (!cfg?.enabled) throw new SsoError('unknown_tenant');
    return cfg;
  }

  // ── Anmeldung starten ──────────────────────────────────────
  /** Liefert die Weiterleitung zum IdP; `binding` kommt als httpOnly-Cookie in den Browser (Schutz vor Login-CSRF). */
  async startLogin(tenantId: string, next: string | null) {
    await this.rate.hit(`sso-start:${currentRequest()?.ipHash ?? 'x'}`, 60, 300);
    const cfg = await this.enabledConfig(tenantId);
    return this.authorizationRedirect(cfg, (base) => ({ kind: 'login', ...base, next }), {});
  }

  /** Step-up vor der Unterschrift: erneute Anmeldung beim IdP mit prompt=login und max_age=0. */
  async startStepUp(accountId: string, purpose: string) {
    await this.rate.hit(`sso-stepup:${accountId}`, 20, 900);
    const m = SIGNATURE_PURPOSE.exec(purpose);
    if (!m) throw new SsoError('no_identity', 'Ungültiger Zweck');
    const invitationId = m[1]!;
    const inv = await this.invitationOf(accountId, invitationId);
    const cfg = await this.enabledConfig(inv.tenantId);
    const subject = await this.subjectOf(accountId, cfg.issuer);
    if (!subject) throw new SsoError('no_identity');
    const email = (await this.db.txAs({ accountId }, (c) => c.query('SELECT email FROM account WHERE id = $1', [accountId]))).rows[0]
      ?.email as string | undefined;
    const startedAt = Math.floor(this.clock.now().getTime() / 1000);
    return {
      invitationId,
      ...(await this.authorizationRedirect(
        cfg,
        (base) => ({ kind: 'stepup', ...base, accountId, invitationId, purpose, subject, startedAt }),
        { prompt: 'login', max_age: '0', ...(email ? { login_hint: email } : {}) },
      )),
    };
  }

  private async authorizationRedirect(
    cfg: SsoConfig,
    build: (base: { tenantId: string; verifier: string; nonce: string; binding: string }) => FlowState,
    extra: Record<string, string>,
  ) {
    const lib = await loadOidc();
    const client = await this.oidc.get(this.configs.settings(cfg)).catch((e: Error) => {
      this.log.warn(`Discovery für Mandant ${cfg.tenant_id} fehlgeschlagen: ${e.message}`);
      throw new SsoError('idp_unreachable');
    });
    const verifier = lib.randomPKCECodeVerifier();
    const nonce = lib.randomNonce();
    const state = lib.randomState();
    const binding = randomToken(24);
    const flow = build({ tenantId: cfg.tenant_id, verifier, nonce, binding: sha256(binding) });
    await this.redis.client.set(`sso:state:${sha256(state)}`, JSON.stringify(flow), 'EX', STATE_TTL_S);
    const url = lib.buildAuthorizationUrl(client, {
      redirect_uri: this.configs.redirectUri,
      scope: cfg.scopes,
      response_type: 'code',
      code_challenge: await lib.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
      nonce,
      ...extra,
    });
    return { url: url.href, binding };
  }

  // ── Rückkehr vom IdP ───────────────────────────────────────
  /**
   * Prüft die Antwort des IdP (state, Browser-Bindung, PKCE, ID-Token: Signatur über JWKS, Issuer, Audience, nonce)
   * und schließt Anmeldung bzw. Step-up ab.
   */
  async callback(query: Record<string, unknown>, bindingCookie: string | undefined): Promise<CallbackResult> {
    const state = typeof query.state === 'string' ? query.state : '';
    const raw = state ? await this.redis.client.getdel(`sso:state:${sha256(state)}`) : null;
    if (!raw) throw new SsoError('state_invalid');
    const flow = JSON.parse(raw) as FlowState;
    if (!bindingCookie || sha256(bindingCookie) !== flow.binding) throw new SsoError('state_invalid', 'Browser-Bindung fehlt');
    try {
      return await this.complete(flow, query, state);
    } catch (e) {
      if (e instanceof SsoError) throw Object.assign(e, { flow });
      throw e;
    }
  }

  /** Bei Fehlern im Step-up kennt der Controller so die Einladung für die Rückleitung. */
  static invitationOfError(e: unknown): string | null {
    const f = (e as { flow?: FlowState }).flow;
    return f?.kind === 'stepup' ? f.invitationId : null;
  }

  private async complete(flow: FlowState, query: Record<string, unknown>, state: string): Promise<CallbackResult> {
    if (typeof query.error === 'string') {
      throw new SsoError(flow.kind === 'stepup' && query.error === 'login_required' ? 'reauth_required' : 'idp_error', String(query.error));
    }
    const cfg = await this.enabledConfig(flow.tenantId);
    const lib = await loadOidc();
    const client = await this.oidc.get(this.configs.settings(cfg)).catch(() => {
      throw new SsoError('idp_unreachable');
    });
    const current = new URL(this.configs.redirectUri);
    for (const [k, v] of Object.entries(query)) if (typeof v === 'string') current.searchParams.set(k, v);
    let claims: Record<string, unknown>;
    try {
      const tokens = await lib.authorizationCodeGrant(client, current, {
        pkceCodeVerifier: flow.verifier,
        expectedState: state,
        expectedNonce: flow.nonce,
        // Für den Step-up genügt openid-client hier ein großzügiges Fenster; die strenge Prüfung (auth_time ≥ Start) folgt unten.
        ...(flow.kind === 'stepup' ? { maxAge: STATE_TTL_S } : {}),
      });
      claims = (tokens.claims() ?? {}) as Record<string, unknown>;
      // Manche IdPs liefern E-Mail/Name nur über den UserInfo-Endpunkt (z. B. „conform“ ID-Tokens im Code-Flow).
      if (flow.kind === 'login' && claims.email === undefined && client.serverMetadata().userinfo_endpoint && typeof claims.sub === 'string') {
        const info = await lib.fetchUserInfo(client, tokens.access_token, claims.sub);
        claims = { ...claims, email: info.email, email_verified: info.email_verified, name: claims.name ?? info.name };
        if (claims.given_name === undefined) Object.assign(claims, { given_name: info.given_name, family_name: info.family_name });
      }
    } catch (e) {
      this.log.warn(`Antwort des IdP abgelehnt (Mandant ${flow.tenantId}): ${(e as Error).message}`);
      throw new SsoError('token_invalid', (e as Error).message);
    }
    const sub = typeof claims.sub === 'string' ? claims.sub : '';
    const iss = typeof claims.iss === 'string' ? claims.iss : '';
    if (!sub || iss !== client.serverMetadata().issuer) throw new SsoError('token_invalid', 'sub/iss fehlt');
    return flow.kind === 'login' ? this.completeLogin(flow, cfg, iss, sub, claims) : this.completeStepUp(flow, iss, sub, claims);
  }

  private async completeLogin(flow: LoginState, cfg: SsoConfig, iss: string, sub: string, claims: Record<string, unknown>): Promise<CallbackResult> {
    const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : null;
    const verified = claims.email_verified === true || claims.email_verified === 'true';
    const domain = emailDomainOf(email);
    const domainOk = !!domain && cfg.domains.includes(domain);
    const name =
      (typeof claims.name === 'string' && claims.name.trim()) ||
      [claims.given_name, claims.family_name].filter((x) => typeof x === 'string' && x.trim()).join(' ') ||
      email?.split('@')[0] ||
      'Unbekannt';

    const accountId = await this.db.txAs({ tenantId: cfg.tenant_id, roles: ['system'] }, async (c) => {
      const ident = (await c.query('SELECT * FROM app.sso_find_identity($1, $2)', [iss, sub])).rows[0] as
        | { account_id: string; email: string; disabled: boolean }
        | undefined;
      let id: string;
      let linkedVia: 'jit' | 'email' | null = null;
      if (ident) {
        if (ident.disabled) throw new SsoError('account_disabled');
        id = ident.account_id;
      } else {
        // Erste Anmeldung mit dieser Identität: über die bestätigte E-Mail verknüpfen oder Konto anlegen (JIT).
        if (!email || !verified) throw new SsoError('email_unverified');
        if (!domainOk) throw new SsoError('domain_not_allowed');
        const acc = (await c.query('SELECT id, disabled FROM app.auth_find_account($1)', [email])).rows[0] as
          | { id: string; disabled: boolean }
          | undefined;
        if (acc) {
          if (acc.disabled) throw new SsoError('account_disabled');
          id = acc.id;
          linkedVia = 'email';
          await c.query('SELECT app.auth_mark_email_verified($1)', [id]);
        } else {
          if (!cfg.jit_enabled) throw new SsoError('no_account');
          id = (await c.query('SELECT app.sso_create_account($1, $2) AS id', [email, name.slice(0, 200)])).rows[0].id;
          linkedVia = 'jit';
        }
      }
      await applyContext(c, { tenantId: cfg.tenant_id, accountId: id, roles: ['system'] });
      if ((await c.query('SELECT app.sso_person_left($1, $2, $3) AS left', [cfg.tenant_id, id, email])).rows[0].left) {
        throw new SsoError('person_left');
      }
      await c.query('SELECT app.sso_link_identity($1, $2, $3, $4, $5)', [id, iss, sub, cfg.tenant_id, linkedVia ?? 'existing']);
      const membership = (
        await c.query('SELECT app.sso_ensure_membership($1, $2, $3, $4) AS m', [cfg.tenant_id, id, cfg.default_roles, cfg.jit_enabled && domainOk])
      ).rows[0].m as 'existing' | 'created' | 'missing';
      if (membership === 'missing') throw new SsoError('no_membership');
      const linkedPersons = (await c.query('SELECT app.sso_link_tenant_persons($1, $2) AS n', [cfg.tenant_id, id])).rows[0].n as number;
      if (linkedVia) {
        await this.audit.record(c, { entity: 'account', entityId: id, action: 'sso_identity_linked', payload: { issuer: iss, via: linkedVia } });
      }
      if (membership === 'created') {
        await this.audit.record(c, { entity: 'membership', entityId: id, action: 'added', payload: { roles: cfg.default_roles, via: 'sso_jit' } });
      }
      await this.audit.record(c, { entity: 'account', entityId: id, action: 'login', payload: { method: 'sso', issuer: iss, linkedPersons } });
      return id;
    });
    const sessionId = await this.sessions.create({ kind: 'account', accountId, tenantId: cfg.tenant_id });
    return { kind: 'login', sessionId, next: flow.next };
  }

  private async completeStepUp(flow: StepUpState, iss: string, sub: string, claims: Record<string, unknown>): Promise<CallbackResult> {
    const s = currentRequest()?.session;
    if (s?.kind !== 'account' || s.accountId !== flow.accountId) throw new SsoError('login_required');
    if (sub !== flow.subject) throw new SsoError('subject_mismatch');
    const authTime = typeof claims.auth_time === 'number' ? claims.auth_time : NaN;
    if (!(authTime >= flow.startedAt - AUTH_TIME_SKEW_S)) throw new SsoError('reauth_required');
    const ticket = randomToken();
    await this.redis.client.set(
      `sso:ticket:${sha256(ticket)}`,
      JSON.stringify({ accountId: flow.accountId, purpose: flow.purpose }),
      'EX',
      TICKET_TTL_S,
    );
    await this.db.txAs({ tenantId: flow.tenantId, accountId: flow.accountId, roles: ['system'] }, (c) =>
      this.audit.record(c, { entity: 'invitation', entityId: flow.invitationId, action: 'sso_step_up', payload: { issuer: iss } }),
    );
    return { kind: 'stepup', invitationId: flow.invitationId, ticket };
  }

  /** Einmal-Ticket aus der Rückleitung gegen die Bestätigung tauschen (Teilnehmer-Step-up mit Methode „sso“). */
  async redeemStepUpTicket(ticket: string, expected: { accountId: string | null; purpose: string }): Promise<void> {
    const raw = await this.redis.client.getdel(`sso:ticket:${sha256(ticket)}`);
    const t = raw ? (JSON.parse(raw) as { accountId: string; purpose: string }) : null;
    if (!t || !expected.accountId || t.accountId !== expected.accountId || t.purpose !== expected.purpose) {
      throw new UnauthorizedException('Die Bestätigung mit dem Firmenkonto ist abgelaufen. Bitte erneut bestätigen.');
    }
  }

  // ── Step-up: verfügbar? ────────────────────────────────────
  private async invitationOf(accountId: string, invitationId: string) {
    const r = await this.db.txAs({}, (c) => c.query('SELECT * FROM app.invitation_for_account($1, $2)', [invitationId, accountId]));
    if (!r.rowCount) throw new SsoError('no_identity', 'Einladung nicht gefunden');
    return { tenantId: r.rows[0].tenant_id as string, personId: r.rows[0].person_id as string };
  }

  private async subjectOf(accountId: string, issuer: string): Promise<string | null> {
    const r = await this.db.txAs({}, (c) => c.query('SELECT app.sso_identity_of($1, $2) AS s', [accountId, issuer]));
    return (r.rows[0]?.s as string | null) ?? null;
  }

  /**
   * Step-up-Optionen für eine Einladung: SSO ist möglich, wenn das Konto beim IdP des Mandanten eine Identität hat.
   * `required`: Mandant „nur SSO“ und Konto ist dort Mitglied (außer Notfall-Admin) → Passwort-Step-up gesperrt.
   */
  async stepUpOptions(accountId: string | null, tenantId: string): Promise<{ sso: boolean; required: boolean }> {
    if (!accountId) return { sso: false, required: false };
    const cfg = await this.configs.load(tenantId);
    if (!cfg?.enabled || !(await this.subjectOf(accountId, cfg.issuer))) return { sso: false, required: false };
    const blocked = await this.passwordBlockedTenants(accountId);
    return { sso: true, required: blocked.some((b) => b.tenantId === tenantId) };
  }

  async passwordBlockedTenants(accountId: string): Promise<Array<{ tenantId: string; tenantName: string }>> {
    const r = await this.db.txAs({}, (c) => c.query('SELECT * FROM app.sso_password_blocked($1)', [accountId]));
    return r.rows.map((x) => ({ tenantId: x.tenant_id, tenantName: x.tenant_name }));
  }

  /** Passwort-Step-up ablehnen, wenn der Mandant der Einladung nur SSO zulässt und SSO-Step-up möglich ist. */
  async assertPasswordStepUpAllowed(accountId: string, tenantId: string) {
    if ((await this.stepUpOptions(accountId, tenantId)).required) {
      throw new UnauthorizedException('Ihre Organisation verlangt die Bestätigung mit dem Firmenkonto.');
    }
  }

}
