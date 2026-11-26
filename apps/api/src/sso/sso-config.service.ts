import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Role } from '@sn/shared';
import type pg from 'pg';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../config';
import { randomToken, sha256 } from '../common/crypto';
import { currentRequest } from '../common/request-context';
import { DbService } from '../db/db.service';
import { OidcClients, type IdpSettings } from './oidc-client';
import { SecretBox } from './secret-box';

export const DOMAIN_TXT_PREFIX = '_schulungsnachweis';
export const DOMAIN_TXT_VALUE_PREFIX = 'schulungsnachweis-verify=';
/** DNS-TXT-Abfrage, in Tests ersetzbar. */
export type TxtResolver = (name: string) => Promise<string[][]>;
export const DOMAIN_TXT_RESOLVER = Symbol('DOMAIN_TXT_RESOLVER');
export interface DomainStatus {
  domain: string;
  verified: boolean;
  verifiedAt: Date | null;
  txtName: string;
  txtValue: string;
}

export interface SsoConfigRow {
  tenant_id: string;
  enabled: boolean;
  slug: string | null;
  issuer: string;
  client_id: string;
  client_secret_enc: string | null;
  scopes: string;
  sso_only: boolean;
  emergency_admin_account_id: string | null;
  jit_enabled: boolean;
  default_roles: Role[];
  updated_at: Date;
}

export interface SsoConfig extends SsoConfigRow {
  /** nur bestätigte Domains */
  domains: string[];
  domainStatus: DomainStatus[];
}

export interface SsoConfigInput {
  enabled: boolean;
  slug: string | null;
  issuer: string;
  clientId: string;
  /** undefined = unverändert, null = entfernen (öffentlicher Client), sonst neu setzen */
  clientSecret?: string | null;
  scopes: string;
  emailDomains: string[];
  ssoOnly: boolean;
  emergencyAdminAccountId?: string | null;
  jitEnabled: boolean;
  defaultRoles: Role[];
}

export const SCIM_TOKEN_PREFIX = 'scim_';

export const emailDomainOf = (email: string | null | undefined) => {
  const at = email?.lastIndexOf('@') ?? -1;
  return at > 0 ? email!.slice(at + 1).toLowerCase() : null;
};

