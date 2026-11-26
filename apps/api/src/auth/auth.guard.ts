import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@sn/shared';
import { currentRequest } from '../common/request-context';
import { ANY_ACCOUNT, IS_PUBLIC, ROLES } from './decorators';

/** Globaler Guard: Standard ist „angemeldet + aktiver Mandant“, Ausnahmen per Decorator. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const get = <T>(key: string) => this.reflector.getAllAndOverride<T>(key, [ctx.getHandler(), ctx.getClass()]);
    if (get<boolean>(IS_PUBLIC)) return true;
    const r = currentRequest();
    if (!r?.session) throw new UnauthorizedException('Bitte anmelden');
    if (get<boolean>(ANY_ACCOUNT)) return true;
    if (!r.session.tenantId) throw new ForbiddenException('Kein Mandant ausgewählt');
    const required = get<Role[]>(ROLES);
    if (required?.length && !required.some((role) => r.roles.includes(role))) {
      throw new ForbiddenException('Keine Berechtigung');
    }
    if (!required?.length && r.roles.length === 0) throw new ForbiddenException('Keine Berechtigung');
    return true;
  }
}
