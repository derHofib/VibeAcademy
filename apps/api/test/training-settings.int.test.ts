import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock, FakeClock } from '../src/common/clock';
import { DeadlineService } from '../src/deadlines/deadline.service';
import { invitedParticipant, publishedTraining, registerDozent } from './fixtures';
import { startHarness, waitFor, type Client, type Harness } from './harness';

/**
 * Phase 4.1 (E-51/E-56): Einstellungen je Schulung – Anlass, Durchführungsart, Standard-Zielgruppe,
 * Protokoll mit Vorher/Nachher, Schnappschuss je Durchführung (spätere Änderungen verändern Nachweise nicht),
 * Erinnerungsstufen je Schulung.
 */
const clock = new FakeClock(new Date('2026-12-01T08:00:00Z'));
let h: Harness;
let dozent: Client;
let trainingId: string;
const DAY = 86_400_000;
const q = async (sql: string, p: unknown[] = []) => (await h.db.admin.query(sql, p)).rows;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function pdfText(buf: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
  let s = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    s += tc.items.map((x) => ('str' in x ? x.str : '')).join(' ') + '\n';
  }
  return s.replace(/\s+/g, ' ');
}
const binary = (res: { on: (e: string, cb: (d?: Buffer) => void) => void }, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (d) => chunks.push(d!));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

beforeAll(async () => {
  h = await startHarness([{ provide: Clock, useValue: clock }]);
  dozent = await registerDozent(h);
  ({ trainingId } = await publishedTraining(dozent, { wordsPerPage: [40, 40], questions: 5, settings: { quizQuestionCount: 5, passPct: 80 } }));
}, 120_000);
afterAll(async () => h?.close());

describe('Einstellungen je Schulung', () => {
  it('Anlass, Durchführungsart, Live-Online-Vorgaben und Zielgruppe speichern; Standardwerte', async () => {
    const t0 = (await dozent.get(`/api/trainings/${trainingId}`)).body;
    expect(t0).toMatchObject({ anlassTyp: 'erst', anlassText: null, defaultDelivery: 'online', defaultOrgUnits: [] });
    expect(t0.settings).toMatchObject({ countersignRequired: true, reminderDaysBefore: [7, 2], reminderDaysAfter: 1 });

    const unit = (await dozent.post('/api/org-units', { name: 'Service Nord' })).body.id;
    const r = await dozent.patch(`/api/trainings/${trainingId}`, {
      anlassTyp: 'anlass', anlassText: 'Beinahe-Unfall am 12.11.2026 in Halle 3', defaultDelivery: 'live_online',
      defaultPlatform: 'teams', defaultMeetingUrl: 'https://teams.microsoft.com/l/meetup-join/abc', defaultOrgUnits: [unit],
    });
    expect(r.status).toBe(200);
    const t1 = (await dozent.get(`/api/trainings/${trainingId}`)).body;
    expect(t1).toMatchObject({
      anlassTyp: 'anlass', anlassText: 'Beinahe-Unfall am 12.11.2026 in Halle 3', defaultDelivery: 'live_online',
      defaultPlatform: 'teams', defaultOrgUnits: [unit], format: 'praesenz',
    });
  });

  it('prüft Eingaben: Anlass braucht Text, Link nur https, unbekannte Org-Einheit, Rollen', async () => {
    const noText = await dozent.patch(`/api/trainings/${trainingId}`, { anlassText: '' });
    expect(noText.status).toBe(400);
    expect(noText.body.fields).toEqual([{ path: 'anlassText', message: 'Bitte den Anlass bzw. das Ereignis beschreiben' }]);
    const http = await dozent.patch(`/api/trainings/${trainingId}`, { defaultMeetingUrl: 'http://zoom.us/j/1' });
    expect(http.status).toBe(400);
    expect(http.body.fields[0]).toMatchObject({ path: 'defaultMeetingUrl', message: 'Bitte einen Link mit https:// angeben' });
    const unknown = await dozent.patch(`/api/trainings/${trainingId}`, { defaultOrgUnits: ['00000000-0000-4000-8000-000000000000'] });
    expect(unknown.status).toBe(400);
    expect((await dozent.patch(`/api/trainings/${trainingId}`, { defaultDelivery: 'fernstudium' })).status).toBe(400);
    const bad = await dozent.patch(`/api/trainings/${trainingId}/settings`, { reminderDaysBefore: [40] });
    expect(bad.status).toBe(400);
  });

  it('Protokoll mit Vorher/Nachher nur für tatsächlich geänderte Werte', async () => {
    await dozent.patch(`/api/trainings/${trainingId}/settings`, { passPct: 90, strictMode: true });
    const audit = await q(`SELECT action, payload FROM audit_event WHERE entity = 'training' AND entity_id = $1 ORDER BY seq`, [trainingId]);
    const settings = audit.filter((a) => a.action === 'settings_changed').at(-1)!;
    expect(settings.payload.changes).toEqual({ passPct: { from: 80, to: 90 } });
    const upd = audit.filter((a) => a.action === 'updated').at(-1)!;
    expect(upd.payload.changes.defaultDelivery).toEqual({ from: 'online', to: 'live_online' });
    expect(upd.payload.changes.anlassTyp).toEqual({ from: 'erst', to: 'anlass' });
    await dozent.patch(`/api/trainings/${trainingId}/settings`, { passPct: 80 });
    // ohne Änderung kein weiterer Eintrag
    const n = (await q(`SELECT count(*)::int AS n FROM audit_event WHERE entity_id = $1 AND action = 'settings_changed'`, [trainingId]))[0].n;
    await dozent.patch(`/api/trainings/${trainingId}/settings`, { passPct: 80 });
    expect((await q(`SELECT count(*)::int AS n FROM audit_event WHERE entity_id = $1 AND action = 'settings_changed'`, [trainingId]))[0].n).toBe(n);
  });
});

