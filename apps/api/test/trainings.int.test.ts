import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestPdf } from '../src/trainings/pdf-fixtures';
import { startHarness, waitFor, type Client, type Harness } from './harness';

let h: Harness;
let dozent: Client;
let trainingId: string;
let versionId: string;

beforeAll(async () => {
  h = await startHarness();
  dozent = await h.agent();
  await dozent.post('/api/auth/register', { name: 'Dennis Hofmann', organisation: 'Muster Elektro GmbH', email: 'd@example.org', password: 'passwort-123' });
});
afterAll(async () => h?.close());

const waitReady = (vid: string) =>
  waitFor(async () => {
    const r = await dozent.get(`/api/trainings/${trainingId}/versions/${vid}`);
    return ['bereit', 'fehler'].includes(r.body.status) && r.body;
  }, 15000);

describe('Schulung anlegen, PDF hochladen, Seitenanalyse', () => {
  it('legt eine Schulung an', async () => {
    const r = await dozent.post('/api/trainings', { titel: 'Sicherheitsunterweisung 2026', confirmText: 'Ich habe die Unterweisung gelesen und verstanden.' });
    expect(r.status).toBe(201);
    trainingId = r.body.id;
    const t = await dozent.get(`/api/trainings/${trainingId}`);
    expect(t.body.settings).toMatchObject({ wordsPerMinute: 200, factor: 0.6, floorSeconds: 4, capSeconds: 90, strictMode: true, passPct: 80, maxAttempts: 3 });
  });

  it('lehnt Nicht-PDFs ab', async () => {
    const r = await dozent.upload(`/api/trainings/${trainingId}/versions`, 'datei', Buffer.from('kein pdf'), 'x.pdf');
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Die Datei ist kein PDF');
  });

  it('Upload berechnet SHA-256, Seitenzahl, Wörter, t_min je Seite und markiert Seiten ohne Text', async () => {
    const pdf = await makeTestPdf({
      wordsPerPage: [100, 0, 500, 172],
      chapters: [{ title: '1 Grundlagen', page: 1 }, { title: '2 Elektrische Gefährdungen', page: 3 }],
    });
    const up = await dozent.upload(`/api/trainings/${trainingId}/versions`, 'datei', pdf, 'Sicherheitsunterweisung_2026.pdf');
    expect(up.status).toBe(201);
    versionId = up.body.id;
    const { createHash } = await import('node:crypto');
    expect(up.body.sha256).toBe(createHash('sha256').update(pdf).digest('hex'));
    const v = await waitReady(versionId);
    expect(v.status).toBe('bereit');
    expect(v.pageCount).toBe(4);
    expect(v.pages.map((p: { word_count: number }) => p.word_count)).toEqual([100, 0, 500, 172]);
    // t_min = max(4, min(90, W/200·60·0,6))
    expect(v.pages.map((p: { t_min_seconds: number }) => p.t_min_seconds)).toEqual([18, 4, 90, 31]);
    expect(v.pages[1].has_text).toBe(false);
    expect(v.totals).toEqual({ words: 772, minReadingSeconds: 143, pagesWithoutText: 1 });
    expect(v.chapters.map((c: { short_name: string; from_page: number; to_page: number }) => [c.short_name, c.from_page, c.to_page])).toEqual([
      ['Grundlagen', 1, 2],
      ['Elektrische', 3, 4],
    ]);
    const thumb = await dozent.get(`/api/trainings/${trainingId}/versions/${versionId}/pages/1/thumb`);
    expect(thumb.status).toBe(200);
    expect(thumb.headers['content-type']).toBe('image/png');
  });

  it('Regeländerung berechnet t_min neu; manueller Wert für Seiten ohne Text', async () => {
    expect((await dozent.patch(`/api/trainings/${trainingId}/settings`, { floorSeconds: 100, capSeconds: 90 })).status).toBe(400);
    const s = await dozent.patch(`/api/trainings/${trainingId}/settings`, { factor: 1 });
    expect(s.status).toBe(200);
    await dozent.patch(`/api/trainings/${trainingId}/versions/${versionId}/pages/2`, { tMinManual: 12 });
    const v = (await dozent.get(`/api/trainings/${trainingId}/versions/${versionId}`)).body;
    expect(v.pages.map((p: { t_min_effective: number }) => p.t_min_effective)).toEqual([30, 12, 90, 52]);
    await dozent.patch(`/api/trainings/${trainingId}/settings`, { factor: 0.6 });
  });

  it('Kapitel müssen lückenlos sein', async () => {
    const bad = await dozent.http.put(`/api/trainings/${trainingId}/versions/${versionId}/chapters`).set('x-csrf-token', (await dozent.get('/api/auth/csrf')).body.token)
      .send([{ title: 'A', shortName: 'A', fromPage: 1, toPage: 2 }, { title: 'B', shortName: 'B', fromPage: 4, toPage: 4 }]);
    expect(bad.status).toBe(400);
  });

  it('Veröffentlichen friert die Version ein', async () => {
    expect((await dozent.post(`/api/trainings/${trainingId}/versions/${versionId}/publish`, {})).status).toBe(201);
    const again = await dozent.patch(`/api/trainings/${trainingId}/versions/${versionId}/pages/2`, { tMinManual: 20 });
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/unveränderlich/);
    expect((await dozent.post(`/api/trainings/${trainingId}/versions/${versionId}/publish`, {})).status).toBe(400);
  });

  it('Version 2 verlangt die Art der Änderung', async () => {
    const up = await dozent.upload(`/api/trainings/${trainingId}/versions`, 'datei', await makeTestPdf({ wordsPerPage: [50, 60] }), 'v2.pdf');
    expect(up.body.versionNo).toBe(2);
    await waitReady(up.body.id);
    const r = await dozent.post(`/api/trainings/${trainingId}/versions/${up.body.id}/publish`, {});
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/Art der Änderung/);
    const ok = await dozent.post(`/api/trainings/${trainingId}/versions/${up.body.id}/publish`, { changeKind: 'inhaltlich', changedPages: [2] });
    expect(ok.status).toBe(201);
  });
});

