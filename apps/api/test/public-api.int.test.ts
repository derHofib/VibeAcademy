import { addDays, berlinDate } from '@sn/shared';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisService } from '../src/redis/redis.service';
import { buildOpenApi } from '../src/public-api/openapi';
import { binary } from './fg-fixtures';
import { publishedTraining, registerDozent } from './fixtures';
import { startHarness, waitFor, type Client, type Harness } from './harness';

/** Öffentliche REST-API /api/v1 (PLAN 3.2, E-37): Schlüssel, Scopes, Mandantentrennung, Paginierung, OpenAPI. */
let h: Harness;
let adminA: Client;
let adminB: Client;
const P = {} as Record<'anna' | 'ben' | 'clara' | 'bForeign', string>;
let trainingId: string;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

type Method = 'get' | 'post' | 'patch' | 'delete';
function api(key: string | null) {
  const call = (m: Method, url: string, body?: object) => {
    let r = request(h.app.getHttpServer())[m](`/api/v1${url}`);
    if (key) r = r.set('authorization', `Bearer ${key}`);
    return body ? r.send(body) : r;
  };
  return {
    get: (url: string) => call('get', url),
    post: (url: string, body: object = {}) => call('post', url, body),
    patch: (url: string, body: object) => call('patch', url, body),
    delete: (url: string) => call('delete', url),
    raw: (m: Method, url: string) => call(m, url),
  };
}
async function createKey(admin: Client, scopes: string[], name = 'Test') {
  const r = await admin.post('/api/integrations/api-keys', { name, scopes });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { key: r.body.key as string, id: r.body.apiKey.id as string };
}
async function onePagePdf() {
  const d = await PDFDocument.create();
  d.addPage([595, 842]).drawText('Teilnahmebescheinigung Stapler', { x: 50, y: 750, size: 18 });
  return Buffer.from(await d.save());
}

const ALL = ['persons:read', 'persons:write', 'trainings:read', 'runs:read', 'runs:write', 'evidence:read', 'external:read', 'external:write', 'compliance:read', 'webhooks:manage'];

beforeAll(async () => {
  h = await startHarness();
  adminA = await registerDozent(h);
  adminB = await registerDozent(h, { name: 'Berta Fremd', organisation: 'Fremdfirma AG', email: 'berta@example.org', password: 'passwort-123' });
  P.anna = (await adminA.post('/api/persons', { name: 'Anna Schulz', email: 'anna@example.org', personalnr: '1001' })).body.id;
  P.ben = (await adminA.post('/api/persons', { name: 'Ben Krause', email: 'ben@example.org', personalnr: '1002' })).body.id;
  P.clara = (await adminA.post('/api/persons', { name: 'Clara Vogt', personalnr: '1003' })).body.id;
  P.bForeign = (await adminB.post('/api/persons', { name: 'Fremde Person', email: 'fremd@example.org' })).body.id;
  ({ trainingId } = await publishedTraining(adminA, { wordsPerPage: [60, 40], questions: 3 }));
}, 120_000);
afterAll(async () => h?.close());

