/**
 * Testdaten für „Meine Nachweise“ (1.18): eine zweite Organisation (eigener E2E-Dozent), die dieselbe
 * E-Mail-Adresse einlädt wie die erste – sie erscheint im Konto als Verknüpfungsvorschlag.
 */
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { ApiClient } from './participant-seed';

const require = createRequire(import.meta.url);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const E2E_DOZENT_B = {
  name: 'Sabine Krüger',
  organisation: 'E2E Zweite Organisation',
  email: process.env.E2E_DOZENT_B_EMAIL ?? 'e2e-konto-dozent-b@example.org',
  password: process.env.E2E_DOZENT_B_PASSWORT ?? 'e2e-passwort-konto-b-1',
};

export interface SecondTenantInvitation {
  invitationId: string;
  tenantName: string;
  trainingTitle: string;
}

/** Legt in der zweiten Organisation eine Person mit `email` an und lädt sie zu einer kurzen Schulung ein. */
export async function seedSecondTenantInvitation(person: { name: string; email: string }): Promise<SecondTenantInvitation> {
  const { makeTestPdf } = require('../../api/dist/trainings/pdf-fixtures.js') as {
    makeTestPdf: (o: { wordsPerPage: number[]; heading?: (n: number) => string }) => Promise<Buffer>;
  };
  const api = new ApiClient();
  await api.call('GET', '/auth/csrf');
  try {
    await api.call('POST', '/auth/login', { email: E2E_DOZENT_B.email, password: E2E_DOZENT_B.password });
  } catch {
    await api.call('POST', '/auth/register', E2E_DOZENT_B);
  }
  const me = await api.call<{ activeTenantId: string; memberships: Array<{ tenantId: string; tenantName: string }> }>('GET', '/auth/me');
  const tenantName = me.memberships.find((m) => m.tenantId === me.activeTenantId)?.tenantName ?? E2E_DOZENT_B.organisation;

  const suffix = randomUUID().slice(0, 8);
  const { id: personId } = await api.call<{ id: string }>('POST', '/persons', { ...person, personalnr: `E2E-B-${suffix}` });
  const trainingTitle = 'Erste-Hilfe-Auffrischung';
  const t = await api.call<{ id: string }>('POST', '/trainings', {
    titel: trainingTitle,
    kategorie: 'Pflichtunterweisung',
    ansprechpartner: 'Sabine Krüger, sabine.krueger@example.org',
    confirmText: 'Ich habe die Erste-Hilfe-Auffrischung vollständig gelesen und verstanden.',
  });
  await api.call('PATCH', `/trainings/${t.id}/settings`, { quizQuestionCount: 1, passPct: 50 });
  const pdf = await makeTestPdf({ wordsPerPage: [20, 20], heading: (n) => `Abschnitt ${n}` });
  const form = new FormData();
  form.append('datei', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), 'Erste-Hilfe.pdf');
  const v = await api.call<{ id: string }>('POST', `/trainings/${t.id}/versions`, form, true);
  for (let i = 0; i < 80; i++) {
    if ((await api.call<{ status: string }>('GET', `/trainings/${t.id}/versions/${v.id}`)).status === 'bereit') break;
    await sleep(250);
  }
  await api.call('POST', `/trainings/${t.id}/questions`, {
    text: 'Was tust du bei einem Stromunfall zuerst?',
    options: ['Sofort mit der Herzdruckmassage beginnen', 'Die Person vom Gerät wegziehen', 'Den Stromkreis unterbrechen'],
    correct: 2,
    explanation: 'Eigenschutz zuerst.',
  });
  await api.call('POST', `/trainings/${t.id}/versions/${v.id}/publish`, {});
  const deadline = new Date(Date.now() + 21 * 86400_000).toISOString().slice(0, 10);
  const run = await api.call<{ id: string }>('POST', '/runs', { trainingId: t.id, deadline });
  await api.call('POST', `/runs/${run.id}/invite`, { personIds: [personId], sendMail: false });
  const detail = await api.call<{ invitations: Array<{ id: string; person_id?: string; personId?: string }> }>('GET', `/runs/${run.id}`);
  const inv = detail.invitations.find((x) => (x.person_id ?? x.personId) === personId) ?? detail.invitations[0]!;
  return { invitationId: inv.id, tenantName, trainingTitle };
}
