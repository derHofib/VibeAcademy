import { createHmac } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  checkQrScan, decodeQrPayload, encodeQrPayload, extractQrToken, fromBase64Url, makeQrToken, peekQrToken, printedWindow,
  QR_SLOT_MS, secondsToNextSlot, slotOf, slotStartMs, toBase64Url, verifyQrSignature, type QrPayload, type QrRunState,
} from './qr';

const signer = (key: string) => (body: string) => new Uint8Array(createHmac('sha256', key).update(body).digest());
const sign = signer('mandant-a');
const RUN = '3f2b6c1e-8a4d-4c2e-9b7a-1d2e3f4a5b6c';
const T0 = Date.parse('2026-12-04T07:00:00Z'); // Beginn 08:00 Berlin
const run: QrRunState = { runId: RUN, startAt: T0, endAt: T0 + 7.5 * 3600_000, endedAt: null };
const rot = (nowMs: number, kind: 'start' | 'end' = 'start'): QrPayload => ({ runId: RUN, kind, mode: 'rotierend', slot: slotOf(nowMs) });

describe('Kodierung', () => {
  it('Payload ist kompakt und verlustfrei', () => {
    const p: QrPayload = { runId: RUN, kind: 'end', mode: 'gedruckt', slot: 59_000_123 };
    const body = encodeQrPayload(p);
    expect(body).toHaveLength(28);
    expect(decodeQrPayload(body)).toEqual(p);
    const t = makeQrToken(p, sign);
    expect(t.length).toBeLessThan(60);
    expect(peekQrToken(t)).toEqual(p);
  });
  it('base64url hin und zurück (Property)', () => {
    fc.assert(fc.property(fc.uint8Array({ maxLength: 64 }), (b) => {
      expect(Array.from(fromBase64Url(toBase64Url(b))!)).toEqual(Array.from(b));
    }));
  });
  it('akzeptiert URL oder nacktes Token', () => {
    const t = makeQrToken(rot(T0), sign);
    expect(extractQrToken(`https://schulung.example.org/q/${t}`)).toBe(t);
    expect(verifyQrSignature(`https://schulung.example.org/q/${t}`, sign)).toEqual(rot(T0));
  });
  it('Müll wird abgelehnt', () => {
    expect(peekQrToken('hallo')).toBeNull();
    expect(peekQrToken('a.b.c')).toBeNull();
    expect(decodeQrPayload('AAAA')).toBeNull();
    expect(verifyQrSignature('x'.repeat(28) + '.' + 'y'.repeat(22), sign)).toBeNull();
  });
});

describe('Signatur und Bindung', () => {
  it('signiert: geänderter Payload, fremder Schlüssel oder gekürzte Signatur → ungültig', () => {
    const t = makeQrToken(rot(T0), sign);
    expect(verifyQrSignature(t, sign)).not.toBeNull();
    expect(verifyQrSignature(t, signer('mandant-b'))).toBeNull();
    const [body, sig] = t.split('.') as [string, string];
    const other = encodeQrPayload({ ...rot(T0), kind: 'end' });
    expect(verifyQrSignature(`${other}.${sig}`, sign)).toBeNull();
    expect(verifyQrSignature(`${body}.${sig.slice(0, -2)}`, sign)).toBeNull();
  });
  it('gebunden an Termin und Art', () => {
    const now = T0 + 3600_000;
    expect(checkQrScan({ payload: rot(now), expectedKind: 'end', run, nowMs: now })).toEqual({ ok: false, reason: 'falsche_art' });
    expect(checkQrScan({ payload: { ...rot(now), runId: '00000000-0000-4000-8000-000000000000' }, expectedKind: 'start', run, nowMs: now })).toEqual({
      ok: false, reason: 'falscher_termin',
    });
  });
});

