import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock, FakeClock } from '../src/common/clock';
import { makeTestPdf } from '../src/trainings/pdf-fixtures';
import { registerDozent } from './fixtures';
import { startHarness, waitFor, type Client, type Harness } from './harness';

/**
 * Phase 3, Paket C: Seiten-Diff (E-38), nur geänderte Seiten bei Neueinladung, Mehrsprachigkeit (E-39), FES/QES (E-40).
 */
const clock = new FakeClock(new Date('2026-12-01T08:00:00Z'));
let h: Harness;
let dozent: Client;

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const words = (topic: string, n = 60) => Array.from({ length: n }, (_, i) => `${topic}${i}`).join(' ');
const A = words('alpha');
const B = words('bravo');
const C = words('charlie');
const X = words('xray');
const binary = (res: { on: (e: string, cb: (d?: Buffer) => void) => void }, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (d) => chunks.push(d!));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

async function pdfInfo(buf: Buffer): Promise<{ text: string; attachments: string[] }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
  let s = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    s += tc.items.map((x) => ('str' in x ? x.str : '')).join(' ') + '\n';
  }
  const att = (await doc.getAttachments()) as Record<string, { filename: string }> | null;
  return { text: s.replace(/\s+/g, ' '), attachments: Object.values(att ?? {}).map((a) => a.filename) };
}
const squeeze = (s: string) => s.replace(/\s/g, '').toLowerCase();

async function newTraining(titel: string, settings?: Record<string, unknown>) {
  const t = await dozent.post('/api/trainings', { titel, confirmText: 'Ich habe die Unterweisung gelesen und verstanden.', ansprechpartner: 'Dennis Hofmann' });
  expect(t.status).toBe(201);
  if (settings) expect((await dozent.patch(`/api/trainings/${t.body.id}/settings`, settings)).status).toBe(200);
  for (let i = 0; i < 2; i++) {
    await dozent.post(`/api/trainings/${t.body.id}/questions`, { text: `Frage ${i + 1}: Was stimmt?`, options: ['Falsch', 'Richtig'], correct: 1 });
  }
  return t.body.id as string;
}

async function upload(trainingId: string, pageTexts: string[], fields: Record<string, string> = {}) {
  const pdf = await makeTestPdf({ wordsPerPage: pageTexts.map(() => 0), pageTexts });
  const up = await dozent.upload(`/api/trainings/${trainingId}/versions`, 'datei', pdf, 'unterweisung.pdf', fields);
  expect(up.status, JSON.stringify(up.body)).toBe(201);
  await waitFor(async () => (await dozent.get(`/api/trainings/${trainingId}/versions/${up.body.id}`)).body.status === 'bereit', 15000);
  return up.body as { id: string; versionNo: number; sprache: string };
}

