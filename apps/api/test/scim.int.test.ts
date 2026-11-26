import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOZENT, registerDozent } from './fixtures';
import { startHarness, type Client, type Harness } from './harness';

/** SCIM 2.0 (E-36): Users ↔ Personen, Groups ↔ Org-Einheiten, Fehlerformat, Paging, Mandantentrennung, Token. */
let h: Harness;
let adminA: Client;
let adminB: Client;
let tokenA: string;
let tokenB: string;

const SCIM = 'application/scim+json';
const ENT = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
const USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
const ERR = 'urn:ietf:params:scim:api:messages:2.0:Error';
const PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

/** SCIM-Client (ohne Cookies/CSRF) mit Bearer-Token. */
const scim = (token: string) => {
  const http = () => request(h.app.getHttpServer());
  const auth = { authorization: `Bearer ${token}` };
  return {
    get: (p: string) => http().get(`/api/scim/v2${p}`).set(auth),
    post: (p: string, body: object) => http().post(`/api/scim/v2${p}`).set(auth).set('content-type', SCIM).send(JSON.stringify(body)),
    put: (p: string, body: object) => http().put(`/api/scim/v2${p}`).set(auth).set('content-type', SCIM).send(JSON.stringify(body)),
    patch: (p: string, ops: object[]) =>
      http().patch(`/api/scim/v2${p}`).set(auth).set('content-type', SCIM).send(JSON.stringify({ schemas: [PATCH], Operations: ops })),
    delete: (p: string) => http().delete(`/api/scim/v2${p}`).set(auth),
  };
};

const user = (userName: string, extra: Record<string, unknown> = {}) => ({
  schemas: [USER, ENT],
  userName,
  externalId: `ext-${userName}`,
  name: { givenName: 'Paula', familyName: 'Prov' },
  displayName: `Paula ${userName.split('@')[0]}`,
  emails: [{ value: userName, type: 'work', primary: true }],
  active: true,
  ...extra,
});

beforeAll(async () => {
  h = await startHarness();
  adminA = await registerDozent(h);
  adminB = await registerDozent(h, { ...DOZENT, email: 'b@example.org', organisation: 'Andere GmbH' });
  const a = await adminA.post('/api/tenant/sso/scim-tokens', { label: 'Entra ID' });
  expect(a.status).toBe(201);
  tokenA = a.body.token;
  tokenB = (await adminB.post('/api/tenant/sso/scim-tokens', {})).body.token;
});
afterAll(async () => {
  await h?.close();
});

describe('Token und Discovery', () => {
  it('Token wird einmal angezeigt, gespeichert ist nur der Hash', async () => {
    expect(tokenA).toMatch(/^scim_/);
    const s = await adminA.get('/api/tenant/sso');
    expect(s.body.scimTokens).toHaveLength(1);
    expect(s.body.scimTokens[0]).toMatchObject({ label: 'Entra ID', prefix: tokenA.slice(0, 12), revokedAt: null });
    expect(JSON.stringify(s.body)).not.toContain(tokenA);
    const rows = (await h.db.admin.query('SELECT token_hash FROM scim_token')).rows;
    expect(rows.map((r) => r.token_hash)).not.toContain(tokenA);
  });

  it('ohne oder mit falschem Token: 401 im SCIM-Fehlerformat', async () => {
    const r = await request(h.app.getHttpServer()).get('/api/scim/v2/Users');
    expect(r.status).toBe(401);
    expect(r.headers['content-type']).toContain(SCIM);
    expect(r.body).toEqual({ schemas: [ERR], status: '401', detail: 'Bearer-Token fehlt' });
    expect((await scim('scim_falsch_falsch_falsch_falsch').get('/Users')).status).toBe(401);
  });

  it('ServiceProviderConfig, Schemas, ResourceTypes', async () => {
    const spc = await scim(tokenA).get('/ServiceProviderConfig');
    expect(spc.status).toBe(200);
    expect(spc.headers['content-type']).toContain(SCIM);
    expect(spc.body).toMatchObject({ patch: { supported: true }, filter: { supported: true }, bulk: { supported: false } });
    const schemas = await scim(tokenA).get('/Schemas');
    expect(schemas.body.Resources.map((s: { id: string }) => s.id)).toEqual(expect.arrayContaining([USER, ENT]));
    expect((await scim(tokenA).get(`/Schemas/${USER}`)).body.name).toBe('User');
    const rt = await scim(tokenA).get('/ResourceTypes');
    expect(rt.body.Resources.map((r: { id: string }) => r.id)).toEqual(['User', 'Group']);
  });

  it('Session-CSRF gilt nicht für SCIM, aber Sitzungen authentifizieren nicht', async () => {
    // Admin-Sitzung ohne Bearer-Token → 401
    expect((await adminA.get('/api/scim/v2/Users')).status).toBe(401);
  });
});

