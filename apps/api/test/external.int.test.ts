import { addDays, addMonths, berlinDate } from '@sn/shared';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock, FakeClock } from '../src/common/clock';
import { DOZENT, registerDozent } from './fixtures';
import { binary, certificatePdf, employeeClient, memberClient, pdfText, pdfToJpeg } from './fg-fixtures';
import { ROOT, sealEnv, startHarness, waitFor, type Client, type Harness } from './harness';

/** Externe Nachweise (Schritt 2.6) und Nachweismappe (Schritt 2.7): drei Erfassungswege, OCR-Vorschlag, Prüfung, Freigabe, RLS. */
const clock = new FakeClock(new Date());
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
let h: Harness;
let dozent: Client;
let kai: Client;
const P = {} as Record<'kai' | 'lea' | 'mehmet' | 'anna' | 'tobias', string>;
let reqEh: string;
let ehTraining: string;
const today = () => berlinDate(clock.now());
const heldOn = () => addDays(today(), -3);
const de = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const CERT = { provider: 'Erste-Hilfe-Ausbildung Muster e. V.', course: 'Erste-Hilfe-Fortbildung (9 UE)' };

async function evidencePdf(client: Client, evidenceId: string) {
  await waitFor(async () => (await h.db.admin.query(`SELECT status FROM evidence WHERE id = $1`, [evidenceId])).rows[0]?.status === 'erzeugt', 60000);
  const r = await client.http.get(`/api/evidence/${evidenceId}/pdf`).buffer(true).parse(binary);
  expect(r.status).toBe(200);
  return r.body as Buffer;
}
function verifySeal(pdf: Buffer) {
  const env = sealEnv();
  if (env.SEAL_MODE !== 'pyhanko') return;
  const out = JSON.parse(execFileSync(env.SEAL_PYTHON!, [join(ROOT, 'infra/seal/verify.py'), join(ROOT, '.local/certs/ca.pem')], { input: pdf }).toString());
  expect(out).toMatchObject({ signed: true, intact: true, valid: true, coverage: 'SignatureCoverageLevel.ENTIRE_FILE' });
}

beforeAll(async () => {
  h = await startHarness([{ provide: Clock, useValue: clock }]);
  dozent = await registerDozent(h);
  P.kai = (await dozent.post('/api/persons', { name: 'Kai Neumann', email: 'kai@example.org' })).body.id;
  const lager = (await dozent.post('/api/org-units', { name: 'Lager', leiterPersonId: P.kai })).body.id;
  const buero = (await dozent.post('/api/org-units', { name: 'Büro' })).body.id;
  await dozent.patch(`/api/persons/${P.kai}`, { orgUnitId: lager });
  P.lea = (await dozent.post('/api/persons', { name: 'Lea Wagner', personalnr: '1047', email: 'lea@example.org', orgUnitId: lager })).body.id;
  P.mehmet = (await dozent.post('/api/persons', { name: 'Mehmet Aydın', personalnr: '1012', email: 'mehmet@example.org', orgUnitId: lager })).body.id;
  P.anna = (await dozent.post('/api/persons', { name: 'Anna Schulz', personalnr: '2001', email: 'anna@example.org', orgUnitId: buero })).body.id;
  P.tobias = (await dozent.post('/api/persons', { name: 'Tobias Meier', personalnr: '2002', orgUnitId: buero })).body.id;
  ehTraining = (await dozent.post('/api/trainings', { titel: 'Erste-Hilfe-Fortbildung', format: 'extern', quizRequired: false, ansprechpartner: 'Dennis Hofmann, 0761 123456' })).body.id;
  const eh = (await dozent.post('/api/qualifications', { name: 'Ersthelfer' })).body.id;
  reqEh = (await dozent.post('/api/requirements', { qualificationId: eh, trainingId: ehTraining, intervalMonths: 24 })).body.id;
  expect((await dozent.post(`/api/qualifications/${eh}/persons`, { personIds: [P.lea, P.anna, P.tobias] })).body.assigned).toBe(3);
  ({ client: kai } = await memberClient(h, dozent, { email: 'kai@example.org', name: 'Kai Neumann', roles: ['vorgesetzter'], personId: P.kai }));
}, 120_000);
afterAll(async () => h?.close());

