import {
  applyDecorators, CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, HttpException, HttpStatus, Inject, Injectable,
  NestMiddleware, SetMetadata, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import { Public } from '../auth/decorators';
import { deriveKey, hmac } from '../common/crypto';
import { requestStore, type RequestState } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config';
import { RedisService } from '../redis/redis.service';
import { ApiKeyService, type ApiPrincipal } from './api-key.service';
import type { ApiScope } from './scopes';

const API_SCOPE = 'sn:api-scope';
const FAILED_AUTH_PER_MINUTE = 30;

type ApiRequest = Request & { apiKey?: ApiPrincipal };

/**
 * Request-Kontext für /api/v1 (ersetzt dort die Sitzungs-Middleware): keine Cookie-Sitzung, kein CSRF
 * (Authentifizierung ausschließlich per Bearer-Token), IP-Hash für das Audit.
 */
@Injectable()
export class ApiContextMiddleware implements NestMiddleware {
  private readonly ipKey: string;
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.ipKey = deriveKey(config.HMAC_MASTER_SECRET, 'ip-hash');
  }
  use(req: Request, _res: Response, next: NextFunction) {
    const state: RequestState = {
      sessionId: null,
      session: null,
      roles: [],
      ipHash: hmac(this.ipKey, req.ip ?? '').slice(0, 32),
      userAgent: (req.header('user-agent') ?? '').slice(0, 300),
    };
    requestStore.run(state, () => next());
  }
}

/** Prüft Bearer-Token, Status des Schlüssels, Rate-Limit je Schlüssel und den Scope der Route. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly limit: number;
  constructor(
    private readonly reflector: Reflector,
    private readonly keys: ApiKeyService,
    private readonly redis: RedisService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.limit = config.API_RATE_LIMIT_PER_MINUTE;
  }

  private async window(key: string): Promise<{ n: number; reset: number }> {
    const slot = Math.floor(Date.now() / 60_000);
    const k = `rl:${key}:${slot}`;
    const n = await this.redis.client.incr(k);
    if (n === 1) await this.redis.client.expire(k, 120);
    return { n, reset: (slot + 1) * 60 - Math.floor(Date.now() / 1000) };
  }

  private async failed(res: Response, message: string): Promise<never> {
    const ip = requestStore.getStore()?.ipHash ?? 'unbekannt';
    const w = await this.window(`api-auth-fail:${ip}`);
    if (w.n > FAILED_AUTH_PER_MINUTE) {
      res.setHeader('retry-after', String(w.reset));
      throw new HttpException('Zu viele fehlgeschlagene Anmeldungen. Bitte später erneut versuchen.', HttpStatus.TOO_MANY_REQUESTS);
    }
    res.setHeader('www-authenticate', 'Bearer realm="schulungsnachweis"');
    throw new UnauthorizedException(message);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const scope = this.reflector.getAllAndOverride<ApiScope | null>(API_SCOPE, [ctx.getHandler(), ctx.getClass()]);
    const req = ctx.switchToHttp().getRequest<ApiRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const m = /^Bearer\s+(\S+)\s*$/i.exec(req.header('authorization') ?? '');
    if (!m) return this.failed(res, 'API-Schlüssel fehlt. Bitte im Header „Authorization: Bearer sn_live_…“ senden.');
    const p = await this.keys.authenticate(m[1]!);
    if (!p) return this.failed(res, 'API-Schlüssel ist ungültig');
    if (p.revoked) return this.failed(res, 'API-Schlüssel wurde widerrufen');
    if (p.expired) return this.failed(res, 'API-Schlüssel ist abgelaufen');
    const w = await this.window(`api:${p.keyId}`);
    res.setHeader('x-ratelimit-limit', String(this.limit));
    res.setHeader('x-ratelimit-remaining', String(Math.max(0, this.limit - w.n)));
    res.setHeader('x-ratelimit-reset', String(w.reset));
    if (w.n > this.limit) {
      res.setHeader('retry-after', String(w.reset));
      throw new HttpException('Zu viele Anfragen mit diesem API-Schlüssel. Bitte später erneut versuchen.', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (scope && !p.scopes.includes(scope)) throw new ForbiddenException(`Dem API-Schlüssel fehlt die Berechtigung „${scope}“`);
    req.apiKey = { keyId: p.keyId, tenantId: p.tenantId, name: p.name, scopes: p.scopes };
    return true;
  }
}

/**
 * Route der öffentlichen API: nicht über die Sitzung (globaler AuthGuard → öffentlich), sondern über den API-Schlüssel.
 * scope = null: jeder gültige Schlüssel.
 */
export const ApiScoped = (scope: ApiScope | null) => applyDecorators(Public(), SetMetadata(API_SCOPE, scope), UseGuards(ApiKeyGuard));

/** Angemeldeter Schlüssel (nach ApiKeyGuard). */
export const ApiKey = createParamDecorator((_: unknown, ctx: ExecutionContext): ApiPrincipal => {
  const p = ctx.switchToHttp().getRequest<ApiRequest>().apiKey;
  if (!p) throw new UnauthorizedException('API-Schlüssel fehlt');
  return p;
});
