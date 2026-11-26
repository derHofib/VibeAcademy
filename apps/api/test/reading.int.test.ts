import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock, FakeClock } from '../src/common/clock';
import { RetentionService } from '../src/retention/retention.service';
import { invitedParticipant, publishedTraining, registerDozent } from './fixtures';
import { startHarness, type Client, type Harness } from './harness';

const clock = new FakeClock(new Date('2026-12-01T08:00:00Z'));
let h: Harness;
let dozent: Client;
let trainingId: string;

const ok = { visibleRatio: 1, focused: true, lastInputAgeMs: 1000 };

beforeAll(async () => {
  h = await startHarness([{ provide: Clock, useValue: clock }]);
  dozent = await registerDozent(h);
  // Seiten: 100 Wörter → 18 s, ohne Text → 4 s, 50 Wörter → 9 s
  ({ trainingId } = await publishedTraining(dozent, { wordsPerPage: [100, 0, 50] }));
});
afterAll(async () => h?.close());

async function reader(name: string) {
  const email = `${name.toLowerCase().replace(/\s/g, '.')}@example.org`;
  const x = await invitedParticipant(h, dozent, trainingId, { name, email });
  let seq = 0;
  const start = async () => {
    const s = await x.participant.post(`/api/me/invitations/${x.invitationId}/sessions`);
    seq = 0;
    return s.body.sessionId as string;
  };
  let sid = await start();
  const beat = async (page: number, sig: Partial<typeof ok> = ok, opts: { advance?: number; seq?: number; session?: string; offline?: boolean } = {}) => {
    clock.advance(opts.advance ?? 5000);
    const s = opts.seq ?? seq++;
    return x.participant.post(`/api/me/reading-sessions/${opts.session ?? sid}/heartbeat`, { seq: s, page, ...ok, ...sig, clientTs: Date.now(), offline: opts.offline });
  };
  return { ...x, beat, sid: () => sid, restart: async () => (sid = await start()) };
}

const page = (r: { body: { pages: Array<{ pageNo: number }> } }, n: number) => r.body.pages.find((p) => p.pageNo === n) as unknown as {
  dwellMs: number; fulfilled: boolean; allowed: boolean; tMinMs: number;
};

