import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LoginLockService } from '../src/auth/login-lock.service';
import { Clock, FakeClock } from '../src/common/clock';
import { RedisService } from '../src/redis/redis.service';
import { startHarness, type Client, type Harness } from './harness';

/**
 * Login-Sperre mit steigender Dauer (je E-Mail, SHA-256-Schlüssel): 5 Fehlversuche frei, dann 1, 2, 4 … Minuten,
 * Deckel 24 h; gilt für Login, Step-up und „Passwort ändern“. Dazu „Passwort ändern“ selbst.
 */
const clock = new FakeClock(new Date('2026-12-01T08:00:00Z'));
let h: Harness;
const DOZENT = { name: 'Dana Dozentin', organisation: 'Sperr GmbH', email: 'sperre@example.org', password: 'richtiges-passwort-1' };
const MIN = 60_000;

const login = (c: Client, email: string, password: string) => c.post('/api/auth/login', { email, password });
const q = async (sql: string, p: unknown[] = []) => (await h.db.admin.query(sql, p)).rows;

beforeAll(async () => {
  h = await startHarness([{ provide: Clock, useValue: clock }]);
  const c = await h.agent();
  expect((await c.post('/api/auth/register', DOZENT)).status).toBe(201);
});
afterAll(async () => h?.close());
beforeEach(async () => {
  // Jeder Fall startet ohne Sperre und ohne IP-Zähler (das IP-Limit wird separat geprüft)
  const redis = h.app.get(RedisService).client;
  const keys = await redis.keys(`${redis.options.keyPrefix}*`);
  const own = keys.map((k) => k.slice(String(redis.options.keyPrefix).length)).filter((k) => /^(loginlock:|rl:)/.test(k));
  if (own.length) await redis.del(...own);
});

