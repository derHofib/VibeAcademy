import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withContext, type DbContext } from '../src/context';
import { createTestDb, type TestDb } from '../src/testing';

let db: TestDb;
let A: { account_id: string; tenant_id: string };
let B: { account_id: string; tenant_id: string };
let chefAccount: string;
const ids: Record<string, string> = {};

const staff = (t = A): DbContext => ({ tenantId: t.tenant_id, accountId: t.account_id, roles: ['admin', 'verantwortlich'] });
const q = async (ctx: DbContext, sql: string, params: unknown[] = []) => withContext(db.app, ctx, (c) => c.query(sql, params));

beforeAll(async () => {
  db = await createTestDb();
  const reg = async (email: string) =>
    (await db.app.query('SELECT * FROM app.auth_register_tenant($1, $2, $3, $4)', [email, 'D', 'h', 'Firma'])).rows[0];
  A = await reg('a@example.org');
  B = await reg('b@example.org');
  chefAccount = (await db.app.query("SELECT app.auth_register_account('chef@example.org', 'Chef', 'h') id")).rows[0].id;
  // Org-Baum: Werk → Elektro → Prüfteam ; daneben Verwaltung
  const ins = async (name: string, parent: string | null) =>
    (await q(staff(), 'INSERT INTO org_unit (name, parent_id) VALUES ($1, $2) RETURNING id', [name, parent])).rows[0].id;
  ids.werk = await ins('Werk', null);
  ids.elektro = await ins('Elektro', ids.werk);
  ids.pruef = await ins('Prüfteam', ids.elektro);
  ids.verw = await ins('Verwaltung', ids.werk);
  const person = async (name: string, org: string, account: string | null = null) =>
    (await q(staff(), 'INSERT INTO person (name, org_unit_id, account_id) VALUES ($1, $2, $3) RETURNING id', [name, org, account])).rows[0].id;
  ids.chef = await person('Chef Elektro', ids.elektro, chefAccount);
  ids.p1 = await person('Anna Schulz', ids.elektro);
  ids.p2 = await person('Tobias Meier', ids.pruef);
  ids.p3 = await person('Lea Wagner', ids.verw);
  await q(staff(), 'UPDATE org_unit SET leiter_person_id = $1 WHERE id = $2', [ids.chef, ids.elektro]);
});
afterAll(async () => db?.drop());

describe('Personen-Sichtbarkeit', () => {
  it('Verantwortliche sehen alle Personen ihres Mandanten, nicht die anderer', async () => {
    expect((await q(staff(), 'SELECT count(*)::int n FROM person')).rows[0].n).toBe(4);
    expect((await q(staff(B), 'SELECT count(*)::int n FROM person')).rows[0].n).toBe(0);
  });

  it('Vorgesetzter sieht nur Personen seiner Org-Einheit inkl. Unterbäume', async () => {
    const r = await q({ tenantId: A.tenant_id, accountId: chefAccount, roles: ['vorgesetzter'] }, 'SELECT name FROM person ORDER BY name');
    expect(r.rows.map((x) => x.name)).toEqual(['Anna Schulz', 'Chef Elektro', 'Tobias Meier']);
  });

  it('Vorgesetzter darf Personen nicht ändern', async () => {
    const r = await q({ tenantId: A.tenant_id, accountId: chefAccount, roles: ['vorgesetzter'] }, "UPDATE person SET name = 'x'");
    expect(r.rowCount).toBe(0);
  });

  it('Teilnehmer (Link-Sitzung) sieht nur sich selbst', async () => {
    const r = await q({ tenantId: A.tenant_id, personId: ids.p3, roles: ['teilnehmer'] }, 'SELECT name FROM person');
    expect(r.rows).toEqual([{ name: 'Lea Wagner' }]);
  });

  it('mandantenübergreifende Verweise sind unmöglich (zusammengesetzte Fremdschlüssel)', async () => {
    const bOrg = (await q(staff(B), "INSERT INTO org_unit (name) VALUES ('B-Org') RETURNING id")).rows[0].id;
    await expect(q(staff(), 'INSERT INTO person (name, org_unit_id) VALUES ($1, $2)', ['X', bOrg])).rejects.toThrow(/foreign key/);
    await expect(q(staff(B), 'INSERT INTO person (tenant_id, name) VALUES ($1, $2)', [A.tenant_id, 'X'])).rejects.toThrow(/row-level security/);
  });
});

describe('Schulungen und Versionen', () => {
  let trainingId: string;
  let versionId: string;

  it('Version anlegen, Seiten schreiben, veröffentlichen → unveränderlich', async () => {
    trainingId = (await q(staff(), "INSERT INTO training (titel) VALUES ('Sicherheitsunterweisung 2026') RETURNING id")).rows[0].id;
    versionId = (
      await q(staff(), `INSERT INTO training_version (training_id, version_no, file_key, file_name, file_size, sha256)
                        VALUES ($1, 1, 'k', 'a.pdf', 10, $2) RETURNING id`, [trainingId, 'a'.repeat(64)])
    ).rows[0].id;
    await q(staff(), 'INSERT INTO page_meta (version_id, page_no, word_count, has_text, t_min_seconds) VALUES ($1, 1, 100, true, 18)', [versionId]);
    await q(staff(), 'UPDATE training_version SET published_at = now(), status = $2 WHERE id = $1', [versionId, 'veroeffentlicht']);
    await expect(q(staff(), "UPDATE training_version SET change_note = 'x' WHERE id = $1", [versionId])).rejects.toThrow(/unveränderlich/);
    await expect(q(staff(), 'UPDATE page_meta SET t_min_seconds = 1 WHERE version_id = $1', [versionId])).rejects.toThrow(/unveränderlich/);
    await expect(q(staff(), 'INSERT INTO page_meta (version_id, page_no, word_count, has_text, t_min_seconds) VALUES ($1, 2, 1, false, 4)', [versionId])).rejects.toThrow(/unveränderlich/);
    await expect(q(staff(), 'DELETE FROM training_version WHERE id = $1', [versionId])).rejects.toThrow(/unveränderlich/);
  });

  it('Lösungen des Fragenpools sind für Vorgesetzte und Trainer nicht lesbar', async () => {
    await q(staff(), `INSERT INTO quiz_question (training_id, text, options, correct) VALUES ($1, 'Frage?', '["a","b"]', 1)`, [trainingId]);
    await expect(q(staff(), `INSERT INTO quiz_question (training_id, text, options, correct) VALUES ($1, 'Frage?', '["a","b"]', 2)`, [trainingId])).rejects.toThrow(/check/);
    expect((await q({ tenantId: A.tenant_id, accountId: chefAccount, roles: ['vorgesetzter', 'trainer'] }, 'SELECT * FROM quiz_question')).rowCount).toBe(0);
  });

  it('Seitendetails (page_meta) sind für Vorgesetzte nicht sichtbar, Schulungstitel schon', async () => {
    const ctx = { tenantId: A.tenant_id, accountId: chefAccount, roles: ['vorgesetzter'] };
    expect((await q(ctx, 'SELECT titel FROM training')).rows).toEqual([{ titel: 'Sicherheitsunterweisung 2026' }]);
    expect((await q(ctx, 'SELECT * FROM page_meta')).rowCount).toBe(0);
  });
});
