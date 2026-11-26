import { ForbiddenException, Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { Role } from '@sn/shared';
import type { NextFunction, Request, Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../config';
import { deriveKey, hmac, randomToken, safeEqual } from '../common/crypto';
import { requestStore, type RequestState } from '../common/request-context';
import { DbService } from '../db/db.service';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE, SessionService } from './session.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Lädt die Sitzung, frischt die Rollen aus der Datenbank auf, prüft CSRF (Double-Submit)
 * und legt den Request-Kontext (AsyncLocalStorage) an.
 */
@Injectable()
export class SessionMiddleware implements NestMiddleware {
  private readonly ipKey: string;
  constructor(
    private readonly sessions: SessionService,
    private readonly db: DbService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.ipKey = deriveKey(config.HMAC_MASTER_SECRET, 'ip-hash');
  }

  async use(req: Request, res: Response, next: NextFunction) {
    // CSRF: Token-Cookie bei Bedarf setzen, schreibende Requests müssen es im Header spiegeln.
    let csrf = req.cookies?.[CSRF_COOKIE] as string | undefined;
    if (!csrf) {
      csrf = randomToken(24);
      res.cookie(CSRF_COOKIE, csrf, { sameSite: 'lax', secure: this.config.NODE_ENV === 'production', path: '/' });
    }
    res.locals.csrf = csrf;
    if (!SAFE_METHODS.has(req.method)) {
      const header = req.header(CSRF_HEADER);
      if (!header || !req.cookies?.[CSRF_COOKIE] || !safeEqual(header, req.cookies[CSRF_COOKIE])) {
        return next(new ForbiddenException('Sicherheitsprüfung fehlgeschlagen (CSRF). Bitte Seite neu laden.'));
      }
    }

    const sessionId = (req.cookies?.[SESSION_COOKIE] as string | undefined) ?? null;
    let session = sessionId ? await this.sessions.get(sessionId) : null;
    let roles: Role[] = [];
    if (session?.tenantId) {
      // Rollen je Request frisch: entzogene Mitgliedschaft wirkt sofort.
      const r = await this.db.txAs({ accountId: session.accountId }, (c) =>
        c.query('SELECT roles FROM membership WHERE account_id = $1 AND tenant_id = $2', [
          session!.accountId,
          session!.tenantId,
        ]),
      );
      if (r.rowCount) roles = r.rows[0].roles;
      else {
        session = { ...session, tenantId: null };
        await this.sessions.update(sessionId!, { tenantId: null });
      }
    }
    const state: RequestState = {
      sessionId: session ? sessionId : null,
      session,
      roles,
      ipHash: hmac(this.ipKey, req.ip ?? '').slice(0, 32),
      userAgent: (req.header('user-agent') ?? '').slice(0, 300),
    };
    requestStore.run(state, () => next());
  }
}
