import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock, FakeClock } from '../src/common/clock';
import { DOZENT, publishedTraining, registerDozent } from './fixtures';
import { startHarness, waitFor, type Client, type Harness } from './harness';

/**
 * Phase 4.2 (E-52–E-54), Abnahme: „Anlassbezogene Arbeitsschutzunterweisung – Die fünf Sicherheitsregeln“ als
 * Live-Online (Teams) für ein vergangenes Datum anlegen, Teams-Anwesenheitsliste importieren, vom Dozenten bestätigen →
 * je Teilnehmer ein Nachweis mit Anlass, Plattform und echtem Datum. Dazu Kombiniert, Regeln, Revisionssicherheit.
 */
const clock = new FakeClock(new Date('2026-11-27T09:00:00Z'));
let h: Harness;
let dozent: Client;
let trainingId: string;
let runId: string;
const persons: Record<string, string> = {};
const q = async (sql: string, p: unknown[] = []) => (await h.db.admin.query(sql, p)).rows;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const TEAMS = [
  '1. Zusammenfassung',
  'Besprechungstitel\tUnterweisung Die fünf Sicherheitsregeln',
  'Startzeit\t18.11.26, 09:00:05',
  '',
  '2. Teilnehmer',
  'Name\tErster Beitritt\tLetztes Verlassen\tDauer der Besprechung\tE-Mail-Adresse\tTeilnehmer-ID (UPN)\tRolle',
  'Dennis Hofmann\t18.11.26, 08:58:00\t18.11.26, 10:00:30\t1 Std. 2 Min. 30 Sek.\tdennis.hofmann@muster-elektro.de\tdennis.hofmann@muster-elektro.de\tOrganisator',
  'Lea Wagner\t18.11.26, 09:01:12\t18.11.26, 10:00:05\t58 Min. 53 Sek.\tlea.wagner@muster-elektro.de\tlea.wagner@muster-elektro.de\tTeilnehmer',
  'Anna Schulz\t18.11.26, 09:12:00\t18.11.26, 10:00:00\t43 Min.\tanna.schulz@muster-elektro.de\tanna.schulz@muster-elektro.de\tTeilnehmer',
  'Neumann, Kai\t18.11.26, 08:59:00\t18.11.26, 10:00:00\t1 Std. 1 Min.\tkai.privat@gmx.de\tkai.privat@gmx.de\tTeilnehmer',
  'Becker, Jonas (Gast)\t18.11.26, 09:05:00\t18.11.26, 09:59:00\t54 Min.\tj.becker@subunternehmer.de\t\tTeilnehmer',
].join('\r\n');
const utf16 = (s: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]);

async function pdfText(buf: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
  let s = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    s += tc.items.map((x) => ('str' in x ? x.str : '')).join(' ') + '\n';
  }
  return s.replace(/\s/g, '');
}
const binary = (res: { on: (e: string, cb: (d?: Buffer) => void) => void }, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (d) => chunks.push(d!));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

beforeAll(async () => {
  h = await startHarness([{ provide: Clock, useValue: clock }]);
  dozent = await registerDozent(h);
  ({ trainingId } = await publishedTraining(dozent, { wordsPerPage: [40], questions: 1, settings: { quizQuestionCount: 1 } }));
  await dozent.patch(`/api/trainings/${trainingId}`, {
    titel: 'Anlassbezogene Arbeitsschutzunterweisung – Die fünf Sicherheitsregeln',
    anlassTyp: 'anlass', anlassText: 'Beinahe-Unfall am 12.11.2026 in Halle 3', defaultDelivery: 'live_online', defaultPlatform: 'teams',
  });
  for (const [name, email] of [['Lea Wagner', 'lea.wagner@muster-elektro.de'], ['Anna Schulz', 'anna.schulz@muster-elektro.de'], ['Kai Neumann', 'kai@muster-elektro.de'], ['Tobias Meier', null]] as const) {
    persons[name] = (await dozent.post('/api/persons', { name, email })).body.id;
  }
}, 120_000);
afterAll(async () => h?.close());

