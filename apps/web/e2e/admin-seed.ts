/**
 * Hilfen für die Verwaltungs-E2E-Tests: API-Client (Cookie + CSRF) gegen die laufende API (Port 3000),
 * Test-PDFs aus `apps/api/dist/trainings/pdf-fixtures.js` und simuliertes Lesen/Quiz/Unterschrift
 * über die Teilnehmer-API. Jeder Lauf legt einen eigenen Mandanten an (zufällige E-Mail).
 */
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';

const require = createRequire(import.meta.url);

export const API = process.env.API_URL ?? 'http://127.0.0.1:3000';
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ApiClient {
  cookie = '';
  csrf = '';

  async call<T = unknown>(method: string, path: string, body?: unknown, isForm = false): Promise<T> {
    if (!this.csrf && method !== 'GET') await this.call('GET', '/auth/csrf');
    const headers: Record<string, string> = { cookie: this.cookie };
    if (method !== 'GET') headers['x-csrf-token'] = this.csrf;
    if (body && !isForm) headers['content-type'] = 'application/json';
    const r = await fetch(`${API}/api${path}`, {
      method,
      headers,
      body: isForm ? (body as FormData) : body ? JSON.stringify(body) : undefined,
    });
    for (const c of r.headers.getSetCookie()) {
      const kv = c.split(';')[0]!;
      const k = kv.split('=')[0]!;
      this.cookie = [...this.cookie.split('; ').filter((x) => x && !x.startsWith(`${k}=`)), kv].join('; ');
      if (k === 'sn_csrf') this.csrf = kv.split('=')[1]!;
    }
    const t = r.headers.get('content-type') ?? '';
    const data = t.includes('json') ? await r.json() : null;
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(data)}`);
    return data as T;
  }
}

export async function apiUp(): Promise<boolean> {
  try {
    return (await fetch(`${API}/api/health`)).ok;
  } catch {
    return false;
  }
}

export function uniqueEmail(prefix = 'dozent') {
  return `${prefix}-${randomUUID().slice(0, 8)}@example.org`;
}

export async function makePdf(opts: {
  wordsPerPage: number[];
  chapters?: Array<{ title: string; page: number }>;
  heading?: (n: number) => string;
}): Promise<Buffer> {
  const { makeTestPdf } = require('../../api/dist/trainings/pdf-fixtures.js') as {
    makeTestPdf: (o: typeof opts) => Promise<Buffer>;
  };
  return makeTestPdf(opts);
}

export async function registerDozent(
  api: ApiClient,
  d: { name: string; organisation: string; email: string; password: string },
) {
  await api.call('GET', '/auth/csrf');
  await api.call('POST', '/auth/register', d);
}

export async function uploadAndWait(
  api: ApiClient,
  trainingId: string,
  pdf: Buffer,
  fileName: string,
  meta: Record<string, string> = {},
) {
  const form = new FormData();
  form.append('datei', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), fileName);
  for (const [k, v] of Object.entries(meta)) form.append(k, v);
  const v = await api.call<{ id: string }>('POST', `/trainings/${trainingId}/versions`, form, true);
  for (let i = 0; i < 120; i++) {
    const s = await api.call<{ status: string }>('GET', `/trainings/${trainingId}/versions/${v.id}`);
    if (s.status === 'bereit') return v.id;
    if (s.status === 'fehler') throw new Error('Analyse fehlgeschlagen');
    await sleep(500);
  }
  throw new Error('Analyse dauert zu lange');
}

/** Persönlichen Link einer Einladung erzeugen und als Teilnehmer öffnen. */
export async function participantFor(admin: ApiClient, invitationId: string) {
  const { link } = await admin.call<{ link: string }>('POST', `/invitations/${invitationId}/link`);
  const token = link.split('/s/')[1]!;
  const p = new ApiClient();
  await p.call('GET', '/auth/csrf');
  await p.call('POST', '/participant/session', { token });
  return p;
}

/**
 * Simuliertes Lesen: je Seite Heartbeats im Abstand von `stepMs` (Server schreibt max. 5 s je Intervall gut),
 * bis `secondsFor(page)` erreicht ist.
 */
export async function readPages(
  p: ApiClient,
  invitationId: string,
  pages: number[],
  secondsFor: (page: number) => number,
  stepMs = 5000,
) {
  type HbResponse = {
    accepted: boolean;
    pages: Array<{ pageNo: number; fulfilled: boolean; tMinMs: number }>;
  };
  const s = await p.call<{ sessionId: string }>('POST', `/me/invitations/${invitationId}/sessions`);
  let seq = 0;
  const beat = (page: number) =>
    p.call<HbResponse>('POST', `/me/reading-sessions/${s.sessionId}/heartbeat`, {
      seq: seq++,
      page,
      visibleRatio: 1,
      focused: true,
      lastInputAgeMs: 600,
      clientTs: Date.now(),
    });
  for (const [i, page] of pages.entries()) {
    // Seitenwechsel: neuer Heartbeat frühestens 1 s nach dem letzten (sonst „too_fast“)
    if (i > 0) await sleep(1100);
    await beat(page);
    const target = secondsFor(page) * 1000;
    let credited = 0;
    for (let n = 0; n < 400; n++) {
      const wait = Math.min(stepMs, Math.max(1100, target - credited));
      await sleep(wait);
      const r = await beat(page);
      if (r.accepted) credited += Math.min(wait, 5000);
      const info = r.pages.find((x) => x.pageNo === page);
      const mustFulfil = !!info && target >= info.tMinMs;
      if (credited >= target && (!mustFulfil || info!.fulfilled)) break;
    }
  }
}

/** Ein Quiz-Versuch: `rightAnswers(text)` liefert die richtige Option, `wrong` Fragen werden falsch beantwortet. */
export async function quizAttempt(
  p: ApiClient,
  invitationId: string,
  correctByText: Map<string, number>,
  wrong = 0,
) {
  const q = await p.call<{
    attempt: { id: string; questions: Array<{ id: string; text: string; options: string[] }> };
  }>('GET', `/me/invitations/${invitationId}/quiz`);
  let w = wrong;
  for (const x of q.attempt.questions) {
    const right = correctByText.get(x.text) ?? 0;
    const option = w-- > 0 ? (right + 1) % x.options.length : right;
    await p.call('POST', `/me/invitations/${invitationId}/quiz/answers`, {
      attemptId: q.attempt.id,
      questionId: x.id,
      option,
    });
  }
  return p.call<{ passed: boolean; scorePct: number }>(
    'POST',
    `/me/invitations/${invitationId}/quiz/finish`,
    { attemptId: q.attempt.id },
  );
}

// 1×1 px PNG (transparent) als Unterschriftsbild
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** Unterschrift mit Einmal-Code aus dem Dev-Postausgang (E-08/E-12). */
export async function sign(p: ApiClient, invitationId: string, email: string, confirmText: string) {
  await p.call('POST', `/me/invitations/${invitationId}/otp`);
  let code: string | undefined;
  for (let i = 0; i < 20 && !code; i++) {
    const box = await p.call<Array<{ to: string; text: string; subject: string }>>(
      'GET',
      `/dev/postausgang?an=${encodeURIComponent(email)}`,
    );
    code = box.map((m) => /Bestätigungscode: (\d{6})/.exec(m.subject)?.[1]).find(Boolean);
    if (!code) await sleep(300);
  }
  if (!code) throw new Error('Kein Code im Postausgang');
  const { stepUpToken } = await p.call<{ stepUpToken: string }>(
    'POST',
    `/me/invitations/${invitationId}/step-up`,
    { code },
  );
  return p.call('POST', `/me/invitations/${invitationId}/signature`, {
    stepUpToken,
    confirmed: true,
    confirmTextSha256: createHash('sha256').update(confirmText).digest('hex'),
    strokes: [
      [
        { x: 10, y: 10, t: 0 },
        { x: 60, y: 30, t: 40 },
        { x: 120, y: 12, t: 90 },
      ],
    ],
    imagePng: PNG_1PX,
  });
}
