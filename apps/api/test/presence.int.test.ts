/* eslint-disable @typescript-eslint/no-explicit-any -- SSE-/JSON-Antworten in Tests werden nur stichprobenartig geprüft */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock, FakeClock } from '../src/common/clock';
import { AttendanceService } from '../src/presence/attendance.service';
import { DOZENT } from './fixtures';
import { ROOT, sealEnv, startHarness, waitFor, type Client, type Harness } from './harness';

/**
 * Präsenz- und Live-Erfassung (Schritte 2.3–2.5, 2.7): QR-Tokens, Intervalle, Vollständigkeit, manuelles Ausloggen,
 * offizielles Ende, Live-Fragen, Kontrollfragen per SSE, Bestätigung, Erinnerung, versiegelter Nachweis.
 * Alle Zeiten über die steuerbare Uhr („Zeitreise“). Termin: 04.12.2026, 08:00–15:30 Berlin = 07:00–14:30 UTC.
 */
const clock = new FakeClock(new Date('2026-12-04T06:00:00Z'));
const at = (hhmmss: string, day = '2026-12-04') => clock.set(`${day}T${hhmmss}Z`);
let h: Harness;
let port: number;
let dozent: Client;
let dozentCookie: string;

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const sessionCookie = (setCookie: string[] | string | undefined) =>
  ([] as string[]).concat(setCookie ?? []).map((c) => c.split(';')[0]!).filter((c) => c.startsWith('sn_session=')).join('; ');
const binary = (res: { on: (e: string, cb: (d?: Buffer) => void) => void }, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (d) => chunks.push(d!));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
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
const squeeze = (s: string) => s.replace(/\s/g, '').toLowerCase();

/** Minimaler SSE-Client (EventSource-Protokoll) für die Tests. */
class Sse {
  events: Array<{ event: string; id: string; data: any }> = [];
  private req!: http.ClientRequest;
  status = 0;
  static open(path: string, cookie: string, lastEventId?: string): Promise<Sse> {
    const s = new Sse();
    return new Promise((resolve, reject) => {
      s.req = http.get(
        { host: '127.0.0.1', port, path, headers: { cookie, accept: 'text/event-stream', ...(lastEventId ? { 'last-event-id': lastEventId } : {}) } },
        (res) => {
          s.status = res.statusCode ?? 0;
          res.setEncoding('utf8');
          let buf = '';
          res.on('data', (chunk: string) => {
            buf += chunk;
            let i: number;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const block = buf.slice(0, i);
              buf = buf.slice(i + 2);
              const ev = { event: 'message', id: '', data: '' };
              for (const line of block.split('\n')) {
                if (line.startsWith('event: ')) ev.event = line.slice(7);
                else if (line.startsWith('id: ')) ev.id = line.slice(4);
                else if (line.startsWith('data: ')) ev.data += line.slice(6);
              }
              if (ev.data) s.events.push({ ...ev, data: JSON.parse(ev.data) });
            }
          });
          resolve(s);
        },
      );
      s.req.on('error', reject);
    });
  }
  async next(event: string, pred: (d: any) => boolean = () => true, timeoutMs = 5000) {
    return waitFor(async () => this.events.find((e) => e.event === event && pred(e.data)), timeoutMs);
  }
  close() {
    this.req.destroy();
  }
}

async function person(name: string, email?: string) {
  const r = await dozent.post('/api/persons', { name, email });
  expect(r.status).toBe(201);
  return r.body.id as string;
}