describe('Weg 1: Verwaltung erfasst (Gruppe, eine Liste für alle) – gilt sofort', () => {
  it('Vorschau „Was sich ändert“, Speichern und anrechnen → versiegelter Nachweis je Person mit Beleg als Anlage', async () => {
    const pdf = await certificatePdf(h, { ...CERT, name: 'Anna Schulz, Tobias Meier', date: de(heldOn()) });
    const up = await dozent.upload('/api/external-uploads', 'datei', pdf, 'Teilnahmebescheinigungen.pdf');
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ mime: 'application/pdf', pages: 1, sha256: sha(pdf) });
    expect((await dozent.upload('/api/external-uploads', 'datei', Buffer.from('kein Beleg'), 'x.txt')).status).toBe(400);

    const prev = await dozent.post('/api/external-records/preview', { requirementId: reqEh, heldOn: heldOn(), personIds: [P.anna, P.tobias] });
    expect(prev.body).toMatchObject({ label: 'Ersthelfer', intervalMonths: 24, validUntilProposed: addMonths(heldOn(), 24), credited: true });
    expect(prev.body.persons.map((p: { current: { state: string } }) => p.current.state)).toEqual(['fehlt', 'fehlt']);

    const r = await dozent.post('/api/external-records', {
      mode: 'gruppe', personIds: [P.anna, P.tobias], requirementId: reqEh, provider: 'Erste-Hilfe-Ausbildung Muster e. V.', location: 'Schulungsraum Lager',
      heldOn: heldOn(), durationLabel: '9 UE (1 Tag)', receipts: { mode: 'one', uploadIds: [up.body.id] },
    });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('freigegeben');
    expect(r.body.groupId).toBeTruthy();
    expect(r.body.records).toHaveLength(2);
    for (const rec of r.body.records) expect(rec).toMatchObject({ status: 'freigegeben', validUntil: addMonths(heldOn(), 24), evidence: { nachweisNr: expect.stringMatching(/^N-\d{4}-\d{5}$/) } });

    // Anrechnung in der Pflichtmatrix mit valid_until
    const comp = (await dozent.get(`/api/compliance?requirement=${reqEh}`)).body;
    const anna = comp.rows.find((x: { personId: string }) => x.personId === P.anna);
    expect(anna).toMatchObject({ state: 'gueltig', validUntil: addMonths(heldOn(), 24), lastCompletedOn: heldOn(), source: 'extern' });

    // Nachweis-PDF: Deckblatt + Beleg (Seitenzahl > 1), versiegelt
    const ev = await evidencePdf(dozent, r.body.records[0].evidence.id);
    const t = await pdfText(ev);
    expect(t.pages).toBeGreaterThan(1);
    for (const s of ['Nachweis über eine externe Schulung', 'Anna Schulz', 'Erste-Hilfe-Fortbildung', 'Ersthelfer', 'Gültig bis', 'Teilnahmebescheinigung', 'Anlage 1']) {
      expect(t.text.replace(/\s/g, ''), s).toContain(s.replace(/\s/g, ''));
    }
    verifySeal(ev);
    const v = (await (await h.agent()).get(`/api/verify/${r.body.records[0].evidence.verifyCode}`)).body;
    expect(v).toMatchObject({ status: 'gueltig', art: 'extern', schulung: 'Erste-Hilfe-Fortbildung', teilnehmer: 'AS.', sha256: sha(ev) });
  });

  it('Beleg je Person und Entwurf', async () => {
    const a = await dozent.upload('/api/external-uploads', 'datei', await certificatePdf(h, { ...CERT, name: 'Lea Wagner', date: de(heldOn()) }), 'Lea.pdf');
    const draft = await dozent.post('/api/external-records', {
      personIds: [P.lea], trainingId: ehTraining, heldOn: heldOn(), receipts: { mode: 'per', perPerson: [{ personId: P.lea, uploadIds: [a.body.id] }] }, draft: true,
    });
    expect(draft.body).toMatchObject({ status: 'entwurf', groupId: null, records: [{ status: 'entwurf', evidence: null }] });
    expect((await dozent.delete(`/api/external-records/${draft.body.records[0].id}`)).status).toBe(200);
  });
});

