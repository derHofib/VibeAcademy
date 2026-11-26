import {
  ArgumentsHost,
  CallHandler,
  Catch,
  createParamDecorator,
  ExceptionFilter,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
  type CanActivate,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { DatabaseError } from 'pg';
import { sha256 } from '../common/crypto';
import { RateLimitService } from '../common/rate-limit.service';
import { DbService } from '../db/db.service';

export const SCIM_CONTENT_TYPE = 'application/scim+json';
export const SCHEMA = {
  user: 'urn:ietf:params:scim:schemas:core:2.0:User',
  enterprise: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
  group: 'urn:ietf:params:scim:schemas:core:2.0:Group',
  list: 'urn:ietf:params:scim:api:messages:2.0:ListResponse',
  patch: 'urn:ietf:params:scim:api:messages:2.0:PatchOp',
  error: 'urn:ietf:params:scim:api:messages:2.0:Error',
  spc: 'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig',
  resourceType: 'urn:ietf:params:scim:schemas:core:2.0:ResourceType',
  schema: 'urn:ietf:params:scim:schemas:core:2.0:Schema',
} as const;

export type ScimType =
  | 'invalidFilter'
  | 'tooMany'
  | 'uniqueness'
  | 'mutability'
  | 'invalidSyntax'
  | 'invalidPath'
  | 'noTarget'
  | 'invalidValue'
  | 'invalidVers';

/** Fehler im SCIM-Format (RFC 7644 §3.12). */
export class ScimError extends HttpException {
  constructor(status: number, detail: string, readonly scimType?: ScimType) {
    super(detail, status);
  }
}

/** Mandant und Token der SCIM-Anfrage – ausschließlich aus dem Bearer-Token abgeleitet. */
export interface ScimAuth {
  tenantId: string;
  tokenId: string;
}
type ScimRequest = Request & { scim?: ScimAuth };

export const ScimTenant = createParamDecorator((_: unknown, ctx: ExecutionContext): ScimAuth => {
  const a = ctx.switchToHttp().getRequest<ScimRequest>().scim;
  if (!a) throw new ScimError(401, 'Nicht authentifiziert');
  return a;
});

/** Bearer-Token (nur SHA-256 gespeichert) → Mandant. Widerrufene Token werden abgelehnt. Rate-Limit je Token. */
@Injectable()
export class ScimAuthGuard implements CanActivate {
  constructor(
    private readonly db: DbService,
    private readonly rate: RateLimitService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<ScimRequest>();
    const m = /^Bearer\s+(\S{20,200})$/i.exec(req.header('authorization') ?? '');
    if (!m) throw new ScimError(401, 'Bearer-Token fehlt');
    const r = await this.db.txAs({}, (c) => c.query('SELECT * FROM app.scim_token_lookup($1)', [sha256(m[1]!)]));
    const row = r.rows[0] as { token_id: string; tenant_id: string } | undefined;
    if (!row) throw new ScimError(401, 'Token ungültig oder widerrufen');
    await this.rate.hit(`scim:${row.token_id}`, 1200, 60).catch(() => {
      throw new ScimError(429, 'Zu viele Anfragen');
    });
    req.scim = { tenantId: row.tenant_id, tokenId: row.token_id };
    return true;
  }
}

/** Antworten als application/scim+json. */
@Injectable()
export class ScimContentType implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler) {
    ctx.switchToHttp().getResponse<Response>().type(SCIM_CONTENT_TYPE);
    return next.handle();
  }
}

/** Alle Fehler der SCIM-Endpunkte im SCIM-Fehlerformat. */
@Catch()
export class ScimExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger('SCIM');
  catch(e: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let detail = 'Interner Fehler';
    let scimType: ScimType | undefined;
    if (e instanceof ScimError) {
      status = e.getStatus();
      detail = e.message;
      scimType = e.scimType;
    } else if (e instanceof HttpException) {
      status = e.getStatus();
      const body = e.getResponse() as { message?: unknown } | string;
      detail = typeof body === 'string' ? body : typeof body.message === 'string' ? body.message : e.message;
    } else if (e instanceof DatabaseError) {
      if (e.code === '23505') [status, detail, scimType] = [409, 'Eintrag existiert bereits (eindeutiges Attribut)', 'uniqueness'];
      else if (e.code === '23514' || e.code === '22P02' || e.code === '22001') [status, detail, scimType] = [400, 'Ungültiger Wert', 'invalidValue'];
      else this.log.error(`${e.code} ${e.message}`);
    } else {
      this.log.error((e as Error)?.stack ?? String(e));
    }
    res
      .status(status)
      .type(SCIM_CONTENT_TYPE)
      .json({ schemas: [SCHEMA.error], status: String(status), ...(scimType ? { scimType } : {}), detail });
  }
}
