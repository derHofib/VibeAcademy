import { ForbiddenException, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { PasswordService } from '../auth/password.service';
import { sha256 } from '../common/crypto';
import { DbService } from '../db/db.service';
import { RedisService } from '../redis/redis.service';
import { SsoService } from './sso.service';

const MESSAGE = 'Ihre Organisation verlangt die Anmeldung mit dem Firmenkonto. Bitte „Mit Firmenkonto anmelden“ verwenden.';

/**
 * „Nur SSO“ (E-36): Passwort-Anmeldung und Passwort-Setzen für Mitglieder eines Mandanten mit „nur SSO“ sperren
 * (Ausnahme: der dort benannte Notfall-Admin). Läuft vor `POST /auth/login` bzw. `/auth/password/set`.
 * Beim Login wird erst nach korrektem Passwort abgelehnt (keine Auskunft über fremde Konten); falsche Passwörter laufen
 * normal in den Login (Rate-Limit, einheitliche Fehlermeldung).
 */
@Injectable()
export class SsoOnlyMiddleware implements NestMiddleware {
  constructor(
    private readonly db: DbService,
    private readonly sso: SsoService,
    private readonly passwords: PasswordService,
    private readonly redis: RedisService,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    try {
      const path = (req.originalUrl ?? req.url).split('?')[0]!;
      const accountId = path.endsWith('/password/set') ? await this.fromSetToken(req) : await this.fromLogin(req);
      if (accountId && (await this.sso.passwordBlockedTenants(accountId)).length) {
        return next(new ForbiddenException({ statusCode: 403, message: MESSAGE, code: 'SSO_REQUIRED' }));
      }
    } catch {
      // Prüfung ist eine Zusatzsperre – technische Fehler hier überlassen die Entscheidung dem eigentlichen Endpunkt.
    }
    next();
  }

  private async fromLogin(req: Request): Promise<string | null> {
    const b = req.body as { email?: unknown; password?: unknown } | undefined;
    if (typeof b?.email !== 'string' || typeof b.password !== 'string' || b.email.length > 254 || b.password.length > 200) return null;
    const email = b.email.trim().toLowerCase();
    const acc = (await this.db.txAs({}, (c) => c.query('SELECT id, password_hash FROM app.auth_find_account($1)', [email])))
      .rows[0] as { id: string; password_hash: string | null } | undefined;
    if (!acc?.password_hash) return null;
    return (await this.passwords.verify(acc.password_hash, b.password)) ? acc.id : null;
  }

  private async fromSetToken(req: Request): Promise<string | null> {
    const t = (req.body as { token?: unknown } | undefined)?.token;
    if (typeof t !== 'string' || t.length > 100) return null;
    return this.redis.client.get(`pwset:${sha256(t)}`);
  }
}