const base = () => ({
  trainingId, delivery: 'live_online', platform: 'teams', startAt: '2026-11-18T09:00:00+01:00', endAt: '2026-11-18T10:00:00+01:00',
  reason: 'Unterweisung kurzfristig per Teams gehalten (Kollegen auf Montage).',
});

describe('Nachträgliche Erfassung – Live-Online per Teams', () => {
  it('Regeln beim Anlegen: Ende in der Vergangenheit, Begründung, Plattform', async () => {
    const future = await dozent.post('/api/runs/nachtraeglich', { ...base(), startAt: '2026-11-28T09:00:00+01:00', endAt: '2026-11-28T10:00:00+01:00' });
    expect(future.status).toBe(400);
    expect(future.body.fields[0]).toMatchObject({ path: 'endAt', message: 'Das Ende muss in der Vergangenheit liegen' });
    const short = await dozent.post('/api/runs/nachtraeglich', { ...base(), reason: 'kurz' });
    expect(short.status).toBe(400);
    expect(short.body.fields[0].path).toBe('reason');
    expect((await dozent.post('/api/runs/nachtraeglich', { ...base(), platform: null })).status).toBe(400);
  });

  it('anlegen → sofort beendet, Vermerk gespeichert, Termin in der Liste', async () => {
    const r = await dozent.post('/api/runs/nachtraeglich', base());
    expect(r.status).toBe(201);
    runId = r.body.id;
    const row = (await q('SELECT typ, delivery, platform, status, ended_at, backdated_reason, backdated_by_name FROM run WHERE id = $1', [runId]))[0];
    expect(row).toMatchObject({ typ: 'termin', delivery: 'live_online', platform: 'teams', status: 'beendet', backdated_by_name: 'Dennis Hofmann' });
    expect(row.backdated_reason).toContain('per Teams');
    const list = (await dozent.get('/api/termine')).body as Array<{ id: string; delivery: string; backdated_at: string }>;
    expect(list.find((x) => x.id === runId)).toMatchObject({ delivery: 'live_online' });
    // kein QR, kein Check-in
    expect((await dozent.get(`/api/runs/${runId}/qr?kind=start`)).status).toBeGreaterThanOrEqual(400);
  });

  it('Teams-Bericht importieren: Zuordnung per E-Mail, Vorschlag per Name, Unbekannte, Anwesenheit in %', async () => {
    const r = await dozent.upload(`/api/runs/${runId}/nachtraeglich/import`, 'datei', utf16(TEAMS), 'Anwesenheitsbericht.csv');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ format: 'teams', plannedMinutes: 60, completenessPct: 90 });
    const rows = r.body.rows as Array<{ name: string; match: { personId: string; by: string } | null; pct: number; state: string }>;
    const by = (n: string) => rows.find((x) => x.name.startsWith(n))!;
    expect(by('Lea').match).toMatchObject({ personId: persons['Lea Wagner'], by: 'email' });
    expect(by('Lea')).toMatchObject({ pct: 98, state: 'vollstaendig' });
    expect(by('Anna')).toMatchObject({ pct: 71, state: 'teilweise' });
    expect(by('Neumann').match).toMatchObject({ personId: persons['Kai Neumann'], by: 'name' });
    expect(by('Becker').match).toBeNull();
    expect(by('Dennis').match).toBeNull();
    (globalThis as Record<string, unknown>).importId = r.body.importId;
    (globalThis as Record<string, unknown>).rows = rows;
  });

  it('Anwesenheit übernehmen (Gast neu anlegen), Beleg hochladen; noch keine Nachweise', async () => {
    const importId = (globalThis as Record<string, unknown>).importId as string;
    const rows = (globalThis as Record<string, unknown>).rows as Array<{ index: number; name: string; match: { personId: string } | null }>;
    const pick = (n: string) => rows.find((x) => x.name.startsWith(n))!;
    const r = await dozent.post(`/api/runs/${runId}/nachtraeglich/anwesenheit`, {
      importId,
      entries: [
        { index: pick('Lea').index, personId: pick('Lea').match!.personId },
        { index: pick('Anna').index, personId: pick('Anna').match!.personId },
        { index: pick('Neumann').index, personId: pick('Neumann').match!.personId },
        { index: pick('Becker').index, newPerson: { name: 'Jonas Becker', email: 'j.becker@subunternehmer.de' } },
        { personId: persons['Tobias Meier'] }, // Checkliste ohne Zeiten → ganze Dauer
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body.createdPersons).toBe(1);
    const st = (await dozent.get(`/api/runs/${runId}/nachtraeglich`)).body;
    expect(st.attendances).toHaveLength(5);
    const anna = st.attendances.find((a: { name: string }) => a.name === 'Anna Schulz');
    expect(anna).toMatchObject({ state: 'teilweise', pct: 71, release: 'abgelehnt', source: 'import' });
    expect(st.attendances.find((a: { name: string }) => a.name === 'Tobias Meier')).toMatchObject({ state: 'vollstaendig', pct: 100, source: 'trainer' });
    const receipt = await dozent.upload(`/api/runs/${runId}/nachtraeglich/belege`, 'datei', PNG, 'Bildschirmfoto Teams.png');
    expect(receipt.status).toBe(201);
    expect((await dozent.upload(`/api/runs/${runId}/nachtraeglich/belege`, 'datei', Buffer.from('nope'), 'x.exe')).status).toBe(400);
    expect((await q('SELECT count(*)::int AS n FROM evidence e JOIN attendance a ON a.id = e.attendance_id WHERE a.run_id = $1', [runId]))[0].n).toBe(0);
  });

  it('Gegenzeichnung des Dozenten → je Person ein Nachweis mit Anlass, Plattform, echtem Datum, Vermerk', async () => {
    expect((await dozent.post(`/api/runs/${runId}/nachtraeglich/gegenzeichnen`, { password: 'falsch-falsch' })).status).toBe(401);
    const cs = await dozent.post(`/api/runs/${runId}/nachtraeglich/gegenzeichnen`, { password: DOZENT.password });
    expect(cs.status).toBe(200);
    expect(cs.body.evidenceQueued).toBe(5);
    const ev = await waitFor(async () => {
      const rows = await q(`SELECT e.id, e.status, e.verify_code, p.name FROM evidence e JOIN attendance a ON a.id = e.attendance_id JOIN person p ON p.id = a.person_id WHERE a.run_id = $1`, [runId]);
      return rows.length === 5 && rows.every((x) => x.status === 'erzeugt') && rows;
    }, 60_000);
    const lea = ev.find((x: { name: string }) => x.name === 'Lea Wagner');
    const pdf = (await dozent.http.get(`/api/evidence/${lea.id}/pdf`).buffer(true).parse(binary)).body as Buffer;
    const text = await pdfText(pdf);
    for (const s of [
      'NachweisüberdieTeilnahmeaneinerLive-Online-Schulung',
      'AnlassbezogeneArbeitsschutzunterweisung–DiefünfSicherheitsregeln',
      'Anlass:Anlassbezogen–Beinahe-Unfallam12.11.2026inHalle3',
      'Art:Live-Online·MicrosoftTeams',
      '18.11.2026·09:00–10:00',
      'Nachträglicherfasstam27.11.2026',
      'vonDennisHofmann',
      'UnterweisungkurzfristigperTeamsgehalten',
      'Zeitquelle:TeilnehmerlistebzwAnwesenheitsbericht'.replace('bzw', 'bzw.'),
      'mitderGegenzeichnungdesDozenten',
      'BildschirmfotoTeams.png',
    ]) {
      expect(text, s).toContain(s);
    }
    // Prüfseite
    const v = (await h.agent().then((c) => c.get(`/api/verify/${lea.verify_code}`))).body;
    expect(v).toMatchObject({ status: 'gueltig', details: { art: 'Live-Online · Microsoft Teams', datum: '18.11.2026' } });
    expect(v.details.erfassung).toMatch(/^nachträglich erfasst am 27\.11\.2026 von Dennis Hofmann \(Unterweisung kurzfristig per Teams/);
    // Anna (71 %): Nachweis dokumentiert „teilweise“, wird aber nicht angerechnet
    const anna = (await q(`SELECT i.status FROM invitation i WHERE i.run_id = $1 AND i.person_id = $2`, [runId, persons['Anna Schulz']]))[0];
    expect(anna.status).not.toBe('bestaetigt');
    const leaInv = (await q(`SELECT status FROM invitation WHERE run_id = $1 AND person_id = $2`, [runId, persons['Lea Wagner']]))[0];
    expect(leaInv.status).toBe('bestaetigt');
  }, 120_000);

  it('revisionssicher: nach der Gegenzeichnung keine Änderungen, alles im Protokoll', async () => {
    const again = await dozent.post(`/api/runs/${runId}/nachtraeglich/anwesenheit`, { entries: [{ personId: persons['Lea Wagner'] }] });
    expect(again.status).toBe(409);
    await expect(h.db.admin.query(`UPDATE attendance_interval SET out_at = in_at WHERE attendance_id IN (SELECT id FROM attendance WHERE run_id = $1)`, [runId])).rejects.toThrow(/unveränderlich/);
    const actions = (await q(`SELECT action FROM audit_event WHERE entity_id = $1 ORDER BY seq`, [runId])).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['backdated_created', 'attendance_imported', 'backdated_attendance', 'receipt_added', 'countersigned']));
  });
});