describe('Weg 2: Mitarbeiter reicht mobil ein (Foto → OCR-Vorschlag → eingereicht)', () => {
  let lea: Client;
  let recordId: string;

  it('Foto hochladen, Texterkennung schlägt Kurs, Name, Datum, Anbieter, Umfang vor (nur Vorschlag)', async () => {
    ({ client: lea } = await employeeClient(h, { email: 'lea@example.org', name: 'Lea Wagner', personIds: [P.lea] }));
    const targets = (await lea.get('/api/me/external-records/targets')).body;
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ personId: P.lea, tenantName: DOZENT.organisation });
    expect(targets[0].options[0]).toMatchObject({ requirementId: reqEh, qualificationName: 'Ersthelfer', label: 'Erste-Hilfe-Fortbildung · Qualifikation Ersthelfer · alle 2 Jahre' });

    const jpg = pdfToJpeg(await certificatePdf(h, { ...CERT, provider: 'ERSTE-HILFE-AUSBILDUNG MUSTER E. V.', name: 'Lea Wagner', date: de(heldOn()) }));
    const up = await lea.upload('/api/me/external-records', 'dateien', jpg, 'Foto_Bescheinigung.jpg');
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ status: 'entwurf', ocr: { status: 'ausstehend' } });
    recordId = up.body.id;
    const d = await waitFor(async () => {
      const x = (await lea.get(`/api/me/external-records/${recordId}`)).body;
      return x.ocr.status !== 'ausstehend' && x;
    }, 60000);
    expect(d.ocr.status).toBe('fertig');
    expect(d.ocr.fields.nameMatches).toBe(true);
    expect(d.ocr.fields.course.value).toContain('Erste-Hilfe-Fortbildung');
    expect(d.ocr.fields.date.normalized).toBe(heldOn());
    expect(d.ocr.fields.provider.value).toMatch(/Erste-Hilfe-Ausbildung Muster/);
    expect(d.ocr.fields.duration).toMatchObject({ value: '9 UE', normalized: 6.75 });
    expect(d.ocr.fields.date.box).toMatchObject({ page: 1, x: expect.any(Number), y: expect.any(Number) });
    expect(d.ocr.suggestedRequirementId).toBe(reqEh);
    // Entwurf vorbelegt, aber editierbar; Anrechnung vorgeschlagen
    expect(d.record).toMatchObject({ status: 'entwurf', heldOn: heldOn(), requirementId: reqEh, qualificationName: 'Ersthelfer', durationLabel: '9 UE' });
    expect(d.credit).toEqual({ label: 'Ersthelfer', validUntil: addMonths(heldOn(), 24) });
    const p = await lea.patch(`/api/me/external-records/${recordId}`, { provider: 'Erste-Hilfe-Ausbildung Muster e. V.' });
    expect(p.body.record.provider).toBe('Erste-Hilfe-Ausbildung Muster e. V.');
  });

  it('„Zur Prüfung einreichen“ → eingereicht, Prüfer bekannt; Warteschlange zeigt „alles passt“', async () => {
    const s = await lea.post(`/api/me/external-records/${recordId}/submit`, {});
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ status: 'eingereicht', reviewerName: 'Dennis Hofmann' });
    expect((await lea.post(`/api/me/external-records/${recordId}/submit`, {})).status).toBe(400);
    const list = (await dozent.get('/api/external-records?status=eingereicht')).body;
    expect(list.counts.eingereicht).toBe(1);
    const item = list.items.find((i: { primaryRecordId: string }) => i.primaryRecordId === recordId);
    expect(item).toMatchObject({ label: 'Lea Wagner', title: 'Erste-Hilfe-Fortbildung', sourceLabel: 'selbst eingereicht', fileKind: 'Foto', chip: { label: 'alles passt', tone: 'ok' } });
    const det = (await dozent.get(`/api/external-records/${recordId}`)).body;
    expect(det.checks.find((c: { key: string }) => c.key === 'person')).toMatchObject({ state: 'ok', value: 'Lea Wagner · Pers.-Nr. 1047', note: 'Name stimmt mit Beleg überein' });
    expect(det.checks.find((c: { key: string }) => c.key === 'datum')).toMatchObject({ state: 'ok', note: 'auf dem Beleg erkannt' });
    expect(det.checks.find((c: { key: string }) => c.key === 'gueltigkeit')).toMatchObject({ value: `bis ${de(addMonths(heldOn(), 24))}`, note: 'Vorschlag aus Intervall 2 Jahre' });
    expect(det.effect.text).toBe(`Lea Wagner: Ersthelfer gültig bis ${de(addMonths(heldOn(), 24))}.`);
    expect(det.files[0]).toMatchObject({ mime: 'image/jpeg', url: `/api/external-records/${recordId}/files/0` });
    expect((await dozent.get(det.files[0].url)).headers['content-type']).toBe('image/jpeg');
    expect(det.permissions).toMatchObject({ approve: true, return: true, undo: false });
  });

  it('Vorgesetzter gibt selbst eingereichte Nachweise seines Teams frei → Nachweis mit Foto als PDF-Anlage', async () => {
    const det = (await kai.get(`/api/external-records/${recordId}`)).body;
    expect(det.permissions.approve).toBe(true);
    const a = await kai.post(`/api/external-records/${recordId}/approve`, {});
    expect(a.status).toBe(200);
    expect(a.body.records[0]).toMatchObject({ status: 'freigegeben', validUntil: addMonths(heldOn(), 24) });
    const pdf = await evidencePdf(dozent, a.body.records[0].evidence.id);
    const t = await pdfText(pdf);
    expect(t.pages).toBe(2);
    expect(t.text).toContain('Lea Wagner');
    expect(t.text).toContain('Foto');
    verifySeal(pdf);
    // Mitarbeiterin sieht Freigabe, Nachweis und Benachrichtigung
    const mine = (await (await employeeLogin('lea@example.org')).get('/api/me/external-records')).body;
    expect(mine[0]).toMatchObject({ status: 'freigegeben', validUntil: addMonths(heldOn(), 24), evidence: { status: 'erzeugt' } });
    await waitFor(async () => (await dozent.get('/api/dev/postausgang?an=lea@example.org')).body.find((m: { subject: string }) => m.subject.startsWith('Freigegeben')));
    // Matrix: Lea gültig
    const comp = (await kai.get('/api/compliance')).body;
    expect(comp.rows.map((r: { personName: string }) => r.personName)).toEqual(['Lea Wagner']); // nur sein Team (Lager)
    expect(comp.rows[0]).toMatchObject({ state: 'gueltig' });
    expect(comp.rows[0]).not.toHaveProperty('source');
    expect(comp.rows[0]).not.toHaveProperty('sourceId');
  });

  it('Vorgesetzter: keine von der Verwaltung erfassten Nachweise, keine fremden Teams, keine eigenen', async () => {
    const annaRec = (await h.db.admin.query(`SELECT id FROM external_record WHERE person_id = $1 LIMIT 1`, [P.anna])).rows[0].id;
    expect((await kai.get(`/api/external-records/${annaRec}`)).status).toBe(404);
    // eigener Nachweis des Vorgesetzten
    const { client: kaiEmp } = { client: kai };
    const own = await kaiEmp.upload('/api/me/external-records', 'dateien', await certificatePdf(h, { ...CERT, name: 'Kai Neumann', date: de(heldOn()) }), 'kai.pdf', {
      trainingId: ehTraining, heldOn: heldOn(), provider: 'DRK', submit: 'true',
    });
    expect(own.status).toBe(201);
    expect((await kai.post(`/api/external-records/${own.body.id}/approve`, {})).status).toBe(403);
    expect((await dozent.post(`/api/external-records/${own.body.id}/approve`, {})).status).toBe(200);
  });
});

