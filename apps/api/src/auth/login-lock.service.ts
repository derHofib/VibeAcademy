import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { loginLockedText, loginLockSeconds, type LoginLockPolicy } from '@sn/shared';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { sha256 } from '../common/crypto';
import { APP_CONFIG, type AppConfig } from '../config';
import { DbService } from '../db/db.service';
import { RedisService } from '../redis/redis.service';

/** 429 mit Restzeit; der `RetryAfterFilter` setzt daraus den Header `Retry-After`. */
export class LoginLockedException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super(
      { statusCode: 429, code: 'login_locked', message: loginLockedText(retryAfterSeconds), retryAfterSeconds },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/**
 * Sperre mit steigender Dauer je E-Mail-Adresse (Login, Step-up, Passwort ändern).
 * Schlüssel = SHA-256 der normalisierten Adresse – unbekannte Adressen werden genauso behandelt
 * (keine Konto-Erkennung). Während der Sperre wird das Passwort gar nicht geprüft.
 */
@Injectable()
export class LoginLockService {
  readonly policy: LoginLockPolicy;
  constructor(
    private readonly redis: RedisService,
    private readonly clock: Clock,
    private readonly db: DbService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.policy = {
      freeAttempts: config.LOGIN_LOCK_FREE_ATTEMPTS ?? (config.NODE_ENV === 'development' ? 100 : 5),
      baseSeconds: config.LOGIN_LOCK_BASE_SECONDS,
      maxSeconds: config.LOGIN_LOCK_MAX_SECONDS,
    };
  }

  static normalize(email: string) {
    return email.trim().toLowerCase();
  }

  private key(email: string) {
    return `loginlock:${sha256(LoginLockService.normalize(email))}`;
  }

  /** Restsperre in Sekunden (0 = frei). */
  async remaining(email: string): Promise<number> {
    const until = Number(await this.redis.client.hget(this.key(email), 'until'));
    const left = until ? Math.ceil((until - this.clock.now().getTime()) / 1000) : 0;
    return Math.max(0, left);
  }

  /** Vor jeder Passwortprüfung: gesperrt → 429, ohne das Passwort anzusehen. */
  async assertOpen(email: string): Promise<void> {
    const left = await this.remaining(email);
    if (left > 0) throw new LoginLockedException(left);
  }

  /**
   * Fehlversuch zählen. Löst er eine Sperre aus, wird sie sofort gemeldet (429) und – wenn das Konto
   * existiert – als `login_locked` protokolliert. Sonst kehrt die Methode zurück (Aufrufer wirft 401/400).
   */
  async fail(email: string, accountId?: string | null): Promise<void> {
    const k = this.key(email);
    const failures = await this.redis.client.hincrby(k, 'fails', 1);
    const lock = loginLockSeconds(failures, this.policy);
    if (lock > 0) await this.redis.client.hset(k, 'until', String(this.clock.now().getTime() + lock * 1000));
    // Zähler verfällt nach maxSeconds ohne weiteren Fehlversuch (Standard 24 h)
    await this.redis.client.expire(k, Math.max(this.policy.maxSeconds, lock));
    if (lock === 0) return;
    if (accountId) await this.auditLocked(accountId, failures, lock);
    throw new LoginLockedException(lock);
  }

  /** Erfolgreiche Anmeldung: Zähler und Sperrstufe zurücksetzen. */
  async reset(email: string): Promise<void> {
    await this.redis.client.del(this.key(email));
  }

  private async auditLocked(accountId: string, failures: number, seconds: number) {
    const tenantId = await this.db
      .txAs({ accountId }, (c) =>
        c.query('SELECT tenant_id FROM membership WHERE account_id = $1 ORDER BY created_at LIMIT 1', [accountId]),
      )
      .then((r) => (r.rows[0]?.tenant_id as string | undefined) ?? null);
    if (!tenantId) return; // Teilnehmerkonto ohne Mandant: keine Mandanten-Hash-Kette
    await this.db.txAs({ tenantId, accountId }, (c) =>
      this.audit.record(c, {
        entity: 'account',
        entityId: accountId,
        action: 'login_locked',
        payload: { failures, lock_seconds: seconds },
      }),
    );
  }
}
