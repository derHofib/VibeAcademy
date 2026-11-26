import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ROLE_LABELS, type Role } from '@sn/shared';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../config';
import { randomToken, sha256 } from '../common/crypto';
import { mapDbError } from '../common/errors';
import { RateLimitService } from '../common/rate-limit.service';
import { currentRequest } from '../common/request-context';
import { DbService } from '../db/db.service';
import { RedisService } from '../redis/redis.service';
import { LoginLockService } from './login-lock.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { StepUpService } from './step-up.service';

const LOGIN_FAILED = 'E-Mail oder Passwort ist falsch';
const PWSET_TTL_S = 7 * 24 * 3600;

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DbService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly stepUp: StepUpService,
    private readonly rate: RateLimitService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
    private readonly lock: LoginLockService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private ip() {
    return currentRequest()?.ipHash ?? 'unknown';
  }

  /** Dozent registriert sich: Konto + eigener Mandant (E-07). */
  async registerDozent(i: { name: string; organisation: string; email: string; password: string }) {
    await this.rate.hit(`register:${this.ip()}`, 10, 3600);
    const hash = await this.passwords.hash(i.password);
    const ids = await this.db
      .txAs({}, (c) =>
        c.query('SELECT * FROM app.auth_register_tenant($1, $2, $3, $4)', [i.email, i.name, hash, i.organisation]),
      )
      .then((r) => r.rows[0] as { account_id: string; tenant_id: string })
      .catch(mapDbError);
    await this.db.txAs({ tenantId: ids.tenant_id, accountId: ids.account_id, roles: ['admin'] }, async (c) => {
      await this.audit.record(c, { entity: 'tenant', entityId: ids.tenant_id, action: 'created', payload: { name: i.organisation } });
      await this.audit.record(c, { entity: 'account', entityId: ids.account_id, action: 'registered' });
    });
    return this.sessions.create({ kind: 'account', accountId: ids.account_id, tenantId: ids.tenant_id });
  }

  /** Teilnehmer legt ein Konto ohne Mandant an, um Nachweise zu sammeln (E-25). */
  async registerAccount(i: { name: string; email: string; password: string }) {
    await this.rate.hit(`register:${this.ip()}`, 10, 3600);
    const hash = await this.passwords.hash(i.password);
    const id = await this.db
      .txAs({}, (c) => c.query('SELECT app.auth_register_account($1, $2, $3) AS id', [i.email, i.name, hash]))
      .then((r) => r.rows[0].id as string)
      .catch(mapDbError);
    // Aus einer Einladungslink-Sitzung heraus: Der Link kam an diese E-Mail-Adresse → Adresse gilt als bestätigt,
    // die eingeladene Person wird direkt verknüpft (E-25).
    const s = currentRequest()?.session;
    if (s?.kind === 'invitation') {
      const email = await this.db
        .txAs({ tenantId: s.tenantId, roles: ['system'] }, (c) => c.query('SELECT email FROM person WHERE id = $1', [s.personId]))
        .then((r) => (r.rows[0]?.email as string | undefined)?.toLowerCase());
      if (email && email === i.email.toLowerCase()) {
        await this.db.txAs({}, async (c) => {
          await c.query('SELECT app.auth_mark_email_verified($1)', [id]);
          await c.query('SELECT app.link_persons($1, $2)', [id, [s.personId]]);
        });
      }
    }
    return this.sessions.create({ kind: 'account', accountId: id, tenantId: null });
  }

  async login(i: { email: string; password: string }) {
    // IP-Limit gegen das Durchprobieren vieler Konten; je Adresse die Sperre mit steigender Dauer
    await this.rate.hit(`login:ip:${this.ip()}`, 30, 900);
    await this.lock.assertOpen(i.email);
    const acc = await this.db
      .txAs({}, (c) => c.query('SELECT * FROM app.auth_find_account($1)', [i.email]))
      .then((r) => r.rows[0] as { id: string; password_hash: string | null; disabled: boolean } | undefined);
    const ok = await this.passwords.verify(acc?.password_hash, i.password);
    if (!acc || !ok || acc.disabled) {
      await this.lock.fail(i.email, acc?.id);
      throw new UnauthorizedException(LOGIN_FAILED);
    }
    await this.lock.reset(i.email);
    const tenantId = await this.db
      .txAs({ accountId: acc.id }, (c) =>
        c.query('SELECT tenant_id FROM membership WHERE account_id = $1 ORDER BY created_at LIMIT 1', [acc.id]),
      )
      .then((r) => (r.rows[0]?.tenant_id as string | undefined) ?? null);
    if (tenantId) {
      await this.db.txAs({ tenantId, accountId: acc.id }, (c) =>
        this.audit.record(c, { entity: 'account', entityId: acc.id, action: 'login' }),
      );
    }
    return this.sessions.create({ kind: 'account', accountId: acc.id, tenantId });
  }

  async me() {
    const r = currentRequest()!;
    const s = r.session!;
    if (s.kind !== 'account') throw new UnauthorizedException('Bitte anmelden');
    return this.db.txAs({ accountId: s.accountId, tenantId: s.tenantId }, async (c) => {
      const account = (
        await c.query(
          'SELECT id, email, display_name, email_verified_at, app.auth_get_password_hash(id) IS NOT NULL AS has_password FROM account WHERE id = $1',
          [s.accountId],
        )
      ).rows[0];
      const memberships = (
        await c.query(
          `SELECT m.tenant_id, t.name AS tenant_name, m.roles FROM membership m JOIN tenant t ON t.id = m.tenant_id
            WHERE m.account_id = $1 ORDER BY m.created_at`,
          [s.accountId],
        )
      ).rows;
      return {
        account: {
          id: account.id,
          email: account.email,
          name: account.display_name,
          emailVerified: !!account.email_verified_at,
          // Konten nur mit Firmenanmeldung (SSO, ohne Passwort) können kein Passwort ändern
          hasPassword: !!account.has_password,
        },
        activeTenantId: s.tenantId,
        roles: r.roles,
        memberships: memberships.map((m) => ({ tenantId: m.tenant_id, tenantName: m.tenant_name, roles: m.roles })),
      };
    });
  }

  async switchTenant(tenantId: string) {
    const r = currentRequest()!;
    if (r.session?.kind !== 'account') throw new UnauthorizedException('Bitte anmelden');
    const ok = await this.db
      .txAs({ accountId: r.session!.accountId }, (c) =>
        c.query('SELECT 1 FROM membership WHERE account_id = $1 AND tenant_id = $2', [r.session!.accountId, tenantId]),
      )
      .then((x) => !!x.rowCount);
    if (!ok) throw new UnauthorizedException('Kein Zugriff auf diesen Mandanten');
    await this.sessions.update(r.sessionId!, { tenantId });
  }

  /** Step-up per Passwort (E-08). purpose bindet das Token an den Vorgang, z. B. „signature:<invitationId>“. */
  async stepUpWithPassword(password: string, purpose: string) {
    const s = currentRequest()!.session!;
    if (s.kind !== 'account') throw new UnauthorizedException('Bitte mit Code bestätigen');
    const mail = await this.accountEmail(s.accountId);
    await this.lock.assertOpen(mail);
    const hash = await this.passwordHash(s.accountId);
    if (!(await this.passwords.verify(hash, password))) {
      await this.lock.fail(mail, s.accountId);
      throw new UnauthorizedException('Passwort ist falsch');
    }
    await this.lock.reset(mail);
    return this.stepUp.issue({ subject: s.accountId, purpose, method: 'password' });
  }

  private accountEmail(accountId: string) {
    return this.db
      .txAs({ accountId }, (c) => c.query('SELECT email FROM account WHERE id = $1', [accountId]))
      .then((r) => String(r.rows[0]?.email ?? ''));
  }

  private passwordHash(accountId: string) {
    return this.db
      .txAs({}, (c) => c.query('SELECT app.auth_get_password_hash($1) AS h', [accountId]))
      .then((r) => (r.rows[0]?.h as string | null) ?? null);
  }

  private firstTenant(accountId: string) {
    return this.db
      .txAs({ accountId }, (c) =>
        c.query('SELECT tenant_id FROM membership WHERE account_id = $1 ORDER BY created_at LIMIT 1', [accountId]),
      )
      .then((r) => (r.rows[0]?.tenant_id as string | undefined) ?? null);
  }

  /**
   * Passwort im eigenen Konto ändern: aktuelles Passwort prüfen (zählt für die Login-Sperre),
   * neues speichern, alle anderen Sitzungen beenden; die aktuelle bleibt bestehen.
   */
  async changePassword(currentPassword: string, newPassword: string) {
    const r = currentRequest()!;
    const s = r.session;
    if (s?.kind !== 'account') throw new UnauthorizedException('Bitte anmelden');
    const mail = await this.accountEmail(s.accountId);
    await this.lock.assertOpen(mail);
    const hash = await this.passwordHash(s.accountId);
    if (!hash) throw new BadRequestException('Für dieses Konto ist kein Passwort hinterlegt (Anmeldung über das Firmenkonto).');
    if (!(await this.passwords.verify(hash, currentPassword))) {
      await this.lock.fail(mail, s.accountId);
      throw new BadRequestException({
        message: 'Das aktuelle Passwort ist falsch',
        fields: [{ path: 'currentPassword', message: 'Das aktuelle Passwort ist falsch' }],
      });
    }
    await this.lock.reset(mail);
    if (currentPassword === newPassword) {
      throw new BadRequestException({
        message: 'Das neue Passwort muss sich vom bisherigen unterscheiden',
        fields: [{ path: 'newPassword', message: 'Das neue Passwort muss sich vom bisherigen unterscheiden' }],
      });
    }
    const next = await this.passwords.hash(newPassword);
    const tenantId = await this.firstTenant(s.accountId);
    await this.db.txAs({ tenantId, accountId: s.accountId }, async (c) => {
      await c.query('SELECT app.auth_set_password($1, $2)', [s.accountId, next]);
      if (tenantId) {
        await this.audit.record(c, { entity: 'account', entityId: s.accountId, action: 'password_changed' });
      }
    });
    const ended = await this.sessions.destroyOthers(s.accountId, r.sessionId);
    return { ok: true, endedSessions: ended };
  }

  /** Einmal-Link zum Passwort-Setzen (eingeladene Kollegen). */
  async createPasswordSetToken(accountId: string): Promise<string> {
    const token = randomToken();
    await this.redis.client.set(`pwset:${sha256(token)}`, accountId, 'EX', PWSET_TTL_S);
    return token;
  }

  passwordSetLink(token: string) {
    return `${this.config.PUBLIC_BASE_URL}/passwort-festlegen#token=${token}`;
  }

  async setPasswordWithToken(token: string, password: string) {
    await this.rate.hit(`pwset:${this.ip()}`, 20, 900);
    const accountId = await this.redis.client.getdel(`pwset:${sha256(token)}`);
    if (!accountId) throw new UnauthorizedException('Der Link ist ungültig oder abgelaufen');
    const hash = await this.passwords.hash(password);
    await this.db.txAs({}, async (c) => {
      await c.query('SELECT app.auth_set_password($1, $2)', [accountId, hash]);
      await c.query('SELECT app.auth_mark_email_verified($1)', [accountId]);
    });
    const tenantId = await this.db
      .txAs({ accountId }, (c) =>
        c.query('SELECT tenant_id FROM membership WHERE account_id = $1 ORDER BY created_at LIMIT 1', [accountId]),
      )
      .then((r) => (r.rows[0]?.tenant_id as string | undefined) ?? null);
    return this.sessions.create({ kind: 'account', accountId, tenantId });
  }

  static rolesLabel(roles: Role[]) {
    return roles.map((r) => ROLE_LABELS[r]).join(', ');
  }
}