describe('Login-Sperre mit steigender Dauer', () => {
  it('5 Fehlversuche ohne Sperre, 6. → 1 min, 7. → 2 min; Retry-After und Restzeit in der Meldung', async () => {
    const c = await h.agent();
    for (let i = 1; i <= 5; i++) {
      const r = await login(c, DOZENT.email, 'falsch-falsch-falsch');
      expect(r.status, `Versuch ${i}`).toBe(401);
    }
    const sixth = await login(c, DOZENT.email, 'falsch-falsch-falsch');
    expect(sixth.status).toBe(429);
    expect(sixth.headers['retry-after']).toBe('60');
    expect(sixth.body).toMatchObject({ code: 'login_locked', retryAfterSeconds: 60 });
    expect(sixth.body.message).toBe('Zu viele Fehlversuche. Bitte in 1 Minute erneut versuchen.');

    // Während der Sperre wird auch das richtige Passwort abgelehnt (gar nicht geprüft)
    clock.advance(30_000);
    const during = await login(c, DOZENT.email, DOZENT.password);
    expect(during.status).toBe(429);
    expect(during.headers['retry-after']).toBe('30');
    expect((await c.get('/api/auth/me')).status).toBe(401);

    clock.advance(31_000);
    const seventh = await login(c, DOZENT.email, 'falsch-falsch-falsch');
    expect(seventh.status).toBe(429);
    expect(seventh.headers['retry-after']).toBe('120');
    expect(seventh.body.message).toBe('Zu viele Fehlversuche. Bitte in 2 Minuten erneut versuchen.');

    clock.advance(2 * MIN + 1000);
    const eighth = await login(c, DOZENT.email, 'falsch-falsch-falsch');
    expect(eighth.headers['retry-after']).toBe('240');
    expect(eighth.body.message).toBe('Zu viele Fehlversuche. Bitte in 4 Minuten erneut versuchen.');

    // Audit „login_locked“ ohne Passwortdaten
    const audit = await q(`SELECT payload FROM audit_event WHERE action = 'login_locked' ORDER BY seq`);
    expect(audit.length).toBeGreaterThanOrEqual(3);
    expect(audit[0]!.payload).toMatchObject({ failures: 6, lock_seconds: 60 });
    expect(JSON.stringify(audit)).not.toMatch(/falsch|richtiges|password/i);
  });

  it('erfolgreiche Anmeldung setzt Zähler und Sperrstufe zurück', async () => {
    const c = await h.agent();
    for (let i = 0; i < 6; i++) await login(c, DOZENT.email, 'falsch-falsch-falsch');
    clock.advance(MIN + 1000);
    expect((await login(c, DOZENT.email, DOZENT.password)).status).toBe(200);
    // wieder 5 freie Versuche, die nächste Sperre beginnt erneut bei 1 Minute
    for (let i = 0; i < 5; i++) expect((await login(c, DOZENT.email, 'falsch-falsch-falsch')).status).toBe(401);
    const r = await login(c, DOZENT.email, 'falsch-falsch-falsch');
    expect(r.status).toBe(429);
    expect(r.headers['retry-after']).toBe('60');
  });

  it('unbekannte E-Mail wird genauso gesperrt (keine Konto-Erkennung), Groß-/Kleinschreibung egal', async () => {
    const c = await h.agent();
    const ghost = 'Niemand@Example.org';
    const responses = [];
    for (let i = 0; i < 6; i++) responses.push(await login(c, i % 2 ? ghost.toLowerCase() : ghost, 'irgendwas-langes'));
    expect(responses.slice(0, 5).map((r) => r.status)).toEqual([401, 401, 401, 401, 401]);
    expect(responses[5]!.status).toBe(429);
    expect(responses[5]!.headers['retry-after']).toBe('60');
    // gleiche Antwortform wie bei einem existierenden Konto
    expect(Object.keys(responses[5]!.body).sort()).toEqual(['code', 'message', 'retryAfterSeconds', 'statusCode']);
    expect(responses[0]!.body.message).toBe('E-Mail oder Passwort ist falsch');
  });

  it('Sperrdauer gedeckelt auf 24 Stunden', async () => {
    const lock = h.app.get(LoginLockService);
    expect(lock.policy).toEqual({ freeAttempts: 5, baseSeconds: 60, maxSeconds: 86_400 });
    const mail = 'deckel@example.org';
    for (let i = 0; i < 16; i++) await lock.fail(mail).catch(() => undefined);
    expect(await lock.remaining(mail)).toBe(61_440); // 16. Fehlversuch: 60 · 2^10 s
    clock.advance(61_440_000 + 1000);
    const c = await h.agent();
    const r = await login(c, mail, 'falsch-falsch-falsch'); // 17. → wäre 122 880 s
    expect(r.status).toBe(429);
    expect(r.headers['retry-after']).toBe('86400');
    expect(r.body.message).toBe('Zu viele Fehlversuche. Bitte in 24 Stunden erneut versuchen.');
  });

  it('IP-Limit bleibt: viele verschiedene Adressen von einer IP → 429', async () => {
    const c = await h.agent();
    let last = 0;
    for (let i = 0; i < 32; i++) last = (await login(c, `ip-${i}@example.org`, 'falsch-falsch-falsch')).status;
    expect(last).toBe(429);
  });

  it('Step-up per Passwort zählt für dieselbe Sperre', async () => {
    const c = await h.agent();
    expect((await login(c, DOZENT.email, DOZENT.password)).status).toBe(200);
    const purpose = `signature:${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}`;
    for (let i = 0; i < 5; i++) {
      expect((await c.post('/api/auth/step-up', { password: 'falsch-falsch', purpose })).status).toBe(401);
    }
    const locked = await c.post('/api/auth/step-up', { password: 'falsch-falsch', purpose });
    expect(locked.status).toBe(429);
    expect(locked.headers['retry-after']).toBe('60');
    // auch der Login derselben Adresse ist jetzt gesperrt
    expect((await login(await h.agent(), DOZENT.email, DOZENT.password)).status).toBe(429);
  });
});