describe('API-Schlüssel verwalten', () => {
  it('Schlüssel wird einmal angezeigt; Liste ohne Geheimnis; Hash nicht lesbar; Validierung deutsch', async () => {
    const r = await adminA.post('/api/integrations/api-keys', { name: 'HR-System', scopes: ['persons:read', 'persons:write'] });
    expect(r.status).toBe(201);
    expect(r.body.key).toMatch(/^sn_live_[a-z0-9]{12}_[A-Za-z0-9_-]{43}$/);
    expect(r.body.apiKey).toMatchObject({ name: 'HR-System', status: 'aktiv', scopes: ['persons:read', 'persons:write'], createdByName: 'Dennis Hofmann' });
    const list = (await adminA.get('/api/integrations/api-keys')).body;
    const secret = r.body.key.split('_').slice(3).join('_');
    expect(JSON.stringify(list)).not.toContain(secret);
    expect(list[0]).not.toHaveProperty('key');
    expect(list[0].preview).toBe(`sn_live_${r.body.apiKey.prefix}_…`);
    const row = (await h.db.admin.query('SELECT secret_hash FROM api_key WHERE id = $1', [r.body.apiKey.id])).rows[0];
    expect(row.secret_hash).toBe(sha(secret));
    // app_user darf den Hash nicht lesen
    await expect(h.db.app.query('SELECT secret_hash FROM api_key')).rejects.toThrow(/permission denied/);
    const bad = await adminA.post('/api/integrations/api-keys', { name: 'x', scopes: ['alles:lesen'] });
    expect(bad.status).toBe(400);
    expect(bad.body.fields[0].message).toBe('Unbekannte Berechtigung');
    expect((await adminA.post('/api/integrations/api-keys', { name: 'x', scopes: ['persons:read'], expiresAt: '2020-01-01' })).status).toBe(400);
    const meta = (await adminA.get('/api/integrations/meta')).body;
    expect(meta.scopes.map((s: { id: string }) => s.id)).toEqual(ALL);
    expect(meta.events.map((s: { id: string }) => s.id)).toContain('compliance.state_changed');
  });

  it('nur Mandanten-Admins (Rolle admin) verwalten Schlüssel', async () => {
    const anon = await h.agent();
    expect((await anon.get('/api/integrations/api-keys')).status).toBe(401);
    expect((await adminB.get('/api/integrations/api-keys')).body).toEqual([]); // Mandant B sieht die Schlüssel von A nicht
  });
});

