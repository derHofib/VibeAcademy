import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Minimaler OIDC-Issuer für Tests (E-36): Discovery, JWKS, Authorize (meldet sofort an), Token-Endpunkt mit PKCE-Prüfung,
 * RS256-signierte ID-Tokens. Über `next` lassen sich einzelne Claims der nächsten Antwort verfälschen (falscher Issuer,
 * falsche Audience, falscher nonce, alte auth_time, fremder Schlüssel).
 */
export interface FakeUser {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

export interface NextOverrides {
  claims?: Record<string, unknown>;
  /** mit einem nicht veröffentlichten Schlüssel signieren */
  foreignKey?: boolean;
  /** Fehler an der Authorize-Antwort (z. B. access_denied) */
  error?: string;
}

export class FakeIdp {
  readonly clientId = 'schulungsnachweis';
  readonly clientSecret = `geheim-${randomBytes(8).toString('hex')}`;
  user: FakeUser = { sub: 'u-1', email: 'max@firma.example', email_verified: true, name: 'Max Muster' };
  next: NextOverrides = {};
  /** Parameter der letzten Authorize-Anfrage (prompt, max_age, login_hint …) */
  lastAuthorize: URLSearchParams | null = null;
  /** auth_time-Verschiebung in Sekunden für alle folgenden Tokens (negativ = früher angemeldet) */
  authTimeOffset = 0;
  private readonly kid = randomBytes(6).toString('hex');
  private readonly key = generateKeyPairSync('rsa', { modulusLength: 2048 });
  private readonly foreign = generateKeyPairSync('rsa', { modulusLength: 2048 });
  private readonly codes = new Map<string, { params: URLSearchParams; user: FakeUser; next: NextOverrides; authTime: number }>();
  private server!: Server;
  issuer = '';

  static async start(port = 0): Promise<FakeIdp> {
    const idp = new FakeIdp();
    idp.server = createServer((req, res) => {
      idp.handle(req).then(
        (r) => {
          res.writeHead(r.status, r.headers);
          res.end(r.body ?? '');
        },
        (e: Error) => {
          res.writeHead(500);
          res.end(e.message);
        },
      );
    });
    await new Promise<void>((resolve) => idp.server.listen(port, '127.0.0.1', resolve));
    idp.issuer = `http://127.0.0.1:${(idp.server.address() as AddressInfo).port}`;
    return idp;
  }

  close() {
    return new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private json(body: unknown, status = 200) {
    return { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(body) };
  }

  private async handle(req: IncomingMessage): Promise<{ status: number; headers: Record<string, string>; body?: string }> {
    const url = new URL(req.url ?? '/', this.issuer);
    if (url.pathname === '/.well-known/openid-configuration') {
      return this.json({
        issuer: this.issuer,
        authorization_endpoint: `${this.issuer}/authorize`,
        token_endpoint: `${this.issuer}/token`,
        jwks_uri: `${this.issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        scopes_supported: ['openid', 'email', 'profile'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
        code_challenge_methods_supported: ['S256'],
        claims_supported: ['sub', 'email', 'email_verified', 'name', 'auth_time'],
      });
    }
    if (url.pathname === '/jwks') {
      const jwk = this.key.publicKey.export({ format: 'jwk' });
      return this.json({ keys: [{ ...jwk, kid: this.kid, use: 'sig', alg: 'RS256' }] });
    }
    if (url.pathname === '/authorize') {
      const p = url.searchParams;
      this.lastAuthorize = p;
      const redirect = new URL(p.get('redirect_uri')!);
      const next = this.next;
      this.next = {};
      if (next.error) {
        redirect.searchParams.set('error', next.error);
      } else {
        if (p.get('client_id') !== this.clientId || p.get('code_challenge_method') !== 'S256' || !p.get('code_challenge')) {
          return this.json({ error: 'invalid_request' }, 400);
        }
        const code = randomBytes(16).toString('hex');
        this.codes.set(code, { params: p, user: { ...this.user }, next, authTime: Math.floor(Date.now() / 1000) + this.authTimeOffset });
        redirect.searchParams.set('code', code);
      }
      if (p.get('state')) redirect.searchParams.set('state', p.get('state')!);
      return { status: 302, headers: { location: redirect.href } };
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      const body = new URLSearchParams(await readBody(req));
      let clientId = body.get('client_id');
      let secret = body.get('client_secret');
      const basic = /^Basic (.+)$/.exec(req.headers.authorization ?? '');
      if (basic) {
        const [id, s] = Buffer.from(basic[1]!, 'base64').toString().split(':').map(decodeURIComponent);
        clientId = id ?? null;
        secret = s ?? null;
      }
      if (clientId !== this.clientId || secret !== this.clientSecret) return this.json({ error: 'invalid_client' }, 401);
      const entry = this.codes.get(body.get('code') ?? '');
      this.codes.delete(body.get('code') ?? '');
      if (!entry) return this.json({ error: 'invalid_grant' }, 400);
      const challenge = createHash('sha256').update(body.get('code_verifier') ?? '').digest('base64url');
      if (challenge !== entry.params.get('code_challenge') || body.get('redirect_uri') !== entry.params.get('redirect_uri')) {
        return this.json({ error: 'invalid_grant', error_description: 'PKCE/redirect_uri' }, 400);
      }
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        iss: this.issuer,
        aud: this.clientId,
        sub: entry.user.sub,
        iat: now,
        exp: now + 300,
        auth_time: entry.authTime,
        nonce: entry.params.get('nonce') ?? undefined,
        email: entry.user.email,
        email_verified: entry.user.email_verified,
        name: entry.user.name,
        ...entry.next.claims,
      };
      const idToken = this.sign(claims, entry.next.foreignKey ? this.foreign.privateKey : this.key.privateKey);
      return this.json({ access_token: randomBytes(16).toString('hex'), token_type: 'Bearer', expires_in: 300, id_token: idToken });
    }
    return this.json({ error: 'not_found' }, 404);
  }

  private sign(claims: Record<string, unknown>, key: KeyObject) {
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const input = `${enc({ alg: 'RS256', typ: 'JWT', kid: this.kid })}.${enc(claims)}`;
    return `${input}.${sign('sha256', Buffer.from(input), key).toString('base64url')}`;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}