describe('Kombiniert', () => {
  it('Präsenz in der Vergangenheit per Checkliste; nach der Gegenzeichnung Online-Bestätigung für alle', async () => {
    const r = await dozent.post('/api/runs/nachtraeglich', {
      ...base(), delivery: 'praesenz', platform: null, ort: 'Halle 3', kombiniert: true, reason: 'Papierliste nachgetragen, Bestätigung folgt online.',
    });
    expect(r.status).toBe(201);
    const id = r.body.id;
    expect((await dozent.post(`/api/runs/${id}/nachtraeglich/anwesenheit`, { entries: [{ personId: persons['Lea Wagner'] }, { personId: persons['Kai Neumann'] }] })).status).toBe(200);
    const cs = await dozent.post(`/api/runs/${id}/nachtraeglich/gegenzeichnen`, { password: DOZENT.password });
    expect(cs.status).toBe(200);
    expect(cs.body).toMatchObject({ followupInvited: 2 });
    const f = (await q(`SELECT typ, status, training_id FROM run WHERE id = $1`, [cs.body.followupRunId]))[0];
    expect(f).toMatchObject({ typ: 'kampagne', status: 'laeuft', training_id: trainingId });
    expect((await q(`SELECT count(*)::int AS n FROM invitation WHERE run_id = $1`, [cs.body.followupRunId]))[0].n).toBe(2);
  }, 120_000);

  it('nur Admin/Verantwortliche; Import nur bei nachträglich erfassten Terminen', async () => {
    const t = await dozent.post('/api/runs/termin', { typ: 'termin', trainingId, startAt: '2026-12-01T09:00:00+01:00', endAt: '2026-12-01T10:00:00+01:00' });
    const imp = await dozent.upload(`/api/runs/${t.body.id}/nachtraeglich/import`, 'datei', utf16(TEAMS), 'bericht.csv');
    expect(imp.status).toBe(409);
    const anon = await h.agent();
    expect((await anon.post('/api/runs/nachtraeglich', base())).status).toBe(401);
  });
});
