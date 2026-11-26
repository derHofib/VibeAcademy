import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withContext, type DbContext } from '../src/context';
import { createTestDb, type TestDb } from '../src/testing';

/** RLS und Integritätsregeln für Präsenz/Live (Migration 012). */
let db: TestDb;
let A: { account_id: string; tenant_id: string };
let B: { account_id: string; tenant_id: string };
let chefAccount: string;
let trainerAccount: string;
const id = {} as Record<
  'org' | 'p1' | 'p2' | 'chef' | 'trainer' | 'run' | 'inv1' | 'att1' | 'att2' | 'q1' | 'qAnon' | 'poll' | 'mood' | 'runB',
  string
>;

const staff = (t = A): DbContext => ({ tenantId: t.tenant_id, accountId: t.account_id, roles: ['admin', 'verantwortlich'] });
const sys = (t = A): DbContext => ({ tenantId: t.tenant_id, roles: ['system'] });
const participant = (personId: string): DbContext => ({ tenantId: A.tenant_id, personId, roles: ['teilnehmer'] });
const q = async (ctx: DbContext, sql: string, params: unknown[] = []) => withContext(db.app, ctx, (c) => c.query(sql, params));
const n = async (ctx: DbContext, table: string) => (await q(ctx, `SELECT count(*)::int AS n FROM ${table}`)).rows[0].n as number;

beforeAll(async () => {
  db = await createTestDb();
  const reg = async (email: string) => (await db.app.query('SELECT * FROM app.auth_register_tenant($1, $2, $3, $4)', [email, 'D', 'h', 'Firma'])).rows[0];
  A = await reg('a@example.org');
  B = await reg('b@example.org');
  chefAccount = (await db.app.query("SELECT app.auth_register_account('chef@example.org', 'Chef', 'h') id")).rows[0].id;
  trainerAccount = (await db.app.query("SELECT app.auth_register_account('trainer@example.org', 'Trainerin', 'h') id")).rows[0].id;
  id.org = (await q(staff(), "INSERT INTO org_unit (name) VALUES ('Lager') RETURNING id")).rows[0].id;
  const person = async (name: string, account: string | null = null) =>
    (await q(staff(), 'INSERT INTO person (name, org_unit_id, account_id) VALUES ($1, $2, $3) RETURNING id', [name, id.org, account])).rows[0].id;
  id.p1 = await person('Anna Schulz');
  id.p2 = await person('Tobias Meier');
  id.chef = await person('Chef Lager', chefAccount);
  id.trainer = await person('Trainerin', trainerAccount);
  await q(staff(), 'UPDATE org_unit SET leiter_person_id = $1 WHERE id = $2', [id.chef, id.org]);
  id.run = (
    await q(staff(), `INSERT INTO run (typ, titel, start_at, end_at, status, trainer_person_id)
                      VALUES ('live_extern', 'Erste-Hilfe-Fortbildung', '2026-12-04T07:00Z', '2026-12-04T14:30Z', 'laeuft', $1) RETURNING id`, [id.trainer])
  ).rows[0].id;
  id.inv1 = (await q(staff(), 'INSERT INTO invitation (run_id, person_id) VALUES ($1, $2) RETURNING id', [id.run, id.p1])).rows[0].id;
  await q(staff(), 'INSERT INTO invitation (run_id, person_id) VALUES ($1, $2)', [id.run, id.p2]);
  const att = async (personId: string) => {
    const a = (await q(sys(), `INSERT INTO attendance (run_id, person_id, check_in_method) VALUES ($1, $2, 'qr_start') RETURNING id`, [id.run, personId])).rows[0].id;
    await q(sys(), `INSERT INTO attendance_interval (attendance_id, in_at, in_method) VALUES ($1, '2026-12-04T07:00Z', 'qr_start')`, [a]);
    return a;
  };
  id.att1 = await att(id.p1);
  id.att2 = await att(id.p2);
  id.q1 = (await q(sys(), `INSERT INTO live_question (run_id, person_id, text) VALUES ($1, $2, 'Wie oft prüfen?') RETURNING id`, [id.run, id.p1])).rows[0].id;
  id.qAnon = (await q(sys(), `INSERT INTO live_question (run_id, person_id, text) VALUES ($1, NULL, 'Medikamente ausgeben?') RETURNING id`, [id.run])).rows[0].id;
  await q(sys(), 'INSERT INTO live_question_vote (question_id, person_id) VALUES ($1, $2), ($3, $4)', [id.qAnon, id.p1, id.qAnon, id.p2]);
  id.poll = (
    await q(sys(), `INSERT INTO live_poll (run_id, question, options, correct, mode, opened_at, closed_at)
                    VALUES ($1, 'Stromunfall?', '["a","b","c"]', 1, 'wissenscheck', now(), now()) RETURNING id`, [id.run])
  ).rows[0].id;
  for (const [p, o] of [[id.p1, 1], [id.p2, 0]] as const) {
    await q(sys(), 'INSERT INTO live_poll_participant (poll_id, person_id) VALUES ($1, $2)', [id.poll, p]);
    await q(sys(), 'INSERT INTO live_poll_answer (poll_id, person_id, option, correct, answered_at) VALUES ($1, $2, $3, $4, now())', [id.poll, p, o, o === 1]);
  }
  id.mood = (
    await q(sys(), `INSERT INTO live_poll (run_id, question, options, mode, opened_at) VALUES ($1, 'Wie sicher?', '["ja","nein"]', 'stimmungsbild', now()) RETURNING id`, [id.run])
  ).rows[0].id;
  await q(sys(), 'INSERT INTO live_poll_answer (poll_id, option) VALUES ($1, 0)', [id.mood]);
  // Mandant B: eigener Termin
  id.runB = (await q(staff(B), `INSERT INTO run (typ, titel, start_at, end_at) VALUES ('live_extern', 'B-Termin', now(), now() + interval '1 hour') RETURNING id`)).rows[0].id;
});
afterAll(async () => db?.drop());