/** Persönlichen Link aus der Termin-Einladung öffnen → Link-Sitzung. */
async function openLink(email: string, subject: string) {
  const mail = await waitFor(async () =>
    ((await dozent.get(`/api/dev/postausgang?an=${email}`)).body as Array<{ subject: string; text: string }>).find((m) => m.subject.includes(subject)),
  );
  const token = /\/s\/([A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
  const client = await h.agent();
  const r = await client.post('/api/participant/session', { token });
  expect(r.status).toBe(200);
  return { client, invitationId: r.body.invitationId as string, cookie: sessionCookie(r.headers['set-cookie']), mail };
}

const qr = async (runId: string, kind: 'start' | 'end' = 'start') => {
  const r = await dozent.get(`/api/runs/${runId}/qr?kind=${kind}`);
  expect(r.status).toBe(200);
  return r.body.token as string;
};
const row = async (runId: string, name: string) =>
  ((await dozent.get(`/api/runs/${runId}/attendance`)).body.rows as Array<Record<string, any>>).find((r) => r.personName === name)!;

beforeAll(async () => {
  h = await startHarness([{ provide: Clock, useValue: clock }]);
  await h.app.listen(0, '127.0.0.1');
  port = (h.app.getHttpServer().address() as AddressInfo).port;
  dozent = await h.agent();
  const reg = await dozent.post('/api/auth/register', DOZENT);
  expect(reg.status).toBe(201);
  dozentCookie = sessionCookie(reg.headers['set-cookie']);
});
afterAll(async () => h?.close());

describe('Externe Schulung live (Screens 12/13)', () => {
  let runId: string;
  const ids: Record<string, string> = {};
  const p: Record<string, Awaited<ReturnType<typeof openLink>>> = {};
  let t1: string;
  let endToken: string;
  let wissenscheckId: string;

  it('Termin mit freiem Titel + Anbieter anlegen und Personen einladen (persönlicher Link)', async () => {
    ids.anna = await person('Anna Schulz', 'anna@example.org');
    ids.julia = await person('Julia Becker', 'julia@example.org');
    ids.tobias = await person('Tobias Meier', 'tobias@example.org');
    ids.sven = await person('Sven Albrecht', 'sven@example.org');
    ids.mehmet = await person('Mehmet Aydın');
    ids.jonas = await person('Jonas Krüger', 'jonas@example.org');
    const bad = await dozent.post('/api/runs/termin', { typ: 'live_extern', startAt: '2026-12-04T08:00:00+01:00', endAt: '2026-12-04T07:00:00+01:00' });
    expect(bad.status).toBe(400);
    const r = await dozent.post('/api/runs/termin', {
      typ: 'live_extern', titel: 'Erste-Hilfe-Fortbildung', provider: 'Erste-Hilfe-Ausbildung Muster e. V.', ort: 'Schulungsraum Lager',
      startAt: '2026-12-04T08:00:00+01:00', endAt: '2026-12-04T15:30:00+01:00', personIds: Object.values(ids),
    });
    expect(r.status).toBe(201);
    expect(r.body.invited).toMatchObject({ created: 6, mailsQueued: 5, withoutEmail: [ids.mehmet] });
    runId = r.body.id;
    for (const n of ['anna', 'julia', 'tobias', 'sven', 'jonas']) p[n] = await openLink(`${n}@example.org`, 'Erste-Hilfe-Fortbildung am 04.12.2026');
    expect(p.anna!.mail.text).toContain('08:00–15:30');
    const list = (await dozent.get('/api/termine')).body;
    expect(list[0]).toMatchObject({ id: runId, typ: 'live_extern', titel: 'Erste-Hilfe-Fortbildung', status: 'geplant', invited: 6 });
    const mine = (await p.anna!.client.get('/api/me/invitations')).body;
    expect(mine[0]).toMatchObject({ typ: 'live_extern', run_id: runId, training_titel: 'Erste-Hilfe-Fortbildung' });
    const state = (await p.anna!.client.get(`/api/me/invitations/${p.anna!.invitationId}/live`)).body;
    expect(state).toMatchObject({ role: 'participant', run: { titel: 'Erste-Hilfe-Fortbildung', plannedSeconds: 27000, completenessPct: 90 }, attendance: { status: 'nicht_eingecheckt' } });
  });

  it('gedruckter Aushang nur im Zeitfenster (30 min vor Beginn)', async () => {
    at('06:00:00');
    const printed = (await dozent.get(`/api/runs/${runId}/qr/print?kind=start`)).body;
    expect(printed).toMatchObject({ mode: 'gedruckt', validWindow: { from: '2026-12-04T06:30:00.000Z', until: '2026-12-04T15:30:00.000Z' } });
    expect(printed.svg).toContain('<svg');
    at('06:20:00');
    const early = await p.jonas!.client.post('/api/checkin', { token: printed.token });
    expect(early.status).toBe(400);
    expect(early.body.code).toBe('ausserhalb_zeitfenster');
  });

  it('rotierender QR: neu alle 30 s, signiert, an Art gebunden; vorheriger Slot ok, vorletzter nicht; Scanzeit = Serverzeit', async () => {
    at('06:56:00');
    const q1 = (await dozent.get(`/api/runs/${runId}/qr?kind=start`)).body;
    expect(q1).toMatchObject({ mode: 'rotierend', rotatesEverySeconds: 30, expiresInSeconds: 30 });
    expect(q1.url).toBe(`http://localhost:5173/q/${q1.token}`);
    t1 = q1.token;
    const a = await p.anna!.client.post('/api/checkin', { token: t1 });
    expect(a.status).toBe(200);
    expect(a.body.me).toMatchObject({ checkedIn: true, firstIn: '2026-12-04T06:56:00.000Z', inMethod: 'qr_start', status: 'anwesend' });
    expect((await p.anna!.client.post('/api/checkin', { token: t1 })).body.alreadyCheckedIn).toBe(true);

    clock.advance(30_000);
    const t2 = await qr(runId);
    expect(t2).not.toBe(t1);
    const j = await p.julia!.client.post('/api/checkin', { token: t1 }); // vorheriger Slot
    expect(j.status).toBe(200);
    expect(j.body.me.firstIn).toBe('2026-12-04T06:56:30.000Z');

    clock.advance(30_000);
    const late = await p.tobias!.client.post('/api/checkin', { token: t1 }); // vorletzter Slot
    expect(late.body.code).toBe('abgelaufen');
    endToken = await qr(runId, 'end');
    expect((await p.tobias!.client.post('/api/checkin', { token: endToken })).body.code).toBe('falsche_art');
    const forged = `${t2.split('.')[0]}.${'A'.repeat(22)}`;
    expect((await p.tobias!.client.post('/api/checkin', { token: forged })).body.code).toBe('signatur');
    expect((await p.tobias!.client.post('/api/checkin', { token: 'kein-qr-code-von-uns-1234' })).body.code).toBe('format');

    at('06:59:00');
    const k = await dozent.post(`/api/runs/${runId}/attendance/checkin`, { personId: ids.mehmet, method: 'kiosk' });
    expect(k.status).toBe(200);
    expect(k.body.rows.find((r: { personName: string }) => r.personName === 'Mehmet Aydın')).toMatchObject({ checkedIn: true, inMethod: 'kiosk', inMethodLabel: 'Tablet' });
    at('07:01:00');
    expect((await p.tobias!.client.post('/api/checkin', { token: await qr(runId) })).status).toBe(200);
  });

  it('Offline-Scan: Scanzeit = signierter Slot-Beginn, nicht die Geräteuhr', async () => {
    at('07:03:10');
    const t3 = await qr(runId);
    at('07:20:00');
    expect((await p.sven!.client.post('/api/checkin', { token: t3 })).body.code).toBe('abgelaufen');
    const r = await p.sven!.client.post('/api/checkin', { token: t3, offline: true, deviceTime: '2026-12-04T09:00:00+01:00' });
    expect(r.status).toBe(200);
    expect(r.body.me.intervals[0]).toMatchObject({ in: '2026-12-04T07:03:00.000Z', inOffline: true });
  });

  it('Start; Wiedereintritt erzeugt ein zweites Intervall', async () => {
    at('07:30:00');
    expect((await dozent.post(`/api/runs/${runId}/start`)).body).toMatchObject({ status: 'laeuft' });
    at('09:00:00');
    expect((await p.tobias!.client.post('/api/checkout', { token: await qr(runId, 'end') })).body.me).toMatchObject({ checkedIn: false, outMethod: 'qr_end' });
    at('09:30:00');
    const again = await p.tobias!.client.post('/api/checkin', { token: await qr(runId) });
    expect(again.body.me.intervals).toHaveLength(2);
  });

  it('Live-Fragen: anonym ohne person_id, „Ich auch“ einmal je Person, sortiert nach Stimmen, Status', async () => {
    at('10:00:00');
    const qa = await p.anna!.client.post(`/api/runs/${runId}/questions`, { text: 'Wie oft muss der Defibrillator im Betrieb geprüft werden?', anonymous: false });
    expect(qa.status).toBe(201);
    const qj = await p.julia!.client.post(`/api/runs/${runId}/questions`, { text: 'Darf ich als Ersthelfer Medikamente ausgeben?', anonymous: true });
    expect(qj.body).toMatchObject({ anonymous: true });
    // nicht eingecheckt → keine Fragen
    expect((await p.jonas!.client.post(`/api/runs/${runId}/questions`, { text: 'Darf ich auch?', anonymous: false })).status).toBe(403);
    // anonym: kein Personenbezug in der Datenbank, auch nicht im Audit
    const db = (await h.db.admin.query('SELECT person_id FROM live_question WHERE id = $1', [qj.body.id])).rows[0];
    expect(db.person_id).toBeNull();
    const audit = (await h.db.admin.query(`SELECT actor_person_id, actor_account_id, payload FROM audit_event WHERE entity = 'live_question' AND entity_id = $1`, [qj.body.id])).rows[0];
    expect(audit).toMatchObject({ actor_person_id: null, actor_account_id: null, payload: { anonymous: true } });

    expect((await p.tobias!.client.post(`/api/questions/${qj.body.id}/vote`)).body).toMatchObject({ votes: 1, voted: true });
    expect((await p.tobias!.client.post(`/api/questions/${qj.body.id}/vote`)).status).toBe(409);
    expect((await p.sven!.client.post(`/api/questions/${qj.body.id}/vote`)).body.votes).toBe(2);
    expect((await p.julia!.client.post(`/api/questions/${qa.body.id}/vote`)).body.votes).toBe(1);
    expect((await p.anna!.client.post(`/api/questions/${qa.body.id}/vote`)).status).toBe(409); // eigene Frage

    const org = (await dozent.get(`/api/runs/${runId}/questions`)).body;
    expect(org.map((q: { votes: number; author: string | null }) => [q.votes, q.author])).toEqual([[2, null], [1, 'Anna Schulz']]);
    const mine = (await p.anna!.client.get(`/api/runs/${runId}/questions`)).body;
    expect(mine).toEqual([
      expect.objectContaining({ author: 'anonym', anonymous: true, mine: false, voted: false }),
      expect.objectContaining({ author: 'du', mine: true }),
    ]);
    expect((await p.julia!.client.get(`/api/runs/${runId}/questions`)).body[1]).toMatchObject({ author: 'Anna S.', voted: true });

    expect((await dozent.patch(`/api/questions/${qj.body.id}`, { status: 'beantwortet' })).body).toMatchObject({ status: 'beantwortet' });
    expect((await dozent.patch(`/api/questions/${qa.body.id}`, { status: 'per_mail' })).status).toBe(200);
    await dozent.patch(`/api/questions/${qa.body.id}`, { status: 'offen' });
    const after = (await dozent.get(`/api/runs/${runId}/questions`)).body;
    expect(after.map((q: { status: string }) => q.status)).toEqual(['offen', 'beantwortet']);
    // Teilnehmer dürfen den Status nicht setzen
    expect((await p.anna!.client.patch(`/api/questions/${qa.body.id}`, { status: 'beantwortet' })).status).toBe(403);
  });

  it('Ohne QR beenden: nur mit Grund + Vermerk ≥ 10 Zeichen → „Vermerk prüfen“', async () => {
    at('11:53:00');
    const short = await p.sven!.client.post('/api/checkout/manual', { reason: 'vorzeitig', note: 'Notdienst' });
    expect(short.status).toBe(400);
    expect(short.body.fields[0]).toMatchObject({ path: 'note' });
    expect((await p.sven!.client.post('/api/checkout/manual', { reason: '', note: 'Notdienst-Einsatz beim Kunden ab 13 Uhr' })).status).toBe(400);
    const ok = await p.sven!.client.post('/api/checkout/manual', { reason: 'vorzeitig', note: 'Notdienst-Einsatz beim Kunden ab 13 Uhr' });
    expect(ok.status).toBe(200);
    expect(ok.body.me).toMatchObject({
      checkedIn: false, outMethod: 'manual', manual: { reason: 'vorzeitig', reasonLabel: 'Vorzeitig gegangen' }, noteReview: 'offen', canConfirm: true,
      durationSeconds: (4 * 60 + 50) * 60, completenessState: 'teilweise', completenessPct: 64,
    });
    expect(await row(runId, 'Sven Albrecht')).toMatchObject({ status: 'vermerk_pruefen', statusLabel: 'Vermerk prüfen' });
    expect((await p.sven!.client.post(`/api/runs/${runId}/questions`, { text: 'Noch eine Frage?', anonymous: false })).status).toBe(403);
  });

  it('Kontrollfragen erreichen alle Eingecheckten per SSE; Live-Auswertung; Wissenscheck vs. Stimmungsbild', async () => {
    at('12:00:00');
    const orgSse = await Sse.open(`/api/runs/${runId}/live`, dozentCookie);
    const annaSse = await Sse.open(`/api/runs/${runId}/live`, p.anna!.cookie);
    const juliaSse = await Sse.open(`/api/runs/${runId}/live`, p.julia!.cookie);
    const svenSse = await Sse.open(`/api/runs/${runId}/live`, p.sven!.cookie);
    const fremd = await Sse.open(`/api/runs/${runId}/live`, '');
    try {
      expect(fremd.status).toBe(401);
      const snap = await orgSse.next('snapshot');
      expect(snap.data).toMatchObject({ role: 'organizer', run: { status: 'laeuft' }, attendance: { kpis: { present: 4, manual: 1, notesToReview: 1, missing: 1 } } });
      expect(snap.data.questions).toHaveLength(2);
      expect((await annaSse.next('snapshot')).data).toMatchObject({ role: 'participant', attendance: { personName: 'Anna Schulz', checkedIn: true }, polls: { openPoll: null } });

      const poll = await dozent.post(`/api/runs/${runId}/polls`, {
        mode: 'wissenscheck', question: 'Was tust du bei einem Stromunfall zuerst?', correct: 1,
        options: ['Sofort mit der Herzdruckmassage beginnen', 'Den Stromkreis unterbrechen', 'Die Person vom Gerät wegziehen'],
        explanation: 'Eigenschutz zuerst – sonst wirst du selbst durchströmt.',
      });
      expect(poll.status).toBe(201);
      wissenscheckId = poll.body.id;
      expect(poll.body).toMatchObject({ open: true, answered: 0, eligible: 4 });
      // eine zweite gleichzeitig offene Frage geht nicht
      expect((await dozent.post(`/api/runs/${runId}/polls`, { mode: 'stimmungsbild', question: 'Zweite?', options: ['a', 'b'] })).status).toBe(409);

      const forAnna = await annaSse.next('polls', (d) => d.openPoll?.id === wissenscheckId);
      expect(forAnna.data.openPoll).toMatchObject({ question: 'Was tust du bei einem Stromunfall zuerst?', mode: 'wissenscheck', myAnswer: null });
      expect(JSON.stringify(forAnna.data.openPoll)).not.toContain('correct');
      await juliaSse.next('polls', (d) => d.openPoll?.id === wissenscheckId);
      // ausgecheckt → bekommt die Frage nicht
      await svenSse.next('polls');
      expect(svenSse.events.filter((e) => e.event === 'polls').every((e) => e.data.openPoll === null)).toBe(true);

      const a = await p.anna!.client.post(`/api/polls/${wissenscheckId}/answers`, { option: 1 });
      expect(a.body).toMatchObject({ correct: true, correctOption: 1, explanation: expect.stringContaining('Eigenschutz'), late: false });
      expect((await p.anna!.client.post(`/api/polls/${wissenscheckId}/answers`, { option: 1 })).status).toBe(409);
      expect((await p.julia!.client.post(`/api/polls/${wissenscheckId}/answers`, { option: 0 })).body.correct).toBe(false);
      expect((await p.sven!.client.post(`/api/polls/${wissenscheckId}/answers`, { option: 1 })).status).toBe(403);
      const live = await orgSse.next('polls', (d) => d.active?.answered === 2);
      expect(live.data.active).toMatchObject({ distribution: [1, 1, 0], rightPct: 50, eligible: 4 });
      expect((await annaSse.next('polls', (d) => d.openPoll?.myAnswer)).data.openPoll.myAnswer).toMatchObject({ option: 1, correct: true });
      expect((await dozent.post(`/api/polls/${wissenscheckId}/close`)).body).toMatchObject({ open: false, answered: 2, rightPct: 50 });
      await annaSse.next('polls', (d) => d.openPoll === null && annaSse.events.some((e) => e.data?.openPoll?.id === wissenscheckId));

      const mood = await dozent.post(`/api/runs/${runId}/polls`, { mode: 'stimmungsbild', question: 'Wie sicher fühlst du dich jetzt?', options: ['sicher', 'eher sicher', 'unsicher'] });
      expect(mood.status).toBe(201);
      await juliaSse.next('polls', (d) => d.openPoll?.id === mood.body.id);
      expect((await p.anna!.client.post(`/api/polls/${mood.body.id}/answers`, { option: 0 })).body).toEqual({ mode: 'stimmungsbild', option: 0, late: false });
      expect((await p.julia!.client.post(`/api/polls/${mood.body.id}/answers`, { option: 1 })).status).toBe(201);
      expect((await p.julia!.client.post(`/api/polls/${mood.body.id}/answers`, { option: 2 })).status).toBe(409);
      const stored = (await h.db.admin.query('SELECT person_id, answered_at, correct FROM live_poll_answer WHERE poll_id = $1', [mood.body.id])).rows;
      expect(stored).toEqual([{ person_id: null, answered_at: null, correct: null }, { person_id: null, answered_at: null, correct: null }]);
      expect((await h.db.admin.query('SELECT count(*)::int n FROM live_poll_participant WHERE poll_id = $1', [mood.body.id])).rows[0].n).toBe(2);
      const res = (await dozent.post(`/api/polls/${mood.body.id}/close`)).body;
      expect(res).toMatchObject({ mode: 'stimmungsbild', answered: 2, distribution: [1, 1, 0], rightPct: null });
      expect((await dozent.get(`/api/runs/${runId}/polls`)).body.list).toHaveLength(2);
      const pool = await dozent.get(`/api/runs/${runId}/poll-pool`);
      expect(pool.body).toEqual([]); // freier Titel → kein Fragenpool

      // Wiederverbindung mit Last-Event-ID → vollständiger Zustand
      const lastId = orgSse.events[orgSse.events.length - 1]!.id;
      const again = await Sse.open(`/api/runs/${runId}/live`, dozentCookie, lastId);
      const s2 = await again.next('snapshot');
      expect(s2.data.resumedFrom).toBe(lastId);
      expect(Number(s2.id)).toBeGreaterThanOrEqual(Number(lastId));
      again.close();
    } finally {
      for (const s of [orgSse, annaSse, juliaSse, svenSse, fremd]) s.close();
    }
  });

  it('Vermerk prüfen: Rückfrage (mit Nachricht) und Akzeptieren', async () => {
    at('13:00:00');
    const sven = await row(runId, 'Sven Albrecht');
    expect((await dozent.post(`/api/attendance/${sven.attendanceId}/review`, { decision: 'rueckfrage' })).status).toBe(400);
    const r = await dozent.post(`/api/attendance/${sven.attendanceId}/review`, { decision: 'rueckfrage', message: 'Bitte Einsatzauftrag nachreichen.' });
    expect(r.body).toMatchObject({ status: 'rueckfrage', statusLabel: 'Rückfrage gesendet', noteReviewMessage: 'Bitte Einsatzauftrag nachreichen.' });
    const mail = await waitFor(async () => (await dozent.get('/api/dev/postausgang?an=sven@example.org')).body.find((m: { subject: string }) => m.subject.startsWith('Rückfrage zu Ihrem Vermerk')));
    expect(mail.text).toContain('Bitte Einsatzauftrag nachreichen.');
    expect((await p.sven!.client.post(`/api/attendance/${sven.attendanceId}/review`, { decision: 'akzeptiert' })).status).toBe(403);
  });

  it('„Offiziell beenden“: offizielles Ende für alle Eingecheckten, QR-Codes ungültig, Push zur Bestätigung', async () => {
    at('14:26:00');
    expect((await p.anna!.client.post('/api/checkout', { token: await qr(runId, 'end') })).body.me).toMatchObject({
      outMethod: 'qr_end', durationSeconds: (7 * 60 + 26) * 60, completenessPct: 99, completenessState: 'vollstaendig',
    });
    at('14:30:00');
    const lastStart = await qr(runId);
    const end = await dozent.post(`/api/runs/${runId}/end`);
    expect(end.body).toMatchObject({ status: 'beendet', endedAt: '2026-12-04T14:30:00.000Z', closedWithOfficialEnd: 3, notified: 5 });
    expect((await dozent.post(`/api/runs/${runId}/end`)).status).toBe(409);
    expect((await dozent.get(`/api/runs/${runId}/qr?kind=start`)).status).toBe(409);
    expect((await dozent.get(`/api/runs/${runId}/qr/print?kind=end`)).status).toBe(409);
    expect((await p.jonas!.client.post('/api/checkin', { token: lastStart })).body.code).toBe('beendet');

    const tobias = await row(runId, 'Tobias Meier');
    expect(tobias.intervals.map((i: { outMethod: string }) => i.outMethod)).toEqual(['qr_end', 'official_end']);
    // 08:01–10:00 + 10:30–15:30 (vergessenes Auschecken → offizielles Ende) = 6 h 59 min = 93 %
    expect(tobias).toMatchObject({ durationSeconds: (6 * 60 + 59) * 60, completenessPct: 93, completenessState: 'vollstaendig', status: 'bestaetigung_offen' });
    expect(await row(runId, 'Julia Becker')).toMatchObject({ outMethod: 'official_end', completenessPct: 100 });
    expect(await row(runId, 'Mehmet Aydın')).toMatchObject({ outMethod: 'official_end', outMethodLabel: 'offizielles Ende' });
    expect(await row(runId, 'Jonas Krüger')).toMatchObject({ status: 'nicht_teilgenommen', attendanceId: null });
    expect(await row(runId, 'Sven Albrecht')).toMatchObject({ status: 'rueckfrage', completenessState: 'teilweise' });
    const push = (
      await h.db.admin.query(`SELECT recipient, data FROM notification WHERE channel = 'push' AND template = 'attendance-confirm' ORDER BY recipient`)
    ).rows;
    expect(push.map((n) => n.recipient).sort()).toEqual(['anna', 'julia', 'mehmet', 'sven', 'tobias'].map((n) => `person:${ids[n]}`).sort());
    expect(push[0].data).toMatchObject({ trainingTitle: 'Erste-Hilfe-Fortbildung', url: expect.stringContaining('/teilnahme/') });
    // offene Kontrollfragen werden mit dem Ende geschlossen; nach dem Ende keine neuen
    expect((await dozent.post(`/api/runs/${runId}/polls`, { mode: 'stimmungsbild', question: 'Noch eine?', options: ['a', 'b'] })).status).toBe(409);
  });

  it('Nicht Eingecheckte holen Wissenscheck-Fragen nach dem Ende nach', async () => {
    at('14:40:00');
    const s = (await p.sven!.client.get(`/api/me/invitations/${p.sven!.invitationId}/live`)).body;
    expect(s.polls.pendingPolls.map((x: { id: string }) => x.id)).toEqual([wissenscheckId]);
    const r = await p.sven!.client.post(`/api/polls/${wissenscheckId}/answers`, { option: 1 });
    expect(r.body).toMatchObject({ correct: true, late: true });
    expect((await p.jonas!.client.post(`/api/polls/${wissenscheckId}/answers`, { option: 1 })).status).toBe(409); // war nicht da
    expect((await p.anna!.client.get(`/api/me/invitations/${p.anna!.invitationId}/live`)).body.polls).toMatchObject({
      pendingPolls: [], myResults: [{ pollId: wissenscheckId, option: 1, correct: true }],
    });
  });

  it('Bestätigung → versiegelter Nachweis mit allen Angaben (nur Wissenscheck personenbezogen)', async () => {
    at('15:00:00');
    const a = (await row(runId, 'Anna Schulz')).attendanceId;
    expect((await p.anna!.client.post(`/api/attendance/${a}/confirm`, { confirmed: false })).status).toBe(400);
    expect((await p.julia!.client.post(`/api/attendance/${a}/confirm`, { confirmed: true })).status).toBe(404); // fremde Teilnahme
    const c = await p.anna!.client.post(`/api/attendance/${a}/confirm`, { confirmed: true });
    expect(c.status).toBe(200);
    expect(c.body.me).toMatchObject({ status: 'bestaetigt', confirmedAt: '2026-12-04T15:00:00.000Z', confirmedVia: 'selbst' });
    expect((await p.anna!.client.post(`/api/attendance/${a}/confirm`, { confirmed: true })).status).toBe(409);
    const ev = await waitFor(async () => {
      const r = await p.anna!.client.get(`/api/me/invitations/${p.anna!.invitationId}/attendance/evidence`);
      return r.status === 200 && r.body.status === 'erzeugt' && r.body;
    }, 30_000);
    expect(ev.nachweisNr).toMatch(/^N-2026-\d{5}$/);
    const pdf = (await p.anna!.client.http.get(`/api/me/invitations/${p.anna!.invitationId}/attendance/evidence/pdf`).buffer(true).parse(binary)).body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    if (process.env.SN_SAVE_EVIDENCE) writeFileSync(`${process.env.SN_SAVE_EVIDENCE}-live.pdf`, pdf);
    const text = squeeze(await pdfText(pdf));
    for (const s of [
      'Nachweis über die Teilnahme an einer externen Schulung', 'Erste-Hilfe-Fortbildung', 'Erste-Hilfe-Ausbildung Muster e. V.', 'Schulungsraum Lager',
      '04.12.2026', '08:00–15:30', 'Anna Schulz', '07:56', 'Start-QR', '15:26', 'Ende-QR', '7 h 26 min', 'vollständig', 'Vollständig ab 90 %',
      'Was tust du bei einem Stromunfall zuerst?', 'Den Stromkreis unterbrechen', 'richtig', 'Rückfrage gestellt',
      'Ich bestätige, dass ich wie angegeben an der Schulung teilgenommen habe.', 'bestätigt 04.12.2026', 'Echtheit prüfen', ev.nachweisNr,
    ]) {
      expect(text, s).toContain(squeeze(s));
    }
    expect(text).not.toContain(squeeze('Wie sicher fühlst du dich jetzt?')); // Stimmungsbild nicht im Nachweis
    const env = sealEnv();
    if (env.SEAL_MODE === 'pyhanko') {
      const out = JSON.parse(execFileSync(env.SEAL_PYTHON!, [join(ROOT, 'infra/seal/verify.py'), join(ROOT, '.local/certs/ca.pem')], { input: pdf }).toString());
      expect(out).toMatchObject({ signed: true, intact: true, valid: true, trusted: true });
      expect(out.timestamp).toBeTruthy();
    }
    const verify = (await (await h.agent()).get(`/api/verify/${ev.verifyCode}`)).body;
    expect(verify).toMatchObject({ status: 'gueltig', schulung: 'Erste-Hilfe-Fortbildung', teilnehmer: 'AS.', art: 'live' });
    expect(await row(runId, 'Anna Schulz')).toMatchObject({ status: 'bestaetigt', evidence: { status: 'erzeugt' } });
    // Einladung gilt als erledigt
    expect((await h.db.admin.query('SELECT status FROM invitation WHERE id = $1', [p.anna!.invitationId])).rows[0].status).toBe('bestaetigt');
  });

  it('„teilweise“ + Vermerk: Nachweis erst nach Akzeptieren und Freigabe der Anrechnung', async () => {
    const s = (await row(runId, 'Sven Albrecht')).attendanceId;
    await p.sven!.client.post(`/api/attendance/${s}/confirm`, { confirmed: true });
    const noEv = async () => (await p.sven!.client.get(`/api/me/invitations/${p.sven!.invitationId}/attendance/evidence`)).status === 404;
    expect(await noEv()).toBe(true);
    expect((await dozent.post(`/api/attendance/${s}/review`, { decision: 'akzeptiert' })).body).toMatchObject({ noteReview: 'akzeptiert', status: 'bestaetigt' });
    expect(await noEv()).toBe(true);
    expect((await dozent.post(`/api/attendance/${(await row(runId, 'Anna Schulz')).attendanceId}/release`, { decision: 'freigegeben' })).status).toBe(409);
    expect((await dozent.post(`/api/attendance/${s}/release`, { decision: 'freigegeben', note: 'Notdienst, Inhalte nachgeholt' })).body.release).toBe('freigegeben');
    const ev = await waitFor(async () => {
      const r = await p.sven!.client.get(`/api/me/invitations/${p.sven!.invitationId}/attendance/evidence`);
      return r.status === 200 && r.body.status === 'erzeugt' && r.body;
    }, 30_000);
    const pdf = (await p.sven!.client.http.get(`/api/me/invitations/${p.sven!.invitationId}/attendance/evidence/pdf`).buffer(true).parse(binary)).body as Buffer;
    const text = squeeze(await pdfText(pdf));
    for (const x of ['Vorzeitig gegangen', 'Notdienst-Einsatz beim Kunden ab 13 Uhr', 'akzeptiert', 'teilweise', '4 h 50 min', 'Anrechnung freigegeben', 'nach dem Ende nachgeholt', 'offline nachsynchronisiert']) {
      expect(text, x).toContain(squeeze(x));
    }
    expect(text).not.toContain(squeeze('Rückfrage gestellt (Frage')); // Sven hat nur abgestimmt, keine eigene Frage
    expect(ev.nachweisNr).toBeTruthy();
  });

  it('Bestätigung am Tablet (ohne Smartphone) mit Unterschrift', async () => {
    const m = await row(runId, 'Mehmet Aydın');
    expect((await dozent.post(`/api/attendance/${m.attendanceId}/kiosk-confirm`, { signaturePng: 'data:image/png;base64,AAAA' })).status).toBe(400);
    const r = await dozent.post(`/api/attendance/${m.attendanceId}/kiosk-confirm`, { signaturePng: PNG });
    expect(r.body).toMatchObject({ confirmedVia: 'kiosk', status: 'bestaetigt' });
    await waitFor(async () => (await row(runId, 'Mehmet Aydın')).evidence?.status === 'erzeugt', 30_000);
  });

  it('Erinnerung nach 48 h ohne Bestätigung – genau einmal', async () => {
    const svc = h.app.get(AttendanceService);
    at('14:29:00', '2026-12-06');
    expect(await svc.remindUnconfirmed()).toBe(0);
    at('14:31:00', '2026-12-06');
    expect(await svc.remindUnconfirmed()).toBe(2); // Julia, Tobias
    expect(await svc.remindUnconfirmed()).toBe(0);
    const n = (await h.db.admin.query(`SELECT channel, recipient FROM notification WHERE template = 'attendance-confirm-reminder' ORDER BY channel, recipient`)).rows;
    expect(n.filter((x) => x.channel === 'mail').map((x) => x.recipient)).toEqual(['julia@example.org', 'tobias@example.org']);
    expect(n.filter((x) => x.channel === 'push')).toHaveLength(2);
    await waitFor(async () => (await dozent.get('/api/dev/postausgang?an=julia@example.org')).body.find((m: { subject: string }) => m.subject.startsWith('Erinnerung: Teilnahme')));
  });

  it('Audit-Kette enthält die Abläufe und ist gültig', async () => {
    expect((await dozent.get('/api/audit/verify')).body.ok).toBe(true);
    const actions = new Set((await dozent.get('/api/audit')).body.map((e: { entity: string; action: string }) => `${e.entity}.${e.action}`));
    for (const a of [
      'run.created', 'run.invited', 'run.qr_printed', 'run.started', 'run.ended', 'attendance.checked_in', 'attendance.checked_out', 'attendance.checked_out_manual',
      'attendance.closed_official_end', 'attendance.note_reviewed', 'attendance.release_decided', 'attendance.confirmed', 'attendance.finalized',
      'attendance.confirm_reminded', 'live_question.asked', 'live_question.voted', 'live_question.status_changed', 'live_poll.opened', 'live_poll.answered',
      'live_poll.participated', 'live_poll.closed', 'evidence.created',
    ]) {
      expect(actions.has(a), a).toBe(true);
    }
  });
});

describe('Interne Präsenz (Screen 7): Aushang, Check-in ohne Einladung, Tablet, Gegenzeichnung', () => {
  let runId: string;
  let lea: Awaited<ReturnType<typeof openLink>>;
  let walkIn: { client: Client; invitationId: string };
  let ninaId: string;

  it('Termin aus dem Katalog anlegen', async () => {
    at('05:00:00', '2026-12-10');
    const t = await dozent.post('/api/trainings', { titel: 'Erste Hilfe Auffrischung', format: 'praesenz', rechtsgrundlage: 'DGUV Vorschrift 1 § 26' });
    const qq = await dozent.post(`/api/trainings/${t.body.id}/questions`, {
      text: 'Welche Notrufnummer gilt europaweit?', options: ['110', '112', '116 117'], correct: 1, explanation: 'Die 112 gilt in der ganzen EU.',
    });
    expect(qq.status).toBe(201);
    expect((await dozent.post('/api/runs/termin', { typ: 'termin', titel: 'Ohne Katalog', startAt: '2026-12-10T08:00:00+01:00', endAt: '2026-12-10T10:00:00+01:00' })).status).toBe(400);
    const leaId = await person('Lea Wagner', 'lea@example.org');
    ninaId = await person('Nina Lorenz');
    const r = await dozent.post('/api/runs/termin', {
      typ: 'termin', trainingId: t.body.id, ort: 'Schulungsraum Lager', startAt: '2026-12-10T08:00:00+01:00', endAt: '2026-12-10T10:00:00+01:00',
      personIds: [leaId], completenessPct: 80,
    });
    expect(r.status).toBe(201);
    runId = r.body.id;
    lea = await openLink('lea@example.org', 'Erste Hilfe Auffrischung am 10.12.2026');
  });

  it('gedruckter Code im Fenster; Check-in ohne Einladung mit Name + E-Mail; Tablet', async () => {
    const printed = (await dozent.get(`/api/runs/${runId}/qr/print?kind=start`)).body.token;
    at('06:20:00', '2026-12-10');
    expect((await lea.client.post('/api/checkin', { token: printed })).body.code).toBe('ausserhalb_zeitfenster');
    at('06:45:00', '2026-12-10');
    expect((await lea.client.post('/api/checkin', { token: printed })).body.me).toMatchObject({ firstIn: '2026-12-10T06:45:00.000Z', checkedIn: true });

    const anon = await h.agent();
    const token = await qr(runId);
    const need = await anon.post('/api/checkin', { token });
    expect(need.status).toBe(401);
    expect(need.body.code).toBe('anmeldung_noetig');
    const w = await anon.post('/api/checkin', { token, name: 'Paul Weber', email: 'paul@example.org' });
    expect(w.status).toBe(200);
    expect(w.body).toMatchObject({ newSession: true, me: { personName: 'Paul Weber', checkedIn: true } });
    walkIn = { client: anon, invitationId: w.body.invitationId };
    expect((await anon.get(`/api/me/invitations/${walkIn.invitationId}/live`)).status).toBe(200);
    // Link-Sitzung reicht nicht für die Verwaltung
    expect((await anon.get(`/api/runs/${runId}/attendance`)).status).toBe(403);

    at('06:58:00', '2026-12-10');
    await dozent.post(`/api/runs/${runId}/attendance/checkin`, { personId: ninaId, method: 'kiosk' });
    const overview = (await dozent.get(`/api/runs/${runId}/attendance`)).body;
    expect(overview.kpis).toMatchObject({ invited: 3, present: 3 });
    expect(overview.run).toMatchObject({ typ: 'termin', titel: 'Erste Hilfe Auffrischung', completenessPct: 80, countersign: null });
  });

  it('Kontrollfrage aus dem Fragenpool der Schulung; Tablet-Auschecken', async () => {
    at('07:30:00', '2026-12-10');
    const pool = (await dozent.get(`/api/runs/${runId}/poll-pool`)).body;
    expect(pool).toEqual([expect.objectContaining({ text: 'Welche Notrufnummer gilt europaweit?', correct: 1, used: false })]);
    const poll = await dozent.post(`/api/runs/${runId}/polls`, { mode: 'wissenscheck', sourceQuestionId: pool[0].id });
    expect(poll.body).toMatchObject({ question: 'Welche Notrufnummer gilt europaweit?', options: ['110', '112', '116 117'], correct: 1, eligible: 3 });
    expect((await lea.client.post(`/api/polls/${poll.body.id}/answers`, { option: 1 })).body).toMatchObject({ correct: true, explanation: 'Die 112 gilt in der ganzen EU.' });
    await dozent.post(`/api/polls/${poll.body.id}/close`);
    expect((await dozent.get(`/api/runs/${runId}/poll-pool`)).body[0].used).toBe(true);
    at('08:50:00', '2026-12-10');
    const out = await dozent.post(`/api/runs/${runId}/attendance/checkout`, { personId: ninaId, method: 'kiosk' });
    expect(out.body.rows.find((r: { personName: string }) => r.personName === 'Nina Lorenz')).toMatchObject({
      checkedIn: false, outMethod: 'kiosk', durationSeconds: 6600, completenessPct: 91, completenessState: 'vollstaendig',
    });
  });

  it('Gegenzeichnung (Step-up per Passwort) erst nach dem Ende; danach Nachweise für alle Bestätigten', async () => {
    at('08:30:00', '2026-12-10');
    expect((await dozent.post(`/api/runs/${runId}/countersign`, { password: DOZENT.password })).status).toBe(409); // noch nicht beendet
    at('09:00:00', '2026-12-10');
    await dozent.post(`/api/runs/${runId}/end`);
    const leaRow = await row(runId, 'Lea Wagner');
    expect(leaRow).toMatchObject({ durationSeconds: 7200, completenessPct: 100 });
    await lea.client.post(`/api/attendance/${leaRow.attendanceId}/confirm`, { confirmed: true });
    await walkIn.client.post(`/api/attendance/${(await row(runId, 'Paul Weber')).attendanceId}/confirm`, { confirmed: true });
    await dozent.post(`/api/attendance/${(await row(runId, 'Nina Lorenz')).attendanceId}/kiosk-confirm`, { signaturePng: PNG });
    expect((await lea.client.get(`/api/me/invitations/${lea.invitationId}/attendance/evidence`)).status).toBe(404);

    expect((await dozent.post(`/api/runs/${runId}/countersign`, { password: 'falsch-falsch-falsch' })).status).toBe(401);
    const cs = await dozent.post(`/api/runs/${runId}/countersign`, { password: DOZENT.password });
    expect(cs.status).toBe(200);
    expect(cs.body).toMatchObject({ countersignName: 'Dennis Hofmann', method: 'password', evidenceQueued: 3 });
    expect((await dozent.post(`/api/runs/${runId}/countersign`, { password: DOZENT.password })).status).toBe(409);

    await waitFor(async () => {
      const r = await lea.client.get(`/api/me/invitations/${lea.invitationId}/attendance/evidence`);
      return r.status === 200 && r.body.status === 'erzeugt';
    }, 30_000);
    const pdf = (await lea.client.http.get(`/api/me/invitations/${lea.invitationId}/attendance/evidence/pdf`).buffer(true).parse(binary)).body as Buffer;
    if (process.env.SN_SAVE_EVIDENCE) writeFileSync(`${process.env.SN_SAVE_EVIDENCE}-praesenz.pdf`, pdf);
    const text = squeeze(await pdfText(pdf));
    for (const x of ['Nachweis über die Teilnahme an einer Präsenzschulung', 'Erste Hilfe Auffrischung', 'DGUV Vorschrift 1 § 26', 'Lea Wagner', '07:45', 'Start-QR',
      '10:00', 'offizielles Ende', '2 h 00 min', 'Gegenzeichnung: Dennis Hofmann', 'Passwort (Re-Auth)', 'Welche Notrufnummer gilt europaweit?', '112']) {
      expect(text, x).toContain(squeeze(x));
    }
    expect((await (await h.agent()).get(`/api/verify/${(await row(runId, 'Lea Wagner')).evidence.verifyCode}`)).body.art).toBe('praesenz');
    // alle drei Nachweise fertig (Tablet-Bestätigung mit Unterschrift, Check-in ohne Einladung)
    await waitFor(async () => (await dozent.get(`/api/runs/${runId}/attendance`)).body.rows.every((r: { evidence: { status: string } | null }) => r.evidence?.status === 'erzeugt'), 30_000);
  });
});

describe('Zeitfenster abgelaufen ohne offizielles Ende (E-17)', () => {
  it('Job schließt offene Intervalle mit dem geplanten Ende → Status „prüfen“', async () => {
    at('06:00:00', '2026-12-11');
    const r = await dozent.post('/api/runs/termin', { typ: 'live_extern', titel: 'Staplerschein Auffrischung', startAt: '2026-12-11T08:00:00+01:00', endAt: '2026-12-11T09:00:00+01:00' });
    const runId = r.body.id;
    const id = await person('Kai Neumann', 'kai@example.org');
    await dozent.post(`/api/runs/${runId}/participants`, { personIds: [id] });
    const kai = await openLink('kai@example.org', 'Staplerschein Auffrischung');
    at('07:00:00', '2026-12-11');
    await kai.client.post('/api/checkin', { token: await qr(runId) });
    const svc = h.app.get(AttendanceService);
    at('08:59:00', '2026-12-11');
    expect(await svc.closeExpiredWindows()).toBe(0);
    at('09:01:00', '2026-12-11');
    expect(await svc.closeExpiredWindows()).toBe(1);
    const k = await row(runId, 'Kai Neumann');
    expect(k).toMatchObject({ status: 'pruefen', autoClosed: true, outMethod: 'official_end', durationSeconds: 3600, canConfirm: true });
    const state = (await kai.client.get(`/api/me/invitations/${kai.invitationId}/live`)).body;
    expect(state.run).toMatchObject({ status: 'beendet', autoEnded: true, endedAt: '2026-12-11T08:00:00.000Z' });
    expect((await dozent.post(`/api/attendance/${k.attendanceId}/review`, { decision: 'akzeptiert' })).body.noteReview).toBe('akzeptiert');
  });
});
