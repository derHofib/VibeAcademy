import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StepUpService } from '../src/auth/step-up.service';
import { startHarness, waitFor, type Client, type Harness } from './harness';

let h: Harness;
let dozent: Client;

const DOZENT = { name: 'Dennis Hofmann', organisation: 'Muster Elektro GmbH', email: 'dozent@example.org', password: 'sehr-geheim-123' };

beforeAll(async () => {
  h = await startHarness();
  dozent = await h.agent();
});
afterAll(async () => h?.close());

describe('Registrierung und Anmeldung', () => {
  it('Dozent registriert sich und erhält einen eigenen Mandanten', async () => {
    const r = await dozent.post('/api/auth/register', DOZENT);
    expect(r.status).toBe(201);
    const me = await dozent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.account).toMatchObject({ email: 'dozent@example.org', name: 'Dennis Hofmann' });
    expect(me.body.roles.sort()).toEqual(['admin', 'trainer', 'verantwortlich']);
    expect(me.body.memberships).toHaveLength(1);
    expect(me.body.memberships[0].tenantName).toBe('Muster Elektro GmbH');
  });

  it('lehnt doppelte E-Mail, schwache Passwörter und fehlende Felder ab', async () => {
    const c = await h.agent();
    expect((await c.post('/api/auth/register', { ...DOZENT, email: 'DOZENT@example.org' })).status).toBe(409);
    const weak = await c.post('/api/auth/register', { ...DOZENT, email: 'x@example.org', password: 'kurz' });
    expect(weak.status).toBe(400);
    expect(weak.body.fields[0].message).toMatch(/mindestens 12 Zeichen/);
    expect((await c.post('/api/auth/register', { email: 'y@example.org' })).status).toBe(400);
  });

  it('schreibende Requests ohne CSRF-Token werden abgelehnt', async () => {
    const r = await dozent.http.post('/api/auth/logout').send({});
    expect(r.status).toBe(403);
  });

  it('Anmeldung: falsches Passwort → 401 mit neutraler Meldung, richtiges → Sitzung', async () => {
    const c = await h.agent();
    const bad = await c.post('/api/auth/login', { email: DOZENT.email, password: 'falsch-falsch' });
    expect(bad.status).toBe(401);
    expect(bad.body.message).toBe('E-Mail oder Passwort ist falsch');
    const unknown = await c.post('/api/auth/login', { email: 'gibtsnicht@example.org', password: 'egal-egal-egal' });
    expect(unknown.body.message).toBe('E-Mail oder Passwort ist falsch');
    expect((await c.get('/api/auth/me')).status).toBe(401);
    const ok = await c.post('/api/auth/login', { email: DOZENT.email, password: DOZENT.password });
    expect(ok.status).toBe(200);
    expect(([] as string[]).concat(ok.headers['set-cookie'] ?? []).join(';')).toMatch(/sn_session=.*HttpOnly.*SameSite=Lax/i);
    expect((await c.get('/api/auth/me')).status).toBe(200);
    expect((await c.post('/api/auth/logout')).status).toBe(200);
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });

  it('Rate-Limit greift nach zu vielen Fehlversuchen', async () => {
    const c = await h.agent();
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await c.post('/api/auth/login', { email: 'rate@example.org', password: 'falsch-falsch' })).status;
    expect(last).toBe(429);
  });

  it('Teilnehmer kann ein Konto ohne Mandant anlegen', async () => {
    const c = await h.agent();
    expect((await c.post('/api/auth/register-account', { name: 'Anna Schulz', email: 'anna@example.org', password: 'anna-passwort-1' })).status).toBe(201);
    const me = await c.get('/api/auth/me');
    expect(me.body.activeTenantId).toBeNull();
    expect(me.body.memberships).toEqual([]);
    // Verwaltungsfunktionen brauchen einen Mandanten
    expect((await c.get('/api/tenant/members')).status).toBe(403);
  });
});

describe('Step-up vor der Unterschrift', () => {
  const purpose = 'signature:3f0d6c56-3d63-4c1e-9f0a-2b1d4e5f6a7b';

  it('falsches Passwort → 401, richtiges → einmal verwendbares, gebundenes Token', async () => {
    expect((await dozent.post('/api/auth/step-up', { password: 'falsch', purpose })).status).toBe(401);
    const r = await dozent.post('/api/auth/step-up', { password: DOZENT.password, purpose });
    expect(r.status).toBe(200);
    const me = await dozent.get('/api/auth/me');
    const svc = h.app.get(StepUpService);
    await expect(svc.consume(r.body.stepUpToken, { subject: me.body.account.id, purpose: 'signature:00000000-0000-0000-0000-000000000000' })).rejects.toThrow(/passt nicht/);
    // nach fehlgeschlagener Bindung ist es verbraucht
    await expect(svc.consume(r.body.stepUpToken, { subject: me.body.account.id, purpose })).rejects.toThrow(/abgelaufen/);
    const r2 = await dozent.post('/api/auth/step-up', { password: DOZENT.password, purpose });
    await expect(svc.consume(r2.body.stepUpToken, { subject: me.body.account.id, purpose })).resolves.toBe('password');
    await expect(svc.consume(r2.body.stepUpToken, { subject: me.body.account.id, purpose })).rejects.toThrow();
  });
});

