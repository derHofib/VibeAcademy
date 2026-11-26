/**
 * Testdaten für die Teilnehmer-E2E-Tests: legt über die laufende API (Port 3000) einen eigenen Dozenten
 * (neuer Mandant), eine kurze Schulung mit winzigen Seiten (t_min = 4 s), Fragen und eine Einladung an.
 * Gibt den persönlichen Link (Token) zurück. Vorbild: scripts/seed-demo.mjs.
 */
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);

export const API = process.env.API_URL ?? 'http://127.0.0.1:3000';

export class ApiClient {
  private cookie = '';
  private csrf = '';

  async call<T = unknown>(method: string, path: string, body?: unknown, isForm = false): Promise<T> {
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

/** Überschreibbar per E2E_DOZENT_EMAIL / E2E_DOZENT_PASSWORT (z. B. wenn die Registrierung gerade rate-limitiert ist). */
export const E2E_DOZENT = {
  name: 'Dennis Hofmann',
  organisation: 'E2E Teilnehmer-Ablauf',
  email: process.env.E2E_DOZENT_EMAIL ?? 'e2e-teilnehmer-dozent@example.org',
  password: process.env.E2E_DOZENT_PASSWORT ?? 'e2e-passwort-teilnehmer-1',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SeededInvitation {
  token: string;
  invitationId: string;
  personEmail: string;
  personName: string;
  trainingTitle: string;
  pages: number;
}

export interface SeedOptions {
  /** Wörter je Seite (≤ 25 Wörter → t_min = 4 s) */
  wordsPerPage?: number[];
  questions?: number;
  quizQuestionCount?: number;
  /** Anzahl Einladungen (Personen) */
  people?: number;
}

/** Legt Dozent, Schulung (mit Kapiteln) und Einladungen an; liefert je Person Token + Einladungs-ID. */
export async function seedParticipantTraining(opts: SeedOptions = {}): Promise<SeededInvitation[]> {
  const { makeTestPdf } = require('../../api/dist/trainings/pdf-fixtures.js') as {
    makeTestPdf: (o: { wordsPerPage: number[]; chapters?: Array<{ title: string; page: number }>; heading?: (n: number) => string }) => Promise<Buffer>;
  };
  const wordsPerPage = opts.wordsPerPage ?? [20, 20, 20];
  const api = new ApiClient();
  const suffix = randomUUID().slice(0, 8);
  await api.call('GET', '/auth/csrf');
  // Fester E2E-Dozent (eigener Mandant): Anmeldung statt Registrierung je Lauf (Registrierung ist rate-limitiert)
  try {
    await api.call('POST', '/auth/login', { email: E2E_DOZENT.email, password: E2E_DOZENT.password });
  } catch {
    await api.call('POST', '/auth/register', E2E_DOZENT);
  }
  const people = Array.from({ length: opts.people ?? 1 }, (_, i) => ({
    name: ['Lea Wagner', 'Anna Schulz', 'Tobias Meier', 'Kai Neumann'][i % 4]!,
    email: `teilnehmer-${suffix}-${i}@example.org`,
  }));
  const personIds: string[] = [];
  for (const [i, p] of people.entries()) {
    personIds.push((await api.call<{ id: string }>('POST', '/persons', { ...p, personalnr: `E2E-${suffix}-${i}` })).id);
  }
  const trainingTitle = 'Sicherheitsunterweisung 2026';
  const t = await api.call<{ id: string }>('POST', '/trainings', {
    titel: trainingTitle,
    kategorie: 'Pflichtunterweisung',
    rechtsgrundlage: 'DGUV Vorschrift 1 § 4',
    ansprechpartner: 'Dennis Hofmann, Telefon 030 1234567, dennis.hofmann@example.org',
    confirmText:
      'Ich habe die Sicherheitsunterweisung 2026 (Version 1) vollständig gelesen und verstanden. Rückfragen konnte ich an Dennis Hofmann richten.',
  });
  await api.call('PATCH', `/trainings/${t.id}/settings`, { quizQuestionCount: opts.quizQuestionCount ?? 2, passPct: 50 });
  const chapterStarts = wordsPerPage.length >= 3 ? [1, 2, wordsPerPage.length] : [1];
  const chapterTitles = ['Grundlagen und Verantwortung', 'Elektrische Gefährdungen', 'Erste Hilfe und Notfall'];
  const pdf = await makeTestPdf({
    wordsPerPage,
    chapters: chapterStarts.map((page, i) => ({ title: `${i + 1} ${chapterTitles[i]}`, page })),
    heading: (n) => `Abschnitt ${n}`,
  });
  const form = new FormData();
  form.append('datei', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), 'Unterweisung.pdf');
  const v = await api.call<{ id: string }>('POST', `/trainings/${t.id}/versions`, form, true);
  for (let i = 0; i < 80; i++) {
    if ((await api.call<{ status: string }>('GET', `/trainings/${t.id}/versions/${v.id}`)).status === 'bereit') break;
    await sleep(250);
  }
  const qs: Array<[string, string[], number, string]> = [
    ['Welche Sicherheitsregel folgt direkt auf „Freischalten“?', ['Erden und kurzschließen', 'Gegen Wiedereinschalten sichern', 'Spannungsfreiheit feststellen'], 1, 'Erst sichern, dann prüfen: So kann niemand die Anlage versehentlich wieder einschalten.'],
    ['Was tust du bei einem Stromunfall zuerst?', ['Sofort mit der Herzdruckmassage beginnen', 'Die Person vom Gerät wegziehen', 'Den Stromkreis unterbrechen'], 2, 'Eigenschutz zuerst – sonst wirst du selbst durchströmt.'],
    ['Wie oft muss die Sicherheitsunterweisung mindestens stattfinden?', ['Einmal jährlich', 'Alle zwei Jahre', 'Nur bei der Einstellung'], 0, 'DGUV Vorschrift 1 verlangt die Unterweisung mindestens einmal jährlich.'],
  ];
  for (const [text, options, correct, explanation] of qs.slice(0, opts.questions ?? 2)) {
    await api.call('POST', `/trainings/${t.id}/questions`, { text, options, correct, explanation });
  }
  await api.call('POST', `/trainings/${t.id}/versions/${v.id}/publish`, {});
  const deadline = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);
  const run = await api.call<{ id: string }>('POST', '/runs', { trainingId: t.id, deadline });
  await api.call('POST', `/runs/${run.id}/invite`, { personIds, sendMail: false });
  const detail = await api.call<{ invitations: Array<{ id: string; person_id?: string; personId?: string }> }>('GET', `/runs/${run.id}`);
  const out: SeededInvitation[] = [];
  for (const [i, pid] of personIds.entries()) {
    const inv = detail.invitations.find((x) => (x.person_id ?? x.personId) === pid) ?? detail.invitations[i]!;
    const { link } = await api.call<{ link: string }>('POST', `/invitations/${inv.id}/link`);
    const token = /\/s\/([^/?#]+)/.exec(link)?.[1];
    if (!token) throw new Error(`Kein Token im Link: ${link}`);
    out.push({ token, invitationId: inv.id, personEmail: people[i]!.email, personName: people[i]!.name, trainingTitle, pages: wordsPerPage.length });
  }
  return out;
}

/** Letzter 6-stelliger Code aus dem Dev-Postausgang (nur Entwicklung). */
export async function latestOtp(email: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${API}/api/dev/postausgang?an=${encodeURIComponent(email)}`);
    const box = (await r.json()) as Array<{ text: string; subject: string }>;
    const code = box.map((m) => /\b(\d{6})\b/.exec(m.text)?.[1]).find(Boolean);
    if (code) return code;
    await sleep(250);
  }
  throw new Error(`Kein Code für ${email}`);
}