async function employeeLogin(email: string) {
  const c = await h.agent();
  await c.post('/api/auth/login', { email, password: 'mitarbeiter-passwort-1' });
  return c;
}

describe('Prüfansicht: Abweichungen, Zurückgeben, Rückgängig', () => {
  let mehmet: Client;
  let rec: string;

  it('Name ≠ Person und Datum fehlt werden markiert; Freigabe ohne Datum unmöglich', async () => {
    ({ client: mehmet } = await employeeClient(h, { email: 'mehmet@example.org', name: 'Mehmet Aydın', personIds: [P.mehmet] }));
    const pdf = await certificatePdf(h, { provider: 'LOGISTIKPARTNER BEISPIEL GMBH', name: 'Max Mustermann', date: '__________', course: 'Unterweisung Flurförderzeuge' });
    const r = await mehmet.upload('/api/me/external-records', 'dateien', pdf, 'Stapler_Unterweisung.pdf', { freeTitle: 'Unterweisung Flurförderzeuge', submit: 'true' });
    expect(r.body.status).toBe('eingereicht');
    rec = r.body.id;
    await waitFor(async () => (await dozent.get(`/api/external-records/${rec}`)).body.ocr.status === 'fertig', 60000);
    const det = (await dozent.get(`/api/external-records/${rec}`)).body;
    expect(det.hints.map((x: { code: string }) => x.code).sort()).toEqual(['anbieter_fehlt', 'datum_fehlt', 'name_abweichung']);
    expect(det.checks.find((c: { key: string }) => c.key === 'datum')).toMatchObject({ state: 'warn', value: 'nicht erkannt' });
    expect(det.checks.find((c: { key: string }) => c.key === 'person')).toMatchObject({ state: 'warn' });
    expect(det.ocr.fields.provider.value).toBe('Logistikpartner Beispiel GmbH');
    const item = (await dozent.get('/api/external-records?status=eingereicht')).body.items.find((i: { primaryRecordId: string }) => i.primaryRecordId === rec);
    expect(item.chip).toEqual({ label: '3 Hinweise', tone: 'warn' });
    expect(item.fileKind).toBe('PDF');
    expect((await dozent.post(`/api/external-records/${rec}/approve`, {})).status).toBe(400);
    // Datum in der Zukunft
    await dozent.patch(`/api/external-records/${rec}`, { heldOn: addDays(today(), 5) });
    expect((await dozent.get(`/api/external-records/${rec}`)).body.hints.map((x: { code: string }) => x.code)).toContain('datum_zukunft');
  });

  it('Zurückgeben nur mit Begründung; Mitarbeiter korrigiert und reicht erneut ein', async () => {
    expect((await dozent.post(`/api/external-records/${rec}/return`, { reason: '' })).status).toBe(400);
    const r = await dozent.post(`/api/external-records/${rec}/return`, { reason: 'Auf dem Beleg fehlt das Datum.' });
    expect(r.body.records[0].status).toBe('zurueckgegeben');
    const mail = await waitFor(async () => (await dozent.get('/api/dev/postausgang?an=mehmet@example.org')).body[0]);
    expect(mail.text).toContain('Auf dem Beleg fehlt das Datum.');
    const mine = (await mehmet.get(`/api/me/external-records/${rec}`)).body;
    expect(mine.record).toMatchObject({ status: 'zurueckgegeben', reviewNote: 'Auf dem Beleg fehlt das Datum.' });
    const s = await mehmet.post(`/api/me/external-records/${rec}/submit`, { heldOn: heldOn(), provider: 'Logistikpartner Beispiel GmbH' });
    expect(s.body.status).toBe('eingereicht');
  });

  it('Rückgängig innerhalb von 10 Minuten: Nachweis widerrufen, Vorgang wieder zur Prüfung; danach nicht mehr', async () => {
    const a = await dozent.post(`/api/external-records/${rec}/approve`, { validUntil: addMonths(heldOn(), 12) });
    expect(a.body.records[0].validUntil).toBe(addMonths(heldOn(), 12));
    const code = a.body.records[0].evidence.verifyCode;
    expect((await dozent.get(`/api/external-records/${rec}`)).body.undo.possible).toBe(true);
    const u = await dozent.post(`/api/external-records/${rec}/undo`, {});
    expect(u.status).toBe(200);
    const newId = u.body.records[0].id;
    expect(u.body.records[0]).toMatchObject({ replaces: rec, status: 'eingereicht' });
    expect((await (await h.agent()).get(`/api/verify/${code}`)).body.status).toBe('widerrufen');
    expect((await dozent.get(`/api/external-records/${newId}`)).body.record).toMatchObject({ status: 'eingereicht', supersedes: rec, heldOn: heldOn() });
    // erneut freigeben, 11 Minuten später kein Rückgängig mehr
    expect((await dozent.post(`/api/external-records/${newId}/approve`, {})).status).toBe(200);
    clock.advance(11 * 60_000);
    expect((await dozent.post(`/api/external-records/${newId}/undo`, {})).status).toBe(400);
  });

  it('Papierliste mit unleserlichen Unterschriften: Gruppe als ein Vorgang, „2 Unterschriften prüfen“', async () => {
    const up = await dozent.upload('/api/external-uploads', 'datei', await certificatePdf(h, { ...CERT, name: 'Anna Schulz Tobias Meier Lea Wagner', date: de(heldOn()) }), 'Anwesenheitsliste.pdf');
    const r = await dozent.post('/api/external-records', {
      mode: 'gruppe', personIds: [P.anna, P.tobias, P.lea], freeTitle: 'Baustellen-Unterweisung (Papierliste)', provider: 'Tiefbau Muster GmbH', heldOn: heldOn(),
      validUntil: addDays(today(), 60), receipts: { mode: 'one', uploadIds: [up.body.id] }, review: true,
      flags: [{ personId: P.tobias, code: 'unterschrift_unleserlich', note: 'Zeile 2' }, { personId: P.lea, code: 'unterschrift_unleserlich', note: 'Zeile 3' }],
    });
    expect(r.body.status).toBe('eingereicht');
    const item = (await dozent.get('/api/external-records?status=eingereicht')).body.items.find((i: { groupId: string }) => i.groupId === r.body.groupId);
    expect(item).toMatchObject({ kind: 'gruppe', label: 'Tiefbau Muster GmbH · 3 Personen', chip: { label: '2 Unterschriften prüfen', tone: 'warn' }, sourceLabel: 'von Verwaltung erfasst' });
    const det = (await dozent.get(`/api/external-records/${item.primaryRecordId}`)).body;
    expect(det.group).toHaveLength(3);
    expect(det.checks.find((c: { key: string }) => c.key === 'unterschriften')).toMatchObject({ state: 'warn', value: '2 unleserlich', note: 'Zeile 2, Zeile 3 prüfen' });
    expect(det.effect.text).toContain('Alle 3 Personen erhalten den Nachweis „Baustellen-Unterweisung (Papierliste)“');
    expect([403, 404]).toContain((await kai.post(`/api/external-records/${item.primaryRecordId}/approve`, {})).status); // Verwaltung erfasst → nur Verantwortliche
    const a = await dozent.post(`/api/external-records/${item.primaryRecordId}/approve`, {});
    expect(a.body.records).toHaveLength(3);
    expect(a.body.records.every((x: { validUntil: string }) => x.validUntil === addDays(today(), 60))).toBe(true);
  });
});

