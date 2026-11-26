import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withContext } from '../src/context';
import { createTestDb, type TestDb } from './helpers';

let db: TestDb;
let a: { account_id: string; tenant_id: string };
let b: { account_id: string; tenant_id: string };

const ctxA = () => ({ tenantId: a.tenant_id, accountId: a.account_id, roles: ['admin', 'verantwortlich', 'trainer'] });
const ctxB = () => ({ tenantId: b.tenant_id, accountId: b.account_id, roles: ['admin', 'verantwortlich', 'trainer'] });

beforeAll(async () => {
  db = await createTestDb();
  const reg = async (email: string, tenant: string) =>
    (await db.app.query('SELECT * FROM app.auth_register_tenant($1, $2, $3, $4)', [email, 'Dozent', 'hash', tenant]))
      .rows[0];
  a = await reg('a@example.org', 'Mandant A');
  b = await reg('b@example.org', 'Mandant B');
});
afterAll(async () => db?.drop());

describe('RLS-Rahmen', () => {
  it('ohne Kontext sind keine Zeilen sichtbar (fail closed)', async () => {
    const r = await withContext(db.app, {}, async (c) => ({
      t: (await c.query('SELECT count(*)::int n FROM tenant')).rows[0].n,
      m: (await c.query('SELECT count(*)::int n FROM membership')).rows[0].n,
      a: (await c.query('SELECT count(*)::int n FROM account')).rows[0].n,
    }));
    expect(r).toEqual({ t: 0, m: 0, a: 0 });
  });

  it('Mandant A sieht nur eigene Daten, nicht die von B', async () => {
    await withContext(db.app, ctxA(), async (c) => {
      const tenants = (await c.query('SELECT id FROM tenant')).rows.map((r) => r.id);
      expect(tenants).toEqual([a.tenant_id]);
      const accounts = (await c.query('SELECT email FROM account')).rows.map((r) => r.email);
      expect(accounts).toEqual(['a@example.org']);
    });
    await withContext(db.app, ctxB(), async (c) => {
      expect((await c.query('SELECT id FROM tenant')).rows.map((r) => r.id)).toEqual([b.tenant_id]);
    });
  });

  it('Schreiben in fremden Mandanten wird abgelehnt', async () => {
    await expect(
      withContext(db.app, ctxA(), (c) =>
        c.query("INSERT INTO membership (tenant_id, account_id, roles) VALUES ($1, $2, '{teilnehmer}')", [
          b.tenant_id,
          a.account_id,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
    const upd = await withContext(db.app, ctxA(), (c) =>
      c.query("UPDATE tenant SET name = 'gekapert' WHERE id = $1", [b.tenant_id]),
    );
    expect(upd.rowCount).toBe(0);
  });

  it('Passwort-Hash ist für app_user nicht lesbar', async () => {
    await expect(
      withContext(db.app, ctxA(), (c) => c.query('SELECT password_hash FROM account')),
    ).rejects.toThrow(/permission denied/);
  });

  it('app_user kann RLS nicht abschalten oder umgehen', async () => {
    const r = await db.app.query(
      "SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'app_user'",
    );
    expect(r.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
    await expect(db.app.query('ALTER TABLE tenant DISABLE ROW LEVEL SECURITY')).rejects.toThrow(/owner/);
    await expect(db.app.query('SET row_security = off; SELECT * FROM tenant')).rejects.toThrow(/row-level security/);
  });

  it('auch der Owner (app_migrator) unterliegt RLS (FORCE)', async () => {
    const r = await db.migrator.query('SELECT count(*)::int n FROM tenant');
    expect(r.rows[0].n).toBe(0);
  });

  it('Nicht-Admin darf keine Mitgliedschaften anlegen', async () => {
    await expect(
      withContext(db.app, { ...ctxA(), roles: ['trainer'] }, (c) =>
        c.query("INSERT INTO membership (tenant_id, account_id, roles) VALUES ($1, $2, '{teilnehmer}')", [
          a.tenant_id,
          b.account_id,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('Kontext gilt nur innerhalb der Transaktion', async () => {
    await withContext(db.app, ctxA(), (c) => c.query('SELECT 1'));
    const r = await db.app.query("SELECT current_setting('app.tenant_id', true) v");
    expect(r.rows[0].v ?? '').toBe('');
  });

  it('Registrierung mit vergebener E-Mail schlägt fehl', async () => {
    await expect(
      db.app.query('SELECT * FROM app.auth_register_tenant($1, $2, $3, $4)', ['A@example.org', 'X', 'h', 'X GmbH']),
    ).rejects.toThrow(/EMAIL_TAKEN/);
  });

  it('Login-Suche liefert den Hash nur über die Definer-Funktion', async () => {
    const r = await db.app.query('SELECT * FROM app.auth_find_account($1)', ['a@example.org']);
    expect(r.rows[0]).toMatchObject({ email: 'a@example.org', password_hash: 'hash', disabled: false });
  });

  it('Konto ohne Mandant sieht nur sich selbst', async () => {
    const id = (await db.app.query('SELECT app.auth_register_account($1, $2, $3) id', ['t@example.org', 'T', 'h']))
      .rows[0].id;
    await withContext(db.app, { accountId: id }, async (c) => {
      expect((await c.query('SELECT email FROM account')).rows).toEqual([{ email: 't@example.org' }]);
      expect((await c.query('SELECT id FROM tenant')).rows).toEqual([]);
    });
  });

  it('Kontext lehnt Nicht-UUIDs und ungültige Rollen ab', async () => {
    await expect(withContext(db.app, { tenantId: "x' OR 1=1" }, async () => 1)).rejects.toThrow(/UUID/);
    await expect(withContext(db.app, { roles: ["admin'"] }, async () => 1)).rejects.toThrow(/Rollen|roles/);
  });
});