describe('Lesenachweis – serverseitige Erfassung', () => {
  it('Seite wird erst nach t_min mit gültigem Signal erfüllt; danach ist die nächste Seite frei', async () => {
    const r = await reader('Anna Schulz');
    let res = await r.beat(1); // Basis
    expect(res.body.reason).toBe('first');
    for (let i = 0; i < 3; i++) res = await r.beat(1);
    expect(page(res, 1)).toMatchObject({ dwellMs: 15000, fulfilled: false, tMinMs: 18000 });
    expect(page(res, 2).allowed).toBe(false);
    expect(res.body.current.remainingMs).toBe(3000);
    res = await r.beat(1);
    expect(page(res, 1).fulfilled).toBe(true);
    expect(res.body.newlyFulfilled).toEqual([1]);
    expect(page(res, 2).allowed).toBe(true);
  });

  it('keine Gutschrift bei Sichtbarkeit < 60 %, ohne Fokus oder ohne Eingabe seit 30 s', async () => {
    const r = await reader('Tobias Meier');
    await r.beat(1);
    for (const sig of [{ visibleRatio: 0.59 }, { focused: false }, { lastInputAgeMs: 30000 }]) {
      await r.beat(1, sig);
      const res = await r.beat(1, sig);
      expect(page(res, 1).dwellMs).toBe(0);
    }
    await r.beat(1); // gültige Basis
    const res = await r.beat(1, { visibleRatio: 0.6, lastInputAgeMs: 29999 });
    expect(page(res, 1).dwellMs).toBe(5000);
  });

  it('manipulierte Heartbeats: Lücke, Wiederholung, Zeitsprung, Flut, Seitenwechsel, offline', async () => {
    const r = await reader('Lea Wagner');
    await r.beat(1, ok, { seq: 0 });
    // Lücke in seq → keine Gutschrift
    let res = await r.beat(1, ok, { seq: 5 });
    expect(res.body.reason).toBe('seq_gap');
    expect(page(res, 1).dwellMs).toBe(0);
    // Wiederholung → verworfen
    res = await r.beat(1, ok, { seq: 5 });
    expect(res.body).toMatchObject({ accepted: false, reason: 'stale_or_duplicate' });
    // Zeitsprung 60 s → max. 5 s
    res = await r.beat(1, ok, { seq: 6, advance: 60000 });
    expect(page(res, 1).dwellMs).toBe(5000);
    // Flut (< 1 s) → verworfen
    res = await r.beat(1, ok, { seq: 7, advance: 200 });
    expect(res.body).toMatchObject({ accepted: false, reason: 'too_fast' });
    // Seitenwechsel zwischen zwei Heartbeats → keine Gutschrift
    res = await r.beat(2, ok, { seq: 7 });
    expect(res.body.reason).toBe('page_changed');
    // offline gepuffert → gespeichert, nicht gutgeschrieben
    res = await r.beat(1, ok, { seq: 8, offline: true });
    expect(res.body).toMatchObject({ accepted: false, reason: 'offline' });
    expect(page(res, 1).dwellMs).toBe(5000);
    const raw = await h.db.admin.query('SELECT reason, credited_ms FROM heartbeat_raw WHERE session_id = $1 ORDER BY id', [r.sid()]);
    expect(raw.rows.map((x) => x.reason)).toEqual(['first', 'seq_gap', 'stale_or_duplicate', 'ok', 'too_fast', 'page_changed', 'offline']);
  });

  it('parallele Sitzungen: nur die neueste zählt, die alte erhält 409; Fortschritt summiert sich über Sitzungen', async () => {
    const r = await reader('Kai Neumann');
    await r.beat(1);
    await r.beat(1);
    await r.beat(1); // 10 s
    const old = r.sid();
    await r.restart();
    const blocked = await r.beat(1, ok, { session: old, seq: 3 });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('abgeloest');
    await r.beat(1);
    await r.beat(1);
    const res = await r.beat(1); // +10 s → 20 s ≥ 18 s
    expect(page(res, 1)).toMatchObject({ fulfilled: true, dwellMs: 18000 });
  });

  it('strenger Modus: Seiten-URL für gesperrte Seite → 409; gelesene Seiten bleiben abrufbar; URL ist kurzlebig', async () => {
    const r = await reader('Mehmet Aydin');
    expect((await r.participant.get(`/api/me/invitations/${r.invitationId}/pages/2`)).status).toBe(409);
    const u = await r.participant.get(`/api/me/invitations/${r.invitationId}/pages/1`);
    expect(u.status).toBe(200);
    const file = await r.participant.get(u.body.url);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['cache-control']).toBe('no-store');
    clock.advance(61_000);
    expect((await r.participant.get(u.body.url)).status).toBe(404);
    const tampered = u.body.url.replace(/.$/, (ch: string) => (ch === 'a' ? 'b' : 'a'));
    expect((await r.participant.get(tampered)).status).toBe(404);
  });

  it('alle Seiten erfüllt → Einladung „gelesen“; Vorgesetzte sehen keine Seitendetails', async () => {
    const r = await reader('Sven Albrecht');
    await r.beat(1);
    for (let i = 0; i < 4; i++) await r.beat(1);
    await r.beat(2);
    await r.beat(2);
    await r.beat(3);
    await r.beat(3);
    const res = await r.beat(3);
    expect(res.body.complete).toBe(true);
    const runs = (await dozent.get('/api/runs')).body;
    const inv = (await dozent.get(`/api/runs/${runs[0].id}`)).body.invitations.find((i: { person_name: string }) => i.person_name === 'Sven Albrecht');
    expect(inv.status).toBe('gelesen');
    // direkter DB-Zugriff als Vorgesetzter: keine Zeilen in page_progress/heartbeat_raw/read_session
    const tenant = (await dozent.get('/api/auth/me')).body.activeTenantId;
    const c = await h.db.app.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.roles', 'vorgesetzter', true)`, [tenant]);
      for (const t of ['page_progress', 'heartbeat_raw', 'read_session']) {
        expect((await c.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n).toBe(0);
      }
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });
});

describe('Datenschutz', () => {
  it('Roh-Heartbeats älter als 90 Tage werden gelöscht, Fortschritt bleibt', async () => {
    const before = (await h.db.admin.query('SELECT count(*)::int n FROM heartbeat_raw')).rows[0].n;
    await h.db.admin.query(`UPDATE heartbeat_raw SET server_ts = now() - interval '91 days' WHERE id IN (SELECT id FROM heartbeat_raw ORDER BY id LIMIT 3)`);
    expect(await h.app.get(RetentionService).purge()).toBe(3);
    expect((await h.db.admin.query('SELECT count(*)::int n FROM heartbeat_raw')).rows[0].n).toBe(before - 3);
    expect((await h.db.admin.query('SELECT count(*)::int n FROM page_progress')).rows[0].n).toBeGreaterThan(0);
  });
});
