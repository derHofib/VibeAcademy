import { addDays, addMonths, berlinDate } from '@sn/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock, FakeClock } from '../src/common/clock';
import { DeadlineService } from '../src/deadlines/deadline.service';
import { makeTestPdf } from '../src/trainings/pdf-fixtures';
import { publishedTraining, registerDozent } from './fixtures';
import { memberClient } from './fg-fixtures';
import { startHarness, waitFor, type Client, type Harness } from './harness';

/**
 * Fristen-Engine (Schritt 2.2) als Zeitreise-Test über 14 Monate:
 * T−7/T−2/T+1 genau einmal je Einladung, Eskalation an den Vorgesetzten, überfällig, automatische Wiedereinladung vor Ablauf,
 * „neuen Termin buchen“ bei externen Kursen, Neueinladung nach inhaltlicher Version – keine Duplikate bei Wiederholung.
 */
const DAY = 86_400_000;
// Start: heute 02:00 Europe/Berlin (= 01:00Z im Winter) – DB-Zeitstempel und Uhr liegen nah beieinander
const start = new Date(`${berlinDate(new Date())}T01:00:00Z`);
const clock = new FakeClock(start);
let h: Harness;
let dozent: Client;
let svc: DeadlineService;
let anna: string;
let tobias: string;
let efkTraining: string;
let reqEfk: string;
let reqEh: string;
let dsTraining: string;
let extRecord: string;

const q = async (sql: string, params: unknown[] = []) => (await h.db.admin.query(sql, params)).rows;
const day = (d: number) => new Date(start.getTime() + d * DAY);
const notices = (personId: string) => q(`SELECT key, kind, stage, invitation_id, created_at FROM deadline_notice WHERE person_id = $1 ORDER BY created_at, key`, [personId]);
const outbox = async () => (await q(`SELECT count(*)::int AS n FROM notification`))[0].n as number;

beforeAll(async () => {
  h = await startHarness([{ provide: Clock, useValue: clock }]);
  svc = h.app.get(DeadlineService);
  dozent = await registerDozent(h);
  const kai = (await dozent.post('/api/persons', { name: 'Kai Neumann', email: 'kai@example.org' })).body.id;
  const elektro = (await dozent.post('/api/org-units', { name: 'Elektro', leiterPersonId: kai })).body.id;
  await dozent.patch(`/api/persons/${kai}`, { orgUnitId: elektro });
  anna = (await dozent.post('/api/persons', { name: 'Anna Schulz', email: 'anna@example.org', orgUnitId: elektro })).body.id;
  tobias = (await dozent.post('/api/persons', { name: 'Tobias Meier', email: 'tobias@example.org', orgUnitId: elektro })).body.id;

  // EFK: Online-Unterweisung, jährlich
  ({ trainingId: efkTraining } = await publishedTraining(dozent, { wordsPerPage: [60, 40] }));
  await dozent.patch(`/api/trainings/${efkTraining}`, { titel: 'EFK-Unterweisung' });
  const efk = (await dozent.post('/api/qualifications', { name: 'EFK' })).body.id;
  reqEfk = (await dozent.post('/api/requirements', { qualificationId: efk, trainingId: efkTraining, intervalMonths: 12 })).body.id;
  // Ersthelfer: externer Kurs, alle 2 Jahre
  const ehTraining = (await dozent.post('/api/trainings', { titel: 'Erste-Hilfe-Fortbildung', format: 'extern', quizRequired: false })).body.id;
  const eh = (await dozent.post('/api/qualifications', { name: 'Ersthelfer' })).body.id;
  reqEh = (await dozent.post('/api/requirements', { qualificationId: eh, trainingId: ehTraining, intervalMonths: 24 })).body.id;
  await dozent.post(`/api/qualifications/${efk}/persons`, { personIds: [anna] });
  await dozent.post(`/api/qualifications/${eh}/persons`, { personIds: [anna] });
  // Ersthelfer-Nachweis läuft am Tag 45 ab
  const validUntil = berlinDate(day(45));
  const rec = await dozent.post('/api/external-records', { personIds: [anna], requirementId: reqEh, provider: 'DRK', heldOn: addMonths(validUntil, -24) });
  expect(rec.status).toBe(201);
  extRecord = rec.body.records[0].id;
  expect(rec.body.records[0].validUntil).toBe(validUntil);

  // Datenschutz (ohne Pflichtmatrix): Tobias hat Version 1 bestätigt
  ({ trainingId: dsTraining } = await publishedTraining(dozent, { wordsPerPage: [30, 30, 30] }));
  await dozent.patch(`/api/trainings/${dsTraining}`, { titel: 'Datenschutz' });
  const run = (await dozent.post('/api/runs', { trainingId: dsTraining })).body.id;
  await dozent.post(`/api/runs/${run}/invite`, { personIds: [tobias], sendMail: false });
  await q(`UPDATE invitation SET status = 'bestaetigt', completed_at = $2 WHERE run_id = $1`, [run, start]);
  await memberClient(h, dozent, { email: 'kai@example.org', name: 'Kai Neumann', roles: ['vorgesetzter'], personId: kai });
}, 120_000);
afterAll(async () => h?.close());