describe('Schnappschuss je Durchführung', () => {
  it('spätere Änderungen ändern weder Wissenscheck-Regeln noch Nachweis einer laufenden Einladung', async () => {
    const x = await invitedParticipant(h, dozent, trainingId, { name: 'Lea Wagner', email: 'lea@example.org' });
    const snap = (await q('SELECT training_snapshot, settings_snapshot FROM run WHERE id = $1', [x.runId]))[0];
    expect(snap.training_snapshot).toMatchObject({ titel: 'Sicherheitsunterweisung 2026', anlass_typ: 'anlass' });
    expect(snap.settings_snapshot).toMatchObject({ passPct: 80 });

    // Nach dem Einladen: Titel, Anlass und Bestehensgrenze ändern
    await dozent.patch(`/api/trainings/${trainingId}`, { titel: 'Neuer Titel 2027', anlassText: 'Gesetzesänderung 2027' });
    await dozent.patch(`/api/trainings/${trainingId}/settings`, { passPct: 100 });

    // Lesen, Quiz mit 4 von 5 (80 %): nach dem Schnappschuss bestanden, nach den neuen Werten nicht
    const s = await x.participant.post(`/api/me/invitations/${x.invitationId}/sessions`);
    let seq = 0;
    for (const [page, n] of [[1, 4], [2, 4]] as const) {
      for (let i = 0; i < n; i++) {
        clock.advance(5000);
        await x.participant.post(`/api/me/reading-sessions/${s.body.sessionId}/heartbeat`, { seq: seq++, page, visibleRatio: 1, focused: true, lastInputAgeMs: 500 });
      }
    }
    const quiz = (await x.participant.get(`/api/me/invitations/${x.invitationId}/quiz`)).body;
    let i = 0;
    for (const question of quiz.attempt.questions) {
      await x.participant.post(`/api/me/invitations/${x.invitationId}/quiz/answers`, { attemptId: quiz.attempt.id, questionId: question.id, option: i++ === 0 ? 0 : 1 });
    }
    const result = (await x.participant.post(`/api/me/invitations/${x.invitationId}/quiz/finish`, { attemptId: quiz.attempt.id })).body;
    expect(result).toMatchObject({ scorePct: 80, passed: true });

    await x.participant.post(`/api/me/invitations/${x.invitationId}/otp`);
    const mail = await waitFor(async () => (await dozent.get('/api/dev/postausgang?an=lea@example.org')).body.find((m: { subject: string }) => m.subject.startsWith('Ihr Bestätigungscode')));
    const code = /(\d{6})/.exec(mail.subject)![1]!;
    const token = (await x.participant.post(`/api/me/invitations/${x.invitationId}/step-up`, { code })).body.stepUpToken;
    const info = (await x.participant.get(`/api/me/invitations/${x.invitationId}/signature`)).body;
    const signed = await x.participant.post(`/api/me/invitations/${x.invitationId}/signature`, {
      stepUpToken: token, confirmed: true, confirmTextSha256: info.confirmTextSha256, strokes: [[{ x: 1, y: 2 }, { x: 5, y: 9 }]], imagePng: PNG,
    });
    expect(signed.status).toBe(201);
    await waitFor(async () => (await x.participant.get(`/api/me/invitations/${x.invitationId}/evidence`)).body.status === 'erzeugt', 30000);
    const pdf = (await x.participant.http.get(`/api/me/invitations/${x.invitationId}/evidence/pdf`).buffer(true).parse(binary)).body as Buffer;
    const text = await pdfText(pdf);
    expect(text).toContain('Sicherheitsunterweisung 2026');
    expect(text).not.toContain('Neuer Titel 2027');
    const squeezed = text.replace(/\s/g, '');
    expect(squeezed).toContain('Anlass:Anlassbezogen–Beinahe-Unfallam12.11.2026inHalle3');
    expect(squeezed).toContain('Format:Online');
    expect(squeezed).not.toContain('Gesetzesänderung2027');
    expect(text).toContain('80 %');

    // eine neue Durchführung übernimmt die neuen Werte
    const run2 = (await dozent.post('/api/runs', { trainingId })).body.id;
    const snap2 = (await q('SELECT training_snapshot, settings_snapshot FROM run WHERE id = $1', [run2]))[0];
    expect(snap2.training_snapshot).toMatchObject({ titel: 'Neuer Titel 2027', anlass_text: 'Gesetzesänderung 2027' });
    expect(snap2.settings_snapshot).toMatchObject({ passPct: 100 });
  }, 90_000);
});

