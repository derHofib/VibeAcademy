import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invitedParticipant, publishedTraining, registerDozent } from './fixtures';
import { startHarness, waitFor, type Client, type Harness } from './harness';

let h: Harness;
let dozent: Client;
let trainingId: string;

beforeAll(async () => {
  h = await startHarness();
  dozent = await registerDozent(h);
  ({ trainingId } = await publishedTraining(dozent, { questions: 2 }));
});
afterAll(async () => h?.close());

describe('Durchführung und Einladungen', () => {
  it('ohne veröffentlichte Version keine Durchführung', async () => {
    const t = await dozent.post('/api/trainings', { titel: 'Entwurf' });
    expect((await dozent.post('/api/runs', { trainingId: t.body.id })).status).toBe(400);
  });

  it('Einladung per Mail mit persönlichem Link, Umfang und Frist (Screen 4)', async () => {
    const { mail, participant, invitationId } = await invitedParticipant(h, dozent, trainingId);
    expect(mail.subject).toMatch(/^Sicherheitsunterweisung 2026 – bitte bis \d\d\.\d\d\.\d{4} bearbeiten$/);
    expect(mail.text).toContain('3 Seiten · ca. 1 Minuten · 2 Fragen');
    expect(mail.text).toContain('Keine Kamera, kein Standort');
    // Startbildschirm
    const s = await participant.get(`/api/me/invitations/${invitationId}`);
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({
      status: 'geoeffnet', personName: 'Anna Schulz',
      training: { titel: 'Sicherheitsunterweisung 2026', ansprechpartner: 'Dennis Hofmann, 0761 123456' },
      totals: { pages: 3, minReadingSeconds: 18 + 4 + 9, questions: 2 },
    });
    expect(s.body.pages).toHaveLength(3);
    expect(s.body.chapters[0].short_name).toBe('Grundlagen');
  });

  it('Link-Sitzung kommt nur an die eigene Einladung und an keine Verwaltungsroute', async () => {
    const { participant } = await invitedParticipant(h, dozent, trainingId, { name: 'Tobias Meier', email: 'tobias@example.org' });
    const other = (await dozent.get('/api/runs')).body[0].id;
    const invs = (await dozent.get(`/api/runs/${other}`)).body.invitations;
    const fremd = invs.find((i: { person_name: string }) => i.person_name !== 'Tobias Meier');
    if (fremd) expect((await participant.get(`/api/me/invitations/${fremd.id}`)).status).toBe(404);
    for (const url of ['/api/persons', '/api/org-units', '/api/trainings', '/api/runs', '/api/audit', '/api/auth/me']) {
      expect([401, 403]).toContain((await participant.get(url)).status);
    }
    const mine = await participant.get('/api/me/invitations');
    expect(mine.body).toHaveLength(1);
  });

  it('ungültiger Link → 404; neuer Link macht den alten ungültig', async () => {
    const c = await h.agent();
    expect((await c.post('/api/participant/session', { token: 'x'.repeat(43) })).status).toBe(404);
    const { token, invitationId } = await invitedParticipant(h, dozent, trainingId, { name: 'Lea Wagner', email: 'lea@example.org' });
    const neu = await dozent.post(`/api/invitations/${invitationId}/link`);
    expect(neu.body.link).toMatch(/\/s\/[A-Za-z0-9_-]{40,}$/);
    expect((await c.post('/api/participant/session', { token })).status).toBe(404);
    const newToken = neu.body.link.split('/s/')[1];
    expect((await c.post('/api/participant/session', { token: newToken })).status).toBe(200);
  });

  it('Verwaltung sieht Status je Person; Erinnerung geht raus', async () => {
    const runs = (await dozent.get('/api/runs')).body;
    expect(runs[0]).toMatchObject({ invited: expect.any(Number), done: 0 });
    const run = (await dozent.get(`/api/runs/${runs[0].id}`)).body;
    const inv = run.invitations[0];
    expect(Object.keys(inv)).not.toContain('dwell_ms');
    expect((await dozent.post(`/api/invitations/${inv.id}/remind`)).status).toBe(201);
    const mail = await waitFor(async () => {
      const box = (await dozent.get('/api/dev/postausgang')).body;
      return box.find((m: { subject: string }) => m.subject.startsWith('Erinnerung:'));
    });
    expect(mail).toBeTruthy();
  });

  it('Step-up per Code: falscher Code → 401, richtiger → Token', async () => {
    const { participant, invitationId } = await invitedParticipant(h, dozent, trainingId, { name: 'Kai Neumann', email: 'kai@example.org' });
    expect((await participant.post(`/api/me/invitations/${invitationId}/step-up`, { password: 'x' })).status).toBe(401);
    expect((await participant.post(`/api/me/invitations/${invitationId}/otp`)).status).toBe(200);
    const mail = await waitFor(async () => (await dozent.get('/api/dev/postausgang?an=kai@example.org')).body.find((m: { subject: string }) => m.subject.startsWith('Ihr Bestätigungscode')));
    const code = /(\d{6})/.exec(mail.subject)![1]!;
    expect((await participant.post(`/api/me/invitations/${invitationId}/step-up`, { code: code === '000000' ? '111111' : '000000' })).status).toBe(401);
    const ok = await participant.post(`/api/me/invitations/${invitationId}/step-up`, { code });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ method: 'otp_mail', expiresInSeconds: 300 });
  });
});
