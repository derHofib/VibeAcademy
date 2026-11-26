import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StepUpService } from '../src/auth/step-up.service';
import { FakeIdp } from './fake-idp';
import { DOZENT, publishedTraining, registerDozent } from './fixtures';
import { startHarness, waitFor, type Client, type Harness } from './harness';

/** SSO (E-36): Anmeldung per OIDC je Mandant, Verknüpfung, JIT, „nur SSO“, Step-up per erneuter IdP-Anmeldung. */
let h: Harness;
let idp: FakeIdp;
let dozent: Client;
const SLUG = 'muster-elektro';

const put = (c: Client, url: string, body: object) =>
  c.http.put(url).set('x-csrf-token', (c as unknown as { csrf: string }).csrf).send(body);

const baseConfig = () => ({
  enabled: true,
  slug: SLUG,
  issuer: idp.issuer,
  clientId: idp.clientId,
  clientSecret: idp.clientSecret,
  scopes: 'openid email profile',
  emailDomains: ['firma.example'],
  ssoOnly: false,
  jitEnabled: true,
  defaultRoles: ['teilnehmer'],
});

/** IdP-Weiterleitung „im Browser“ folgen: liefert den Pfad des Callbacks (Redirect-URI zeigt auf PUBLIC_BASE_URL). */
async function viaIdp(location: string): Promise<string> {
  expect(location.startsWith(idp.issuer)).toBe(true);
  const r = await fetch(location, { redirect: 'manual' });
  expect(r.status).toBe(302);
  const u = new URL(r.headers.get('location')!);
  expect(u.origin).toBe('http://localhost:5173');
  return u.pathname + u.search;
}

async function ssoLogin(c: Client, start = `/api/auth/sso/start?tenant=${SLUG}`): Promise<string> {
  const s = await c.get(start);
  expect(s.status).toBe(302);
  const cb = await c.get(await viaIdp(s.headers.location!));
  expect(cb.status).toBe(302);
  return cb.headers.location as string;
}

beforeAll(async () => {
  idp = await FakeIdp.start();
  h = await startHarness([], { SSO_DOMAIN_VERIFICATION: 'trust' });
  dozent = await registerDozent(h);
});
afterAll(async () => {
  await h?.close();
  await idp?.close();
});

describe('Einstellungen (Admin)', () => {
  it('Standardwerte ohne Konfiguration, Redirect- und SCIM-URL', async () => {
    const r = await dozent.get('/api/tenant/sso');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ enabled: false, hasClientSecret: false, jitEnabled: true, defaultRoles: ['teilnehmer'] });
    expect(r.body.redirectUri).toBe('http://localhost:5173/api/auth/sso/callback');
    expect(r.body.scimBaseUrl).toBe('http://localhost:5173/api/scim/v2');
  });

  it('Pflichtfelder bei Aktivierung, Admin-Rolle nicht als Standardrolle', async () => {
    const r = await put(dozent, '/api/tenant/sso', { ...baseConfig(), issuer: '', emailDomains: [], defaultRoles: ['admin'] });
    expect(r.status).toBe(400);
    const paths = (r.body.fields as Array<{ path: string }>).map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(['issuer', 'emailDomains', 'defaultRoles']));
  });

  it('speichert die Konfiguration, das Client-Secret nur verschlüsselt und gibt es nie zurück', async () => {
    const r = await put(dozent, '/api/tenant/sso', { ...baseConfig(), emailDomains: ['@Firma.example'] });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ enabled: true, slug: SLUG, hasClientSecret: true, emailDomains: ['firma.example'] });
    expect(JSON.stringify(r.body)).not.toContain(idp.clientSecret);
    const row = (await h.db.admin.query('SELECT client_secret_enc FROM tenant_sso_config')).rows[0];
    expect(row.client_secret_enc).toMatch(/^v1:/);
    expect(row.client_secret_enc).not.toContain(idp.clientSecret);
    // Secret weglassen = unverändert
    const again = await put(dozent, '/api/tenant/sso', { ...baseConfig(), clientSecret: undefined });
    expect(again.body.hasClientSecret).toBe(true);
    expect((await h.db.admin.query('SELECT client_secret_enc FROM tenant_sso_config')).rows[0].client_secret_enc).toBe(row.client_secret_enc);
  });

  it('Verbindungstest per Discovery', async () => {
    const ok = await dozent.post('/api/tenant/sso/test', {});
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, issuer: idp.issuer, tokenEndpoint: `${idp.issuer}/token` });
    const bad = await dozent.post('/api/tenant/sso/test', { issuer: 'http://127.0.0.1:1/nix' });
    expect(bad.body.ok).toBe(false);
  });

  it('eine Domain ist höchstens für eine Organisation bestätigt', async () => {
    const other = await registerDozent(h, { ...DOZENT, email: 'zweite@example.org', organisation: 'Zweite GmbH' });
    const r = await put(other, '/api/tenant/sso', { ...baseConfig(), slug: 'zweite' });
    expect(r.status).toBe(409);
    expect(r.body.message).toContain('andere Organisation');
  });

  it('nur Admins', async () => {
    const anon = await h.agent();
    expect((await anon.get('/api/tenant/sso')).status).toBe(401);
  });
});

