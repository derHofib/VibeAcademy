import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOZENT, invitedParticipant, publishedTraining, registerDozent } from './fixtures';
import { startHarness, waitFor, type Client, type Harness } from './harness';

let h: Harness;
let dozentA: Client;
let dozentB: Client;
let invA: Awaited<ReturnType<typeof invitedParticipant>>;
let invB: Awaited<ReturnType<typeof invitedParticipant>>;
const ANNA = { name: 'Anna Schulz', email: 'anna@example.org' };

beforeAll(async () => {
  h = await startHarness();
  dozentA = await registerDozent(h);
  dozentB = await registerDozent(h, { ...DOZENT, email: 'b@example.org', organisation: 'Andere Firma GmbH' });
  const tA = await publishedTraining(dozentA);
  const tB = await publishedTraining(dozentB);
  invA = await invitedParticipant(h, dozentA, tA.trainingId, ANNA);
  invB = await invitedParticipant(h, dozentB, tB.trainingId, ANNA);
});
afterAll(async () => h?.close());

describe('Meine Nachweise (Teilnehmerkonto, E-25)', () => {
  let anna: Client;

  it('Konto aus der Einladungs-Sitzung: E-Mail gilt als bestätigt, Person wird verknüpft', async () => {
    anna = invA.participant;
    expect((await anna.post('/api/auth/register-account', { ...ANNA, password: 'anna-passwort-1' })).status).toBe(201);
    const me = (await anna.get('/api/auth/me')).body;
    expect(me.account.emailVerified).toBe(true);
    const ev = (await anna.get('/api/me/evidence')).body;
    expect(ev.map((e: { tenant_name: string }) => e.tenant_name)).toEqual(['Muster Elektro GmbH']);
  });

  it('weitere Mandanten nur nach ausdrücklicher Verknüpfung', async () => {
    const cands = (await anna.get('/api/me/link-candidates')).body;
    const b = cands.find((c: { tenant_name: string }) => c.tenant_name === 'Andere Firma GmbH');
    expect(b).toMatchObject({ linked: false, person_name: 'Anna Schulz' });
    expect((await anna.get(`/api/me/invitations/${invB.invitationId}`)).status).toBe(404);
    expect((await anna.post('/api/me/link', { personIds: [b.person_id] })).body.linked).toBe(1);
    const ev = (await anna.get('/api/me/evidence')).body;
    expect(ev).toHaveLength(2);
    // Zugriff auf die Einladung im anderen Mandanten über das Konto
    expect((await anna.get(`/api/me/invitations/${invB.invitationId}`)).status).toBe(200);
    // aber keine Verwaltungsdaten
    expect((await anna.get('/api/persons')).status).toBe(403);
    expect((await anna.get('/api/tenant/members')).status).toBe(403);
  });

  it('fremde Konten können keine Personen übernehmen; unbestätigte E-Mail sieht keine Kandidaten', async () => {
    const mallory = await h.agent();
    await mallory.post('/api/auth/register-account', { name: 'Mallory', email: 'mallory@example.org', password: 'mallory-passwort-1' });
    expect((await mallory.get('/api/me/link-candidates')).body).toEqual([]);
    const ids = (await anna.get('/api/me/link-candidates')).body.map((c: { person_id: string }) => c.person_id);
    expect((await mallory.post('/api/me/link', { personIds: ids })).body.linked).toBe(0);
    expect((await mallory.get(`/api/me/invitations/${invA.invitationId}`)).status).toBe(404);
    expect((await mallory.get('/api/me/evidence')).body).toEqual([]);
    // Gleiche E-Mail, aber noch unbestätigt → keine Kandidaten, nach Code-Bestätigung schon
    const other = await h.agent();
    await other.post('/api/auth/register-account', { name: 'Tobias', email: 'tobias@example.org', password: 'tobias-passwort-1' });
    await dozentA.post('/api/persons', { name: 'Tobias Meier', email: 'tobias@example.org' });
    expect((await other.get('/api/me/link-candidates')).body).toEqual([]);
    await other.post('/api/auth/email/verify-request');
    const mail = await waitFor(async () => (await dozentA.get('/api/dev/postausgang?an=tobias@example.org')).body[0]);
    const code = /(\d{6})/.exec(mail.subject)![1]!;
    expect((await other.post('/api/auth/email/verify', { code })).status).toBe(200);
    expect((await other.get('/api/me/link-candidates')).body).toHaveLength(1);
  });

  it('Konto löschen trennt nur die Verknüpfung; Dozenten-Konten mit Mitgliedschaft nicht löschbar', async () => {
    expect((await dozentA.delete('/api/me/account')).status).toBe(409);
    expect((await anna.delete('/api/me/account')).status).toBe(200);
    expect((await anna.get('/api/auth/me')).status).toBe(401);
    const run = (await dozentA.get(`/api/runs/${invA.runId}`)).body;
    expect(run.invitations).toHaveLength(1);
    const linked = await h.db.admin.query('SELECT count(*)::int n FROM person WHERE account_id IS NOT NULL AND email = $1', [ANNA.email]);
    expect(linked.rows[0].n).toBe(0);
  });
});