describe('Weg 3: Import CSV + ZIP', () => {
  const csv = (rows: string[]) => Buffer.from(['Personalnr;Kurs;Qualifikation;Anbieter;Datum;Umfang;Beleg', ...rows].join('\n'));
  it('Probelauf, Fehler → nichts importiert; korrekt → freigegeben mit Beleg', async () => {
    const zip = new JSZip();
    zip.file('belege/anna.pdf', await certificatePdf(h, { ...CERT, name: 'Anna Schulz', date: de(heldOn()) }));
    const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });
    const imp = (rows: string[], fields: Record<string, string>) =>
      dozent.http.post('/api/imports/external').set('x-csrf-token', (dozent as unknown as { csrf: string }).csrf)
        .attach('csv', csv(rows), 'import.csv').attach('zip', zipBuf, 'belege.zip').field(fields);
    const bad = await imp([`2001;Erste-Hilfe-Fortbildung;Ersthelfer;DRK;${de(heldOn())};9 UE;anna.pdf`, `9999;Erste-Hilfe-Fortbildung;;DRK;31.02.2026;;fehlt.pdf`], { mode: 'freigeben' });
    expect(bad.status).toBe(400);
    expect(bad.body.rows[1].errors).toEqual(['Person nicht gefunden: 9999', 'Datum ungültig: 31.02.2026', 'Beleg nicht in der ZIP-Datei: fehlt.pdf']);
    const dry = await imp([`2001;Erste-Hilfe-Fortbildung;Ersthelfer;DRK;${de(heldOn())};9 UE;anna.pdf`], { mode: 'freigeben', dryRun: 'true' });
    expect(dry.body).toMatchObject({ dryRun: true, created: 0, rows: [{ line: 2, ok: true, personName: 'Anna Schulz' }] });
    const before = Number((await h.db.admin.query(`SELECT count(*) FROM external_record WHERE source = 'import'`)).rows[0].count);
    expect(before).toBe(0);
    const ok = await imp([`2001;Erste-Hilfe-Fortbildung;Ersthelfer;DRK;${heldOn()};9 UE;anna.pdf`, `2002;Gabelstapler-Lehrgang;;Logistik GmbH;${de(heldOn())};2 Std.;`], { mode: 'freigeben' });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ created: 2, receipts: 1, status: 'freigegeben' });
    const recs = (await h.db.admin.query(`SELECT person_id, requirement_id, free_title, valid_until::text, status, cardinality(evidence_keys) AS files FROM external_record WHERE source = 'import' ORDER BY free_title NULLS FIRST`)).rows;
    expect(recs[0]).toMatchObject({ person_id: P.anna, requirement_id: reqEh, valid_until: addMonths(heldOn(), 24), status: 'freigegeben', files: 1 });
    expect(recs[1]).toMatchObject({ person_id: P.tobias, free_title: 'Gabelstapler-Lehrgang', valid_until: null, files: 0 });
    await waitFor(async () => Number((await h.db.admin.query(`SELECT count(*) FROM evidence e JOIN external_record x ON x.id = e.external_record_id WHERE x.source = 'import' AND e.status = 'erzeugt'`)).rows[0].count) === 2, 60000);
  });
});

