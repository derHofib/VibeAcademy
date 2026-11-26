import { addDays, addMonths, berlinDate } from '@sn/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOZENT, registerDozent } from './fixtures';
import { memberClient, put } from './fg-fixtures';
import { startHarness, type Client, type Harness } from './harness';

/** Pflichtmatrix (Schritt 2.1): Stammdaten, Erfüllungsstand, Vorgesetzten-Sicht, Mandantentrennung. */
let h: Harness;
let dozent: Client;
let chef: Client;
const P = {} as Record<'chef' | 'a' | 'b' | 'c' | 'd' | 'e', string>;
let qEh: string;
let tEh: string;
let reqEh: string;
let lager: string;
const today = berlinDate(new Date());

beforeAll(async () => {
  h = await startHarness();
  dozent = await registerDozent(h);
  P.chef = (await dozent.post('/api/persons', { name: 'Chef Lager', email: 'chef@example.org' })).body.id;
  lager = (await dozent.post('/api/org-units', { name: 'Lager', leiterPersonId: P.chef })).body.id;
  const buero = (await dozent.post('/api/org-units', { name: 'Büro' })).body.id;
  for (const [k, name, unit] of [['a', 'Anna Schulz', lager], ['b', 'Ben Becker', lager], ['c', 'Clara Conrad', lager], ['d', 'Dora Dietz', buero], ['e', 'Emil Ernst', buero]] as const) {
    P[k] = (await dozent.post('/api/persons', { name, orgUnitId: unit })).body.id;
  }
  ({ client: chef } = await memberClient(h, dozent, { email: 'chef@example.org', name: 'Chef Lager', roles: ['vorgesetzter'], personId: P.chef }));
});
afterAll(async () => h?.close());