describe('Anmeldung per SSO', () => {
  it('E-Mail-Domain-Erkennung auf der Anmeldeseite', async () => {
    const c = await h.agent();
    const hit = await c.get('/api/auth/sso/discover?email=Max@Firma.example');
    expect(hit.body).toMatchObject({ sso: true, tenantName: DOZENT.organisation, ssoOnly: false });
    expect((await c.get('/api/auth/sso/discover?email=a@unbekannt.example')).body).toEqual({ sso: false });
  });

  it('JIT: legt Konto und Mitgliedschaft mit Standardrollen an und meldet im Mandanten an', async () => {
    idp.user = { sub: 'jit-1', email: 'jana.jit@firma.example', email_verified: true, name: 'Jana Jit' };
    const c = await h.agent();
    const s = await c.get(`/api/auth/sso/start?tenant=${SLUG}&weiter=/konto`);
    expect(String(s.headers['set-cookie'])).toContain('sn_sso=');
    const auth = new URL(s.headers.location!);
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
    expect(auth.searchParams.get('nonce')).toBeTruthy();
    expect(auth.searchParams.get('redirect_uri')).toBe('http://localhost:5173/api/auth/sso/callback');
    const cb = await c.get(await viaIdp(s.headers.location!));
    expect(cb.headers.location).toBe('http://localhost:5173/anmelden/sso?weiter=%2Fkonto');
    const me = await c.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.account).toMatchObject({ email: 'jana.jit@firma.example', name: 'Jana Jit', emailVerified: true });
    expect(me.body.roles).toEqual(['teilnehmer']);
    expect(me.body.memberships).toHaveLength(1);
    const ident = (await h.db.admin.query("SELECT * FROM account_identity WHERE subject = 'jit-1'")).rows;
    expect(ident).toHaveLength(1);
    expect(ident[0]).toMatchObject({ issuer: idp.issuer, linked_via: 'jit' });
    const audit = (await h.db.admin.query("SELECT action, payload FROM audit_event WHERE entity_id = $1 ORDER BY seq", [me.body.account.id])).rows;
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['sso_identity_linked', 'added', 'login']));
    // zweite Anmeldung: gleiches Konto, keine neue Identität
    const c2 = await h.agent();
    await ssoLogin(c2);
    expect((await c2.get('/api/auth/me')).body.account.id).toBe(me.body.account.id);
    expect((await h.db.admin.query("SELECT count(*)::int AS n FROM account_identity WHERE subject = 'jit-1'")).rows[0].n).toBe(1);
  });

  it('Start per E-Mail-Adresse', async () => {
    idp.user = { sub: 'jit-1', email: 'jana.jit@firma.example', email_verified: true, name: 'Jana Jit' };
    const c = await h.agent();
    expect(await ssoLogin(c, '/api/auth/sso/start?email=jana.jit@firma.example')).toBe('http://localhost:5173/anmelden/sso');
    expect((await c.get('/api/auth/me')).status).toBe(200);
  });

  it.each([
    ['fremder Issuer', { claims: { iss: 'https://evil.example' } }],
    ['falsche Audience', { claims: { aud: 'anderer-client' } }],
    ['falscher nonce', { claims: { nonce: 'manipuliert' } }],
    ['fremder Signaturschlüssel', { foreignKey: true }],
    ['abgelaufenes Token', { claims: { exp: Math.floor(Date.now() / 1000) - 600, iat: Math.floor(Date.now() / 1000) - 900 } }],
  ])('lehnt ab: %s', async (_, next) => {
    idp.user = { sub: 'bad-1', email: 'boese@firma.example', email_verified: true };
    idp.next = next;
    const c = await h.agent();
    expect(await ssoLogin(c)).toBe('http://localhost:5173/anmelden/sso?fehler=token_invalid');
    expect((await c.get('/api/auth/me')).status).toBe(401);
    expect((await h.db.admin.query("SELECT count(*)::int AS n FROM account WHERE email = 'boese@firma.example'")).rows[0].n).toBe(0);
  });

  it('state nur einmal und nur im selben Browser (Login-CSRF)', async () => {
    idp.user = { sub: 'jit-1', email: 'jana.jit@firma.example', email_verified: true };
    const a = await h.agent();
    const s = await a.get(`/api/auth/sso/start?tenant=${SLUG}`);
    const cb = await viaIdp(s.headers.location!);
    const victim = await h.agent();
    expect((await victim.get(cb)).headers.location).toBe('http://localhost:5173/anmelden/sso?fehler=state_invalid');
    // state ist verbraucht
    expect((await a.get(cb)).headers.location).toBe('http://localhost:5173/anmelden/sso?fehler=state_invalid');
  });

  it('Fehler des IdP und unbekannter Mandant', async () => {
    idp.next = { error: 'access_denied' };
    expect(await ssoLogin(await h.agent())).toBe('http://localhost:5173/anmelden/sso?fehler=idp_error');
    const r = await (await h.agent()).get('/api/auth/sso/start?tenant=gibt-es-nicht');
    expect(r.headers.location).toBe('http://localhost:5173/anmelden/sso?fehler=unknown_tenant');
  });

  it('verknüpft ein bestehendes Konto über die bestätigte E-Mail', async () => {
    const own = await h.agent();
    await own.post('/api/auth/register-account', { name: 'Lea Link', email: 'lea@firma.example', password: 'passwort-lea-123' });
    const accountId = (await own.get('/api/auth/me')).body.account.id;
    // unbestätigte E-Mail → keine Verknüpfung
    idp.user = { sub: 'lea-sub', email: 'lea@firma.example', email_verified: false };
    expect(await ssoLogin(await h.agent())).toBe('http://localhost:5173/anmelden/sso?fehler=email_unverified');
    idp.user = { sub: 'lea-sub', email: 'lea@firma.example', email_verified: true, name: 'Lea L.' };
    const c = await h.agent();
    await ssoLogin(c);
    const me = (await c.get('/api/auth/me')).body;
    expect(me.account.id).toBe(accountId);
    expect(me.account.emailVerified).toBe(true);
    expect(me.roles).toEqual(['teilnehmer']);
    expect((await h.db.admin.query("SELECT linked_via FROM account_identity WHERE subject = 'lea-sub'")).rows[0].linked_via).toBe('email');
  });

  it('fremde Domain und JIT aus', async () => {
    idp.user = { sub: 'x-1', email: 'x@andere.example', email_verified: true };
    expect(await ssoLogin(await h.agent())).toBe('http://localhost:5173/anmelden/sso?fehler=domain_not_allowed');
    await put(dozent, '/api/tenant/sso', { ...baseConfig(), jitEnabled: false });
    idp.user = { sub: 'neu-1', email: 'neu@firma.example', email_verified: true };
    expect(await ssoLogin(await h.agent())).toBe('http://localhost:5173/anmelden/sso?fehler=no_account');
    await put(dozent, '/api/tenant/sso', baseConfig());
  });
});