describe('Rotation alle 30 s', () => {
  it('neuer Code je Slot; aktueller und vorheriger Slot gültig, vorletzter nicht', () => {
    const issued = T0 + 10 * QR_SLOT_MS + 5_000;
    const p = rot(issued);
    expect(makeQrToken(p, sign)).not.toBe(makeQrToken(rot(issued + QR_SLOT_MS), sign));
    expect(checkQrScan({ payload: p, expectedKind: 'start', run, nowMs: issued + 20_000 })).toMatchObject({ ok: true, scanAtMs: issued + 20_000 });
    expect(checkQrScan({ payload: p, expectedKind: 'start', run, nowMs: issued + 30_000 })).toMatchObject({ ok: true }); // vorheriger Slot
    expect(checkQrScan({ payload: p, expectedKind: 'start', run, nowMs: issued + 55_000 })).toEqual({ ok: false, reason: 'abgelaufen' });
    expect(checkQrScan({ payload: rot(issued + 60_000), expectedKind: 'start', run, nowMs: issued })).toEqual({ ok: false, reason: 'zukunft' });
  });
  it('Scanzeit = Serverzeit (Eingang), nicht der Slot', () => {
    const now = T0 + 77_777;
    expect(checkQrScan({ payload: rot(now - 31_000), expectedKind: 'start', run, nowMs: now })).toEqual({ ok: true, scanAtMs: now, offline: false });
  });
  it('Countdown bis zum Wechsel', () => {
    expect(secondsToNextSlot(slotStartMs(100) + 9_000)).toBe(21);
  });
  it('nach dem offiziellen Ende ungültig', () => {
    const ended = { ...run, endedAt: T0 + 3600_000 };
    expect(checkQrScan({ payload: rot(T0 + 3600_000, 'end'), expectedKind: 'end', run: ended, nowMs: T0 + 3600_000 + 1 })).toEqual({ ok: false, reason: 'beendet' });
  });
});

describe('Gedruckter Aushang', () => {
  const printed = (kind: 'start' | 'end' = 'start'): QrPayload => ({ runId: RUN, kind, mode: 'gedruckt', slot: slotOf(T0 - 86_400_000) });
  it('nur 30 min vor Beginn bis 60 min nach geplantem Ende', () => {
    const w = printedWindow(run);
    expect(w).toEqual({ from: T0 - 30 * 60_000, until: run.endAt + 60 * 60_000 });
    expect(checkQrScan({ payload: printed(), expectedKind: 'start', run, nowMs: w.from - 1 })).toEqual({ ok: false, reason: 'ausserhalb_zeitfenster' });
    expect(checkQrScan({ payload: printed(), expectedKind: 'start', run, nowMs: w.from })).toMatchObject({ ok: true, scanAtMs: w.from });
    expect(checkQrScan({ payload: printed('end'), expectedKind: 'end', run, nowMs: w.until })).toMatchObject({ ok: true });
    expect(checkQrScan({ payload: printed('end'), expectedKind: 'end', run, nowMs: w.until + 1 })).toEqual({ ok: false, reason: 'ausserhalb_zeitfenster' });
  });
  it('nach offiziellem Ende ungültig, auch im Fenster', () => {
    const ended = { ...run, endedAt: run.endAt - 600_000 };
    expect(checkQrScan({ payload: printed('end'), expectedKind: 'end', run: ended, nowMs: run.endAt })).toEqual({ ok: false, reason: 'beendet' });
  });
});

describe('Offline-Scan', () => {
  it('Scanzeit = signierter Slot-Beginn, höchstens 12 h nachträglich', () => {
    const scanned = T0 + 3600_000 + 12_345;
    const p = rot(scanned);
    const later = scanned + 3 * 3600_000;
    expect(checkQrScan({ payload: p, expectedKind: 'start', run, nowMs: later, offline: true })).toEqual({ ok: true, scanAtMs: slotStartMs(p.slot), offline: true });
    expect(checkQrScan({ payload: p, expectedKind: 'start', run, nowMs: later })).toEqual({ ok: false, reason: 'abgelaufen' });
    expect(checkQrScan({ payload: p, expectedKind: 'start', run, nowMs: slotStartMs(p.slot) + 12 * 3600_000 + 1, offline: true })).toEqual({ ok: false, reason: 'offline_zu_alt' });
  });
  it('offline gescannt vor dem Ende → gilt; Slot nach dem Ende → ungültig', () => {
    const endedAt = T0 + 2 * 3600_000;
    const ended = { ...run, endedAt };
    expect(checkQrScan({ payload: rot(endedAt - 60_000, 'end'), expectedKind: 'end', run: ended, nowMs: endedAt + 3600_000, offline: true })).toMatchObject({ ok: true });
    expect(checkQrScan({ payload: rot(endedAt + 30_000, 'end'), expectedKind: 'end', run: ended, nowMs: endedAt + 3600_000, offline: true })).toEqual({ ok: false, reason: 'beendet' });
  });
  it('Property: angenommene Scanzeit liegt nie in der Zukunft und nie vor dem signierten Slot', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20 * 3600_000 }), fc.integer({ min: 0, max: 14 * 3600_000 }), fc.boolean(), (at, delay, offline) => {
        const p = rot(T0 + at);
        const now = T0 + at + delay;
        const r = checkQrScan({ payload: p, expectedKind: 'start', run, nowMs: now, offline });
        if (r.ok) {
          expect(r.scanAtMs).toBeLessThanOrEqual(now);
          expect(r.scanAtMs).toBeGreaterThanOrEqual(slotStartMs(p.slot));
        }
      }),
    );
  });
});
