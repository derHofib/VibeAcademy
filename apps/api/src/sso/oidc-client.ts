import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config';

// openid-client ist ein reines ES-Modul → dynamisch laden (API läuft als CommonJS), siehe trainings/pdf-analysis.ts.
export type OidcLib = typeof import('openid-client', { with: { 'resolution-mode': 'import' } });
export type OidcConfiguration = InstanceType<OidcLib['Configuration']>;
let libPromise: Promise<OidcLib> | null = null;
export const loadOidc = () => (libPromise ??= import('openid-client'));

export interface IdpSettings {
  tenantId: string;
  issuer: string;
  clientId: string;
  clientSecret: string | null;
  /** Änderungsstand der Konfiguration (Cache-Schlüssel) */
  version: string;
}

export interface DiscoveryResult {
  issuer: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  jwksUri?: string;
  scopesSupported?: string[];
  codeChallengeMethods?: string[];
}

const CACHE_MS = 10 * 60 * 1000;

/**
 * OIDC-Client je Mandant (Discovery + JWKS über openid-client, Ergebnis 10 min im Speicher).
 * ID-Token-Signaturen werden immer gegen die JWKS des IdP geprüft (enableNonRepudiationChecks).
 */
@Injectable()
export class OidcClients {
  private readonly cache = new Map<string, { version: string; at: number; cfg: Promise<OidcConfiguration> }>();
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** http-Issuer nur außerhalb der Produktion: in Tests immer, in der Entwicklung per SSO_ALLOW_HTTP_ISSUER. */
  get allowHttp(): boolean {
    if (this.config.NODE_ENV === 'production') return false;
    return this.config.NODE_ENV === 'test' || this.config.SSO_ALLOW_HTTP_ISSUER;
  }

  /** Issuer-URL prüfen (https, ohne Query/Fragment). Liefert eine Fehlermeldung oder null. */
  issuerProblem(issuer: string): string | null {
    let u: URL;
    try {
      u = new URL(issuer);
    } catch {
      return 'Bitte eine gültige Issuer-URL angeben';
    }
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && this.allowHttp)) return 'Der Issuer muss eine https-Adresse sein';
    if (u.search || u.hash || u.username || u.password) return 'Der Issuer darf keine Parameter enthalten';
    return null;
  }

  async get(s: IdpSettings): Promise<OidcConfiguration> {
    const hit = this.cache.get(s.tenantId);
    if (hit && hit.version === s.version && Date.now() - hit.at < CACHE_MS) return hit.cfg;
    const cfg = this.create(s);
    this.cache.set(s.tenantId, { version: s.version, at: Date.now(), cfg });
    cfg.catch(() => this.cache.delete(s.tenantId));
    return cfg;
  }

  forget(tenantId: string) {
    this.cache.delete(tenantId);
  }

  /** Verbindungstest: nur Discovery (Metadaten des IdP), ohne Client-Anmeldung. */
  async discover(issuer: string): Promise<DiscoveryResult> {
    const lib = await loadOidc();
    const cfg = await lib.discovery(new URL(issuer), 'verbindungstest', undefined, lib.None(), {
      execute: this.allowHttp ? [lib.allowInsecureRequests] : [],
      timeout: 10,
    });
    const m = cfg.serverMetadata();
    return {
      issuer: m.issuer,
      authorizationEndpoint: m.authorization_endpoint,
      tokenEndpoint: m.token_endpoint,
      jwksUri: m.jwks_uri,
      scopesSupported: m.scopes_supported,
      codeChallengeMethods: m.code_challenge_methods_supported,
    };
  }

  private async create(s: IdpSettings): Promise<OidcConfiguration> {
    const lib = await loadOidc();
    const execute = this.allowHttp ? [lib.allowInsecureRequests] : [];
    // Discovery prüft, dass der Issuer in den Metadaten exakt der konfigurierte ist.
    const probe = await lib.discovery(new URL(s.issuer), s.clientId, undefined, lib.None(), { execute, timeout: 10 });
    const meta = probe.serverMetadata();
    const algs = meta.id_token_signing_alg_values_supported ?? ['RS256'];
    const clientMeta = {
      client_id: s.clientId,
      id_token_signed_response_alg: algs.includes('RS256') ? 'RS256' : algs.find((a) => a !== 'none'),
    };
    const methods = meta.token_endpoint_auth_methods_supported ?? ['client_secret_basic'];
    const auth = !s.clientSecret
      ? lib.None()
      : methods.includes('client_secret_basic')
        ? lib.ClientSecretBasic(s.clientSecret)
        : lib.ClientSecretPost(s.clientSecret);
    const cfg = new lib.Configuration(meta, s.clientId, clientMeta, auth);
    lib.enableNonRepudiationChecks(cfg);
    for (const fn of execute) fn(cfg);
    cfg.timeout = 10;
    return cfg;
  }
}
