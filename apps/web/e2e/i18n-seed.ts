/**
 * Testdaten für den englischen Teilnehmer-Ablauf (Phase 3, E-39/E-40): Schulung mit deutscher und englischer Fassung
 * (Version 1), englischsprachige Person, optional Signaturniveau FES (Test-Anbieter). Nutzt den festen E2E-Dozenten
 * aus participant-seed.ts (eigener Mandant).
 */
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { ApiClient, E2E_DOZENT } from './participant-seed';

const require = createRequire(import.meta.url);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SeededEnglish {
  token: string;
  invitationId: string;
  personEmail: string;
  personName: string;
  trainingTitle: string;
  pages: number;
}

async function uploadVersion(api: ApiClient, trainingId: string, pdf: Buffer, sprache: 'de' | 'en') {
  const form = new FormData();
  form.append('sprache', sprache);
  form.append('datei', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), `Training-${sprache}.pdf`);
  const v = await api.call<{ id: string }>('POST', `/trainings/${trainingId}/versions`, form, true);
  for (let i = 0; i < 80; i++) {
    if ((await api.call<{ status: string }>('GET', `/trainings/${trainingId}/versions/${v.id}`)).status === 'bereit') break;
    await sleep(250);
  }
  return v.id;
}

export async function seedEnglishTraining(opts: { signatureLevel?: 'ees' | 'fes' | 'qes' } = {}): Promise<SeededEnglish> {
  const { makeTestPdf } = require('../../api/dist/trainings/pdf-fixtures.js') as {
    makeTestPdf: (o: { wordsPerPage: number[]; chapters?: Array<{ title: string; page: number }>; heading?: (n: number) => string }) => Promise<Buffer>;
  };
  const api = new ApiClient();
  const suffix = randomUUID().slice(0, 8);
  await api.call('GET', '/auth/csrf');
  try {
    await api.call('POST', '/auth/login', { email: E2E_DOZENT.email, password: E2E_DOZENT.password });
  } catch {
    await api.call('POST', '/auth/register', E2E_DOZENT);
  }
  const person = { name: 'Emma Clarke', email: `emma-${suffix}@example.org` };
  const personId = (await api.call<{ id: string }>('POST', '/persons', { ...person, sprache: 'en', personalnr: `E2E-EN-${suffix}` })).id;
  const trainingTitle = opts.signatureLevel === 'fes' ? 'Electrical safety briefing (AdES)' : 'Electrical safety briefing';
  const t = await api.call<{ id: string }>('POST', '/trainings', {
    titel: trainingTitle,
    kategorie: 'Mandatory instruction',
    rechtsgrundlage: 'DGUV Regulation 1 § 4',
    ansprechpartner: 'Dennis Hofmann, Telefon 030 1234567, dennis.hofmann@example.org',
    confirmText: 'I have read and understood the electrical safety briefing (version 1) in full. I was able to ask Dennis Hofmann questions.',
  });
  await api.call('PATCH', `/trainings/${t.id}/settings`, { quizQuestionCount: 2, passPct: 50, signatureLevel: opts.signatureLevel ?? 'ees' });
  const words = [20, 20, 20];
  const de = await makeTestPdf({ wordsPerPage: words, chapters: [{ title: '1 Grundlagen', page: 1 }, { title: '2 Gefährdungen', page: 2 }], heading: (n) => `Abschnitt ${n}` });
  const en = await makeTestPdf({ wordsPerPage: words, chapters: [{ title: '1 Basics', page: 1 }, { title: '2 Electrical hazards', page: 2 }], heading: (n) => `Section ${n}` });
  const deId = await uploadVersion(api, t.id, de, 'de');
  for (const [text, options, correct, explanation] of [
    ['Which safety rule comes directly after “disconnect”?', ['Earth and short-circuit', 'Secure against reconnection', 'Verify absence of voltage'], 1, 'Secure first, then test: nobody can switch the system back on by mistake.'],
    ['What do you do first after an electrical accident?', ['Start chest compressions', 'Pull the person away', 'Interrupt the circuit'], 2, 'Protect yourself first – otherwise current flows through you too.'],
  ] as Array<[string, string[], number, string]>) {
    await api.call('POST', `/trainings/${t.id}/questions`, { text, options, correct, explanation });
  }
  await api.call('POST', `/trainings/${t.id}/versions/${deId}/publish`, {});
  const enId = await uploadVersion(api, t.id, en, 'en');
  await api.call('POST', `/trainings/${t.id}/versions/${enId}/publish`, {});
  const deadline = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);
  const run = await api.call<{ id: string }>('POST', '/runs', { trainingId: t.id, deadline });
  await api.call('POST', `/runs/${run.id}/invite`, { personIds: [personId], sendMail: false });
  const detail = await api.call<{ invitations: Array<{ id: string; person_id: string }> }>('GET', `/runs/${run.id}`);
  const inv = detail.invitations.find((x) => x.person_id === personId)!;
  const { link } = await api.call<{ link: string }>('POST', `/invitations/${inv.id}/link`);
  const token = /\/s\/([^/?#]+)/.exec(link)?.[1];
  if (!token) throw new Error(`Kein Token im Link: ${link}`);
  return { token, invitationId: inv.id, personEmail: person.email, personName: person.name, trainingTitle, pages: words.length };
}