describe('Arbeitsmedizinische Vorsorge', () => {
  it('nur Teilnahme und Datum, keine Befunde, keine Texterkennung', async () => {
    const up = await dozent.upload('/api/external-uploads', 'datei', await certificatePdf(h, { provider: 'Betriebsarzt', name: 'Lea Wagner', date: de(heldOn()), course: 'Vorsorgebescheinigung G 25' }), 'vorsorge.pdf');
    const r = await dozent.post('/api/external-records', {
      personIds: [P.lea], freeTitle: 'Arbeitsmedizinische Vorsorge G 25', heldOn: heldOn(), isMedical: true, durationLabel: '1 Std.', location: 'Praxis',
      receipts: { mode: 'one', uploadIds: [up.body.id] },
    });
    const row = (await h.db.admin.query(`SELECT is_medical, duration_label, location, ocr_status FROM external_record WHERE id = $1`, [r.body.records[0].id])).rows[0];
    expect(row).toEqual({ is_medical: true, duration_label: null, location: null, ocr_status: 'keine' });
    const t = await pdfText(await evidencePdf(dozent, r.body.records[0].evidence.id));
    expect(t.text).toContain('arbeitsmedizinische');
    expect(t.text).toContain('keine Befunde');
    expect(t.text).not.toContain('Umfang');
  });
});