describe('Fristen-Engine – Zeitreise über 14 Monate', () => {
  it('Stufen genau einmal, Eskalation, überfällig, Wiedereinladung, „neuen Termin buchen“, neue Version; idempotent', async () => {
    const annaInvitations = () =>
      q(`SELECT i.id, i.status, i.due_at, i.auto_reason, i.completed_at FROM invitation i JOIN run r ON r.id = i.run_id WHERE i.person_id = $1 AND r.training_id = $2 ORDER BY i.created_at`, [anna, efkTraining]);
    let completedFirst = false;
    let completedSecond = false;
    let publishedV2 = false;
    for (let d = 0; d <= 425; d++) {
      clock.set(day(d));
      await svc.run();
      if (d % 50 === 0 || d === 15) {
        // Wiederholung am selben Tag erzeugt nichts Neues
        const before = await outbox();
        const again = await svc.run();
        expect(again.reminders + again.escalations + again.reinvitations + again.bookCourse + again.newVersion).toBe(0);
        expect(await outbox()).toBe(before);
      }
      const invs = await annaInvitations();
      if (d === 0) {
        expect(invs).toHaveLength(1);
        expect(invs[0]).toMatchObject({ status: 'offen', auto_reason: 'fehlt' });
      }
      if (d === 20 && !completedFirst) {
        // Anna schließt die (überfällige) erste Einladung ab
        await q(`UPDATE invitation SET status = 'bestaetigt', completed_at = $2 WHERE id = $1`, [invs[0].id, clock.now()]);
        completedFirst = true;
      }
      if (invs.length === 2 && !completedSecond && new Date(invs[1].due_at).getTime() - clock.now().getTime() < 1.5 * DAY) {
        await q(`UPDATE invitation SET status = 'bestaetigt', completed_at = $2 WHERE id = $1`, [invs[1].id, clock.now()]);
        completedSecond = true;
      }
      if (d === 102) {
        // Tobias bestätigt die neue Version zügig
        await q(
          `UPDATE invitation i SET status = 'bestaetigt', completed_at = $3 FROM run r
            WHERE r.id = i.run_id AND i.person_id = $1 AND r.training_id = $2 AND i.status <> 'bestaetigt'`,
          [tobias, dsTraining, clock.now()],
        );
      }
      if (d === 100 && !publishedV2) {
        const pdf = await makeTestPdf({ wordsPerPage: [31, 30, 30] });
        const v2 = (await dozent.upload(`/api/trainings/${dsTraining}/versions`, 'datei', pdf, 'datenschutz-v2.pdf')).body.id;
        await waitFor(async () => (await dozent.get(`/api/trainings/${dsTraining}/versions/${v2}`)).body.status === 'bereit', 15000);
        expect((await dozent.post(`/api/trainings/${dsTraining}/versions/${v2}/publish`, { changeKind: 'inhaltlich', changedPages: [2] })).status).toBe(201);
        publishedV2 = true;
      }
    }

    // ── EFK: erste Einladung (fehlt) mit T−7, T−2, T+1, überfällig, Eskalation – je genau einmal ──
    const invs = await annaInvitations();
    expect(invs.map((i) => i.auto_reason)).toEqual(['fehlt', 'ablauf']);
    expect(invs.every((i) => i.status === 'bestaetigt')).toBe(true);
    const n = await notices(anna);
    const forInv = (id: string) => n.filter((x) => x.invitation_id === id).map((x) => `${x.kind}:${x.stage ?? ''}`).sort();
    expect(forInv(invs[0].id)).toEqual(['erinnerung:T+1', 'erinnerung:T-2', 'erinnerung:T-7', 'eskalation:', 'ueberfaellig:']);
    const dayOf = (key: string) => Math.round((new Date(n.find((x) => x.key === key)!.created_at).getTime() - start.getTime()) / DAY);
    expect([dayOf(`inv:${invs[0].id}:T-7`), dayOf(`inv:${invs[0].id}:T-2`), dayOf(`inv:${invs[0].id}:T+1`), dayOf(`inv:${invs[0].id}:eskalation`)]).toEqual([7, 12, 15, 15]);
    // zweite Einladung (Ablauf): 30 Tage vor Ablauf, fristgerecht erledigt → nur T−7 und T−2, keine Eskalation
    expect(forInv(invs[1].id)).toEqual(['erinnerung:T-2', 'erinnerung:T-7']);
    const validUntil1 = addMonths(berlinDate(day(20)), 12);
    const reinviteKey = `req:${anna}:${reqEfk}:${validUntil1}:einladung`;
    expect(dayOf(reinviteKey)).toBe(Math.round((Date.parse(`${addDays(validUntil1, -30)}T01:00:00Z`) - start.getTime()) / DAY));
    expect(berlinDate(new Date(invs[1].due_at))).toBe(validUntil1);

    // Mails: 5 Erinnerungen an Anna, 1 Eskalation an Kai, 1 „neuen Termin buchen“
    const mails = await q(`SELECT recipient, template, data FROM notification WHERE channel = 'mail' ORDER BY created_at`);
    expect(mails.filter((m) => m.recipient === 'anna@example.org' && m.template === 'invitation' && m.data.reminder).length).toBe(5);
    expect(mails.filter((m) => m.recipient === 'anna@example.org' && m.template === 'invitation' && !m.data.reminder).length).toBe(2);
    const esc = mails.filter((m) => m.template === 'deadline-escalation');
    expect(esc).toHaveLength(1);
    expect(esc[0]).toMatchObject({ recipient: 'kai@example.org', data: { personName: 'Anna Schulz', trainingTitle: 'EFK-Unterweisung', supervisorName: 'Kai Neumann' } });
    // überfällig markiert und im Audit
    expect((await q(`SELECT count(*)::int AS n FROM audit_event WHERE entity = 'invitation' AND entity_id = $1 AND action = 'overdue'`, [invs[0].id]))[0].n).toBe(1);

    // ── Ersthelfer (extern): genau ein Hinweis „neuen Termin buchen“, 30 Tage vor Ablauf; danach abgelaufen ──
    const book = n.filter((x) => x.kind === 'termin_buchen');
    expect(book).toHaveLength(1);
    expect(dayOf(book[0].key)).toBe(15);
    expect(mails.filter((m) => m.template === 'book-course')).toHaveLength(1);
    expect((await q('SELECT status FROM external_record WHERE id = $1', [extRecord]))[0].status).toBe('abgelaufen');
    const comp = (await dozent.get(`/api/compliance?person=${anna}`)).body;
    expect(comp.rows.find((r: { requirementId: string }) => r.requirementId === reqEh)).toMatchObject({ state: 'abgelaufen', validUntil: berlinDate(day(45)) });
    expect(comp.rows.find((r: { requirementId: string }) => r.requirementId === reqEfk)).toMatchObject({ state: 'gueltig' });

    // ── Neue inhaltliche Version: Tobias (gültiger Nachweis v1) genau einmal neu eingeladen, nur geänderte Seiten ──
    const tv = await q(
      `SELECT i.auto_reason, i.changed_pages, v.version_no FROM invitation i JOIN run r ON r.id = i.run_id JOIN training_version v ON v.id = r.training_version_id
        WHERE i.person_id = $1 AND r.training_id = $2 ORDER BY v.version_no`,
      [tobias, dsTraining],
    );
    expect(tv).toEqual([
      { auto_reason: null, changed_pages: null, version_no: 1 },
      { auto_reason: 'neue_version', changed_pages: [2], version_no: 2 },
    ]);
    expect((await notices(tobias)).filter((x) => x.kind === 'neue_version')).toHaveLength(1);
  }, 600_000);

  it('manuell auslösbar und ohne Rechte gesperrt; Dashboard zeigt Kennzahlen', async () => {
    const r = await dozent.post('/api/admin/deadlines/run');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ tenants: 1, reminders: 0 });
    const kai = await h.agent();
    await kai.post('/api/auth/login', { email: 'kai@example.org', password: 'KaiNeumann-passwort-1' });
    expect((await kai.post('/api/admin/deadlines/run')).status).toBe(403);
    const d = (await dozent.get('/api/dashboard')).body;
    expect(d.compliance).toMatchObject({ gesamt: 2, erfuellt: 1, abgelaufen: 1, erfuellungsquote: 50 });
    expect(d).toHaveProperty('kpi.erledigt');
    expect(d).toHaveProperty('externZuPruefen', 0);
    const log = (await dozent.get(`/api/deadlines/notices?person=${anna}`)).body;
    expect(log.length).toBeGreaterThanOrEqual(10);
  });
});
