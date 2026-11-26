import { generateKeyPairSync } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { publishedTraining, registerDozent } from './fixtures';
import { startHarness, type Client, type Harness } from './harness';

/**
 * SSO gegen einen echten OpenID Provider (oidc-provider, in-process auf zufälligem Port):
 * Anmeldung (Login-Interaktion meldet den Testnutzer automatisch an, Zustimmung automatisch) und Step-up mit prompt=login.
 */
/** Ausschnitt der oidc-provider-API, den der Test nutzt (das Paket bringt keine Typen mit). */
interface OidcGrant {
  addOIDCScope(scope: string): void;
  save(): Promise<string>;
}
interface OidcProvider {
  callback(): (req: IncomingMessage, res: ServerResponse) => void;
  interactionDetails(req: IncomingMessage, res: ServerResponse): Promise<{
    prompt: { name: string };
    grantId?: string;
    session: { accountId: string };
    params: { client_id: string; scope: string };
  }>;
  interactionFinished(req: IncomingMessage, res: ServerResponse, result: object, opts: object): Promise<void>;
  Grant: { new (o: { accountId: string; clientId: string }): OidcGrant; find(id: string): Promise<OidcGrant> };
}

let h: Harness;
let dozent: Client;
let server: Server;
let issuer = '';
let logins = 0;
const CLIENT = { client_id: 'sn-test', client_secret: 'sn-test-secret-0123456789' };
const USER = { sub: 'op-user-1', email: 'olga@op.example', email_verified: true, name: 'Olga Provider' };

/** Kleiner Browser für den IdP: folgt Weiterleitungen, merkt sich Cookies, stoppt an der Redirect-URI. */
async function browse(start: string): Promise<string> {
  const jar = new Map<string, string>();
  let url = start;
  for (let i = 0; i < 15; i++) {
    if (url.startsWith('http://localhost:5173/')) return url.slice('http://localhost:5173'.length);
    const r = await fetch(url, { redirect: 'manual', headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } });
    for (const c of r.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const eq = pair!.indexOf('=');
      jar.set(pair!.slice(0, eq), pair!.slice(eq + 1));
    }
    const loc = r.headers.get('location');
    if (!loc) throw new Error(`IdP antwortet ohne Weiterleitung (${r.status}): ${(await r.text()).slice(0, 300)}`);
    url = new URL(loc, url).href;
  }
  throw new Error('Zu viele Weiterleitungen');
}

beforeAll(async () => {
  // oidc-provider ist ein reines ES-Modul ohne Typen
  const mod = 'oidc-provider';
  const { default: Provider } = (await import(mod)) as { default: new (issuer: string, cfg: object) => OidcProvider };
  server = createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const provider = new Provider(issuer, {
    clients: [{ ...CLIENT, redirect_uris: ['http://localhost:5173/api/auth/sso/callback'], token_endpoint_auth_method: 'client_secret_basic' }],
    findAccount: async (_ctx: unknown, sub: string) => ({ accountId: sub, claims: async () => ({ ...USER, sub }) }),
    claims: { openid: ['sub'], email: ['email', 'email_verified'], profile: ['name'] },
    features: { devInteractions: { enabled: false } },
    interactions: { url: (_ctx: unknown, interaction: { uid: string }) => `/interaction/${interaction.uid}` },
    cookies: { keys: ['sn-test-cookie-key'] },
    pkce: { required: () => true },
    jwks: { keys: [{ ...generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' }] },
    ttl: { Interaction: 600, Session: 3600, Grant: 3600, AccessToken: 300, IdToken: 300, AuthorizationCode: 60 },
  });
  const callback = provider.callback();
  server.on('request', async (req, res) => {
    if (!req.url?.startsWith('/interaction/')) return callback(req, res);
    try {
      const details = await provider.interactionDetails(req, res);
      if (details.prompt.name === 'login') {
        logins++;
        await provider.interactionFinished(req, res, { login: { accountId: USER.sub } }, { mergeWithLastSubmission: false });
      } else {
        const grant = details.grantId
          ? await provider.Grant.find(details.grantId)
          : new provider.Grant({ accountId: details.session.accountId, clientId: details.params.client_id });
        grant.addOIDCScope(details.params.scope);
        await provider.interactionFinished(req, res, { consent: { grantId: await grant.save() } }, { mergeWithLastSubmission: true });
      }
    } catch (e) {
      res.statusCode = 500;
      res.end(String(e));
    }
  });
  h = await startHarness([], { SSO_DOMAIN_VERIFICATION: 'trust' });
  dozent = await registerDozent(h);
  const r = await dozent.http
    .put('/api/tenant/sso')
    .set('x-csrf-token', (dozent as unknown as { csrf: string }).csrf)
    .send({
      enabled: true,
      slug: 'op-test',
      issuer,
      clientId: CLIENT.client_id,
      clientSecret: CLIENT.client_secret,
      emailDomains: ['op.example'],
      jitEnabled: true,
      defaultRoles: ['teilnehmer', 'trainer'],
    });
  expect(r.status).toBe(200);
});

afterAll(async () => {
  await h?.close();
  await new Promise((r) => server?.close(r));
});

describe('SSO mit oidc-provider', () => {
  let c: Client;
  it('Anmeldung: JIT-Konto (E-Mail über UserInfo), Mitgliedschaft, Sitzung', async () => {
    c = await h.agent();
    const start = await c.get('/api/auth/sso/start?tenant=op-test');
    expect(start.status).toBe(302);
    const cb = await c.get(await browse(start.headers.location!));
    expect(cb.headers.location).toBe('http://localhost:5173/anmelden/sso');
    const me = await c.get('/api/auth/me');
    expect(me.body.account).toMatchObject({ email: 'olga@op.example', name: 'Olga Provider' });
    expect(me.body.roles.sort()).toEqual(['teilnehmer', 'trainer']);
    expect(logins).toBe(1);
  });

  it('Step-up: erneute Anmeldung trotz IdP-Sitzung (prompt=login), Ticket → Methode „sso“', async () => {
    // Einladung für die Person mit Olgas E-Mail → Person wird bei der nächsten SSO-Anmeldung verknüpft
    const { trainingId } = await publishedTraining(dozent, { wordsPerPage: [20] });
    const run = (await dozent.post('/api/runs', { trainingId })).body.id;
    const personId = (await dozent.post('/api/persons', { name: 'Olga Provider', email: 'olga@op.example' })).body.id;
    await dozent.post(`/api/runs/${run}/invite`, { personIds: [personId] });
    const invitationId = (await h.db.admin.query('SELECT id FROM invitation WHERE person_id = $1', [personId])).rows[0].id;
    const again = await c.get('/api/auth/sso/start?tenant=op-test');
    await c.get(await browse(again.headers.location!));
    const before = logins;
    const s = await c.get(`/api/auth/sso/step-up/start?purpose=signature:${invitationId}`);
    expect(new URL(s.headers.location!).searchParams.get('prompt')).toBe('login');
    const back = (await c.get(await browse(s.headers.location!))).headers.location as string;
    expect(logins).toBe(before + 1);
    const ticket = /#sso=([\w-]+)$/.exec(back)?.[1];
    expect(ticket, back).toBeTruthy();
    const r = await c.post(`/api/me/invitations/${invitationId}/step-up`, { ssoTicket: ticket });
    expect(r.status).toBe(200);
    expect(r.body.method).toBe('sso');
  });
});