async function publish(trainingId: string, versionId: string, body: Record<string, unknown> = {}) {
  const r = await dozent.post(`/api/trainings/${trainingId}/versions/${versionId}/publish`, body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
}

/** Person anlegen, in neue Kampagne einladen, Link aus dem Postausgang öffnen. */
async function invite(trainingId: string, person: { name: string; email: string; sprache?: 'de' | 'en' }) {
  const run = (await dozent.post('/api/runs', { trainingId })).body.id as string;
  const personId = (await dozent.post('/api/persons', person)).body.id as string;
  await dozent.post(`/api/runs/${run}/invite`, { personIds: [personId] });
  const mail = await waitFor(async () => ((await dozent.get(`/api/dev/postausgang?an=${person.email}`)).body as Array<{ subject: string; text: string }>)[0]);
  return { ...(await openLink(mail.text)), mail, personId, runId: run };
}

async function openLink(text: string) {
  const token = /\/s\/([A-Za-z0-9_-]+)/.exec(text)![1]!;
  const participant = await h.agent();
  const open = await participant.post('/api/participant/session', { token });
  expect(open.status).toBe(200);
  return { participant, invitationId: open.body.invitationId as string };
}

/** Liest die angegebenen Seiten (Standard: alle Pflichtseiten) bis zur Erfüllung. */
async function readPages(p: Client, invitationId: string, only?: number[]) {
  const s = await p.post(`/api/me/invitations/${invitationId}/sessions`);
  expect(s.status).toBe(201);
  let seq = 0;
  const pages = (s.body.pages as Array<{ pageNo: number; tMinMs: number; required: boolean }>).filter((x) => (only ? only.includes(x.pageNo) : x.required));
  let last: { body: { complete: boolean } } | null = null;
  for (const page of pages) {
    for (let i = 0; i <= Math.ceil(page.tMinMs / 5000); i++) {
      clock.advance(5000);
      last = await p.post(`/api/me/reading-sessions/${s.body.sessionId}/heartbeat`, { seq: seq++, page: page.pageNo, visibleRatio: 1, focused: true, lastInputAgeMs: 500 });
    }
  }
  return last?.body;
}

async function passQuiz(p: Client, invitationId: string) {
  const q = (await p.get(`/api/me/invitations/${invitationId}/quiz`)).body;
  for (const question of q.attempt.questions) {
    await p.post(`/api/me/invitations/${invitationId}/quiz/answers`, { attemptId: q.attempt.id, questionId: question.id, option: 1 });
  }
  return (await p.post(`/api/me/invitations/${invitationId}/quiz/finish`, { attemptId: q.attempt.id })).body;
}

async function evidencePdf(p: Client, invitationId: string) {
  await waitFor(async () => (await p.get(`/api/me/invitations/${invitationId}/evidence`)).body.status === 'erzeugt', 30000);
  return (await p.http.get(`/api/me/invitations/${invitationId}/evidence/pdf`).buffer(true).parse(binary)).body as Buffer;
}

beforeAll(async () => {
  h = await startHarness([{ provide: Clock, useValue: clock }]);
  dozent = await registerDozent(h);
});
afterAll(async () => h?.close());

describe('Seiten-Diff (E-38)', () => {
  let trainingId: string;
  let v1: string;
  let v2: string;

  it('erkennt eingefügte und geänderte Seiten und schlägt die Art der Änderung vor', async () => {
    trainingId = await newTraining('Diff-Unterweisung');
    v1 = (await upload(trainingId, [A, B, C])).id;
    expect((await dozent.get(`/api/trainings/${trainingId}/versions/${v1}/diff`)).status).toBe(404); // keine Vorversion
    await publish(trainingId, v1);
    v2 = (await upload(trainingId, [A, X, B, C.replace('charlie7', 'charlieNEU')])).id;
    const r = await dozent.get(`/api/trainings/${trainingId}/versions/${v2}/diff`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({
      versionNo: 2, against: { versionId: v1, versionNo: 1 }, pageCount: { old: 3, new: 4 },
      changedPages: [2, 4], suggestedChangeKind: 'inhaltlich', summary: { unveraendert: 2, geaendert: 1, neu: 1, entfernt: 0 },
    });
    expect(r.body.pages.map((p: { pageNo: number; oldPageNo: number; status: string }) => [p.oldPageNo, p.pageNo, p.status])).toEqual([
      [1, 1, 'unveraendert'], [null, 2, 'neu'], [2, 3, 'unveraendert'], [3, 4, 'geaendert'],
    ]);
    const changed = r.body.pages[3];
    expect(changed.similarity).toBeGreaterThan(0.9);
    expect(changed.excerpt).toEqual({ removed: 'charlie7', added: 'charlieNEU' });
    // explizite Vergleichsversion; ungültige Angaben
    expect((await dozent.get(`/api/trainings/${trainingId}/versions/${v2}/diff?against=${v1}`)).body.changedPages).toEqual([2, 4]);
    expect((await dozent.get(`/api/trainings/${trainingId}/versions/${v2}/diff?against=${v2}`)).status).toBe(400);
    expect((await dozent.get(`/api/trainings/${trainingId}/versions/${v2}/diff?against=kaputt`)).status).toBe(400);
  });

  it('ältere Versionen ohne gespeicherten Seitentext werden aus dem Original nachgezogen', async () => {
    await h.db.admin.query('DELETE FROM page_text WHERE version_id = $1', [v1]);
    const r = await dozent.get(`/api/trainings/${trainingId}/versions/${v2}/diff`);
    expect(r.body.changedPages).toEqual([2, 4]);
    expect((await h.db.admin.query('SELECT count(*)::int AS n FROM page_text WHERE version_id = $1', [v1])).rows[0].n).toBe(3);
  });

  it('Seitentext ist für Teilnehmer und Vorgesetzte nicht lesbar (RLS)', async () => {
    const tenant = (await h.db.admin.query('SELECT tenant_id FROM training WHERE id = $1', [trainingId])).rows[0].tenant_id;
    const c = await h.db.app.connect();
    try {
      for (const role of ['teilnehmer', 'vorgesetzter']) {
        await c.query('BEGIN');
        await c.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.roles', $2, true)`, [tenant, role]);
        expect((await c.query('SELECT count(*)::int AS n FROM page_text')).rows[0].n).toBe(0);
        await c.query('ROLLBACK');
      }
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.roles', 'verantwortlich', true)`, [tenant]);
      expect((await c.query('SELECT count(*)::int AS n FROM page_text')).rows[0].n).toBeGreaterThan(0);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });
});

describe('Neueinladung nur geänderte Seiten (E-38)', () => {
  it('nur die geänderten Seiten sind für den Abschluss nötig; Hinweis in Mail, Startdaten und Nachweis', async () => {
    const trainingId = await newTraining('Nachschulung geänderter Seiten', { strictMode: true });
    const v1 = (await upload(trainingId, [A, B, C])).id;
    await publish(trainingId, v1);
    const first = await invite(trainingId, { name: 'Tobias Brandt', email: 'tobias@example.org' });
    // v1 gilt als erledigt (Abkürzung über den Datenbank-Owner)
    await h.db.admin.query(`UPDATE invitation SET status = 'bestaetigt', completed_at = $2 WHERE id = $1`, [first.invitationId, clock.now()]);
    const v2 = (await upload(trainingId, [A, X, B, C.replace('charlie3', 'charlieNEU')])).id;
    const diff = (await dozent.get(`/api/trainings/${trainingId}/versions/${v2}/diff`)).body;
    await publish(trainingId, v2, { changeKind: 'inhaltlich', changedPages: diff.changedPages });
    const run = await dozent.post('/api/admin/deadlines/run');
    expect(run.body.newVersion).toBe(1);
    const mail = await waitFor(async () =>
      ((await dozent.get('/api/dev/postausgang?an=tobias@example.org')).body as Array<{ subject: string; text: string }>).find((m) => m.text.includes('nur geänderte Seiten')),
    );
    expect(mail.text).toContain('nur geänderte Seiten: 2, 4');
    const { participant, invitationId } = await openLink(mail.text);
    const start = (await participant.get(`/api/me/invitations/${invitationId}`)).body;
    expect(start).toMatchObject({ onlyPages: [2, 4], quizRequired: true, version: { versionNo: 2 } });
    expect(start.pages.filter((p: { required: boolean }) => p.required).map((p: { pageNo: number }) => p.pageNo)).toEqual([2, 4]);
    // strenger Modus nur unter den Pflichtseiten: 1 und 3 frei, 4 erst nach 2
    expect((await participant.get(`/api/me/invitations/${invitationId}/pages/1`)).status).toBe(200);
    expect((await participant.get(`/api/me/invitations/${invitationId}/pages/4`)).status).toBe(409);
    const after = await readPages(participant, invitationId);
    expect(after?.complete).toBe(true);
    const progress = (await participant.get(`/api/me/invitations/${invitationId}/progress`)).body;
    expect(progress.onlyPages).toEqual([2, 4]);
    expect(progress.pages.filter((p: { fulfilled: boolean }) => p.fulfilled).map((p: { pageNo: number }) => p.pageNo)).toEqual([2, 4]);
    // Wissenscheck bleibt Pflicht (quizOnReinvite = true)
    expect((await h.db.admin.query('SELECT status FROM invitation WHERE id = $1', [invitationId])).rows[0].status).toBe('gelesen');
    await passQuiz(participant, invitationId);
    await participant.post(`/api/me/invitations/${invitationId}/otp`);
    const otp = await waitFor(async () => ((await dozent.get('/api/dev/postausgang?an=tobias@example.org')).body as Array<{ subject: string }>).find((m) => m.subject.startsWith('Ihr Bestätigungscode')));
    const token = (await participant.post(`/api/me/invitations/${invitationId}/step-up`, { code: /(\d{6})/.exec(otp.subject)![1] })).body.stepUpToken;
    const info = (await participant.get(`/api/me/invitations/${invitationId}/signature`)).body;
    expect(info.level).toBe('ees');
    const signed = await participant.post(`/api/me/invitations/${invitationId}/signature`, {
      stepUpToken: token, confirmed: true, confirmTextSha256: info.confirmTextSha256, strokes: [[{ x: 1, y: 2 }, { x: 4, y: 6 }]], imagePng: PNG,
    });
    expect(signed.status, JSON.stringify(signed.body)).toBe(201);
    const pdf = await pdfInfo(await evidencePdf(participant, invitationId));
    expect(squeeze(pdf.text)).toContain(squeeze('Nachschulung geänderter Seiten'));
    expect(squeeze(pdf.text)).toContain(squeeze('nur die geänderten Seiten 2, 4'));
    expect(squeeze(pdf.text)).toContain('freiwillig');
  });

  it('ohne Wissenscheck bei Neueinladung (quizOnReinvite = false) → direkt zur Unterschrift', async () => {
    const trainingId = await newTraining('Nachschulung ohne Quiz', { quizOnReinvite: false });
    const v1 = (await upload(trainingId, [A, B])).id;
    await publish(trainingId, v1);
    const first = await invite(trainingId, { name: 'Mia Roth', email: 'mia@example.org' });
    await h.db.admin.query(`UPDATE invitation SET status = 'bestaetigt', completed_at = $2 WHERE id = $1`, [first.invitationId, clock.now()]);
    const v2 = (await upload(trainingId, [A, B.replace('bravo2', 'bravoNEU')])).id;
    await publish(trainingId, v2, { changeKind: 'inhaltlich', changedPages: [2] });
    await dozent.post('/api/admin/deadlines/run');
    const mail = await waitFor(async () =>
      ((await dozent.get('/api/dev/postausgang?an=mia@example.org')).body as Array<{ subject: string; text: string }>).find((m) => m.text.includes('nur geänderte Seiten')),
    );
    const { participant, invitationId } = await openLink(mail.text);
    expect((await participant.get(`/api/me/invitations/${invitationId}`)).body).toMatchObject({ onlyPages: [2], quizRequired: false, totals: { questions: 0 } });
    await readPages(participant, invitationId);
    expect((await h.db.admin.query('SELECT status FROM invitation WHERE id = $1', [invitationId])).rows[0].status).toBe('bestanden');
    expect((await participant.get(`/api/me/invitations/${invitationId}/quiz`)).body).toEqual({ required: false });
    expect((await participant.get(`/api/me/invitations/${invitationId}/signature`)).body).toMatchObject({ ready: true, requirements: { quizRequired: false } });
  });
});

describe('Mehrsprachigkeit (E-39)', () => {
  let trainingId: string;
  let enVersion: string;

  it('englische Fassung je Versionsnummer; Einladung wählt sie für englischsprachige Personen', async () => {
    trainingId = await newTraining('Safety briefing');
    const de1 = await upload(trainingId, [A, B]);
    expect(de1).toMatchObject({ versionNo: 1, sprache: 'de' });
    await publish(trainingId, de1.id);
    const en1 = await upload(trainingId, [words('english', 70), words('second', 40), words('third', 30)], { sprache: 'en' });
    expect(en1).toMatchObject({ versionNo: 1, sprache: 'en' });
    // unveröffentlichte Sprachfassung wird beim erneuten Hochladen ersetzt
    const en1b = await upload(trainingId, [words('english', 70), words('second', 40), words('third', 30)], { sprache: 'en' });
    expect(en1b.versionNo).toBe(1);
    expect((await dozent.get(`/api/trainings/${trainingId}/versions/${en1.id}`)).status).toBe(404);
    enVersion = en1b.id;
    await publish(trainingId, enVersion);
    expect((await dozent.upload(`/api/trainings/${trainingId}/versions`, 'datei', await makeTestPdf({ wordsPerPage: [10] }), 'x.pdf', { sprache: 'en' })).status).toBe(409);
    const t = (await dozent.get(`/api/trainings/${trainingId}`)).body;
    expect(t.versions.map((v: { version_no: number; sprache: string }) => `${v.version_no}${v.sprache}`)).toEqual(['1de', '1en']);
    // Liste zeigt die deutsche Linie
    const list = (await dozent.get('/api/trainings')).body.find((x: { id: string }) => x.id === trainingId);
    expect(list).toMatchObject({ latest_version_id: de1.id, published_version_no: 1 });
  });

  it('englischer Teilnehmer: Mail, Startdaten, Wissenscheck, OTP und Nachweis auf Englisch', async () => {
    const x = await invite(trainingId, { name: 'Emma Clarke', email: 'emma@example.org', sprache: 'en' });
    expect(x.mail.subject).toMatch(/^Safety briefing – please complete by \d{2}\/\d{2}\/\d{4}$/);
    expect(x.mail.text).toContain('Start the training:');
    expect(x.mail.text).toContain('3 pages');
    const start = (await x.participant.get(`/api/me/invitations/${x.invitationId}`)).body;
    expect(start).toMatchObject({ sprache: 'en', documentLanguage: 'en', version: { id: enVersion, versionNo: 1, pageCount: 3 }, onlyPages: null, signatureLevel: 'ees' });
    await readPages(x.participant, x.invitationId);
    const page = await x.participant.get(`/api/me/invitations/${x.invitationId}/pages/3`);
    expect(page.status).toBe(200);
    expect((await passQuiz(x.participant, x.invitationId)).passed).toBe(true);
    await x.participant.post(`/api/me/invitations/${x.invitationId}/otp`);
    const otp = await waitFor(async () => ((await dozent.get('/api/dev/postausgang?an=emma@example.org')).body as Array<{ subject: string; text: string }>).find((m) => m.subject.startsWith('Your confirmation code')));
    expect(otp.text).toContain('Signature “Safety briefing”');
    const token = (await x.participant.post(`/api/me/invitations/${x.invitationId}/step-up`, { code: /(\d{6})/.exec(otp.subject)![1] })).body.stepUpToken;
    const info = (await x.participant.get(`/api/me/invitations/${x.invitationId}/signature`)).body;
    const signed = await x.participant.post(`/api/me/invitations/${x.invitationId}/signature`, {
      stepUpToken: token, confirmed: true, confirmTextSha256: info.confirmTextSha256, strokes: [[{ x: 1, y: 2 }, { x: 4, y: 6 }]], imagePng: PNG,
    });
    expect(signed.status).toBe(201);
    const pdf = await pdfInfo(await evidencePdf(x.participant, x.invitationId));
    const text = squeeze(pdf.text);
    for (const s of ['Record of Instruction and Acknowledgement', 'Record no.', 'Participant', 'Page log', 'Knowledge check', 'Attempt 1: 2 of 2 (100 %)',
      'One-time code by e-mail', 'Verify authenticity', 'Valid until', 'Simple electronic signature']) {
      expect(text, s).toContain(squeeze(s));
    }
    expect(text).not.toContain(squeeze('Seitenprotokoll'));
    // Nachweis und Prüfseite tragen dieselbe Versionsnummer
    expect((await (await h.agent()).get(`/api/verify/${signed.body.verifyCode}`)).body).toMatchObject({ version: 1, schulung: 'Safety briefing' });
  });

  it('ohne englische Fassung erhält die Person die deutsche Version; Sprache aus der Teilnehmersicht änderbar', async () => {
    const other = await newTraining('Nur Deutsch');
    const v = await upload(other, [A]);
    await publish(other, v.id);
    const x = await invite(other, { name: 'Oliver Grant', email: 'oliver@example.org', sprache: 'en' });
    const start = (await x.participant.get(`/api/me/invitations/${x.invitationId}`)).body;
    expect(start).toMatchObject({ sprache: 'en', documentLanguage: 'de', version: { id: v.id } });
    expect(x.mail.subject).toContain('please complete by');
    expect((await x.participant.post(`/api/me/invitations/${x.invitationId}/language`, { sprache: 'de' })).body).toEqual({ sprache: 'de' });
    expect((await x.participant.get(`/api/me/invitations/${x.invitationId}`)).body.sprache).toBe('de');
    expect((await x.participant.post(`/api/me/invitations/${x.invitationId}/language`, { sprache: 'fr' })).status).toBe(400);
  });
});

describe('FES/QES mit Test-Anbieter (E-40)', () => {
  it('Bestätigung → Weiterleitung → Signieren → Rückleitung → Unterschrift typ fes, Nachweis mit signiertem Dokument', async () => {
    const trainingId = await newTraining('FES-Unterweisung', { signatureLevel: 'fes' });
    const v = await upload(trainingId, [A, B]);
    await publish(trainingId, v.id);
    const x = await invite(trainingId, { name: 'Lea Wagner', email: 'lea@example.org' });
    expect((await x.participant.get(`/api/me/invitations/${x.invitationId}`)).body.signatureLevel).toBe('fes');
    await readPages(x.participant, x.invitationId);
    await passQuiz(x.participant, x.invitationId);
    const info = (await x.participant.get(`/api/me/invitations/${x.invitationId}/signature`)).body;
    expect(info).toMatchObject({ ready: true, level: 'fes', provider: { name: 'test', test: true } });
    // EES-Weg ist für FES-Schulungen gesperrt
    const ees = await x.participant.post(`/api/me/invitations/${x.invitationId}/signature`, {
      stepUpToken: 'x'.repeat(43), confirmed: true, confirmTextSha256: info.confirmTextSha256, strokes: [[{ x: 1, y: 2 }]], imagePng: PNG,
    });
    expect(ees.status).toBe(409);
    expect((await x.participant.post(`/api/me/invitations/${x.invitationId}/signature/provider`, { confirmed: true, confirmTextSha256: '0'.repeat(64) })).status).toBe(409);
    const started = await x.participant.post(`/api/me/invitations/${x.invitationId}/signature/provider`, { confirmed: true, confirmTextSha256: info.confirmTextSha256 });
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    expect(started.body).toMatchObject({ provider: 'test', level: 'fes', test: true, redirectUrl: expect.stringMatching(/^\/api\/qes\/test\/sign\/TEST-/) });
    // Signaturseite des Test-Anbieters
    const browser = await h.agent();
    const page = await browser.get(started.body.redirectUrl);
    expect(page.status).toBe(200);
    expect(page.text).toContain('TEST-ANBIETER');
    expect(page.text).toContain('Signieren');
    const approve = /href="([^"]+\/approve\?n=[^"]+)"/.exec(page.text)![1]!.replace(/&amp;/g, '&');
    // falsche Nonce → 404
    expect((await browser.get(approve.replace(/n=[^&]+/, 'n=falsch'))).status).toBe(404);
    const back = await browser.get(approve);
    expect(back.status).toBe(303);
    expect(back.headers.location).toMatch(/^\/api\/qes\/callback\//);
    const done = await browser.get(back.headers.location!);
    expect(done.status).toBe(303);
    expect(done.headers.location).toBe(`/teilnahme/${x.invitationId}/abschluss?signatur=ok`);
    // erneute Rückleitung ist idempotent
    expect((await browser.get(back.headers.location!)).headers.location).toBe(`/teilnahme/${x.invitationId}/abschluss?signatur=ok`);
    const sig = (await h.db.admin.query('SELECT * FROM signature WHERE invitation_id = $1', [x.invitationId])).rows;
    expect(sig).toHaveLength(1);
    expect(sig[0]).toMatchObject({ typ: 'fes', auth_method: 'provider', provider: 'test', image_key: null, signed_document_format: 'PAdES' });
    expect(sig[0].provider_transaction_id).toMatch(/^TEST-/);
    expect(sig[0].signer_info).toMatchObject({ test: true });
    expect((await h.db.admin.query('SELECT status FROM signature_request WHERE invitation_id = $1', [x.invitationId])).rows[0].status).toBe('abgeschlossen');
    expect((await x.participant.get(`/api/me/invitations/${x.invitationId}/signature`)).body).toMatchObject({ level: 'fes', signedAt: expect.any(String) });
    const pdf = await pdfInfo(await evidencePdf(x.participant, x.invitationId));
    const text = squeeze(pdf.text);
    for (const s of ['Fortgeschrittene elektronische Signatur (FES)', 'Anbieter: test', 'TEST-ANBIETER', 'Identifizierung beim Signaturanbieter', 'Elektronisch signiert beim Signaturanbieter']) {
      expect(text, s).toContain(squeeze(s));
    }
    expect(pdf.attachments).toEqual([expect.stringMatching(/^fes-test-TEST-.*\.pdf$/)]);
    const audit = (await dozent.get('/api/audit')).body.map((e: { entity: string; action: string }) => `${e.entity}.${e.action}`);
    expect(audit).toEqual(expect.arrayContaining(['signature_request.started', 'signature.signed']));
    expect((await dozent.get('/api/audit/verify')).body.ok).toBe(true);
  });

  it('Abbrechen beim Anbieter: keine Unterschrift, erneuter Start möglich', async () => {
    const trainingId = await newTraining('QES-Unterweisung', { signatureLevel: 'qes' });
    const v = await upload(trainingId, [A]);
    await publish(trainingId, v.id);
    const x = await invite(trainingId, { name: 'Jonas Krüger', email: 'jonas@example.org' });
    await readPages(x.participant, x.invitationId);
    await passQuiz(x.participant, x.invitationId);
    const info = (await x.participant.get(`/api/me/invitations/${x.invitationId}/signature`)).body;
    const started = (await x.participant.post(`/api/me/invitations/${x.invitationId}/signature/provider`, { confirmed: true, confirmTextSha256: info.confirmTextSha256 })).body;
    const page = await x.participant.get(started.redirectUrl);
    expect(page.text).toContain('Qualifizierte elektronische Signatur (QES)');
    const cancel = /href="([^"]+\/cancel\?n=[^"]+)"/.exec(page.text)![1]!.replace(/&amp;/g, '&');
    const back = await x.participant.get(cancel);
    const done = await x.participant.get(back.headers.location!);
    expect(done.headers.location).toBe(`/teilnahme/${x.invitationId}/abschluss?signatur=abgebrochen`);
    expect((await h.db.admin.query('SELECT count(*)::int AS n FROM signature WHERE invitation_id = $1', [x.invitationId])).rows[0].n).toBe(0);
    expect((await x.participant.post(`/api/me/invitations/${x.invitationId}/signature/provider/complete`)).body).toEqual({ outcome: 'abgebrochen' });
    const again = await x.participant.post(`/api/me/invitations/${x.invitationId}/signature/provider`, { confirmed: true, confirmTextSha256: info.confirmTextSha256 });
    expect(again.status).toBe(201);
    // Rückleitung mit manipuliertem Token
    expect((await x.participant.get(`/api/qes/callback/${again.body.requestId}?t=kaputt`)).status).toBe(404);
  });
});