describe('„Nur SSO“', () => {
  it('sperrt die Passwort-Anmeldung für Mitglieder, nicht für den Notfall-Admin', async () => {
    const r = await put(dozent, '/api/tenant/sso', { ...baseConfig(), ssoOnly: true });
    expect(r.status).toBe(200);
    const dozentId = (await dozent.get('/api/auth/me')).body.account.id;
    expect(r.body.emergencyAdminAccountId).toBe(dozentId);
    // Lea ist (per JIT) Mitglied und hat ein Passwort
    const lea = await h.agent();
    const blocked = await lea.post('/api/auth/login', { email: 'lea@firma.example', password: 'passwort-lea-123' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('SSO_REQUIRED');
    // falsches Passwort → wie immer 401 (keine Auskunft über SSO-Pflicht)
    expect((await lea.post('/api/auth/login', { email: 'lea@firma.example', password: 'falsch-falsch-1' })).status).toBe(401);
    // Notfall-Admin
    expect((await (await h.agent()).post('/api/auth/login', { email: DOZENT.email, password: DOZENT.password })).status).toBe(200);
    // eingeladene Kollegen können kein Passwort setzen (Link bleibt gültig, falls „nur SSO“ wieder abgeschaltet wird)
    await dozent.post('/api/tenant/members', { email: 'kollegin@firma.example', name: 'Kim Kollegin', roles: ['trainer'] });
    const mail = await waitFor(async () => (await dozent.get('/api/dev/postausgang?an=kollegin@firma.example')).body[0]);
    const pwToken = /#token=([A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
    const setPw = await (await h.agent()).post('/api/auth/password/set', { token: pwToken, password: 'kollegin-passwort-1' });
    expect(setPw.status).toBe(403);
    expect(setPw.body.code).toBe('SSO_REQUIRED');
    // per SSO weiterhin möglich
    idp.user = { sub: 'lea-sub', email: 'lea@firma.example', email_verified: true };
    await ssoLogin(lea);
    expect((await lea.get('/api/auth/me')).status).toBe(200);
    await put(dozent, '/api/tenant/sso', baseConfig());
    expect((await (await h.agent()).post('/api/auth/login', { email: 'lea@firma.example', password: 'passwort-lea-123' })).status).toBe(200);
  });
});

describe('Step-up per SSO vor der Unterschrift', () => {
  let invitationId: string;
  let personId: string;
  let lea: Client;

  beforeAll(async () => {
    const { trainingId } = await publishedTraining(dozent, { wordsPerPage: [20] });
    const run = (await dozent.post('/api/runs', { trainingId })).body.id as string;
    personId = (await dozent.post('/api/persons', { name: 'Lea Link', email: 'lea@firma.example' })).body.id as string;
    await dozent.post(`/api/runs/${run}/invite`, { personIds: [personId] });
    invitationId = (await h.db.admin.query('SELECT id FROM invitation WHERE person_id = $1', [personId])).rows[0].id;
    // SSO-Anmeldung verknüpft die Person des Mandanten mit dem Konto (bestätigte E-Mail)
    idp.user = { sub: 'lea-sub', email: 'lea@firma.example', email_verified: true };
    lea = await h.agent();
    await ssoLogin(lea);
    expect((await lea.get('/api/me/invitations')).body.map((i: { invitation_id: string }) => i.invitation_id)).toContain(invitationId);
  });

  const stepUp = async (c: Client) => {
    const s = await c.get(`/api/auth/sso/step-up/start?purpose=signature:${invitationId}`);
    expect(s.status).toBe(302);
    return (await c.get(await viaIdp(s.headers.location!))).headers.location as string;
  };

  it('bietet SSO an, IdP mit prompt=login und max_age=0, Token mit Methode „sso“', async () => {
    const o = await lea.get(`/api/auth/sso/step-up/options?invitationId=${invitationId}`);
    expect(o.body).toMatchObject({ sso: true, required: false, startUrl: `/api/auth/sso/step-up/start?purpose=signature:${invitationId}` });
    const back = await stepUp(lea);
    expect(idp.lastAuthorize?.get('prompt')).toBe('login');
    expect(idp.lastAuthorize?.get('max_age')).toBe('0');
    expect(idp.lastAuthorize?.get('login_hint')).toBe('lea@firma.example');
    const m = new RegExp(`^http://localhost:5173/teilnahme/${invitationId}/abschluss#sso=([\\w-]+)$`).exec(back);
    expect(m).toBeTruthy();
    const r = await lea.post(`/api/me/invitations/${invitationId}/step-up`, { ssoTicket: m![1] });
    expect(r.status).toBe(200);
    expect(r.body.method).toBe('sso');
    const method = await h.app.get(StepUpService).consume(r.body.stepUpToken, { subject: `person:${personId}`, purpose: `signature:${invitationId}` });
    expect(method).toBe('sso');
    // Ticket nur einmal
    expect((await lea.post(`/api/me/invitations/${invitationId}/step-up`, { ssoTicket: m![1] })).status).toBe(401);
  });

  it('lehnt eine zu alte Anmeldung (auth_time) ab', async () => {
    idp.authTimeOffset = -600;
    try {
      expect(await stepUp(lea)).toBe(`http://localhost:5173/teilnahme/${invitationId}/abschluss#sso-fehler=reauth_required`);
    } finally {
      idp.authTimeOffset = 0;
    }
  });

  it('lehnt ein anderes IdP-Subjekt ab', async () => {
    idp.user = { sub: 'jemand-anderes', email: 'lea@firma.example', email_verified: true };
    expect(await stepUp(lea)).toBe(`http://localhost:5173/teilnahme/${invitationId}/abschluss#sso-fehler=subject_mismatch`);
    idp.user = { sub: 'lea-sub', email: 'lea@firma.example', email_verified: true };
  });

  it('ohne Konto-Sitzung kein SSO-Step-up', async () => {
    const anon = await h.agent();
    const r = await anon.get(`/api/auth/sso/step-up/start?purpose=signature:${invitationId}`);
    expect(r.headers.location).toBe(`http://localhost:5173/teilnahme/${invitationId}/abschluss#sso-fehler=login_required`);
  });

  it('„nur SSO“: Passwort-Step-up gesperrt, SSO verlangt', async () => {
    await put(dozent, '/api/tenant/sso', { ...baseConfig(), ssoOnly: true });
    try {
      expect((await lea.get(`/api/auth/sso/step-up/options?invitationId=${invitationId}`)).body).toMatchObject({ sso: true, required: true });
      const r = await lea.post(`/api/me/invitations/${invitationId}/step-up`, { password: 'passwort-lea-123' });
      expect(r.status).toBe(401);
      expect(r.body.message).toContain('Firmenkonto');
    } finally {
      await put(dozent, '/api/tenant/sso', baseConfig());
    }
  });
});