describe('Stammdaten der Pflichtmatrix', () => {
  it('Qualifikationen, Anforderungen, Zuordnungen (CRUD) mit Dubletten-Schutz', async () => {
    qEh = (await dozent.post('/api/qualifications', { name: 'Ersthelfer', description: 'Betriebliche Ersthelfer' })).body.id;
    expect((await dozent.post('/api/qualifications', { name: 'ersthelfer' })).status).toBe(400);
    tEh = (await dozent.post('/api/trainings', { titel: 'Erste-Hilfe-Fortbildung', format: 'extern', quizRequired: false })).body.id;
    reqEh = (await dozent.post('/api/requirements', { qualificationId: qEh, trainingId: tEh, intervalMonths: 24, graceDays: 0 })).body.id;
    expect((await dozent.post('/api/requirements', { qualificationId: qEh, trainingId: tEh, intervalMonths: 12 })).status).toBe(400);
    expect((await dozent.patch(`/api/requirements/${reqEh}`, { reinviteDays: 45 })).status).toBe(200);
    expect((await dozent.post(`/api/qualifications/${qEh}/persons`, { personIds: [P.a, P.b, P.c, P.d] })).body.assigned).toBe(4);
    expect((await put(dozent, `/api/persons/${P.e}/qualifications`, { qualificationIds: [qEh] })).status).toBe(200);
    expect((await dozent.get(`/api/persons/${P.e}/qualifications`)).body.map((q: { name: string }) => q.name)).toEqual(['Ersthelfer']);
    const reqs = (await dozent.get('/api/requirements')).body;
    expect(reqs[0]).toMatchObject({ qualification_name: 'Ersthelfer', training_title: 'Erste-Hilfe-Fortbildung', training_format: 'extern', interval_months: 24, reinvite_days: 45, person_count: 5 });
    expect((await dozent.get('/api/qualifications')).body[0]).toMatchObject({ name: 'Ersthelfer', person_count: 5, requirement_count: 1 });
    expect((await chef.post('/api/qualifications', { name: 'Stapler' })).status).toBe(403);
  });

  it('Erfüllungsstand: gültig, läuft ab, abgelaufen, fehlt, befreit', async () => {
    const rec = (personId: string, heldOn: string) => dozent.post('/api/external-records', { personIds: [personId], requirementId: reqEh, provider: 'DRK', heldOn });
    await rec(P.a, addDays(today, -30)); // gültig
    await rec(P.b, addDays(addMonths(today, -24), 10)); // läuft in 10 Tagen ab
    await rec(P.c, addMonths(today, -25)); // abgelaufen
    // Ältere und neuere Nachweise: es zählt der mit dem spätesten Ablauf
    await rec(P.c, addMonths(today, -30));
    expect((await dozent.post('/api/compliance/exemptions', { personId: P.e, requirementId: reqEh, reason: 'Ausgebildeter Rettungssanitäter' })).status).toBe(201);
    const c = (await dozent.get('/api/compliance')).body;
    const st = Object.fromEntries(c.rows.map((r: { personName: string; state: string }) => [r.personName, r.state]));
    expect(st).toEqual({ 'Anna Schulz': 'gueltig', 'Ben Becker': 'laeuft_ab', 'Clara Conrad': 'abgelaufen', 'Dora Dietz': 'fehlt', 'Emil Ernst': 'befreit' });
    expect(c.summary).toEqual({ total: 5, gueltig: 1, laeuft_ab: 1, abgelaufen: 1, fehlt: 1, befreit: 1, erfuellungsquote: 50 });
    expect(c.requirements).toEqual([{ id: reqEh, qualificationName: 'Ersthelfer', trainingTitle: 'Erste-Hilfe-Fortbildung', trainingFormat: 'extern', intervalMonths: 24 }]);
    const ben = c.rows.find((r: { personName: string }) => r.personName === 'Ben Becker');
    expect(ben).toMatchObject({ validUntil: addDays(today, 10), reinviteOn: addDays(today, -35), lastCompletedOn: addDays(addMonths(today, -24), 10) });
    expect((await dozent.get('/api/compliance?state=fehlt')).body.rows.map((r: { personName: string }) => r.personName)).toEqual(['Dora Dietz']);
    expect((await dozent.get(`/api/compliance?org_unit=${lager}`)).body.rows).toHaveLength(3);
    expect((await dozent.get('/api/compliance?state=kaputt')).status).toBe(400);
    // Dashboard: Erfüllungsquote und „läuft in 30 Tagen ab“
    const d = (await dozent.get('/api/dashboard')).body;
    expect(d.compliance).toMatchObject({ erfuellungsquote: 50, laeuftAb30: 1, abgelaufen: 1, fehlt: 1, befreit: 1, naechsteWiedereinladung: today });
    expect(d.kpi).toHaveProperty('offen');
  });

  it('Vorgesetzte sehen nur den Status ihres Teams (API und SQL)', async () => {
    const c = (await chef.get('/api/compliance')).body;
    expect(c.rows.map((r: { personName: string }) => r.personName)).toEqual(['Anna Schulz', 'Ben Becker', 'Clara Conrad']);
    expect(Object.keys(c.rows[0]).sort()).toEqual(
      ['expiresOn', 'orgUnitId', 'orgUnitName', 'personId', 'personName', 'qualificationId', 'qualificationName', 'requirementId', 'state', 'trainingFormat', 'trainingId', 'trainingTitle', 'validUntil'].sort(),
    );
    const tenant = (await h.db.admin.query('SELECT tenant_id FROM person WHERE id = $1', [P.a])).rows[0].tenant_id;
    const account = (await h.db.admin.query('SELECT account_id FROM person WHERE id = $1', [P.chef])).rows[0].account_id;
    const cl = await h.db.app.connect();
    try {
      await cl.query('BEGIN');
      await cl.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.account_id', $2, true), set_config('app.roles', 'vorgesetzter', true)`, [tenant, account]);
      expect((await cl.query('SELECT count(*)::int AS n FROM app.compliance(now())')).rows[0].n).toBe(3);
      expect((await cl.query('SELECT count(*)::int AS n FROM external_record')).rows[0].n).toBe(4); // Clara hat zwei Nachweise
      await expect(cl.query(`INSERT INTO qualification (name) VALUES ('X')`)).rejects.toThrow(/row-level security/);
      await cl.query('ROLLBACK');
    } finally {
      cl.release();
    }
  });

  it('Mandantentrennung für alle neuen Tabellen; ohne Kontext keine Zeilen', async () => {
    const other = await registerDozent(h, { ...DOZENT, email: 'b@example.org', organisation: 'Andere Firma GmbH' });
    expect((await other.get('/api/compliance')).body.rows).toHaveLength(0);
    expect((await other.get('/api/requirements')).body).toHaveLength(0);
    expect((await other.get(`/api/qualifications/${qEh}/persons`)).body).toHaveLength(0);
    expect((await other.patch(`/api/requirements/${reqEh}`, { intervalMonths: 1 })).status).toBe(404);
    expect((await other.delete(`/api/qualifications/${qEh}`)).status).toBe(404);
    await dozent.post('/api/admin/deadlines/run');
    const tB = (await h.db.admin.query(`SELECT id FROM tenant WHERE name = 'Andere Firma GmbH'`)).rows[0].id;
    const cl = await h.db.app.connect();
    const tables = ['qualification', 'person_qualification', 'requirement', 'compliance_exemption', 'deadline_notice', 'external_record', 'external_upload', 'push_subscription'];
    try {
      for (const ctx of [`SELECT set_config('app.tenant_id', '${tB}', true), set_config('app.roles', 'admin,verantwortlich,system,auditor', true)`, 'SELECT 1']) {
        await cl.query('BEGIN');
        await cl.query(ctx);
        for (const t of tables) expect((await cl.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n, t).toBe(0);
        expect((await cl.query('SELECT count(*)::int AS n FROM app.compliance(now())')).rows[0].n).toBe(0);
        await cl.query('ROLLBACK');
      }
    } finally {
      cl.release();
    }
    // Daten im eigenen Mandanten vorhanden (Gegenprobe)
    expect(Number((await h.db.admin.query('SELECT count(*) FROM deadline_notice')).rows[0].count)).toBeGreaterThan(0);
  });

  it('Ausnahme aufheben, Qualifikation entfernen', async () => {
    const ex = (await dozent.get('/api/compliance/exemptions')).body;
    expect(ex[0]).toMatchObject({ person_name: 'Emil Ernst', reason: 'Ausgebildeter Rettungssanitäter' });
    expect((await dozent.delete(`/api/compliance/exemptions/${ex[0].id}`)).status).toBe(200);
    expect((await dozent.delete(`/api/qualifications/${qEh}/persons/${P.e}`)).status).toBe(200);
    expect((await dozent.get('/api/compliance')).body.rows).toHaveLength(4);
  });
});
