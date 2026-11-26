import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { attendanceDurationMs, formatDuration, summarizeAttendance, validateManualCheckout, type AttendanceWindow } from './attendance';

const H = 3600_000;
const M = 60_000;
const T0 = Date.parse('2026-12-04T07:00:00Z');
const w: AttendanceWindow = { startAt: T0, endAt: T0 + 7.5 * H, endedAt: null };
const at = (h: number, m = 0) => T0 + h * H + m * M;

describe('Dauer aus Intervallen', () => {
  it('ein Intervall, gekappt auf den geplanten Beginn', () => {
    expect(attendanceDurationMs([{ inAt: at(0, -4), outAt: at(7, 26) }], w, at(9))).toBe(7 * H + 26 * M);
  });
  it('Wiedereintritt: zwei Intervalle werden addiert', () => {
    const iv = [{ inAt: at(0), outAt: at(2) }, { inAt: at(3), outAt: at(7, 30) }];
    expect(attendanceDurationMs(iv, w, at(9))).toBe(6.5 * H);
  });
  it('Überlappungen zählen nur einmal', () => {
    const iv = [{ inAt: at(0), outAt: at(3) }, { inAt: at(2), outAt: at(4) }];
    expect(attendanceDurationMs(iv, w, at(9))).toBe(4 * H);
  });
  it('offenes Intervall zählt bis jetzt (laufende Uhr), höchstens bis zum geplanten Ende', () => {
    expect(attendanceDurationMs([{ inAt: at(0, 2), outAt: null }], w, at(4, 51))).toBe(4 * H + 49 * M);
    expect(attendanceDurationMs([{ inAt: at(0), outAt: null }], w, at(10))).toBe(7.5 * H);
  });
  it('Kappung auf das offizielle Ende (auch wenn später ausgecheckt)', () => {
    const ended = { ...w, endedAt: at(7) };
    expect(attendanceDurationMs([{ inAt: at(0), outAt: at(7, 25) }], ended, at(9))).toBe(7 * H);
  });
  it('Property: Dauer ≤ geplante Dauer und ≥ 0', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: -2 * H, max: 10 * H }), fc.integer({ min: 0, max: 5 * H }), fc.boolean()), { maxLength: 6 }),
        (raw) => {
          const iv = raw.map(([a, d, open]) => ({ inAt: T0 + a, outAt: open ? null : T0 + a + d }));
          const ms = attendanceDurationMs(iv, w, T0 + 12 * H);
          expect(ms).toBeGreaterThanOrEqual(0);
          expect(ms).toBeLessThanOrEqual(7.5 * H);
        },
      ),
    );
  });
});

describe('Vollständigkeit', () => {
  it('≥ 90 % vollständig, sonst teilweise (Standard)', () => {
    expect(summarizeAttendance([{ inAt: at(0), outAt: at(6, 45) }], w, at(9))).toMatchObject({ state: 'vollstaendig', pct: 90 });
    expect(summarizeAttendance([{ inAt: at(0), outAt: at(6, 44) }], w, at(9))).toMatchObject({ state: 'teilweise', pct: 89 });
  });
  it('Schwelle je Schulung einstellbar', () => {
    expect(summarizeAttendance([{ inAt: at(0), outAt: at(6) }], w, at(9), 80)).toMatchObject({ state: 'vollstaendig', pct: 80 });
  });
  it('vorzeitig gegangen (manuell 12:53) → teilweise', () => {
    const s = summarizeAttendance([{ inAt: at(0, 3), outAt: at(4, 53) }], { ...w, endedAt: at(7, 30) }, at(9));
    expect(s).toMatchObject({ state: 'teilweise', durationMs: 4 * H + 50 * M, plannedMs: 7.5 * H, pct: 64 });
    expect(formatDuration(s.durationMs)).toBe('4 h 50 min');
  });
});

describe('Manuelles Ausloggen', () => {
  it('Grund und Vermerk ≥ 10 Zeichen sind Pflicht', () => {
    expect(validateManualCheckout(undefined, 'Notdienst beim Kunden')).toBe('grund_fehlt');
    expect(validateManualCheckout('weg', 'Notdienst beim Kunden')).toBe('grund_fehlt');
    expect(validateManualCheckout('vorzeitig', '  kurz    ')).toBe('vermerk_zu_kurz');
    expect(validateManualCheckout('vorzeitig', 'Notdienst-Einsatz beim Kunden ab 13 Uhr')).toBeNull();
  });
});
