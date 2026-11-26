import { RequestMethod, type MiddlewareConsumer } from '@nestjs/common';
import { ScimBodyMiddleware } from '../scim/scim-body.middleware';
import { ScimController } from '../scim/scim.controller';
import { ScimAuthGuard } from '../scim/scim-http';
import { ScimService } from '../scim/scim.service';
import { OidcClients } from './oidc-client';
import { SsoAdminController } from './sso-admin.controller';
import { DOMAIN_TXT_RESOLVER, SsoConfigService } from './sso-config.service';
import { resolveTxt } from 'node:dns/promises';
import { SsoOnlyMiddleware } from './sso-only.middleware';
import { SsoController } from './sso.controller';
import { SsoService } from './sso.service';

/** Paket A, Phase 3 (E-36): SSO (OIDC je Mandant) und SCIM 2.0 – Registrierung im AppModule. */
export const SSO_CONTROLLERS = [SsoController, SsoAdminController, ScimController];
export const SSO_PROVIDERS = [
  OidcClients, SsoConfigService, SsoService, ScimService, ScimAuthGuard,
  { provide: DOMAIN_TXT_RESOLVER, useValue: (name: string) => resolveTxt(name) },
];

/** SCIM läuft ohne Sitzung/CSRF (eigenes Bearer-Token) → von der Session-Middleware ausnehmen. */
export const SCIM_ROUTES = { path: 'scim/v2/{*path}', method: RequestMethod.ALL };

export function configureSso(consumer: MiddlewareConsumer) {
  // SCIM-Clients senden application/scim+json
  consumer.apply(ScimBodyMiddleware).forRoutes(SCIM_ROUTES);
  // „Nur SSO“: Passwort-Anmeldung für Mitglieder solcher Mandanten sperren
  consumer
    .apply(SsoOnlyMiddleware)
    .forRoutes({ path: 'auth/login', method: RequestMethod.POST }, { path: 'auth/password/set', method: RequestMethod.POST });
}
