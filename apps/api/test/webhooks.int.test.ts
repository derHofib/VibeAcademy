import { addDays, berlinDate } from '@sn/shared';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock, FakeClock } from '../src/common/clock';
import { DbService } from '../src/db/db.service';
import { verifySignature } from '../src/webhooks/crypto';
import { WebhookEmitter } from '../src/webhooks/webhook-emitter';
import { WEBHOOK_OPTIONS, type WebhookOptions } from '../src/webhooks/webhook-options';
import { invitedParticipant, publishedTraining, registerDozent } from './fixtures';
import { startHarness, waitFor, type Client, type Harness } from './harness';

/** Webhooks (PLAN 3.2, E-37): Signatur, Wiederholung mit Backoff, Abschalten, Idempotenz, echte Abläufe, keine Personendaten. */
const clock = new FakeClock(new Date('2026-12-01T08:00:00Z'));
const OPTS: WebhookOptions = { maxAttempts: 6, backoffBaseMs: 150, disableAfterFailures: 4, timeoutMs: 3000, pollMs: 40, allowPrivate: true, retentionDays: 30 };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

let h: Harness;
let dozent: Client;
let adminB: Client;
let trainingId: string;
let tenantA: string;

// ── lokaler Empfänger ─────────────────────────────────────────
interface Hit { path: string; headers: IncomingHttpHeaders; raw: string; body: { id: string; type: string; createdAt: string; tenantId: string; data: Record<string, unknown> }; at: number }
const hits: Hit[] = [];
/** Statuscode je Pfad und n-tem Aufruf (1-basiert) */
const behavior: Record<string, (n: number) => number> = {};
let server: Server;
let base: string;
const hitsOn = (path: string) => hits.filter((x) => x.path === path);
const eventsOn = (path: string, type: string) => hitsOn(path).filter((x) => x.body.type === type);

type EndpointCreated = { id: string; url: string; events: string[]; active: boolean; secret: string };
async function endpoint(admin: Client, path: string, events: string[]): Promise<EndpointCreated> {
  const r = await admin.post('/api/integrations/webhooks', { url: `${base}${path}`, events });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { ...r.body.endpoint, secret: r.body.secret };
}
const nowS = () => Math.floor(Date.now() / 1000);
const signed = (hit: Hit, secret: string) => verifySignature(secret, hit.raw, String(hit.headers['schulungsnachweis-signature']), nowS());

// ── Teilnehmer-Ablauf (wie completion.int.test.ts) ────────────
async function readAll(p: Client, invitationId: string) {
  const s = await p.post(`/api/me/invitations/${invitationId}/sessions`);
  let seq = 0;
  const beat = (page: number) => {
    clock.advance(5000);
    return p.post(`/api/me/reading-sessions/${s.body.sessionId}/heartbeat`, { seq: seq++, page, visibleRatio: 1, focused: true, lastInputAgeMs: 500 });
  };
  for (const [page, n] of [[1, 5], [2, 2], [3, 3]] as const) for (let i = 0; i < n; i++) await beat(page);
}
async function doQuiz(p: Client, invitationId: string) {
  const q = (await p.get(`/api/me/invitations/${invitationId}/quiz`)).body;
  for (const question of q.attempt.questions) {
    await p.post(`/api/me/invitations/${invitationId}/quiz/answers`, { attemptId: q.attempt.id, questionId: question.id, option: 1 });
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
  server = createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const path = req.url ?? '/';
      hits.push({ path, headers: req.headers, raw, body: JSON.parse(raw || '{}'), at: Date.now() });
      const status = behavior[path]?.(hitsOn(path).length) ?? 200;
      res.writeHead(status, { 'content-type': 'text/plain' });
      res.end(status < 300 ? 'ok' : 'kaputt');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  h = await startHarness([{ provide: Clock, useValue: clock }, { provide: WEBHOOK_OPTIONS, useValue: OPTS }]);
  dozent = await registerDozent(h);
  adminB = await registerDozent(h, { name: 'Berta Fremd', organisation: 'Fremdfirma AG', email: 'berta@example.org', password: 'passwort-123' });
  tenantA = (await dozent.get('/api/auth/me')).body.activeTenantId;
  ({ trainingId } = await publishedTraining(dozent, { wordsPerPage: [100, 0, 50], questions: 5, settings: { quizQuestionCount: 5 } }));
}, 120_000);
afterAll(async () => {
  await h?.close();
  await new Promise((r) => server?.close(r));
});

