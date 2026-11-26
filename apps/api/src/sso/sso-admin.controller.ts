import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ROLES, type Role } from '@sn/shared';
import { z } from 'zod';
import { Roles } from '../auth/decorators';
import { ZodBody } from '../common/errors';
import { currentRequest } from '../common/request-context';
import { OidcClients } from './oidc-client';
import { SsoConfigService, DOMAIN_TXT_RESOLVER, type TxtResolver } from './sso-config.service';

const domain = z
  .string()
  .trim()
  .toLowerCase()
  .transform((d) => d.replace(/^@/, ''))
  .pipe(z.string().regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/, 'Ungültige Domain'));

const UpdateSso = z.object({
  enabled: z.boolean(),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .max(50)
    .nullish()
    .transform((s) => s || null)
    .pipe(z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/, 'Nur Kleinbuchstaben, Ziffern und Bindestriche (3–50 Zeichen)').nullable()),
  issuer: z.string().trim().max(500).default(''),
  clientId: z.string().trim().max(500).default(''),
  clientSecret: z.string().max(2000).nullish(),
  scopes: z
    .string()
    .trim()
    .max(300)
    .default('openid email profile')
    .refine((s) => s.split(/\s+/).includes('openid'), 'Der Scope „openid“ ist erforderlich')
    .transform((s) => s.split(/\s+/).join(' ')),
  emailDomains: z
    .array(domain)
    .max(50)
    .default([])
    .transform((d) => [...new Set(d)]),
  ssoOnly: z.boolean().default(false),
  emergencyAdminAccountId: z.uuid().nullish(),
  jitEnabled: z.boolean().default(true),
  defaultRoles: z
    .array(z.enum(ROLES))
    .min(1, 'Mindestens eine Rolle wählen')
    .default(['teilnehmer'])
    .transform((r) => [...new Set(r)] as Role[]),
});
const TestConnection = z.object({ issuer: z.string().trim().max(500).optional() });
const CreateToken = z.object({ label: z.string().trim().max(100).default('') });

/** Einstellungen „Anmeldung & Benutzerverwaltung“ (SSO + SCIM) – nur Mandanten-Admin. */
@Controller('tenant/sso')
@Roles('admin')
export class SsoAdminController {
  constructor(
    private readonly configs: SsoConfigService,
    private readonly oidc: OidcClients,
    @Inject(DOMAIN_TXT_RESOLVER) private readonly resolveTxt: TxtResolver,
  ) {}

  @Get()
  get() {
    return this.configs.forAdmin();
  }

  @Put()
  update(@Body(new ZodBody(UpdateSso)) b: z.infer<typeof UpdateSso>) {
    return this.configs.update({ ...b, clientSecret: b.clientSecret });
  }

  /** Verbindung testen: Discovery-Dokument des IdP abrufen (gespeicherter oder eingegebener Issuer). */
  @Post('test')
  @HttpCode(200)
  async test(@Body(new ZodBody(TestConnection)) b: z.infer<typeof TestConnection>) {
    const issuer = b.issuer || (await this.configs.load(currentRequest()!.session!.tenantId!))?.issuer;
    if (!issuer) throw new BadRequestException('Bitte zuerst den Issuer angeben');
    const problem = this.oidc.issuerProblem(issuer);
    if (problem) throw new BadRequestException(problem);
    try {
      const m = await this.oidc.discover(issuer);
      const warnings: string[] = [];
      if (!m.codeChallengeMethods?.includes('S256')) warnings.push('Der Anbieter meldet keine PKCE-Unterstützung (S256).');
      if (m.scopesSupported && !m.scopesSupported.includes('email')) warnings.push('Der Anbieter meldet keinen Scope „email“.');
      return { ok: true, ...m, warnings };
    } catch (e) {
      return { ok: false, error: `Der Identitätsanbieter ist nicht erreichbar oder liefert keine gültigen Metadaten (${(e as Error).message})` };
    }
  }

  /** Domain-Nachweis per DNS-TXT (Migration 018). */
  @Post('domains/:domain/verify')
  @HttpCode(200)
  verifyDomain(@Param('domain') domain: string) {
    if (!/^[a-z0-9.-]{3,253}$/i.test(domain)) throw new BadRequestException('Ungültige Domain');
    return this.configs.verifyDomain(domain, this.resolveTxt);
  }

  @Post('scim-tokens')
  createToken(@Body(new ZodBody(CreateToken)) b: z.infer<typeof CreateToken>) {
    return this.configs.createScimToken(b.label);
  }

  @Delete('scim-tokens/:id')
  async revokeToken(@Param('id', ParseUUIDPipe) id: string) {
    await this.configs.revokeScimToken(id);
    return { ok: true };
  }
}