describe('Mitglieder und Rollen', () => {
  it('Admin lädt einen Kollegen ein; Mail geht über die Outbox, Passwort per Link', async () => {
    const r = await dozent.post('/api/tenant/members', { email: 'kollege@example.org', name: 'Kai Neumann', roles: ['vorgesetzter'] });
    expect(r.status).toBe(201);
    expect(r.body.invited).toBe(true);
    const mail = await waitFor(async () => {
      const box = await dozent.get('/api/dev/postausgang?an=kollege@example.org');
      return box.body[0];
    });
    expect(mail.subject).toMatch(/Einladung zu Muster Elektro GmbH/);
    const token = /#token=([A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
    // Outbox protokolliert ohne Geheimnis
    const outbox = await waitFor(async () => {
      const o = await dozent.get('/api/dev/outbox');
      return o.body[0]?.status === 'sent' && o;
    });
    expect(outbox.body[0]).toMatchObject({ template: 'member-invite', status: 'sent' });
    expect(JSON.stringify(outbox.body)).not.toContain(token);

    const kollege = await h.agent();
    expect((await kollege.post('/api/auth/password/set', { token, password: 'kollege-passwort-1' })).status).toBe(200);
    expect((await kollege.post('/api/auth/password/set', { token, password: 'kollege-passwort-1' })).status).toBe(401);
    const me = await kollege.get('/api/auth/me');
    expect(me.body.roles).toEqual(['vorgesetzter']);
    expect(me.body.account.emailVerified).toBe(true);
    // Vorgesetzter: keine Mitgliederverwaltung, kein Audit-Trail
    expect((await kollege.get('/api/tenant/members')).status).toBe(403);
    expect((await kollege.get('/api/audit')).status).toBe(403);
  });

  it('Rollenänderung wirkt sofort; der letzte Admin bleibt erhalten', async () => {
    const list = await dozent.get('/api/tenant/members');
    const self = list.body.find((m: { email: string }) => m.email === DOZENT.email);
    const kollege = list.body.find((m: { email: string }) => m.email === 'kollege@example.org');
    expect((await dozent.patch(`/api/tenant/members/${self.id}`, { roles: ['trainer'] })).status).toBe(400);
    expect((await dozent.delete(`/api/tenant/members/${self.id}`)).status).toBe(400);
    expect((await dozent.patch(`/api/tenant/members/${kollege.id}`, { roles: ['vorgesetzter', 'auditor'] })).status).toBe(200);
  });

  it('Mandanten sind über die API getrennt', async () => {
    const other = await h.agent();
    await other.post('/api/auth/register', { ...DOZENT, email: 'andere@example.org', organisation: 'Andere GmbH' });
    const members = await other.get('/api/tenant/members');
    expect(members.body.map((m: { email: string }) => m.email)).toEqual(['andere@example.org']);
    const mine = await dozent.get('/api/tenant/members');
    const kollegeId = mine.body.find((m: { email: string }) => m.email === 'kollege@example.org').id;
    expect((await other.patch(`/api/tenant/members/${kollegeId}`, { roles: ['admin'] })).status).toBe(404);
    expect((await other.delete(`/api/tenant/members/${kollegeId}`)).status).toBe(404);
    const audit = await other.get('/api/audit');
    expect(audit.body.every((e: { entity: string; payload: { name?: string } }) => e.payload?.name !== 'Muster Elektro GmbH')).toBe(true);
  });

  it('Audit-Kette ist gültig und enthält die Vorgänge', async () => {
    const v = await dozent.get('/api/audit/verify');
    expect(v.body.ok).toBe(true);
    const events = await dozent.get('/api/audit');
    const actions = events.body.map((e: { entity: string; action: string }) => `${e.entity}.${e.action}`);
    expect(actions).toEqual(expect.arrayContaining(['tenant.created', 'account.registered', 'membership.added', 'membership.roles_changed']));
    expect(events.body[0].payload.ip_hash).toMatch(/^[0-9a-f]{32}$/);
  });
});