describe('Fragenpool', () => {
  it('legt Fragen an, prüft die richtige Antwort und deaktiviert statt zu löschen', async () => {
    const bad = await dozent.post(`/api/trainings/${trainingId}/questions`, { text: 'Was zuerst?', options: ['A', 'B'], correct: 2 });
    expect(bad.status).toBe(400);
    const q = await dozent.post(`/api/trainings/${trainingId}/questions`, {
      text: 'Was ist die erste der fünf Sicherheitsregeln?', options: ['Erden', 'Freischalten', 'Abdecken'], correct: 1, explanation: 'Zuerst wird freigeschaltet.',
    });
    expect(q.status).toBe(201);
    expect((await dozent.delete(`/api/trainings/${trainingId}/questions/${q.body.id}`)).status).toBe(200);
    const list = await dozent.get(`/api/trainings/${trainingId}/questions`);
    expect(list.body[0]).toMatchObject({ active: false, correct: 1 });
  });
});

describe('Personen und Org-Einheiten', () => {
  it('CSV-Import legt Personen und Einheiten an, aktualisiert per Personalnummer, meldet Fehler je Zeile', async () => {
    const csv = 'name;personalnr;email;org_einheit\nAnna Schulz;1001;anna@example.org;Elektro\nTobias Meier;1002;;Elektro\n;1003;;Lager\nLea Wagner;1004;kaputt;Lager\n';
    const r = await dozent.post('/api/persons/import', { csv });
    expect(r.body).toMatchObject({ created: 2, updated: 0 });
    expect(r.body.errors.map((e: { zeile: number }) => e.zeile)).toEqual([4, 5]);
    const r2 = await dozent.post('/api/persons/import', { csv: 'name;personalnr\nAnna Schulz-Meier;1001\n' });
    expect(r2.body).toMatchObject({ created: 0, updated: 1 });
    const list = await dozent.get('/api/persons?q=anna');
    expect(list.body[0]).toMatchObject({ name: 'Anna Schulz-Meier', org_unit_name: 'Elektro' });
    expect((await dozent.post('/api/persons', { name: 'Doppelt', email: 'anna@example.org' })).status).toBe(400);
  });

  it('verhindert zirkuläre Org-Bäume', async () => {
    const a = (await dozent.post('/api/org-units', { name: 'Werk' })).body.id;
    const b = (await dozent.post('/api/org-units', { name: 'Halle', parentId: a })).body.id;
    expect((await dozent.patch(`/api/org-units/${a}`, { parentId: b })).status).toBe(400);
  });

  it('Vorgesetzter sieht über die API nur sein Team und darf keine Schulungen hochladen', async () => {
    const units = (await dozent.get('/api/org-units')).body;
    const elektro = units.find((u: { name: string }) => u.name === 'Elektro').id;
    const chef = (await dozent.post('/api/persons', { name: 'Chef Elektro', email: 'chef@example.org', orgUnitId: elektro })).body.id;
    await dozent.patch(`/api/org-units/${elektro}`, { leiterPersonId: chef });
    // Konto für den Chef anlegen und mit seiner Person verknüpfen (später automatisch über E-25)
    await dozent.post('/api/tenant/members', { email: 'chef@example.org', name: 'Chef Elektro', roles: ['vorgesetzter'] });
    const mail = await waitFor(async () => (await dozent.get('/api/dev/postausgang?an=chef@example.org')).body[0]);
    const token = /#token=([A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
    const chefClient = await h.agent();
    await chefClient.post('/api/auth/password/set', { token, password: 'chef-passwort-1' });
    const accountId = (await chefClient.get('/api/auth/me')).body.account.id;
    await h.db.admin.query('UPDATE person SET account_id = $1 WHERE id = $2', [accountId, chef]);

    const seen = (await chefClient.get('/api/persons')).body.map((p: { name: string }) => p.name).sort();
    expect(seen).toEqual(['Anna Schulz-Meier', 'Chef Elektro', 'Tobias Meier']);
    expect((await chefClient.get('/api/trainings')).status).toBe(200);
    expect((await chefClient.get(`/api/trainings/${trainingId}/versions/${versionId}`)).status).toBe(403);
    expect((await chefClient.upload(`/api/trainings/${trainingId}/versions`, 'datei', Buffer.from('%PDF-'), 'x.pdf')).status).toBe(403);
    expect((await chefClient.post('/api/persons', { name: 'X' })).status).toBe(403);
  });
});