describe('RLS: Mandantentrennung und nur eigene Datensätze', () => {
  it('Mitarbeitende sehen nur eigene Nachweise; anderer Mandant sieht nichts', async () => {
    const lea = await employeeLogin('lea@example.org');
    const mehmetRec = (await h.db.admin.query(`SELECT id FROM external_record WHERE person_id = $1 LIMIT 1`, [P.mehmet])).rows[0].id;
    expect((await lea.get(`/api/me/external-records/${mehmetRec}`)).status).toBe(404);
    expect((await lea.get(`/api/me/external-records/${mehmetRec}/files/0`)).status).toBe(404);
    expect((await lea.get('/api/external-records')).status).toBe(403);
    const mine = (await lea.get('/api/me/external-records')).body;
    expect(mine.length).toBeGreaterThan(0);
    // direkt per SQL im Teilnehmerkontext: nur eigene Zeilen
    const tenant = (await h.db.admin.query('SELECT tenant_id FROM person WHERE id = $1', [P.lea])).rows[0].tenant_id;
    const accountId = (await h.db.admin.query('SELECT account_id FROM person WHERE id = $1', [P.lea])).rows[0].account_id;
    const c = await h.db.app.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.account_id', $2, true), set_config('app.roles', 'teilnehmer', true)`, [tenant, accountId]);
      const persons = (await c.query('SELECT DISTINCT person_id FROM external_record')).rows.map((r) => r.person_id);
      expect(persons).toEqual([P.lea]);
      expect((await c.query('SELECT count(*)::int AS n FROM external_upload')).rows[0].n).toBe(0);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
    const other = await registerDozent(h, { ...DOZENT, email: 'b@example.org', organisation: 'Andere Firma GmbH' });
    const ol = (await other.get('/api/external-records?status=eingereicht,freigegeben')).body;
    expect(ol.items).toHaveLength(0);
    expect((await other.get(`/api/external-records/${mehmetRec}`)).status).toBe(404);
    expect((await other.get('/api/compliance')).body.rows).toHaveLength(0);
    expect((await other.get('/api/qualifications')).body).toHaveLength(0);
  });
});

