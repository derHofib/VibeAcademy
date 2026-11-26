import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOMAIN_TXT_RESOLVER } from '../src/sso/sso-config.service';
import { FakeIdp } from './fake-idp';
import { DOZENT, registerDozent } from './fixtures';
import { startHarness, type Client, type Harness } from './harness';

/** Domain-Nachweis per DNS-TXT (Migration 018): ohne Nachweis keine Weiterleitung, kein JIT, keine E-Mail-Verknüpfung. */
const txt = new Map<string, string[][]>();
const resolver = async (name: string) => {
  const r = txt.get(name);
  if (!r) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
  return r;
};

let h: Harness;
let idp: FakeIdp;
let a: Client;
let b: Client;

const put = (c: Client, body: object) =>
  c.http.put('/api/tenant/sso').set('x-csrf-token', (c as unknown as { csrf: string }).csrf).send(body);
const config = (slug: string) => ({
  enabled: true, slug, issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret,
  scopes: 'openid email profile', emailDomains: ['firma.example'], ssoOnly: false, jitEnabled: true, defaultRoles: ['teilnehmer'],
});

beforeAll(async () => {
  idp = await FakeIdp.start();
  h = await startHarness([{ provide: DOMAIN_TXT_RESOLVER, useValue: resolver }]);
  a = await registerDozent(h);
  b = await registerDozent(h, { ...DOZENT, email: 'angreifer@example.org', organisation: 'Fremde GmbH' });
});
afterAll(async () => {
  await h?.close();
  await idp?.close();
});

describe('Domain-Nachweis für SSO', () => {
  it('eingetragene, aber unbestätigte Domain wirkt nicht', async () => {
    expect((await put(a, config('firma'))).status).toBe(200);
    const s = (await a.get('/api/tenant/sso')).body;
    expect(s.emailDomainStatus).toEqual([
      expect.objectContaining({ domain: 'firma.example', verified: false, txtName: '_schulungsnachweis.firma.example', txtValue: expect.stringMatching(/^schulungsnachweis-verify=[0-9a-f]{32}$/) }),
    ]);
    const anon = await h.agent();
    expect((await anon.get('/api/auth/sso/discover?email=max@firma.example')).body).toEqual({ sso: false });
  });

  it('eine fremde Organisation kann die Domain beanspruchen, aber nichts blockieren', async () => {
    expect((await put(b, config('fremd'))).status).toBe(200);
    const anon = await h.agent();
    expect((await anon.get('/api/auth/sso/discover?email=max@firma.example')).body).toEqual({ sso: false });
  });

  it('ohne passenden TXT-Eintrag keine Bestätigung', async () => {
    txt.set('_schulungsnachweis.firma.example', [['schulungsnachweis-verify=falsch']]);
    const r = await a.post('/api/tenant/sso/domains/firma.example/verify');
    expect(r.status).toBe(400);
    expect(r.body.message).toContain('_schulungsnachweis.firma.example');
  });

  it('mit TXT-Eintrag bestätigt; danach Weiterleitung aktiv; zweite Organisation kann nicht mehr bestätigen', async () => {
    const mine = (await a.get('/api/tenant/sso')).body.emailDomainStatus[0].txtValue as string;
    const theirs = (await b.get('/api/tenant/sso')).body.emailDomainStatus[0].txtValue as string;
    expect(theirs).not.toBe(mine);
    txt.set('_schulungsnachweis.firma.example', [['v=spf1 -all'], [mine.slice(0, 20), mine.slice(20)]]);
    const ok = await a.post('/api/tenant/sso/domains/firma.example/verify');
    expect(ok.status).toBe(200);
    expect(ok.body.verified).toBe(true);
    const anon = await h.agent();
    expect((await anon.get('/api/auth/sso/discover?email=max@firma.example')).body).toMatchObject({ sso: true, tenantName: DOZENT.organisation });
    // Selbst mit eigenem TXT-Eintrag kann die zweite Organisation sie nicht übernehmen
    txt.set('_schulungsnachweis.firma.example', [[mine], [theirs]]);
    expect((await b.post('/api/tenant/sso/domains/firma.example/verify')).status).toBe(409);
    // Speichern der Konfiguration behält den Nachweis
    expect((await put(a, config('firma'))).status).toBe(200);
    expect((await a.get('/api/tenant/sso')).body.emailDomainStatus[0].verified).toBe(true);
  });

  it('nur Admins dürfen bestätigen; unbekannte Domain → 404', async () => {
    expect((await a.post('/api/tenant/sso/domains/unbekannt.example/verify')).status).toBe(404);
    const anon = await h.agent();
    expect([401, 403]).toContain((await anon.post('/api/tenant/sso/domains/firma.example/verify')).status);
  });
});
