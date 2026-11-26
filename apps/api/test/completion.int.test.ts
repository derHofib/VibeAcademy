import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock, FakeClock } from '../src/common/clock';
import { invitedParticipant, publishedTraining, registerDozent } from './fixtures';
import { ROOT, sealEnv, startHarness, waitFor, type Client, type Harness } from './harness';

const clock = new FakeClock(new Date('2026-12-01T08:00:00Z'));
let h: Harness;
let dozent: Client;
let trainingId: string;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const binary = (res: { on: (e: string, cb: (d?: Buffer) => void) => void; setEncoding?: unknown }, cb: (err: Error | null, body: Buffer) => void) => {
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

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function readAll(p: Client, invitationId: string) {
  const s = await p.post(`/api/me/invitations/${invitationId}/sessions`);
  let seq = 0;
  const beat = (page: number) => {
    clock.advance(5000);
    return p.post(`/api/me/reading-sessions/${s.body.sessionId}/heartbeat`, { seq: seq++, page, visibleRatio: 1, focused: true, lastInputAgeMs: 500 });
  };
  for (const [page, n] of [[1, 5], [2, 2], [3, 3]] as const) for (let i = 0; i < n; i++) await beat(page);
}

async function doQuiz(p: Client, invitationId: string, wrong = 0) {
  const q = (await p.get(`/api/me/invitations/${invitationId}/quiz`)).body;
  let i = 0;
  for (const question of q.attempt.questions) {
    await p.post(`/api/me/invitations/${invitationId}/quiz/answers`, { attemptId: q.attempt.id, questionId: question.id, option: i++ < wrong ? 0 : 1 });
  }
  return (await p.post(`/api/me/invitations/${invitationId}/quiz/finish`, { attemptId: q.attempt.id })).body;
}

async function stepUp(p: Client, invitationId: string, email: string) {
  await p.post(`/api/me/invitations/${invitationId}/otp`);
  const mail = await waitFor(async () => (await dozent.get(`/api/dev/postausgang?an=${email}`)).body.find((m: { subject: string }) => m.subject.startsWith('Ihr Bestätigungscode')));
  const code = /(\d{6})/.exec(mail.subject)![1]!;
  return (await p.post(`/api/me/invitations/${invitationId}/step-up`, { code })).body.stepUpToken as string;
}

beforeAll(async () => {
  h = await startHarness([{ provide: Clock, useValue: clock }]);
  dozent = await registerDozent(h);
  ({ trainingId } = await publishedTraining(dozent, { wordsPerPage: [100, 0, 50], questions: 5, settings: { quizQuestionCount: 5 } }));
});
afterAll(async () => h?.close());

describe('Wissenscheck', () => {
  it('erst nach allen Seiten; Feedback je Frage; Bestehensgrenze; max. Versuche; Info an Verantwortlichen', async () => {
    const x = await invitedParticipant(h, dozent, trainingId, { name: 'Jonas Krüger', email: 'jonas@example.org' });
    expect((await x.participant.get(`/api/me/invitations/${x.invitationId}/quiz`)).status).toBe(409);
    await readAll(x.participant, x.invitationId);
    const q = (await x.participant.get(`/api/me/invitations/${x.invitationId}/quiz`)).body;
    expect(q.attempt.questions).toHaveLength(5);
    expect(JSON.stringify(q.attempt.questions)).not.toContain('"correct"');
    const fb = await x.participant.post(`/api/me/invitations/${x.invitationId}/quiz/answers`, { attemptId: q.attempt.id, questionId: q.attempt.questions[0].id, option: 0 });
    expect(fb.body).toMatchObject({ isCorrect: false, correct: 1, explanation: expect.stringContaining('Erklärung') });
    expect((await x.participant.post(`/api/me/invitations/${x.invitationId}/quiz/answers`, { attemptId: q.attempt.id, questionId: q.attempt.questions[0].id, option: 1 })).status).toBe(409);
    expect((await x.participant.post(`/api/me/invitations/${x.invitationId}/quiz/finish`, { attemptId: q.attempt.id })).status).toBe(400);
    for (const question of q.attempt.questions.slice(1)) {
      await x.participant.post(`/api/me/invitations/${x.invitationId}/quiz/answers`, { attemptId: q.attempt.id, questionId: question.id, option: 1 });
    }
    const r1 = (await x.participant.post(`/api/me/invitations/${x.invitationId}/quiz/finish`, { attemptId: q.attempt.id })).body;
    expect(r1).toMatchObject({ scorePct: 80, passed: true }); // 4/5 = 80 % ≥ 80 %
    const again = (await x.participant.get(`/api/me/invitations/${x.invitationId}/quiz`)).body;
    expect(again).toMatchObject({ passed: true, result: { scorePct: 80 } });
  });

  it('drei Fehlversuche sperren und benachrichtigen den Verantwortlichen', async () => {
    const x = await invitedParticipant(h, dozent, trainingId, { name: 'Sven Albrecht', email: 'sven@example.org' });
    await readAll(x.participant, x.invitationId);
    for (let i = 1; i <= 3; i++) {
      const r = await doQuiz(x.participant, x.invitationId, 2); // 3/5 = 60 %
      expect(r).toMatchObject({ passed: false, attemptNo: i, locked: i === 3 });
    }
    expect((await x.participant.get(`/api/me/invitations/${x.invitationId}/quiz`)).body.locked).toBe(true);
    const mail = await waitFor(async () => (await dozent.get('/api/dev/postausgang?an=dozent@example.org')).body.find((m: { subject: string }) => m.subject.startsWith('Wissenscheck nicht bestanden')));
    expect(mail.subject).toContain('Sven Albrecht');
    // ohne bestandenes Quiz keine Unterschrift
    expect((await x.participant.get(`/api/me/invitations/${x.invitationId}/signature`)).body.ready).toBe(false);
  });
});

describe('Unterschrift und versiegelter Nachweis', () => {
  let x: Awaited<ReturnType<typeof invitedParticipant>>;
  let pdf: Buffer;
  let verifyCode: string;

  it('Unterschrift erst nach Lesen + Quiz, nur mit Step-up, danach unveränderlich', async () => {
    x = await invitedParticipant(h, dozent, trainingId, { name: 'Lea Wagner', email: 'lea@example.org' });
    const info0 = (await x.participant.get(`/api/me/invitations/${x.invitationId}/signature`)).body;
    expect(info0).toMatchObject({ ready: false, requirements: { pagesComplete: false, quizPassed: false }, authMethods: ['otp_mail'] });
    const body = (token: string) => ({ stepUpToken: token, confirmed: true, confirmTextSha256: info0.confirmTextSha256, strokes: [[{ x: 1, y: 2 }, { x: 5, y: 9 }]], imagePng: PNG });
    expect((await x.participant.post(`/api/me/invitations/${x.invitationId}/signature`, body('x'.repeat(43)))).status).toBe(409);
    await readAll(x.participant, x.invitationId);
    await doQuiz(x.participant, x.invitationId);
    expect((await x.participant.post(`/api/me/invitations/${x.invitationId}/signature`, body('x'.repeat(43)))).status).toBe(401);
    expect((await x.participant.post(`/api/me/invitations/${x.invitationId}/signature`, { ...body('x'.repeat(43)), confirmed: false })).status).toBe(400);
    const token = await stepUp(x.participant, x.invitationId, 'lea@example.org');
    const signed = await x.participant.post(`/api/me/invitations/${x.invitationId}/signature`, body(token));
    expect(signed.status).toBe(201);
    verifyCode = signed.body.verifyCode;
    expect(verifyCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(signed.body.nachweisNr).toMatch(/^N-2026-\d{5}$/);
    const token2 = await stepUp(x.participant, x.invitationId, 'lea@example.org');
    expect((await x.participant.post(`/api/me/invitations/${x.invitationId}/signature`, body(token2))).status).toBe(409);
    await expect(h.db.admin.query("UPDATE signature SET auth_method = 'password'")).rejects.toThrow(/unveränderlich/);
  });

  it('Nachweis-PDF enthält alle Pflichtinhalte und ist versiegelt', async () => {
    await waitFor(async () => (await x.participant.get(`/api/me/invitations/${x.invitationId}/evidence`)).body.status === 'erzeugt', 30000);
    const { writeFileSync } = await import('node:fs');
    pdf = (await x.participant.http.get(`/api/me/invitations/${x.invitationId}/evidence/pdf`).buffer(true).parse(binary)).body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    if (process.env.SN_SAVE_EVIDENCE) writeFileSync(process.env.SN_SAVE_EVIDENCE, pdf);
    const text = await pdfText(pdf);
    const squeezed = text.replace(/\s/g, '').toLowerCase();
    for (const s of [
      'Nachweis über Unterweisung und Kenntnisnahme', 'Nachweis-Nr. N-2026-', 'Sicherheitsunterweisung 2026', 'Version 1', 'Dokument SHA-256',
      'Lea Wagner', 'Seitenprotokoll', 'S. 1', 'S. 3', 'Wissenscheck', 'Versuch 1: 5 von 5 (100 %)', 'bestanden',
      'Ich habe die Unterweisung vollständig gelesen und verstanden.', 'Einmalcode per E-Mail', 'Best.-Text SHA-256', 'Echtheit prüfen', 'Gültig bis',
    ]) {
      expect(squeezed, s).toContain(s.replace(/\s/g, '').toLowerCase());
    }
    const env = sealEnv();
    if (env.SEAL_MODE === 'pyhanko') {
      const out = JSON.parse(execFileSync(env.SEAL_PYTHON!, [join(ROOT, 'infra/seal/verify.py'), join(ROOT, '.local/certs/ca.pem')], { input: pdf }).toString());
      expect(out).toMatchObject({ signed: true, intact: true, valid: true, trusted: true, coverage: 'SignatureCoverageLevel.ENTIRE_FILE' });
      expect(out.timestamp).toBeTruthy();
      // Manipulation: ein Byte im Inhalt ändern → Siegel nicht mehr intakt
      const tampered = Buffer.from(pdf);
      const at = tampered.indexOf('Lea Wagner') > 0 ? tampered.indexOf('Lea Wagner') : 2000;
      tampered[at] = tampered[at]! ^ 1;
      const bad = JSON.parse(execFileSync(env.SEAL_PYTHON!, [join(ROOT, 'infra/seal/verify.py'), join(ROOT, '.local/certs/ca.pem')], { input: tampered }).toString());
      expect(bad.intact && bad.valid).toBe(false);
    } else {
      expect(existsSync(join(ROOT, '.local/certs'))).toBe(false);
    }
  });

  it('öffentliche Prüfung /verify/:code liefert Status und Hash, aber keine Personendaten', async () => {
    const r = await (await h.agent()).get(`/api/verify/${verifyCode}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'gueltig', schulung: 'Sicherheitsunterweisung 2026', version: 1, teilnehmer: 'LW.', aussteller: 'Muster Elektro GmbH' });
    expect(r.body.sha256).toBe(sha(pdf));
    expect(JSON.stringify(r.body)).not.toContain('Lea Wagner');
    expect((await (await h.agent()).get('/api/verify/AAAA-BBBB-CCCC')).status).toBe(404);
  });

  it('Lesenachweis je Person (Screen 3) für Verantwortliche; Dashboard-Kennzahlen', async () => {
    const r = await dozent.get(`/api/invitations/${x.invitationId}/report`);
    expect(r.status).toBe(200);
    expect(r.body.summary).toMatchObject({ sessions: 1, sollMs: 31000, plausibel: true });
    expect(r.body.pages.map((p: { ist_ms: number; soll_ms: number }) => [p.ist_ms, p.soll_ms])).toEqual([[20000, 18000], [5000, 4000], [10000, 9000]]);
    expect(r.body.signature.auth_method).toBe('otp_mail');
    expect(r.body.evidence.status).toBe('erzeugt');
    expect(r.body.audit.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['link_opened', 'started', 'reading_completed', 'passed', 'signed', 'created']));
    const d = (await dozent.get('/api/dashboard')).body;
    expect(d.kpi).toMatchObject({ erledigt: 1, gesamt: 3 });
    const sum = (k: 'eingeladen' | 'erledigt') => d.laufend.reduce((n: number, r: Record<string, number>) => n + r[k]!, 0);
    expect([sum('eingeladen'), sum('erledigt')]).toEqual([3, 1]);
  });

  it('Audit-Kette enthält den Ablauf und ist gültig', async () => {
    const v = await dozent.get('/api/audit/verify');
    expect(v.body.ok).toBe(true);
    const actions = (await dozent.get('/api/audit')).body.map((e: { entity: string; action: string }) => `${e.entity}.${e.action}`);
    expect(actions).toEqual(expect.arrayContaining(['invitation.link_opened', 'read_session.started', 'invitation.reading_completed', 'quiz_attempt.passed', 'signature.signed', 'evidence.created']));
  });
});