/** IdP-Konfiguration, E-Mail-Domains und SCIM-Token je Mandant (E-36). Geheimnisse verlassen den Server nie. */
@Injectable()
export class SsoConfigService {
  readonly box: SecretBox;
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly oidc: OidcClients,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.box = new SecretBox(config.HMAC_MASTER_SECRET);
  }

  get redirectUri() {
    return `${this.config.PUBLIC_BASE_URL}/api/auth/sso/callback`;
  }
  get scimBaseUrl() {
    return `${this.config.PUBLIC_BASE_URL}/api/scim/v2`;
  }

  private async read(c: pg.PoolClient, tenantId: string): Promise<SsoConfig | null> {
    const row = (await c.query('SELECT * FROM tenant_sso_config WHERE tenant_id = $1', [tenantId])).rows[0] as SsoConfigRow | undefined;
    if (!row) return null;
    const all = (
      await c.query('SELECT domain, verified_at, verification_token FROM sso_email_domain WHERE tenant_id = $1 ORDER BY domain', [tenantId])
    ).rows;
    // Nur bestätigte Domains zählen für Weiterleitung, JIT und E-Mail-Verknüpfung (Migration 018).
    const domains = all.filter((r) => r.verified_at).map((r) => String(r.domain));
    const domainStatus = all.map((r) => ({
      domain: String(r.domain),
      verified: !!r.verified_at,
      verifiedAt: r.verified_at as Date | null,
      txtName: `${DOMAIN_TXT_PREFIX}.${r.domain}`,
      txtValue: `${DOMAIN_TXT_VALUE_PREFIX}${r.verification_token}`,
    }));
    return { ...row, domains, domainStatus };
  }

  /** Konfiguration im Systemkontext des Mandanten (Anmeldeablauf, ohne Sitzung). */
  load(tenantId: string): Promise<SsoConfig | null> {
    return this.db.txAs({ tenantId, roles: ['system'] }, (c) => this.read(c, tenantId));
  }

  settings(cfg: SsoConfig): IdpSettings {
    return {
      tenantId: cfg.tenant_id,
      issuer: cfg.issuer,
      clientId: cfg.client_id,
      clientSecret: cfg.client_secret_enc ? this.box.open(cfg.client_secret_enc, cfg.tenant_id) : null,
      version: new Date(cfg.updated_at).toISOString(),
    };
  }

  /**
   * Domain-Nachweis: TXT-Eintrag `_schulungsnachweis.<domain>` muss `schulungsnachweis-verify=<token>` enthalten.
   * Eine Domain kann nur von einer Organisation bestätigt sein.
   */
  async verifyDomain(domain: string, resolve: TxtResolver) {
    const d = domain.trim().toLowerCase();
    return this.db.tx(async (c) => {
      const row = (await c.query('SELECT verification_token, verified_at FROM sso_email_domain WHERE tenant_id = app.tenant_id() AND domain = $1', [d])).rows[0];
      if (!row) throw new NotFoundException('Domain ist nicht eingetragen');
      if (row.verified_at) return { domain: d, verified: true, verifiedAt: row.verified_at };
      const expected = `${DOMAIN_TXT_VALUE_PREFIX}${row.verification_token}`;
      let records: string[][] = [];
      try {
        records = await resolve(`${DOMAIN_TXT_PREFIX}.${d}`);
      } catch {
        records = [];
      }
      const found = records.map((parts) => parts.join('')).some((txt) => txt.trim() === expected);
      if (!found) {
        throw new BadRequestException(`Der TXT-Eintrag wurde nicht gefunden. Bitte bei ${DOMAIN_TXT_PREFIX}.${d} den Wert „${expected}“ hinterlegen (DNS-Änderungen können etwas dauern).`);
      }
      await c.query('UPDATE sso_email_domain SET verified_at = now() WHERE tenant_id = app.tenant_id() AND domain = $1', [d]).catch(
        (e: { constraint?: string }) => {
          if (e.constraint === 'sso_email_domain_verified_uq') throw new ConflictException('Die Domain ist bereits für eine andere Organisation bestätigt');
          throw e;
        },
      );
      await this.audit.record(c, { entity: 'sso_config', entityId: currentRequest()!.session!.tenantId!, action: 'domain_verified', payload: { domain: d } });
      return { domain: d, verified: true, verifiedAt: new Date() };
    });
  }

  /** Sicht für die Einstellungen (Admin). Ohne Client-Secret. */
  async forAdmin() {
    return this.db.tx(async (c) => {
      const tenantId = currentRequest()!.session!.tenantId!;
      const cfg = await this.read(c, tenantId);
      const tokens = (
        await c.query(
          `SELECT id, prefix, label, created_at, last_used_at, revoked_at FROM scim_token ORDER BY revoked_at NULLS FIRST, created_at DESC`,
        )
      ).rows;
      const key = cfg?.slug ?? tenantId;
      return {
        enabled: cfg?.enabled ?? false,
        slug: cfg?.slug ?? null,
        issuer: cfg?.issuer ?? '',
        clientId: cfg?.client_id ?? '',
        hasClientSecret: !!cfg?.client_secret_enc,
        scopes: cfg?.scopes ?? 'openid email profile',
        emailDomains: cfg?.domainStatus.map((d) => d.domain) ?? [],
        emailDomainStatus: cfg?.domainStatus ?? [],
        ssoOnly: cfg?.sso_only ?? false,
        emergencyAdminAccountId: cfg?.emergency_admin_account_id ?? null,
        jitEnabled: cfg?.jit_enabled ?? true,
        defaultRoles: cfg?.default_roles ?? ['teilnehmer'],
        updatedAt: cfg?.updated_at ?? null,
        redirectUri: this.redirectUri,
        loginUrl: `${this.config.PUBLIC_BASE_URL}/api/auth/sso/start?tenant=${encodeURIComponent(key)}`,
        scimBaseUrl: this.scimBaseUrl,
        scimTokens: tokens.map((t) => ({
          id: t.id,
          prefix: t.prefix,
          label: t.label,
          createdAt: t.created_at,
          lastUsedAt: t.last_used_at,
          revokedAt: t.revoked_at,
        })),
      };
    });
  }

  async update(i: SsoConfigInput) {
    const s = currentRequest()!.session!;
    const tenantId = s.tenantId!;
    const fields: Record<string, string> = {};
    if (i.issuer) {
      const p = this.oidc.issuerProblem(i.issuer);
      if (p) fields.issuer = p;
    }
    if (i.enabled) {
      if (!i.issuer) fields.issuer = 'Bitte den Issuer des Identitätsanbieters angeben';
      if (!i.clientId) fields.clientId = 'Bitte die Client-ID angeben';
      if (!i.emailDomains.length) fields.emailDomains = 'Mindestens eine E-Mail-Domain angeben';
    }
    if (i.ssoOnly && !i.enabled) fields.ssoOnly = '„Nur SSO“ setzt eine aktive SSO-Anmeldung voraus';
    if (i.defaultRoles.includes('admin')) fields.defaultRoles = 'Die Rolle Admin wird nicht automatisch vergeben';
    if (Object.keys(fields).length) {
      throw new BadRequestException({
        message: 'Eingaben unvollständig oder ungültig',
        fields: Object.entries(fields).map(([path, message]) => ({ path, message })),
      });
    }
    await this.db.tx(async (c) => {
      const prev = await this.read(c, tenantId);
      let emergency = i.emergencyAdminAccountId ?? (i.ssoOnly ? (prev?.emergency_admin_account_id ?? s.accountId) : null);
      if (emergency) {
        const ok = await c.query(
          `SELECT 1 FROM membership WHERE tenant_id = app.tenant_id() AND account_id = $1 AND 'admin' = ANY(roles)`,
          [emergency],
        );
        if (!ok.rowCount) {
          if (i.emergencyAdminAccountId) throw new BadRequestException('Der Notfall-Admin muss Admin dieser Organisation sein');
          emergency = null;
        }
      }
      // undefined/'' = unverändert, null = entfernen, sonst neu verschlüsseln
      let secret = prev?.client_secret_enc ?? null;
      if (i.clientSecret === null) secret = null;
      else if (i.clientSecret) secret = this.box.seal(i.clientSecret, tenantId);
      await c.query(
        `INSERT INTO tenant_sso_config (tenant_id, enabled, slug, issuer, client_id, client_secret_enc, scopes, sso_only,
                                        emergency_admin_account_id, jit_enabled, default_roles)
         VALUES (app.tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (tenant_id) DO UPDATE SET enabled = $1, slug = $2, issuer = $3, client_id = $4, client_secret_enc = $5,
           scopes = $6, sso_only = $7, emergency_admin_account_id = $8, jit_enabled = $9, default_roles = $10`,
        [i.enabled, i.slug, i.issuer, i.clientId, secret, i.scopes, i.ssoOnly, emergency, i.jitEnabled, i.defaultRoles],
      ).catch((e: { constraint?: string }) => {
        if (e.constraint === 'tenant_sso_config_slug_key') throw new ConflictException('Dieser Kurzname ist bereits vergeben');
        throw e;
      });
      // Bestehende Domains (mit ihrem Nachweis) behalten, entfernte löschen, neue unbestätigt anlegen.
      await c.query('DELETE FROM sso_email_domain WHERE tenant_id = app.tenant_id() AND NOT (domain = ANY($1::citext[]))', [i.emailDomains]);
      if (i.emailDomains.length) {
        await c.query(
          `INSERT INTO sso_email_domain (domain, tenant_id, verified_at) SELECT d, app.tenant_id(), $2::timestamptz FROM unnest($1::citext[]) d
           ON CONFLICT (domain, tenant_id) DO NOTHING`,
          [i.emailDomains, this.config.SSO_DOMAIN_VERIFICATION === 'trust' ? new Date() : null],
        ).catch((e: { constraint?: string }) => {
          if (e.constraint === 'sso_email_domain_verified_uq') {
            throw new ConflictException('Die Domain ist bereits für eine andere Organisation bestätigt');
          }
          throw e;
        });
      }
      await this.audit.record(c, {
        entity: 'sso_config',
        entityId: tenantId,
        action: prev ? 'updated' : 'created',
        payload: {
          enabled: i.enabled,
          issuer: i.issuer,
          clientId: i.clientId,
          secretChanged: i.clientSecret === null || !!i.clientSecret,
          ssoOnly: i.ssoOnly,
          emergencyAdminAccountId: emergency,
          jitEnabled: i.jitEnabled,
          defaultRoles: i.defaultRoles,
          emailDomains: i.emailDomains,
        },
      });
    });
    this.oidc.forget(tenantId);
    return this.forAdmin();
  }

  /** Neues SCIM-Token – der Klartext wird genau einmal zurückgegeben, gespeichert wird nur der Hash. */
  async createScimToken(label: string) {
    const token = `${SCIM_TOKEN_PREFIX}${randomToken(32)}`;
    const prefix = token.slice(0, 12);
    const id = await this.db.tx(async (c) => {
      const r = await c.query(
        `INSERT INTO scim_token (token_hash, prefix, label, created_by) VALUES ($1, $2, $3, app.account_id()) RETURNING id`,
        [sha256(token), prefix, label],
      );
      await this.audit.record(c, { entity: 'scim_token', entityId: r.rows[0].id, action: 'created', payload: { prefix, label } });
      return r.rows[0].id as string;
    });
    return { id, token, prefix, scimBaseUrl: this.scimBaseUrl };
  }

  async revokeScimToken(id: string) {
    await this.db.tx(async (c) => {
      const r = await c.query('UPDATE scim_token SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING prefix', [id]);
      if (!r.rowCount) throw new NotFoundException('Token nicht gefunden oder bereits widerrufen');
      await this.audit.record(c, { entity: 'scim_token', entityId: id, action: 'revoked', payload: { prefix: r.rows[0].prefix } });
    });
  }
}
