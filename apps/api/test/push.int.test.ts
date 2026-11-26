import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbService } from '../src/db/db.service';
import { NotificationService } from '../src/notifications/notification.service';
import { PUSH_PROVIDER } from '../src/notifications/providers';
import { WebPushProvider, type PushTarget, type WebPushSender } from '../src/push/web-push.provider';
import { registerDozent } from './fixtures';
import { employeeClient } from './fg-fixtures';
import { startHarness, waitFor, type Client, type Harness } from './harness';

/** Web-Push (E-12, Schritt 2.2) mit nachgebildetem Versand: Auflösung person:/account:, 410 entfernt das Abo. */
const sent: Array<{ endpoint: string; payload: Record<string, string> }> = [];
const gone = new Set<string>();
const sender: WebPushSender = {
  async send(t: PushTarget, payload: string, vapid) {
    expect(vapid.publicKey).toBe('test-public');
    if (gone.has(t.endpoint)) throw Object.assign(new Error('Gone'), { statusCode: 410 });
    sent.push({ endpoint: t.endpoint, payload: JSON.parse(payload) });
    return { statusCode: 201 };
  },
};

let h: Harness;
let dozent: Client;
let personId: string;
let emp: Client;
let accountId: string;

beforeAll(async () => {
  h = await startHarness([
    {
      provide: PUSH_PROVIDER,
      inject: [DbService],
      useFactory: (db: DbService) => new WebPushProvider(db, { publicKey: 'test-public', privateKey: 'test-private', subject: 'mailto:test@example.org' }, sender),
    },
  ]);
  dozent = await registerDozent(h);
  personId = (await dozent.post('/api/persons', { name: 'Lea Wagner', email: 'lea@example.org' })).body.id;
  ({ client: emp, accountId } = await employeeClient(h, { email: 'lea@example.org', name: 'Lea Wagner', personIds: [personId] }));
});
afterAll(async () => h?.close());

describe('Web-Push', () => {
  it('öffentlicher Schlüssel (ohne VAPID-Konfiguration: deaktiviert)', async () => {
    expect((await (await h.agent()).get('/api/push/key')).body).toEqual({ enabled: false, publicKey: null });
  });

  it('Abo anlegen (nur HTTPS), Versand an person:/account:, 410 entfernt das Abo, Abmelden', async () => {
    const keys = { p256dh: 'BPx1234567890abcdefghijklmnop', auth: 'authsecret12' };
    expect((await emp.post('/api/me/push-subscriptions', { endpoint: 'http://unsicher.example.org/x', keys })).status).toBe(400);
    expect((await emp.post('/api/me/push-subscriptions', { endpoint: 'https://push.example.org/a', keys })).status).toBe(201);
    expect((await emp.post('/api/me/push-subscriptions', { endpoint: 'https://push.example.org/b', keys })).status).toBe(201);
    expect((await (await h.agent()).post('/api/me/push-subscriptions', { endpoint: 'https://push.example.org/c', keys })).status).toBe(401);

    // über die Outbox (Kanal push, Empfänger person:<id> → Abos des verknüpften Kontos)
    const notifications = h.app.get(NotificationService);
    const db = h.app.get(DbService);
    const tenantId = (await h.db.admin.query('SELECT tenant_id FROM person WHERE id = $1', [personId])).rows[0].tenant_id;
    const n = await db.txAs({ tenantId, roles: ['system'] }, (c) =>
      notifications.enqueue(c, { tenantId, channel: 'push', recipient: `person:${personId}`, template: 'push-message', data: { title: 'Erinnerung', body: 'Bitte bis 15.12. abschließen', url: '/konto' } }),
    );
    await notifications.dispatch([n]);
    await waitFor(async () => sent.length === 2);
    expect(sent.map((s) => s.endpoint).sort()).toEqual(['https://push.example.org/a', 'https://push.example.org/b']);
    expect(sent[0]!.payload).toEqual({ title: 'Erinnerung', body: 'Bitte bis 15.12. abschließen', url: '/konto' });
    const row = await waitFor(async () => (await h.db.admin.query('SELECT status, provider FROM notification WHERE id = $1', [n.id])).rows.find((r) => r.status === 'sent'));
    expect(row.provider).toBe('webpush');

    // 410 Gone → Abo wird gelöscht
    gone.add('https://push.example.org/a');
    const provider = h.app.get<WebPushProvider>(PUSH_PROVIDER);
    expect((await provider.send(`account:${accountId}`, { title: 'x', body: 'y' })).messageId).toBe('webpush-1/2');
    const left = (await h.db.admin.query('SELECT endpoint FROM push_subscription')).rows.map((r) => r.endpoint);
    expect(left).toEqual(['https://push.example.org/b']);

    // Abmelden; fremde Endpunkte bleiben unberührt
    expect((await emp.delete('/api/me/push-subscriptions').send({ endpoint: 'https://push.example.org/b' })).body).toEqual({ removed: 1 });
    expect((await provider.send(`person:${personId}`, { title: 'x', body: 'y' })).messageId).toBe('kein-abo');
  });

  it('RLS: Abos nur für den Eigentümer sichtbar, nicht direkt schreibbar', async () => {
    await emp.post('/api/me/push-subscriptions', { endpoint: 'https://push.example.org/d', keys: { p256dh: 'BPx1234567890abcdefghijklmnop', auth: 'authsecret12' } });
    const c = await h.db.app.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.account_id', $1, true)`, [accountId]);
      expect((await c.query('SELECT count(*)::int AS n FROM push_subscription')).rows[0].n).toBe(1);
      await c.query(`SELECT set_config('app.account_id', $1, true)`, ['00000000-0000-0000-0000-000000000001']);
      expect((await c.query('SELECT count(*)::int AS n FROM push_subscription')).rows[0].n).toBe(0);
      await expect(c.query(`INSERT INTO push_subscription (account_id, endpoint, p256dh, auth) VALUES ($1, 'https://x.example.org', 'a', 'b')`, [accountId])).rejects.toThrow(/permission denied/);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });
});