describe('Users', () => {
  let paulaId: string;

  it('POST legt eine Person an (department → Org-Einheit, employeeNumber → Personalnummer)', async () => {
    const r = await scim(tokenA).post('/Users', user('paula@firma.example', { [ENT]: { department: 'Vertrieb', employeeNumber: 'P-100' } }));
    expect(r.status).toBe(201);
    expect(r.headers['content-type']).toContain(SCIM);
    expect(r.body).toMatchObject({
      userName: 'paula@firma.example',
      externalId: 'ext-paula@firma.example',
      active: true,
      displayName: 'Paula paula',
      emails: [{ value: 'paula@firma.example', primary: true }],
      [ENT]: { department: 'Vertrieb', employeeNumber: 'P-100' },
      meta: { resourceType: 'User' },
    });
    paulaId = r.body.id;
    const persons = (await adminA.get('/api/persons')).body as Array<{ id: string; personalnr: string; email: string }>;
    const p = (Array.isArray(persons) ? persons : (persons as { items: typeof persons }).items).find((x) => x.id === paulaId);
    expect(p).toMatchObject({ personalnr: 'P-100', email: 'paula@firma.example' });
    const audit = (await h.db.admin.query("SELECT action, payload FROM audit_event WHERE entity_id = $1", [paulaId])).rows;
    expect(audit[0]).toMatchObject({ action: 'scim_created', payload: expect.objectContaining({ via: 'scim' }) });
  });

  it('userName ist eindeutig (409 uniqueness), Pflichtfeld (400)', async () => {
    const dup = await scim(tokenA).post('/Users', user('PAULA@firma.example'));
    expect(dup.status).toBe(409);
    expect(dup.body).toMatchObject({ schemas: [ERR], status: '409', scimType: 'uniqueness' });
    const missing = await scim(tokenA).post('/Users', { schemas: [USER] });
    expect(missing.status).toBe(400);
    expect(missing.body.scimType).toBe('invalidValue');
  });

  it('Filter userName eq / externalId eq, ungültiger Filter', async () => {
    const byName = await scim(tokenA).get(`/Users?filter=${encodeURIComponent('userName eq "Paula@Firma.example"')}`);
    expect(byName.body).toMatchObject({ totalResults: 1, startIndex: 1, itemsPerPage: 1 });
    expect(byName.body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:ListResponse']);
    expect(byName.body.Resources[0].id).toBe(paulaId);
    const byExt = await scim(tokenA).get(`/Users?filter=${encodeURIComponent('externalId eq "ext-paula@firma.example"')}`);
    expect(byExt.body.Resources.map((u: { id: string }) => u.id)).toEqual([paulaId]);
    const none = await scim(tokenA).get(`/Users?filter=${encodeURIComponent('userName eq "nix@firma.example"')}`);
    expect(none.body).toMatchObject({ totalResults: 0, Resources: [] });
    const bad = await scim(tokenA).get(`/Users?filter=${encodeURIComponent('userName sw "p"')}`);
    expect(bad.status).toBe(400);
    expect(bad.body.scimType).toBe('invalidFilter');
  });

  it('findet in der App angelegte Personen über die E-Mail als userName', async () => {
    const id = (await adminA.post('/api/persons', { name: 'Olaf Alt', email: 'olaf@firma.example' })).body.id;
    const r = await scim(tokenA).get(`/Users?filter=${encodeURIComponent('userName eq "olaf@firma.example"')}`);
    expect(r.body.Resources[0]).toMatchObject({ id, userName: 'olaf@firma.example', active: true });
  });

  it('Paging mit startIndex und count', async () => {
    for (const n of [1, 2, 3, 4]) expect((await scim(tokenA).post('/Users', user(`page${n}@firma.example`))).status).toBe(201);
    const all = await scim(tokenA).get('/Users');
    const total = all.body.totalResults as number;
    expect(total).toBeGreaterThanOrEqual(6);
    const page = await scim(tokenA).get('/Users?startIndex=3&count=2');
    expect(page.body).toMatchObject({ totalResults: total, startIndex: 3, itemsPerPage: 2 });
    expect(page.body.Resources.map((u: { id: string }) => u.id)).toEqual(all.body.Resources.slice(2, 4).map((u: { id: string }) => u.id));
    const countOnly = await scim(tokenA).get('/Users?count=0');
    expect(countOnly.body).toMatchObject({ totalResults: total, itemsPerPage: 0, Resources: [] });
  });

  it('PATCH replace/add/remove (Entra-Stil, Wertefilter, Erweiterung)', async () => {
    const r = await scim(tokenA).patch(`/Users/${paulaId}`, [
      { op: 'Replace', path: 'displayName', value: 'Paula Neu' },
      { op: 'replace', path: 'emails[type eq "work"].value', value: 'paula.neu@firma.example' },
      { op: 'add', value: { [ENT]: { employeeNumber: 'P-200' }, title: 'ignoriert' } },
      { op: 'remove', path: 'externalId' },
    ]);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ displayName: 'Paula Neu', emails: [{ value: 'paula.neu@firma.example' }], [ENT]: { employeeNumber: 'P-200' } });
    expect(r.body.externalId).toBeUndefined();
    const bad = await scim(tokenA).patch(`/Users/${paulaId}`, [{ op: 'remove', path: 'userName' }]);
    expect(bad.status).toBe(400);
    expect(bad.body.scimType).toBe('mutability');
    const badPath = await scim(tokenA).patch(`/Users/${paulaId}`, [{ op: 'replace', path: 'emails[type co "w"].value', value: 'x' }]);
    expect(badPath.body.scimType).toBe('invalidPath');
  });

  it('PUT ersetzt die Darstellung', async () => {
    const r = await scim(tokenA).put(`/Users/${paulaId}`, user('paula@firma.example', { displayName: 'Paula Ersetzt', externalId: 'neu-1' }));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ displayName: 'Paula Ersetzt', externalId: 'neu-1', emails: [{ value: 'paula@firma.example' }] });
    // department nicht angegeben → Org-Einheit bleibt
    expect(r.body[ENT]).toMatchObject({ department: 'Vertrieb' });
  });

  it('active:false (als Zeichenkette) deaktiviert: Austritt und Mitgliedschaft gelöst', async () => {
    // Kollege mit Konto + Mitgliedschaft, verknüpft mit der Person
    await adminA.post('/api/tenant/members', { email: 'kurt@firma.example', name: 'Kurt Konto', roles: ['trainer'] });
    const accountId = (await h.db.admin.query("SELECT id FROM account WHERE email = 'kurt@firma.example'")).rows[0].id;
    const created = await scim(tokenA).post('/Users', user('kurt@firma.example'));
    await h.db.admin.query('UPDATE person SET account_id = $1 WHERE id = $2', [accountId, created.body.id]);
    const r = await scim(tokenA).patch(`/Users/${created.body.id}`, [{ op: 'Replace', path: 'active', value: 'False' }]);
    expect(r.status).toBe(200);
    expect(r.body.active).toBe(false);
    const p = (await h.db.admin.query('SELECT austritt_am FROM person WHERE id = $1', [created.body.id])).rows[0];
    expect(p.austritt_am).not.toBeNull();
    expect((await h.db.admin.query('SELECT count(*)::int AS n FROM membership WHERE account_id = $1', [accountId])).rows[0].n).toBe(0);
    const actions = (await h.db.admin.query("SELECT action FROM audit_event WHERE entity IN ('person','membership') AND entity_id IN ($1, $2::text)", [created.body.id, accountId])).rows.map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining(['scim_deactivated', 'removed']));
    // reaktivieren
    const back = await scim(tokenA).patch(`/Users/${created.body.id}`, [{ op: 'replace', value: { active: true } }]);
    expect(back.body.active).toBe(true);
  });

  it('DELETE deaktiviert statt zu löschen', async () => {
    const id = (await scim(tokenA).post('/Users', user('weg@firma.example'))).body.id;
    const r = await scim(tokenA).delete(`/Users/${id}`);
    expect(r.status).toBe(204);
    const g = await scim(tokenA).get(`/Users/${id}`);
    expect(g.status).toBe(200);
    expect(g.body.active).toBe(false);
    expect((await h.db.admin.query('SELECT count(*)::int AS n FROM person WHERE id = $1', [id])).rows[0].n).toBe(1);
  });

  it('unbekannte ID → 404 im SCIM-Format', async () => {
    const r = await scim(tokenA).get('/Users/00000000-0000-0000-0000-000000000000');
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ schemas: [ERR], status: '404' });
  });
});

