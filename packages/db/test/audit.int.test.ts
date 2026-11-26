import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withContext } from '../src/context';
import { createTestDb, type TestDb } from './helpers';

let db: TestDb;
let ten: { account_id: string; tenant_id: string };
let other: { account_id: string; tenant_id: string };
const ctx = (t = ten, roles = ['admin']) => ({ tenantId: t.tenant_id, accountId: t.account_id, roles });

// Hinweis: INSERT … RETURNING unterliegt zusätzlich der SELECT-Policy; deshalb hier mit Rolle „auditor“.
// Die Anwendung schreibt Audit-Ereignisse ohne RETURNING (siehe Test „Teilnehmer darf schreiben“).
const record = (t = ten, payload: object = {}) =>
  withContext(db.app, ctx(t, ['auditor']), (c) =>
    c.query("INSERT INTO audit_event (entity, entity_id, action, payload) VALUES ('test', '1', 'did', $1) RETURNING *", [
      payload,
    ]),
  ).then((r) => r.rows[0]);

const verify = (t = ten) =>
  withContext(db.app, ctx(t), (c) => c.query('SELECT * FROM app.audit_verify()')).then((r) => r.rows[0]);

beforeAll(async () => {
  db = await createTestDb();
  const reg = async (email: string) =>
    (await db.app.query('SELECT * FROM app.auth_register_tenant($1, $2, $3, $4)', [email, 'D', 'h', 'Firma'])).rows[0];
  ten = await reg('audit@example.org');
  other = await reg('other@example.org');
});
afterAll(async () => db?.drop());

describe('Audit-Hash-Kette', () => {
  it('verkettet Ereignisse fortlaufend je Mandant', async () => {
    const e1 = await record(ten, { n: 1 });
    const e2 = await record(ten, { n: 2 });
    const o1 = await record(other, { n: 1 });
    expect(e1.seq).toBe('1');
    expect(e1.prev_hash).toBe('0'.repeat(64));
    expect(e2.seq).toBe('2');
    expect(e2.prev_hash).toBe(e1.hash);
    expect(o1.seq).toBe('1');
  });

  it('Teilnehmer darf schreiben, aber nicht lesen', async () => {
    const r = await withContext(db.app, ctx(ten, ['teilnehmer']), async (c) => {
      await c.query("INSERT INTO audit_event (entity, action) VALUES ('test', 'teilnehmer')");
      return c.query('SELECT * FROM audit_event');
    });
    expect(r.rowCount).toBe(0);
  });

  it('bleibt bei vielen und parallelen Einfügungen eine gültige Kette', async () => {
    await Promise.all(Array.from({ length: 40 }, (_, i) => record(ten, { p: i })));
    for (let i = 0; i < 200; i++) await record(ten, { i, text: 'Ä ö ü ß – "quoted"' });
    const v = await verify();
    expect(v.ok).toBe(true);
    expect(Number(v.checked)).toBe(243);
  });

  it('UPDATE, DELETE und TRUNCATE sind verboten', async () => {
    await expect(withContext(db.app, ctx(), (c) => c.query("UPDATE audit_event SET action = 'x'"))).rejects.toThrow(
      /permission denied|unveränderlich/,
    );
    await expect(withContext(db.app, ctx(), (c) => c.query('DELETE FROM audit_event'))).rejects.toThrow(
      /permission denied|unveränderlich/,
    );
    await expect(withContext(db.app, ctx(), (c) => c.query('TRUNCATE audit_event'))).rejects.toThrow(
      /permission denied|unveränderlich/,
    );
    // Owner (app_migrator): keine UPDATE-Policy → 0 Zeilen betroffen
    const own = await withContext(db.migrator, ctx(), (c) => c.query("UPDATE audit_event SET action = 'x'"));
    expect(own.rowCount).toBe(0);
    // Superuser umgeht RLS, scheitert aber am Trigger
    await expect(db.admin.query("UPDATE audit_event SET action = 'x'")).rejects.toThrow(/unveränderlich/);
    await expect(db.admin.query('DELETE FROM audit_event')).rejects.toThrow(/unveränderlich/);
  });

  it('kann keine Ereignisse in einen fremden Mandanten schreiben', async () => {
    await expect(
      withContext(db.app, ctx(ten), (c) =>
        c.query("INSERT INTO audit_event (tenant_id, entity, action) VALUES ($1, 'x', 'y')", [other.tenant_id]),
      ),
    ).rejects.toThrow(/aktiven Mandanten|row-level security/);
  });

  it('erkennt eine nachträglich geänderte Zeile', async () => {
    const target = await withContext(db.app, ctx(), (c) =>
      c.query('SELECT id, seq FROM audit_event WHERE seq = 17'),
    ).then((r) => r.rows[0]);
    // Manipulation „an der Anwendung vorbei“: Superuser schaltet den Schutz-Trigger ab und ändert den Inhalt.
    await db.admin.query('ALTER TABLE audit_event DISABLE TRIGGER audit_event_no_update');
    await db.admin.query(`UPDATE audit_event SET payload = '{"manipuliert": true}' WHERE id = $1`, [target.id]);
    await db.admin.query('ALTER TABLE audit_event ENABLE TRIGGER audit_event_no_update');
    const v = await verify();
    expect(v.ok).toBe(false);
    expect(v.first_bad_id).toBe(target.id);
    expect(v.reason).toMatch(/Hash/);
    // andere Mandanten bleiben gültig
    expect((await verify(other)).ok).toBe(true);
  });

  // Das Abschneiden am Ende der Kette erkennt erst der tägliche TSA-Anker (E-11), nicht audit_verify().
  it('erkennt eine gelöschte Zeile in der Mitte', async () => {
    await record(other, { n: 2 });
    await record(other, { n: 3 });
    await db.admin.query('ALTER TABLE audit_event DISABLE TRIGGER audit_event_no_update');
    await db.admin.query('DELETE FROM audit_event WHERE tenant_id = $1 AND seq = 2', [other.tenant_id]);
    await db.admin.query('ALTER TABLE audit_event ENABLE TRIGGER audit_event_no_update');
    const v = await verify(other);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/Lücke/);
  });
});