describe('Endpunkte verwalten', () => {
  it('nur https (http nur zu localhost in Entwicklung/Test), keine Zugangsdaten in der URL; Geheimnis nur einmal', async () => {
    const bad = (url: string) => dozent.post('/api/integrations/webhooks', { url, events: ['evidence.created'] });
    expect((await bad('http://example.com/hook')).body.message).toBe('Webhooks müssen https verwenden');
    expect((await bad('ftp://example.com/hook')).status).toBe(400);
    expect((await bad('https://nutzer:geheim@example.com/hook')).body.message).toBe('Zugangsdaten in der URL sind nicht erlaubt');
    expect((await dozent.post('/api/integrations/webhooks', { url: 'https://example.com/hook', events: ['alles'] })).status).toBe(400);
    expect((await dozent.post('/api/integrations/webhooks', { url: 'https://example.com/hook', events: [] })).body.fields[0].message).toBe('Bitte mindestens ein Ereignis auswählen');
    const ep = await endpoint(dozent, '/ok', ['invitation.completed', 'evidence.created', 'external_record.approved', 'attendance.confirmed']);
    expect(ep.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    const list = (await dozent.get('/api/integrations/webhooks')).body;
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(ep.secret);
    const stored = (await h.db.admin.query('SELECT secret_enc FROM webhook_endpoint WHERE id = $1', [ep.id])).rows[0].secret_enc as string;
    expect(stored.startsWith('v1:')).toBe(true);
    expect(stored).not.toContain(ep.secret.slice(6));
  });

  it('Test-Ping: signiert und prüfbar, Header, Zustellprotokoll', async () => {
    const ep = (await dozent.get('/api/integrations/webhooks')).body[0];
    const secret = (await dozent.post(`/api/integrations/webhooks/${ep.id}/rotate-secret`)).body.secret as string;
    const ping = await dozent.post(`/api/integrations/webhooks/${ep.id}/ping`);
    expect(ping.status).toBe(202);
    const hit = await waitFor(async () => eventsOn('/ok', 'test.ping')[0]);
    expect(hit.headers['schulungsnachweis-event']).toBe('test.ping');
    expect(hit.headers['schulungsnachweis-delivery']).toBe(ping.body.deliveryId);
    expect(hit.headers['content-type']).toBe('application/json');
    expect(hit.body).toMatchObject({ id: ping.body.eventId, type: 'test.ping', tenantId: tenantA, data: { endpointId: ep.id } });
    expect(String(hit.headers['schulungsnachweis-signature'])).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(signed(hit, secret)).toBe(true);
    expect(verifySignature('whsec_falsch', hit.raw, String(hit.headers['schulungsnachweis-signature']), nowS())).toBe(false);
    expect(verifySignature(secret, hit.raw.replace('test.ping', 'test.pong'), String(hit.headers['schulungsnachweis-signature']), nowS())).toBe(false);
    expect(verifySignature(secret, hit.raw, String(hit.headers['schulungsnachweis-signature']), nowS() + 3600)).toBe(false); // zu alt
    const log = await waitFor(async () => {
      const d = (await dozent.get(`/api/integrations/webhooks/${ep.id}/deliveries`)).body.data;
      return d[0]?.status === 'succeeded' && d;
    });
    expect(log[0]).toMatchObject({ id: ping.body.deliveryId, eventType: 'test.ping', attempts: 1, responseCode: 200, nextAttemptAt: null });
  });
});

describe('Ereignisse aus den echten Abläufen', () => {
  let x: Awaited<ReturnType<typeof invitedParticipant>>;

  it('Unterschrift → invitation.completed und evidence.created; Nutzlast nur IDs/Status', async () => {
    x = await invitedParticipant(h, dozent, trainingId, { name: 'Lea Wagner', email: 'lea@example.org' });
    await readAll(x.participant, x.invitationId);
    await doQuiz(x.participant, x.invitationId);
    const token = await stepUp(x.participant, x.invitationId, 'lea@example.org');
    const info = (await x.participant.get(`/api/me/invitations/${x.invitationId}/signature`)).body;
    const signedRes = await x.participant.post(`/api/me/invitations/${x.invitationId}/signature`, {
      stepUpToken: token, confirmed: true, confirmTextSha256: info.confirmTextSha256, strokes: [[{ x: 1, y: 2 }, { x: 5, y: 9 }]], imagePng: PNG,
    });
    expect(signedRes.status, JSON.stringify(signedRes.body)).toBe(201);
    const done = await waitFor(async () => eventsOn('/ok', 'invitation.completed').find((e) => e.body.data.invitationId === x.invitationId));
    expect(done.body.data).toMatchObject({ invitationId: x.invitationId, runId: x.runId, personId: x.personId, trainingId, status: 'bestaetigt' });
    expect(done.body.data.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const ev = await waitFor(async () => eventsOn('/ok', 'evidence.created').find((e) => e.body.data.invitationId === x.invitationId), 60_000);
    expect(ev.body.data).toMatchObject({ kind: 'online', status: 'erzeugt', personId: x.personId, invitationId: x.invitationId, attendanceId: null, externalRecordId: null });
    expect(ev.body.data.nachweisNr).toMatch(/^N-2026-\d{5}$/);
    expect(ev.body.data.sha256).toMatch(/^[0-9a-f]{64}$/);
    for (const hit of [done, ev]) {
      expect(hit.raw).not.toContain('Lea');
      expect(hit.raw).not.toContain('lea@example.org');
      expect(hit.raw).not.toContain('@');
      expect(hit.raw).not.toContain('Muster Elektro');
      expect(hit.raw).not.toContain('Sicherheitsunterweisung');
    }
  }, 120_000);

  it('Präsenz/Live: Anwesenheit bestätigt (Tablet) → attendance.confirmed und invitation.completed', async () => {
    const personId = (await dozent.post('/api/persons', { name: 'Mehmet Aydın' })).body.id;
    const run = await dozent.post('/api/runs/termin', {
      typ: 'live_extern', titel: 'Erste-Hilfe-Fortbildung', provider: 'Muster e. V.', ort: 'Lager',
      startAt: '2026-12-04T08:00:00Z', endAt: '2026-12-04T10:00:00Z', personIds: [personId],
    });
    expect(run.status, JSON.stringify(run.body)).toBe(201);
    const runId = run.body.id as string;
    clock.set('2026-12-04T07:55:00Z');
    expect((await dozent.post(`/api/runs/${runId}/start`)).status).toBeLessThan(300);
    clock.set('2026-12-04T08:00:00Z');
    expect((await dozent.post(`/api/runs/${runId}/attendance/checkin`, { personId, method: 'kiosk' })).status).toBeLessThan(300);
    clock.set('2026-12-04T10:00:00Z');
    expect((await dozent.post(`/api/runs/${runId}/end`)).status).toBeLessThan(300);
    const row = ((await dozent.get(`/api/runs/${runId}/attendance`)).body.rows as Array<{ personName: string; attendanceId: string }>).find((r) => r.personName === 'Mehmet Aydın')!;
    const k = await dozent.post(`/api/attendance/${row.attendanceId}/kiosk-confirm`, { signaturePng: PNG });
    expect(k.status, JSON.stringify(k.body)).toBeLessThan(300);
    const att = await waitFor(async () => eventsOn('/ok', 'attendance.confirmed').find((e) => e.body.data.attendanceId === row.attendanceId));
    expect(att.body.data).toMatchObject({ runId, personId, completeness: 'vollstaendig', credited: true });
    const inv = await waitFor(async () => eventsOn('/ok', 'invitation.completed').find((e) => e.body.data.runId === runId));
    expect(inv.body.data).toMatchObject({ personId, status: 'bestaetigt' });
    expect(att.raw).not.toContain('Mehmet');
  }, 60_000);

  it('idempotent: dasselbe Ereignis wird nur einmal eingetragen; erneute Zustellung trägt dieselbe Ereignis-ID', async () => {
    const db = h.app.get(DbService);
    const again = await db.txAs({ tenantId: tenantA, roles: ['system'] }, (c) => WebhookEmitter.emit(c, tenantA, 'invitation.completed', { invitationId: x.invitationId }));
    expect(again).toBeNull();
    const n = (await h.db.admin.query(`SELECT count(*)::int AS n FROM webhook_event WHERE dedup_key = $1`, [`invitation.completed:${x.invitationId}`])).rows[0].n;
    expect(n).toBe(1);
    const first = eventsOn('/ok', 'invitation.completed').find((e) => e.body.data.invitationId === x.invitationId)!;
    const ep = (await dozent.get('/api/integrations/webhooks')).body[0];
    const log = (await dozent.get(`/api/integrations/webhooks/${ep.id}/deliveries?limit=200`)).body.data as Array<{ id: string; eventId: string; status: string }>;
    const d = log.find((l) => l.id === first.headers['schulungsnachweis-delivery'])!;
    expect(d.eventId).toBe(first.body.id);
    const re = await dozent.post(`/api/integrations/webhooks/${ep.id}/deliveries/${d.id}/redeliver`);
    expect(re.status).toBe(202);
    expect(re.body).toMatchObject({ eventId: first.body.id, redeliveryOf: d.id, status: 'pending' });
    const second = await waitFor(async () => hitsOn('/ok').find((e) => e.headers['schulungsnachweis-delivery'] === re.body.id));
    expect(second.body.id).toBe(first.body.id);
    expect(second.raw).toBe(first.raw);
    // Fehler beim Eintragen (fremder Mandant) bricht die fachliche Transaktion nicht ab
    const ok = await db.txAs({ tenantId: tenantA, roles: ['system'] }, async (c) => {
      const id = await WebhookEmitter.emit(c, '00000000-0000-0000-0000-000000000000', 'test.ping', {}, { endpointId: ep.id });
      return { id, alive: (await c.query('SELECT 1 AS one')).rows[0].one };
    });
    expect(ok).toEqual({ id: null, alive: 1 });
  });
});

describe('Wiederholung, Backoff, Abschalten', () => {
  let key: string;
  beforeAll(async () => {
    key = (await dozent.post('/api/integrations/api-keys', { name: 'Webhook-Test', scopes: ['external:write', 'webhooks:manage', 'persons:read'] })).body.key;
  });
  const approveExternal = async (personName: string) => {
    const personId = (await dozent.post('/api/persons', { name: personName })).body.id;
    const r = await request(h.app.getHttpServer())
      .post('/api/v1/external-records')
      .set('authorization', `Bearer ${key}`)
      .send({ personIds: [personId], title: 'Staplerschein', heldOn: addDays(berlinDate(new Date()), -1) });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.records[0].id as string;
  };

  it('500, 500, dann 200: drei Versuche mit wachsendem Abstand, gleiche Zustell-ID und Ereignis-ID, gültige Signatur', async () => {
    behavior['/flaky'] = (n) => (n <= 2 ? 500 : 200);
    const ep = await endpoint(dozent, '/flaky', ['external_record.approved']);
    const recordId = await approveExternal('Flora Flaky');
    await waitFor(async () => hitsOn('/flaky').length >= 3, 10_000);
    const got = hitsOn('/flaky');
    expect(got).toHaveLength(3);
    expect(new Set(got.map((g) => g.headers['schulungsnachweis-delivery'])).size).toBe(1);
    expect(new Set(got.map((g) => g.body.id)).size).toBe(1);
    expect(got[0]!.body.data).toMatchObject({ externalRecordId: recordId, status: 'freigegeben' });
    expect(got.every((g) => signed(g, ep.secret))).toBe(true);
    expect(got[1]!.at - got[0]!.at).toBeGreaterThanOrEqual(OPTS.backoffBaseMs - 20);
    expect(got[2]!.at - got[1]!.at).toBeGreaterThanOrEqual(2 * OPTS.backoffBaseMs - 20);
    const log = await waitFor(async () => {
      const d = (await dozent.get(`/api/integrations/webhooks/${ep.id}/deliveries`)).body.data;
      return d[0]?.status === 'succeeded' && d;
    });
    expect(log[0]).toMatchObject({ attempts: 3, responseCode: 200, lastError: null });
    expect((await dozent.get(`/api/integrations/webhooks/${ep.id}`)).body).toMatchObject({ active: true, failureCount: 0 });
  });

  it('dauerhaft 500 → Endpunkt nach 4 Fehlversuchen in Folge deaktiviert; Reaktivieren holt die Zustellung nach', async () => {
    behavior['/down'] = () => 500;
    const ep = await endpoint(dozent, '/down', ['external_record.approved']);
    // Erfassung über die Verwaltung (Cookie-Sitzung) – ebenfalls Ereignis external_record.approved
    const personId = (await dozent.post('/api/persons', { name: 'Dieter Down' })).body.id;
    const cap = await dozent.post('/api/external-records', { personIds: [personId], freeTitle: 'Brandschutzhelfer', heldOn: addDays(berlinDate(new Date()), -1) });
    expect(cap.status, JSON.stringify(cap.body)).toBe(201);
    const ws = await waitFor(async () => {
      const e = (await dozent.get(`/api/integrations/webhooks/${ep.id}`)).body;
      return !e.active && e;
    }, 10_000);
    expect(ws).toMatchObject({ active: false, failureCount: 4 });
    expect(ws.disabledReason).toContain('automatisch deaktiviert');
    await new Promise((r) => setTimeout(r, 600));
    expect(hitsOn('/down')).toHaveLength(4); // nach dem Abschalten keine weiteren Versuche
    const log = (await dozent.get(`/api/integrations/webhooks/${ep.id}/deliveries`)).body.data;
    expect(log[0]).toMatchObject({ status: 'pending', attempts: 4, responseCode: 500, lastError: 'HTTP 500' });
    behavior['/down'] = () => 204;
    const re = await dozent.patch(`/api/integrations/webhooks/${ep.id}`, { active: true });
    expect(re.body).toMatchObject({ active: true, failureCount: 0, disabledReason: null });
    await waitFor(async () => (await dozent.get(`/api/integrations/webhooks/${ep.id}/deliveries`)).body.data[0]?.status === 'succeeded', 10_000);
    expect(hitsOn('/down')).toHaveLength(5);
  });

  it('nach der letzten Wiederholung: Zustellung „failed“', async () => {
    behavior['/never'] = () => 503;
    const ep = await endpoint(dozent, '/never', ['external_record.approved']);
    // Abschalten erst nach mehr Fehlversuchen als eine Zustellung hat → Zustellung endet als failed
    await h.db.admin.query('UPDATE webhook_endpoint SET failure_count = -10 WHERE id = $1', [ep.id]);
    await approveExternal('Nina Never');
    const d = await waitFor(async () => (await dozent.get(`/api/integrations/webhooks/${ep.id}/deliveries`)).body.data.find((x: { status: string }) => x.status === 'failed'), 20_000);
    expect(d).toMatchObject({ attempts: OPTS.maxAttempts, responseCode: 503 });
    expect(hitsOn('/never')).toHaveLength(OPTS.maxAttempts);
  }, 30_000);
});

describe('compliance.state_changed aus dem nächtlichen Fristen-Job', () => {
  it('erster Lauf = Ausgangsstand; danach genau eine Meldung je Statusänderung', async () => {
    const ep = await endpoint(dozent, '/compliance', ['compliance.state_changed']);
    const t = (await dozent.post('/api/trainings', { titel: 'Erste Hilfe', format: 'extern', quizRequired: false })).body.id;
    const q = (await dozent.post('/api/qualifications', { name: 'Ersthelfer' })).body.id;
    const req = (await dozent.post('/api/requirements', { qualificationId: q, trainingId: t, intervalMonths: 24 })).body.id;
    const personId = (await dozent.post('/api/persons', { name: 'Clara Compliance', email: 'clara@example.org' })).body.id;
    await dozent.post(`/api/qualifications/${q}/persons`, { personIds: [personId] });
    expect((await dozent.post('/api/admin/deadlines/run')).status).toBe(200);
    expect((await h.db.admin.query('SELECT state FROM compliance_snapshot WHERE person_id = $1', [personId])).rows[0].state).toBe('fehlt');
    const cap = await dozent.post('/api/external-records', { personIds: [personId], requirementId: req, heldOn: addDays(berlinDate(clock.now()), -5) });
    expect(cap.status, JSON.stringify(cap.body)).toBe(201);
    await dozent.post('/api/admin/deadlines/run');
    const hit = await waitFor(async () => hitsOn('/compliance')[0]);
    expect(hit.body.type).toBe('compliance.state_changed');
    expect(hit.body.data).toMatchObject({ personId, requirementId: req, qualificationId: q, trainingId: t, previousState: 'fehlt', state: 'gueltig' });
    expect(signed(hit, ep.secret)).toBe(true);
    expect(hit.raw).not.toContain('Clara');
    await dozent.post('/api/admin/deadlines/run');
    await new Promise((r) => setTimeout(r, 400));
    expect(hitsOn('/compliance')).toHaveLength(1);
  });
});

describe('Webhooks über die API und Mandantentrennung', () => {
  it('Scope webhooks:manage: anlegen, auflisten, Ping, Protokoll, löschen; Audit mit actor api-key', async () => {
    const k = await dozent.post('/api/integrations/api-keys', { name: 'Ops', scopes: ['webhooks:manage'] });
    const api = (m: 'get' | 'post' | 'delete' | 'patch', url: string) => request(h.app.getHttpServer())[m](`/api/v1${url}`).set('authorization', `Bearer ${k.body.key}`);
    const c = await api('post', '/webhooks').send({ url: `${base}/api`, events: ['evidence.created'], description: 'aus der API' });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect(c.body.secret).toMatch(/^whsec_/);
    expect((await api('get', '/webhooks')).body.data.map((e: { id: string }) => e.id)).toContain(c.body.id);
    const p = await api('post', `/webhooks/${c.body.id}/ping`);
    expect(p.status).toBe(202);
    const hit = await waitFor(async () => hitsOn('/api')[0]);
    expect(signed(hit, c.body.secret)).toBe(true);
    expect((await api('patch', `/webhooks/${c.body.id}`).send({ events: ['evidence.created', 'invitation.completed'] })).body.events).toEqual(['evidence.created', 'invitation.completed']);
    await waitFor(async () => (await api('get', `/webhooks/${c.body.id}/deliveries`)).body.data[0]?.status === 'succeeded');
    const audit = (await dozent.get('/api/audit')).body as Array<{ entity: string; entity_id: string; action: string; payload: Record<string, unknown> }>;
    expect(audit.find((e) => e.entity === 'webhook_endpoint' && e.entity_id === c.body.id && e.action === 'created')?.payload.actor).toBe(`api-key:${k.body.apiKey.id}`);
    expect((await api('delete', `/webhooks/${c.body.id}`)).status).toBe(204);
    expect((await api('get', `/webhooks/${c.body.id}`)).status).toBe(404);
  });

  it('Endpunkt von Mandant B erhält keine Ereignisse von A; A sieht/ändert Webhooks von B nicht', async () => {
    const b = await endpoint(adminB, '/tenant-b', ['invitation.completed', 'evidence.created', 'external_record.approved', 'attendance.confirmed', 'compliance.state_changed']);
    const k = (await dozent.post('/api/integrations/api-keys', { name: 'A', scopes: ['webhooks:manage'] })).body.key;
    const api = (m: 'get' | 'post' | 'delete', url: string) => request(h.app.getHttpServer())[m](`/api/v1${url}`).set('authorization', `Bearer ${k}`);
    expect((await api('get', `/webhooks/${b.id}`)).status).toBe(404);
    expect((await api('post', `/webhooks/${b.id}/ping`)).status).toBe(404);
    expect((await api('delete', `/webhooks/${b.id}`)).status).toBe(404);
    expect((await dozent.get(`/api/integrations/webhooks/${b.id}/deliveries`)).status).toBe(404);
    // weiteres Ereignis in A
    const personId = (await dozent.post('/api/persons', { name: 'Tina Trennung' })).body.id;
    await dozent.post('/api/external-records', { personIds: [personId], freeTitle: 'Kurs', heldOn: addDays(berlinDate(new Date()), -1) });
    await waitFor(async () => eventsOn('/ok', 'external_record.approved').length >= 3);
    await new Promise((r) => setTimeout(r, 300));
    expect(hitsOn('/tenant-b')).toEqual([]);
    expect((await h.db.admin.query('SELECT count(*)::int AS n FROM webhook_delivery WHERE endpoint_id = $1', [b.id])).rows[0].n).toBe(0);
    // Nachweis-Erzeugung abwarten (sauberes Herunterfahren)
    await waitFor(async () => (await h.db.admin.query(`SELECT count(*)::int AS n FROM evidence WHERE status = 'ausstehend'`)).rows[0].n === 0, 60_000);
  }, 90_000);
});
