import { SMTPServer } from 'smtp-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OtpService } from '../src/auth/otp.service';
import { DbService } from '../src/db/db.service';
import { NotificationService } from '../src/notifications/notification.service';
import { MAIL_PROVIDER, SmtpMailProvider, type MailProvider } from '../src/notifications/providers';
import { startHarness, type Harness } from './harness';

let h: Harness;
let tenantId: string;

beforeAll(async () => {
  h = await startHarness();
  const c = await h.agent();
  await c.post('/api/auth/register', { name: 'D', organisation: 'Firma X', email: 'd@example.org', password: 'passwort-123' });
  tenantId = (await c.get('/api/auth/me')).body.activeTenantId;
});
afterAll(async () => h?.close());

const enqueueOne = (secret?: Record<string, string>) =>
  h.app.get(DbService).txAs({ tenantId, roles: ['system'] }, (c) =>
    h.app.get(NotificationService).enqueue(c, {
      tenantId,
      channel: 'mail',
      recipient: 'empfaenger@example.org',
      template: 'otp',
      data: { purposeLabel: 'Test' },
      secret,
    }),
  );

describe('OTP', () => {
  it('Code einmal gültig, max. 5 Fehlversuche', async () => {
    const otp = h.app.get(OtpService);
    const code = await otp.issue('test:1');
    expect(code).toMatch(/^\d{6}$/);
    expect(await otp.verify('test:1', '000000' === code ? '111111' : '000000')).toBe(false);
    expect(await otp.verify('test:1', code)).toBe(true);
    expect(await otp.verify('test:1', code)).toBe(false);

    const code2 = await otp.issue('test:2');
    for (let i = 0; i < 5; i++) await otp.verify('test:2', 'abcdef');
    expect(await otp.verify('test:2', code2)).toBe(false);
  });
});

describe('Outbox', () => {
  it('versendet idempotent und speichert Geheimnisse nicht in der Datenbank', async () => {
    const svc = h.app.get(NotificationService);
    const n = await enqueueOne({ code: '123456' });
    expect(await svc.process(n.id, tenantId)).toBe('sent');
    expect(await svc.process(n.id, tenantId)).toBe('skipped');
    const row = await h.app.get(DbService).txAs({ tenantId, roles: ['system'] }, (c) =>
      c.query('SELECT * FROM notification WHERE id = $1', [n.id]),
    );
    expect(row.rows[0].status).toBe('sent');
    expect(JSON.stringify(row.rows[0])).not.toContain('123456');
  });

  it('markiert Fehler, zählt Versuche und versendet beim nächsten Versuch', async () => {
    const svc = h.app.get(NotificationService);
    const mail = h.app.get<MailProvider>(MAIL_PROVIDER);
    const original = mail.send.bind(mail);
    let fail = true;
    mail.send = async (m) => {
      if (fail) throw new Error('SMTP nicht erreichbar');
      return original(m);
    };
    const n = await enqueueOne();
    await expect(svc.process(n.id, tenantId)).rejects.toThrow(/SMTP/);
    fail = false;
    expect(await svc.process(n.id, tenantId)).toBe('sent');
    const row = await h.app.get(DbService).txAs({ tenantId, roles: ['system'] }, (c) =>
      c.query('SELECT status, attempts FROM notification WHERE id = $1', [n.id]),
    );
    expect(row.rows[0]).toEqual({ status: 'sent', attempts: 2 });
    mail.send = original;
  });

  it('andere Mandanten sehen die Nachrichten nicht', async () => {
    const r = await h.app.get(DbService).txAs({ roles: ['admin'] }, (c) => c.query('SELECT count(*)::int n FROM notification'));
    expect(r.rows[0].n).toBe(0);
  });
});

describe('SMTP-Adapter', () => {
  it('liefert über SMTP aus', async () => {
    const received: string[] = [];
    const server = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      onData(stream, _session, cb) {
        let data = '';
        stream.on('data', (d) => (data += d));
        stream.on('end', () => {
          received.push(data);
          cb();
        });
      },
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.server.address() as { port: number }).port;
    const p = new SmtpMailProvider(`smtp://127.0.0.1:${port}?ignoreTLS=true`, 'Schulungsnachweis <no-reply@example.org>');
    const res = await p.send({ to: 'x@example.org', subject: 'Betreff äöü', text: 'Hallo', html: '<p>Hallo</p>' });
    expect(res.messageId).toBeTruthy();
    expect(received[0]).toContain('x@example.org');
    await new Promise<void>((r) => server.close(() => r()));
  });
});