describe('Passwort ändern', () => {
  const NEU = 'neues-passwort-1';

  it('prüft das aktuelle Passwort, Regeln und Unterschied zum alten', async () => {
    const c = await h.agent();
    expect((await login(c, DOZENT.email, DOZENT.password)).status).toBe(200);
    const me = await c.get('/api/auth/me');
    expect(me.body.account.hasPassword).toBe(true);
    const wrong = await c.post('/api/auth/password/change', { currentPassword: 'falsch-falsch', newPassword: NEU });
    expect(wrong.status).toBe(400);
    expect(wrong.body.fields).toEqual([{ path: 'currentPassword', message: 'Das aktuelle Passwort ist falsch' }]);
    const short = await c.post('/api/auth/password/change', { currentPassword: DOZENT.password, newPassword: 'kurz' });
    expect(short.status).toBe(400);
    expect(short.body.fields[0]).toMatchObject({ path: 'newPassword', message: 'Das Passwort muss mindestens 10 Zeichen haben' });
    const same = await c.post('/api/auth/password/change', { currentPassword: DOZENT.password, newPassword: DOZENT.password });
    expect(same.status).toBe(400);
    expect(same.body.fields[0].path).toBe('newPassword');
    // ohne CSRF-Token abgelehnt
    expect((await c.http.post('/api/auth/password/change').send({ currentPassword: DOZENT.password, newPassword: NEU })).status).toBe(403);
    // ohne Anmeldung abgelehnt
    expect((await (await h.agent()).post('/api/auth/password/change', { currentPassword: 'x', newPassword: NEU })).status).toBe(401);
  });

  it('speichert, beendet alle anderen Sitzungen, aktuelle bleibt; Audit ohne Passwortdaten', async () => {
    const a = await h.agent();
    const b = await h.agent();
    expect((await login(a, DOZENT.email, DOZENT.password)).status).toBe(200);
    expect((await login(b, DOZENT.email, DOZENT.password)).status).toBe(200);
    const r = await a.post('/api/auth/password/change', { currentPassword: DOZENT.password, newPassword: NEU });
    expect(r.status).toBe(200);
    expect(r.body.endedSessions).toBeGreaterThanOrEqual(1);
    expect((await a.get('/api/auth/me')).status).toBe(200);
    expect((await b.get('/api/auth/me')).status).toBe(401);
    // altes Passwort gilt nicht mehr, neues schon
    const c = await h.agent();
    expect((await login(c, DOZENT.email, DOZENT.password)).status).toBe(401);
    expect((await login(c, DOZENT.email, NEU)).status).toBe(200);
    const audit = await q(`SELECT payload FROM audit_event WHERE action = 'password_changed'`);
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(NEU);
    expect(JSON.stringify(audit)).not.toContain(DOZENT.password);
    // zurück für die folgenden Fälle
    expect((await a.post('/api/auth/password/change', { currentPassword: NEU, newPassword: DOZENT.password })).status).toBe(200);
  });

  it('falsches aktuelles Passwort zählt als Fehlversuch für die Sperre', async () => {
    const c = await h.agent();
    expect((await login(c, DOZENT.email, DOZENT.password)).status).toBe(200);
    for (let i = 0; i < 5; i++) {
      expect((await c.post('/api/auth/password/change', { currentPassword: 'falsch-falsch', newPassword: NEU })).status).toBe(400);
    }
    const locked = await c.post('/api/auth/password/change', { currentPassword: 'falsch-falsch', newPassword: NEU });
    expect(locked.status).toBe(429);
    expect(locked.headers['retry-after']).toBe('60');
    // während der Sperre auch mit richtigem Passwort nicht
    const during = await c.post('/api/auth/password/change', { currentPassword: DOZENT.password, newPassword: NEU });
    expect(during.status).toBe(429);
    expect(during.body.message).toBe('Zu viele Fehlversuche. Bitte in 1 Minute erneut versuchen.');
    // die Sitzung bleibt bestehen
    expect((await c.get('/api/auth/me')).status).toBe(200);
  });
});