describe('Groups ↔ Org-Einheiten', () => {
  let groupId: string;
  let u1: string;
  let u2: string;

  beforeAll(async () => {
    u1 = (await scim(tokenA).post('/Users', user('g1@firma.example'))).body.id;
    u2 = (await scim(tokenA).post('/Users', user('g2@firma.example'))).body.id;
  });

  it('POST legt eine Org-Einheit mit Mitgliedern an', async () => {
    const r = await scim(tokenA).post('/Groups', {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
      displayName: 'Werkstatt',
      externalId: 'grp-1',
      members: [{ value: u1 }],
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ displayName: 'Werkstatt', externalId: 'grp-1', members: [{ value: u1 }] });
    groupId = r.body.id;
    expect((await h.db.admin.query('SELECT org_unit_id FROM person WHERE id = $1', [u1])).rows[0].org_unit_id).toBe(groupId);
    expect((await scim(tokenA).get(`/Users/${u1}`)).body.groups).toEqual([expect.objectContaining({ value: groupId, display: 'Werkstatt' })]);
  });

  it('Filter displayName eq, excludedAttributes=members', async () => {
    const r = await scim(tokenA).get(`/Groups?filter=${encodeURIComponent('displayName eq "Werkstatt"')}&excludedAttributes=members`);
    expect(r.body.totalResults).toBe(1);
    expect(r.body.Resources[0].members).toBeUndefined();
  });

  it('PATCH Mitglieder hinzufügen, entfernen, Name ändern', async () => {
    let r = await scim(tokenA).patch(`/Groups/${groupId}`, [{ op: 'Add', path: 'members', value: [{ value: u2 }] }]);
    expect(r.body.members.map((m: { value: string }) => m.value).sort()).toEqual([u1, u2].sort());
    r = await scim(tokenA).patch(`/Groups/${groupId}`, [
      { op: 'Remove', path: `members[value eq "${u1}"]` },
      { op: 'Replace', path: 'displayName', value: 'Werkstatt Nord' },
    ]);
    expect(r.body).toMatchObject({ displayName: 'Werkstatt Nord', members: [{ value: u2 }] });
    expect((await h.db.admin.query('SELECT org_unit_id FROM person WHERE id = $1', [u1])).rows[0].org_unit_id).toBeNull();
    expect((await h.db.admin.query('SELECT name FROM org_unit WHERE id = $1', [groupId])).rows[0].name).toBe('Werkstatt Nord');
  });

  it('PUT ersetzt Mitglieder', async () => {
    const r = await scim(tokenA).put(`/Groups/${groupId}`, { displayName: 'Werkstatt Nord', members: [{ value: u1 }] });
    expect(r.body.members.map((m: { value: string }) => m.value)).toEqual([u1]);
  });

  it('manager → Leitung der Org-Einheit', async () => {
    const r = await scim(tokenA).patch(`/Users/${u1}`, [{ op: 'add', path: `${ENT}:manager`, value: { value: u2 } }]);
    expect(r.body[ENT].manager).toMatchObject({ value: u2 });
    expect((await h.db.admin.query('SELECT leiter_person_id FROM org_unit WHERE id = $1', [groupId])).rows[0].leiter_person_id).toBe(u2);
  });

  it('DELETE entfernt die Org-Einheit, Personen bleiben', async () => {
    expect((await scim(tokenA).delete(`/Groups/${groupId}`)).status).toBe(204);
    expect((await scim(tokenA).get(`/Groups/${groupId}`)).status).toBe(404);
    expect((await h.db.admin.query('SELECT org_unit_id FROM person WHERE id = $1', [u1])).rows[0].org_unit_id).toBeNull();
  });
});

