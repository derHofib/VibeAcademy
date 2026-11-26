import { makeTestPdf } from '../src/trainings/pdf-fixtures';
import { waitFor, type Client, type Harness } from './harness';

export const DOZENT = { name: 'Dennis Hofmann', organisation: 'Muster Elektro GmbH', email: 'dozent@example.org', password: 'passwort-123' };

export async function registerDozent(h: Harness, d = DOZENT): Promise<Client> {
  const c = await h.agent();
  const r = await c.post('/api/auth/register', d);
  if (r.status !== 201) throw new Error(`Registrierung fehlgeschlagen: ${JSON.stringify(r.body)}`);
  return c;
}

/** Schulung mit veröffentlichter Version und optionalem Fragenpool anlegen. */
export async function publishedTraining(
  dozent: Client,
  opts: { wordsPerPage?: number[]; questions?: number; settings?: Record<string, unknown>; confirmText?: string } = {},
) {
  const t = await dozent.post('/api/trainings', {
    titel: 'Sicherheitsunterweisung 2026',
    confirmText: opts.confirmText ?? 'Ich habe die Unterweisung vollständig gelesen und verstanden.',
    ansprechpartner: 'Dennis Hofmann, 0761 123456',
  });
  const trainingId = t.body.id as string;
  if (opts.settings) await dozent.patch(`/api/trainings/${trainingId}/settings`, opts.settings);
  const pdf = await makeTestPdf({
    wordsPerPage: opts.wordsPerPage ?? [100, 0, 50],
    chapters: [{ title: '1 Grundlagen', page: 1 }],
  });
  const up = await dozent.upload(`/api/trainings/${trainingId}/versions`, 'datei', pdf, 'unterweisung.pdf');
  const versionId = up.body.id as string;
  await waitFor(async () => (await dozent.get(`/api/trainings/${trainingId}/versions/${versionId}`)).body.status === 'bereit', 15000);
  for (let i = 0; i < (opts.questions ?? 0); i++) {
    await dozent.post(`/api/trainings/${trainingId}/questions`, {
      text: `Frage ${i + 1}: Welche Antwort ist richtig?`, options: ['Falsch A', 'Richtig', 'Falsch B'], correct: 1, explanation: `Erklärung ${i + 1}`,
    });
  }
  const pub = await dozent.post(`/api/trainings/${trainingId}/versions/${versionId}/publish`, {});
  if (pub.status !== 201) throw new Error(`Veröffentlichen fehlgeschlagen: ${JSON.stringify(pub.body)}`);
  return { trainingId, versionId };
}

/** Kampagne anlegen, Person einladen, Link aus dem Postausgang holen und als Teilnehmer öffnen. */
export async function invitedParticipant(h: Harness, dozent: Client, trainingId: string, person = { name: 'Anna Schulz', email: 'anna@example.org' }) {
  const run = (await dozent.post('/api/runs', { trainingId })).body.id as string;
  const personId = (await dozent.post('/api/persons', person)).body.id as string;
  // Postausgang ist in der Entwicklung prozessweit: auf eine NEUE Einladungsmail an diese Adresse warten.
  const invitationMails = async () =>
    ((await dozent.get(`/api/dev/postausgang?an=${person.email}`)).body as Array<{ subject: string; text: string }>).filter((m) =>
      m.subject.includes('bitte bis'),
    );
  const before = (await invitationMails()).length;
  await dozent.post(`/api/runs/${run}/invite`, { personIds: [personId] });
  const mail = await waitFor(async () => {
    const list = await invitationMails();
    return list.length > before && list[0];
  });
  const token = /\/s\/([A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
  const participant = await h.agent();
  const open = await participant.post('/api/participant/session', { token });
  return { runId: run, personId, token, participant, invitationId: open.body.invitationId as string, mail };
}