describe('Mandantentrennung', () => {
  it('Mandant B sieht nichts aus A', async () => {
    for (const t of ['attendance', 'attendance_interval', 'live_question', 'live_question_vote', 'live_poll', 'live_poll_answer', 'live_poll_participant']) {
      expect(await n(staff(B), t), t).toBe(0);
      expect(await n(staff(), t), t).toBeGreaterThan(0);
    }
  });
  it('mandantenübergreifende Verweise sind unmöglich', async () => {
    await expect(q(sys(B), `INSERT INTO attendance (run_id, person_id) VALUES ($1, $2)`, [id.run, id.chef])).rejects.toThrow(/foreign key/);
    await expect(q(sys(), `INSERT INTO attendance (run_id, person_id) VALUES ($1, $2)`, [id.runB, id.p1])).rejects.toThrow(/foreign key/);
  });
  it('ohne Kontext keine Zeilen', async () => {
    expect(await n({}, 'attendance')).toBe(0);
    expect(await n({}, 'live_question')).toBe(0);
  });
});

describe('Teilnehmer sehen nur eigene Daten', () => {
  it('eigene Anwesenheit, eigene Intervalle, eigene Antworten und Stimmen', async () => {
    const me = participant(id.p1);
    expect((await q(me, 'SELECT person_id FROM attendance')).rows).toEqual([{ person_id: id.p1 }]);
    expect(await n(me, 'attendance_interval')).toBe(1);
    expect((await q(me, 'SELECT person_id FROM live_poll_answer')).rows).toEqual([{ person_id: id.p1 }]);
    expect((await q(me, 'SELECT person_id FROM live_question_vote')).rows).toEqual([{ person_id: id.p1 }]);
    expect(await n(me, 'live_poll_participant')).toBe(1);
    // Fragen und Kontrollfragen des eigenen Termins
    expect(await n(me, 'live_question')).toBe(2);
    expect(await n(me, 'live_poll')).toBe(2);
  });
  it('Teilnehmer schreiben nicht direkt (nur über den Systemkontext der API, E-27)', async () => {
    const me = participant(id.p1);
    expect((await q(me, `UPDATE attendance SET confirmed_at = now(), confirmed_via = 'selbst'`)).rowCount).toBe(0);
    await expect(q(me, `INSERT INTO live_question (run_id, text) VALUES ($1, 'Hallo Welt')`, [id.run])).rejects.toThrow(/row-level security/);
  });
  it('nicht eingeladene Person sieht keine Fragen des Termins', async () => {
    expect(await n(participant(id.chef), 'live_question')).toBe(0);
  });
});

describe('Vorgesetzte nur Status, Trainer nur ihre Termine', () => {
  const chef = (): DbContext => ({ tenantId: A.tenant_id, accountId: chefAccount, roles: ['vorgesetzter'] });
  const trainer = (): DbContext => ({ tenantId: A.tenant_id, accountId: trainerAccount, roles: ['trainer'] });
  it('Vorgesetzter: Einladungsstatus ja, Anwesenheitsdetails/Antworten/Fragen nein', async () => {
    expect(await n(chef(), 'invitation')).toBe(2);
    for (const t of ['attendance', 'attendance_interval', 'live_poll_answer', 'live_question', 'live_question_vote', 'live_poll']) {
      expect(await n(chef(), t), t).toBe(0);
    }
  });
  it('Trainer des Termins liest Anwesenheit, Fragen und Antworten, schreibt aber nicht direkt', async () => {
    expect(await n(trainer(), 'attendance')).toBe(2);
    expect(await n(trainer(), 'attendance_interval')).toBe(2);
    expect(await n(trainer(), 'live_question')).toBe(2);
    expect(await n(trainer(), 'live_poll_answer')).toBe(3);
    expect((await q(trainer(), `UPDATE attendance SET note_review = 'akzeptiert'`)).rowCount).toBe(0);
    // anderer Trainer (ohne Zuordnung) sieht nichts
    expect(await n({ tenantId: A.tenant_id, accountId: chefAccount, roles: ['trainer'] }, 'attendance')).toBe(0);
  });
});