describe('Nachweismappe (Export)', () => {
  it('ZIP mit Verzeichnis-PDF (Prüfcodes, SHA-256) und allen versiegelten Nachweisen; auditiert; Rollen', async () => {
    await waitFor(async () => Number((await h.db.admin.query(`SELECT count(*) FROM evidence WHERE status = 'ausstehend'`)).rows[0].count) === 0, 60000);
    const expected = (await h.db.admin.query(`SELECT nachweis_nr, verify_code, pdf_sha256 FROM evidence WHERE status = 'erzeugt' AND revoked_at IS NULL AND tenant_id = (SELECT tenant_id FROM person WHERE id = $1)`, [P.lea])).rows;
    const r = await dozent.http.post('/api/exports/nachweismappe').set('x-csrf-token', (dozent as unknown as { csrf: string }).csrf)
      .send({ from: addDays(today(), -30), to: today() }).buffer(true).parse(binary);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/zip');
    expect(Number(r.headers['x-evidence-count'])).toBe(expected.length);
    const zip = await JSZip.loadAsync(r.body as Buffer);
    const names = Object.keys(zip.files).filter((n) => !zip.files[n]!.dir);
    expect(names).toContain('00_Verzeichnis.pdf');
    expect(names).toContain('verzeichnis.csv');
    for (const e of expected) {
      const f = await zip.file(`nachweise/${e.nachweis_nr}.pdf`)!.async('nodebuffer');
      expect(sha(f)).toBe(e.pdf_sha256);
    }
    const index = await zip.file('00_Verzeichnis.pdf')!.async('nodebuffer');
    const t = (await pdfText(index)).text.replace(/\s/g, '');
    expect(t).toContain('Nachweismappe');
    for (const e of expected) {
      expect(t).toContain(e.verify_code);
      expect(t).toContain(e.pdf_sha256);
    }
    verifySeal(index);
    const audit = (await dozent.get('/api/audit')).body.find((e: { entity: string; action: string }) => e.entity === 'export' && e.action === 'nachweismappe');
    expect(audit.payload).toMatchObject({ count: expected.length });
    // Filter Org-Einheit + Rollen
    const auditor = (await memberClient(h, dozent, { email: 'pruefer@example.org', name: 'Petra Prüfer', roles: ['auditor'] })).client;
    expect((await auditor.post('/api/exports/nachweismappe', { from: addDays(today(), -30), to: today() })).status).toBe(200);
    expect((await kai.post('/api/exports/nachweismappe', { from: addDays(today(), -30), to: today() })).status).toBe(403);
    expect((await dozent.post('/api/exports/nachweismappe', { from: '2020-01-01', to: '2020-01-31' })).status).toBe(404);
  });
});