describe('Erinnerungsstufen je Schulung', () => {
  it('nur die eingestellten Stufen (3 Tage vorher, keine danach)', async () => {
    const { trainingId: t2 } = await publishedTraining(dozent, { wordsPerPage: [30], settings: { reminderDaysBefore: [3], reminderDaysAfter: 0 } });
    const person = (await dozent.post('/api/persons', { name: 'Kai Neumann', email: 'kai@example.org' })).body.id;
    const due = new Date(clock.now().getTime() + 10 * DAY);
    const run = (await dozent.post('/api/runs', { trainingId: t2, deadline: due.toISOString() })).body.id;
    await dozent.post(`/api/runs/${run}/invite`, { personIds: [person], sendMail: false });
    const svc = h.app.get(DeadlineService);
    const stages = async () =>
      (await q(`SELECT n.stage FROM deadline_notice n JOIN invitation i ON i.id = n.invitation_id WHERE i.run_id = $1 AND n.kind = 'erinnerung' ORDER BY n.created_at`, [run])).map((r) => r.stage);
    clock.set(new Date(due.getTime() - 7 * DAY + 3600_000));
    await svc.run();
    expect(await stages()).toEqual([]); // Standard T-7 ist abgeschaltet
    clock.set(new Date(due.getTime() - 3 * DAY + 3600_000));
    await svc.run();
    expect(await stages()).toEqual(['T-3']);
    clock.set(new Date(due.getTime() + 2 * DAY));
    await svc.run();
    expect(await stages()).toEqual(['T-3']); // keine Stufe nach der Frist
  }, 90_000);
});