describe('Authentifizierung', () => {
  let key: string;
  beforeAll(async () => ({ key } = await createKey(adminA, ['persons:read'])));

  it('ohne, mit falschem oder kaputtem Token → 401 mit deutscher Meldung und WWW-Authenticate', async () => {
    const none = await api(null).get('/persons');
    expect(none.status).toBe(401);
    expect(none.body.message).toContain('API-Schlüssel fehlt');
    expect(none.headers['www-authenticate']).toMatch(/^Bearer/);
    expect((await api('sn_live_abcdefghijkl_' + 'A'.repeat(43)).get('/persons')).body.message).toBe('API-Schlüssel ist ungültig');
    expect((await api('kaputt').get('/persons')).status).toBe(401);
    const me = await api(key).get('/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ scopes: ['persons:read'], name: 'Test' });
    expect(me.headers['x-ratelimit-limit']).toBe('600');
  });

  it('Cookie-Sitzung der Oberfläche gilt unter /api/v1 nicht', async () => {
    expect((await adminA.get('/api/persons')).status).toBe(200); // Sitzung ist gültig …
    const r = await adminA.get('/api/v1/persons'); // … aber nicht für die öffentliche API
    expect(r.status).toBe(401);
    expect((await adminA.post('/api/v1/persons', { name: 'Über Cookie' })).status).toBe(401);
  });

  it('kein CSRF nötig: POST mit Schlüssel ohne CSRF-Token und ohne Cookie; Audit mit actor api-key', async () => {
    const w = await createKey(adminA, ['persons:write', 'persons:read'], 'Schreiber');
    const r = await api(w.key).post('/persons', { name: 'Dora Neu', externalId: 'HR-0042', email: 'Dora@Example.org' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ name: 'Dora Neu', externalId: 'HR-0042', email: 'dora@example.org', language: 'de', external: false });
    const audit = (await adminA.get('/api/audit')).body as Array<{ entity: string; entity_id: string; action: string; payload: Record<string, unknown> }>;
    const ev = audit.find((e) => e.entity === 'person' && e.entity_id === r.body.id && e.action === 'created');
    expect(ev?.payload.actor).toBe(`api-key:${w.id}`);
    const v = await adminA.get('/api/audit/verify');
    expect(v.body.ok).toBe(true);
    const dup = await api(w.key).post('/persons', { name: 'Doppelt', externalId: 'HR-0042' });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toBe('Diese externe ID ist bereits vergeben');
    const upd = await api(w.key).patch(`/persons/${r.body.id}`, { personalnr: '7777', exitDate: '2027-03-31' });
    expect(upd.body).toMatchObject({ personalnr: '7777', exitDate: '2027-03-31' });
    expect((await api(w.key).patch(`/persons/${r.body.id}`, {})).status).toBe(400);
    expect((await api(w.key).post('/persons', { name: '' })).body.fields[0].message).toBe('Bitte einen Namen angeben');
  });

  it('widerrufene und abgelaufene Schlüssel → 401; last_used_at wird gesetzt', async () => {
    const k = await createKey(adminA, ['persons:read'], 'Kurzlebig');
    expect((await api(k.key).get('/persons')).status).toBe(200);
    const listed = (await adminA.get('/api/integrations/api-keys')).body.find((x: { id: string }) => x.id === k.id);
    expect(listed.lastUsedAt).toBeTruthy();
    const rev = await adminA.post(`/api/integrations/api-keys/${k.id}/revoke`);
    expect(rev.body.status).toBe('widerrufen');
    const r = await api(k.key).get('/persons');
    expect(r.status).toBe(401);
    expect(r.body.message).toBe('API-Schlüssel wurde widerrufen');

    const e = await createKey(adminA, ['persons:read'], 'Abgelaufen');
    await h.db.admin.query("UPDATE api_key SET expires_at = now() - interval '1 minute' WHERE id = $1", [e.id]);
    const x = await api(e.key).get('/persons');
    expect(x.status).toBe(401);
    expect(x.body.message).toBe('API-Schlüssel ist abgelaufen');
    expect((await adminA.get('/api/integrations/api-keys')).body.find((y: { id: string }) => y.id === e.id).status).toBe('abgelaufen');
  });

  it('Rate-Limit je Schlüssel → 429 mit Retry-After', async () => {
    const k = await createKey(adminA, ['persons:read'], 'Viel');
    const redis = h.app.get(RedisService);
    await redis.client.set(`rl:api:${k.id}:${Math.floor(Date.now() / 60_000)}`, '600', 'EX', 120);
    const r = await api(k.key).get('/me');
    if (r.status !== 429) {
      // Minutenwechsel zwischen Setzen und Anfrage: neues Fenster – erneut versuchen
      await redis.client.set(`rl:api:${k.id}:${Math.floor(Date.now() / 60_000)}`, '600', 'EX', 120);
    }
    const r2 = r.status === 429 ? r : await api(k.key).get('/me');
    expect(r2.status).toBe(429);
    expect(r2.body.message).toContain('Zu viele Anfragen');
    expect(Number(r2.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('Scopes und Mandantentrennung', () => {
  it('fehlender Scope → 403 mit Name des Scopes', async () => {
    const { key } = await createKey(adminA, ['trainings:read']);
    const r = await api(key).get('/persons');
    expect(r.status).toBe(403);
    expect(r.body.message).toBe('Dem API-Schlüssel fehlt die Berechtigung „persons:read“');
    expect((await api(key).post('/persons', { name: 'Nein' })).status).toBe(403);
    expect((await api(key).get('/evidence')).status).toBe(403);
    expect((await api(key).get('/webhooks')).status).toBe(403);
    expect((await api(key).get('/compliance')).status).toBe(403);
    expect((await api(key).get('/trainings')).status).toBe(200);
  });

  it('auch auf Datenbankebene (RLS): Scope-Rolle persons:read liest keine Schulungen', async () => {
    const tenant = (await h.db.admin.query('SELECT tenant_id FROM person WHERE id = $1', [P.anna])).rows[0].tenant_id;
    const c = await h.db.app.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.roles', 'api,api_persons_read', true)`, [tenant]);
      expect(Number((await c.query('SELECT count(*) FROM person')).rows[0].count)).toBeGreaterThan(0);
      expect(Number((await c.query('SELECT count(*) FROM training')).rows[0].count)).toBe(0);
      expect(Number((await c.query('SELECT count(*) FROM invitation')).rows[0].count)).toBe(0);
      await expect(c.query("INSERT INTO person (name) VALUES ('X')")).rejects.toThrow(/row-level security/);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });

  it('Schlüssel von Mandant A sieht nie Daten von Mandant B (und umgekehrt)', async () => {
    const a = await createKey(adminA, ALL);
    const b = await createKey(adminB, ALL);
    const listA = (await api(a.key).get('/persons?limit=200')).body.data.map((p: { id: string }) => p.id);
    expect(listA).toContain(P.anna);
    expect(listA).not.toContain(P.bForeign);
    const listB = (await api(b.key).get('/persons?limit=200')).body.data.map((p: { id: string }) => p.id);
    expect(listB).toEqual([P.bForeign]);
    expect((await api(a.key).get(`/persons/${P.bForeign}`)).status).toBe(404);
    expect((await api(a.key).patch(`/persons/${P.bForeign}`, { name: 'Gekapert' })).status).toBe(404);
    expect((await api(b.key).get(`/trainings/${trainingId}`)).status).toBe(404);
    expect((await api(b.key).get('/trainings')).body.data).toEqual([]);
    expect((await api(b.key).get('/runs')).body.data).toEqual([]);
    expect((await api(b.key).post('/runs', { trainingId, personIds: [P.bForeign] })).status).toBe(400);
    expect((await api(b.key).post('/external-records', { personIds: [P.anna], title: 'Fremd', heldOn: '2026-01-10' })).status).toBe(400);
    expect((await api(a.key).get('/compliance')).body.data.every((r: { personId: string }) => r.personId !== P.bForeign)).toBe(true);
    expect((await h.db.admin.query('SELECT name FROM person WHERE id = $1', [P.bForeign])).rows[0].name).toBe('Fremde Person');
  });
});

describe('Ressourcen', () => {
  let key: string;
  beforeAll(async () => ({ key } = await createKey(adminA, ALL, 'Alles')));

  it('Paginierung: stabil über Cursor, alle Einträge genau einmal; Fehler bei ungültigem Cursor/limit', async () => {
    for (let i = 0; i < 5; i++) await api(key).post('/persons', { name: `Seite ${i}`, externalId: `PAGE-${i}` });
    const all = (await api(key).get('/persons?limit=200')).body.data.map((p: { id: string }) => p.id);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r: request.Response = await api(key).get(`/persons?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      expect(r.status).toBe(200);
      expect(r.body.data.length).toBeLessThanOrEqual(2);
      seen.push(...r.body.data.map((p: { id: string }) => p.id));
      cursor = r.body.nextCursor;
      pages++;
    } while (cursor && pages < 50);
    expect(seen).toEqual(all);
    expect(new Set(seen).size).toBe(all.length);
    expect(pages).toBe(Math.ceil(all.length / 2));
    expect((await api(key).get('/persons?cursor=quatsch')).body.message).toBe('Ungültiger Cursor');
    expect((await api(key).get('/persons?limit=0')).status).toBe(400);
    expect((await api(key).get('/persons?limit=201')).status).toBe(400);
  });

  it('Personen filtern nach externalId, personalnr, email, updatedSince', async () => {
    expect((await api(key).get('/persons?externalId=PAGE-3')).body.data.map((p: { name: string }) => p.name)).toEqual(['Seite 3']);
    expect((await api(key).get('/persons?personalnr=1002')).body.data[0].id).toBe(P.ben);
    expect((await api(key).get('/persons?email=ANNA@example.org')).body.data[0].id).toBe(P.anna);
    const future = new Date(Date.now() + 3600_000).toISOString();
    expect((await api(key).get(`/persons?updatedSince=${future}`)).body.data).toEqual([]);
    expect((await api(key).get('/persons?updatedSince=gestern')).status).toBe(400);
    expect((await api(key).get('/persons?orgUnitId=keine-uuid')).body.message).toContain('UUID');
    expect((await api(key).get('/org-units')).status).toBe(200);
  });

  it('Schulungen mit Versionen (Metadaten)', async () => {
    const list = (await api(key).get('/trainings')).body.data;
    const t = list.find((x: { id: string }) => x.id === trainingId);
    expect(t).toMatchObject({ title: 'Sicherheitsunterweisung 2026', format: 'online', archived: false, currentVersion: { versionNo: 1 } });
    const d = (await api(key).get(`/trainings/${trainingId}`)).body;
    expect(d.versions).toHaveLength(1);
    expect(d.versions[0]).toMatchObject({ versionNo: 1, status: 'veroeffentlicht', pageCount: 2 });
    expect(d.versions[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await api(key).get(`/trainings/${trainingId}/versions`)).body.data).toHaveLength(1);
    expect((await api(key).get('/trainings/00000000-0000-0000-0000-000000000000')).status).toBe(404);
    expect((await api(key).get('/trainings/abc')).body.message).toBe('Ungültige ID (UUID erwartet)');
  });

  it('Kampagne anlegen und einladen; Einladungen mit Status, Filter und updatedSince', async () => {
    const before = new Date(Date.now() - 1000).toISOString();
    const r = await api(key).post('/runs', { trainingId, title: 'API-Kampagne', deadline: '2027-01-31', personIds: [P.anna, P.clara] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ type: 'kampagne', title: 'API-Kampagne', status: 'laeuft', trainingId, invitationCount: 2, completedCount: 0 });
    expect(r.body.invitations).toMatchObject({ skipped: 0, mailsQueued: 1, withoutEmail: [P.clara] });
    expect(r.body.invitations.created).toHaveLength(2);
    const again = await api(key).post(`/runs/${r.body.id}/invitations`, { personIds: [P.anna, P.ben], sendMail: false });
    expect(again.body).toMatchObject({ skipped: 1, mailsQueued: 0 });
    expect(again.body.created.map((x: { personId: string }) => x.personId)).toEqual([P.ben]);
    const invs = (await api(key).get(`/invitations?runId=${r.body.id}`)).body.data;
    expect(invs.map((i: { personId: string }) => i.personId).sort()).toEqual([P.anna, P.ben, P.clara].sort());
    expect(invs.every((i: { status: string; overdue: boolean }) => i.status === 'offen' && !i.overdue)).toBe(true);
    expect((await api(key).get(`/invitations?updatedSince=${before}&personId=${P.ben}`)).body.data).toHaveLength(1);
    expect((await api(key).get('/invitations?status=kaputt')).status).toBe(400);
    expect((await api(key).get(`/invitations/${invs[0].id}`)).body.id).toBe(invs[0].id);
    expect((await api(key).get(`/runs/${r.body.id}`)).body.invitationCount).toBe(3);
    expect((await api(key).get(`/runs?trainingId=${trainingId}`)).body.data.map((x: { id: string }) => x.id)).toContain(r.body.id);
    const audit = (await adminA.get('/api/audit')).body as Array<{ entity: string; action: string; payload: Record<string, unknown> }>;
    expect(audit.some((e) => e.entity === 'run' && e.action === 'invited' && String(e.payload.actor).startsWith('api-key:'))).toBe(true);
    expect((await api(key).post('/runs', { trainingId: '00000000-0000-0000-0000-000000000000' })).status).toBe(400);
  });

  it('externen Nachweis mit Beleg (multipart) erfassen → freigegeben, versiegelter Nachweis, PDF + Prüfcode über die API', async () => {
    const pdf = await onePagePdf();
    const heldOn = addDays(berlinDate(new Date()), -2);
    const r = await request(h.app.getHttpServer())
      .post('/api/v1/external-records')
      .set('authorization', `Bearer ${key}`)
      .field('data', JSON.stringify({ personIds: [P.anna, P.ben], title: 'Staplerschein Auffrischung', provider: 'DEKRA', heldOn, validUntil: addDays(heldOn, 365) }))
      .attach('receipts', pdf, 'bescheinigung.pdf');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.status).toBe('freigegeben');
    expect(r.body.groupId).toBeTruthy();
    expect(r.body.records).toHaveLength(2);
    const rec = r.body.records.find((x: { personId: string }) => x.personId === P.anna);
    expect(rec).toMatchObject({ title: 'Staplerschein Auffrischung', provider: 'DEKRA', heldOn, source: 'verwaltung', status: 'freigegeben' });
    expect(rec.receipts[0]).toMatchObject({ name: 'bescheinigung.pdf', mime: 'application/pdf', sha256: sha(pdf) });
    expect(rec.evidenceId).toBeTruthy();
    expect((await api(key).get(`/external-records/${rec.id}`)).body.id).toBe(rec.id);
    expect((await api(key).get(`/external-records?personId=${P.anna}&status=freigegeben`)).body.data.map((x: { id: string }) => x.id)).toContain(rec.id);

    await waitFor(async () => (await api(key).get(`/evidence/${rec.evidenceId}`)).body.status === 'erzeugt', 60_000);
    const ev = (await api(key).get(`/evidence/${rec.evidenceId}`)).body;
    expect(ev).toMatchObject({ kind: 'extern', personId: P.anna, externalRecordId: rec.id, pdfUrl: `/api/v1/evidence/${rec.evidenceId}/pdf` });
    const file = await request(h.app.getHttpServer()).get(`/api/v1/evidence/${rec.evidenceId}/pdf`).set('authorization', `Bearer ${key}`).buffer(true).parse(binary);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(sha(file.body as Buffer)).toBe(ev.sha256);
    expect(file.headers['x-content-sha256']).toBe(ev.sha256);
    const v = await api(key).get(`/evidence/verify/${ev.verifyCode.toLowerCase()}`);
    expect(v.body).toMatchObject({ valid: true, id: ev.id });
    expect((await api(key).get(`/evidence?personId=${P.anna}&kind=extern`)).body.data.map((x: { id: string }) => x.id)).toContain(ev.id);
    // nur JSON, ohne Beleg, zur Prüfung
    const j = await api(key).post('/external-records', { personIds: [P.clara], title: 'Ersthelfer', review: true });
    expect(j.status, JSON.stringify(j.body)).toBe(201);
    expect(j.body.records[0]).toMatchObject({ status: 'eingereicht', evidenceId: null });
    const bad = await api(key).post('/external-records', { personIds: [P.clara], title: 'Ohne Datum' });
    expect(bad.body.fields.map((f: { path: string }) => f.path)).toContain('heldOn');
  });

  it('Pflichtmatrix: Qualifikationen, Anforderungen, Stand je Person × Anforderung', async () => {
    const t = (await adminA.post('/api/trainings', { titel: 'Erste Hilfe', format: 'extern', quizRequired: false })).body.id;
    const q = (await adminA.post('/api/qualifications', { name: 'Ersthelfer' })).body.id;
    const req = (await adminA.post('/api/requirements', { qualificationId: q, trainingId: t, intervalMonths: 24 })).body.id;
    await adminA.post(`/api/qualifications/${q}/persons`, { personIds: [P.anna, P.ben] });
    expect((await api(key).get('/qualifications')).body.data.map((x: { id: string }) => x.id)).toContain(q);
    expect((await api(key).get(`/requirements?qualificationId=${q}`)).body.data[0]).toMatchObject({ id: req, trainingId: t, intervalMonths: 24, active: true });
    const rows = (await api(key).get(`/compliance?requirementId=${req}`)).body;
    expect(rows.at).toBeTruthy();
    expect(rows.data).toHaveLength(2);
    expect(rows.data.every((r: { state: string; validUntil: null }) => r.state === 'fehlt' && r.validUntil === null)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('Anna');
    const page1 = (await api(key).get(`/compliance?requirementId=${req}&limit=1`)).body;
    const page2 = (await api(key).get(`/compliance?requirementId=${req}&limit=1&cursor=${page1.nextCursor}`)).body;
    expect([page1.data[0].personId, page2.data[0].personId].sort()).toEqual([P.anna, P.ben].sort());
    expect(page2.nextCursor).toBeNull();
    expect((await api(key).get('/compliance?state=unbekannt')).status).toBe(400);
  });
});

describe('OpenAPI', () => {
  it('öffentlich unter /api/v1/openapi.json, Version 3.1, mit Signatur-Anleitung', async () => {
    const r = await request(h.app.getHttpServer()).get('/api/v1/openapi.json');
    expect(r.status).toBe(200);
    expect(r.body.openapi).toBe('3.1.0');
    expect(r.body.info.description).toContain('Schulungsnachweis-Signature');
    expect(r.body.info.description).toContain('HMAC-SHA256');
    expect(Object.keys(r.body.webhooks)).toEqual(expect.arrayContaining(['invitation.completed', 'evidence.created', 'external_record.approved', 'compliance.state_changed']));
  });

  it('jede Route unter /api/v1 ist beschrieben (und umgekehrt); Scopes stimmen', async () => {
    const instance = h.app.getHttpAdapter().getInstance() as { router?: { stack: Layer[] }; _router?: { stack: Layer[] } };
    type Layer = { route?: { path: string; methods: Record<string, boolean> } };
    const stack = (instance.router ?? instance._router)!.stack;
    const routes = new Set<string>();
    for (const l of stack) {
      // Middleware (Nest registriert sie als Route mit Platzhalter {*path}) zählt nicht
      if (!l.route || !l.route.path.startsWith('/api/v1/') || l.route.path.includes('{*')) continue;
      const path = l.route.path.replace(/^\/api\/v1/, '').replace(/:([A-Za-z]+)/g, '{$1}');
      for (const m of Object.keys(l.route.methods)) if (m !== '_all') routes.add(`${m.toUpperCase()} ${path}`);
    }
    expect(routes.size).toBeGreaterThan(25);
    const doc = buildOpenApi();
    const documented = new Set<string>();
    for (const [path, ops] of Object.entries(doc.paths)) for (const m of Object.keys(ops)) documented.add(`${m.toUpperCase()} ${path}`);
    expect([...routes].filter((r) => !documented.has(r)), 'nicht dokumentiert').toEqual([]);
    expect([...documented].filter((r) => !routes.has(r)), 'dokumentiert, aber nicht vorhanden').toEqual([]);
    // dokumentierter Scope = tatsächlich verlangter Scope (Schlüssel ohne Scopes außer webhooks:manage)
    const { key } = await createKey(adminA, ['webhooks:manage'], 'Scope-Probe');
    for (const [path, ops] of Object.entries(doc.paths)) {
      for (const [m, o] of Object.entries(ops as Record<string, { 'x-required-scope'?: string | null }>)) {
        const scope = o['x-required-scope'];
        if (!scope || scope === 'webhooks:manage') continue;
        const url = path.replace(/\{[A-Za-z]+\}/g, (x) => (x === '{code}' ? 'AAAA-BBBB-CCCC' : '00000000-0000-0000-0000-000000000000'));
        const r = await api(key).raw(m as Method, url);
        expect(r.status, `${m} ${path}`).toBe(403);
        expect(r.body.message, `${m} ${path}`).toContain(scope);
      }
    }
  });
});