describe('Mandantentrennung und Widerruf', () => {
  it('Token von A sieht und ändert keine Personen von B', async () => {
    const b = await scim(tokenB).post('/Users', user('bert@andere.example'));
    expect(b.status).toBe(201);
    const listA = await scim(tokenA).get('/Users?count=200');
    expect(listA.body.Resources.map((u: { id: string }) => u.id)).not.toContain(b.body.id);
    expect((await scim(tokenA).get(`/Users/${b.body.id}`)).status).toBe(404);
    expect((await scim(tokenA).patch(`/Users/${b.body.id}`, [{ op: 'replace', path: 'active', value: false }])).status).toBe(404);
    expect((await scim(tokenA).delete(`/Users/${b.body.id}`)).status).toBe(404);
    expect((await scim(tokenB).get(`/Users/${b.body.id}`)).body.active).toBe(true);
    // gleicher userName in beiden Mandanten erlaubt
    expect((await scim(tokenA).post('/Users', user('bert@andere.example'))).status).toBe(201);
    expect((await scim(tokenB).get('/Users')).body.totalResults).toBe(1);
  });

  it('widerrufenes Token wird abgelehnt', async () => {
    const t = await adminB.post('/api/tenant/sso/scim-tokens', { label: 'kurzlebig' });
    expect((await scim(t.body.token).get('/Users')).status).toBe(200);
    expect((await adminB.delete(`/api/tenant/sso/scim-tokens/${t.body.id}`)).status).toBe(200);
    const r = await scim(t.body.token).get('/Users');
    expect(r.status).toBe(401);
    expect(r.body.schemas).toEqual([ERR]);
    // andere Token des Mandanten bleiben gültig
    expect((await scim(tokenB).get('/Users')).status).toBe(200);
  });
});