describe('Integrität', () => {
  it('Stimmungsbild nur ohne Personenbezug, Wissenscheck nur mit', async () => {
    await expect(q(sys(), 'INSERT INTO live_poll_answer (poll_id, person_id, option) VALUES ($1, $2, 1)', [id.mood, id.p1])).rejects.toThrow(/ohne Personenbezug/);
    await expect(q(sys(), 'INSERT INTO live_poll_answer (poll_id, option, answered_at) VALUES ($1, 1, now())', [id.mood])).rejects.toThrow(/ohne Personenbezug/);
    await expect(q(sys(), 'INSERT INTO live_poll_answer (poll_id, option) VALUES ($1, 1)', [id.poll])).rejects.toThrow(/Personenbezug/);
    await expect(q(sys(), 'INSERT INTO live_poll_answer (poll_id, option) VALUES ($1, 5)', [id.mood])).rejects.toThrow(/außerhalb/);
  });
  it('„Ich auch“ und Antwort je Person nur einmal; höchstens eine offene Kontrollfrage', async () => {
    await expect(q(sys(), 'INSERT INTO live_question_vote (question_id, person_id) VALUES ($1, $2)', [id.qAnon, id.p1])).rejects.toThrow(/duplicate key/);
    await expect(q(sys(), 'INSERT INTO live_poll_participant (poll_id, person_id) VALUES ($1, $2)', [id.poll, id.p1])).rejects.toThrow(/duplicate key/);
    await expect(
      q(sys(), `INSERT INTO live_poll (run_id, question, options, mode, opened_at) VALUES ($1, 'Noch eine?', '["a","b"]', 'stimmungsbild', now())`, [id.run]),
    ).rejects.toThrow(/live_poll_one_open/);
    await expect(
      q(sys(), `INSERT INTO live_poll (run_id, question, options, mode, opened_at) VALUES ($1, 'Ohne Lösung?', '["a","b"]', 'wissenscheck', now())`, [id.run]),
    ).rejects.toThrow(/check constraint/);
  });
  it('höchstens ein offenes Intervall; Vermerk ≥ 10 Zeichen; bestätigte Anwesenheit unveränderlich', async () => {
    await expect(q(sys(), `INSERT INTO attendance_interval (attendance_id, in_at, in_method) VALUES ($1, now(), 'qr_start')`, [id.att1])).rejects.toThrow(/one_open/);
    await expect(q(sys(), `UPDATE attendance SET check_out_reason = 'vorzeitig', check_out_note = 'zu kurz' WHERE id = $1`, [id.att1])).rejects.toThrow(/check constraint/);
    await q(sys(), `UPDATE attendance_interval SET out_at = '2026-12-04T14:30Z', out_method = 'official_end' WHERE attendance_id = $1`, [id.att2]);
    await q(sys(), `UPDATE attendance SET confirmed_at = now(), confirmed_via = 'selbst' WHERE id = $1`, [id.att2]);
    await expect(q(sys(), `UPDATE attendance_interval SET out_at = '2026-12-04T14:00Z' WHERE attendance_id = $1`, [id.att2])).rejects.toThrow(/unveränderlich/);
    await expect(q(sys(), `INSERT INTO attendance_interval (attendance_id, in_at, in_method) VALUES ($1, now(), 'qr_start')`, [id.att2])).rejects.toThrow(/unveränderlich/);
  });
  it('Kampagnen brauchen weiterhin Schulung + Version; Termine brauchen Beginn < Ende', async () => {
    await expect(q(staff(), `INSERT INTO run (typ, titel) VALUES ('kampagne', 'Kampagne X')`)).rejects.toThrow(/run_kampagne_complete/);
    await expect(q(staff(), `INSERT INTO run (typ, titel, start_at, end_at) VALUES ('termin', 'Termin', now(), now())`)).rejects.toThrow(/run_termin_times/);
  });
  it('anonyme Frage ohne Personenbezug bleibt anonym', async () => {
    expect((await q(staff(), 'SELECT person_id FROM live_question WHERE id = $1', [id.qAnon])).rows[0].person_id).toBeNull();
  });
});
