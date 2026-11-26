import { dateDe, durLong, durShort, formatClock, hm, liveDurationSeconds, localDateTimeIso, pctOf, sameDay, serverOffsetMs } from '../time';
import type { AttendanceInterval } from '../api';

const iv = (inAt: string, out: string | null): AttendanceInterval => ({
  in: inAt,
  out,
  inMethod: 'qr_start',
  outMethod: out ? 'qr_end' : null,
  inOffline: false,
  outOffline: false,
});

describe('Uhr- und Dauerformate', () => {
  it('formatiert die laufende Uhr wie im Mockup', () => {
    expect(formatClock(4 * 3600 + 51 * 60)).toBe('4:51:00');
    expect(formatClock(59)).toBe('0:00:59');
    expect(formatClock(-5)).toBe('0:00:00');
    expect(formatClock(36_000 + 61.9)).toBe('10:01:01');
  });

  it('kurze Dauer für die Organisator-Tabelle („7 h 30“)', () => {
    expect(durShort(7 * 3600 + 30 * 60)).toBe('7 h 30');
    expect(durShort(5 * 60 + 59)).toBe('0 h 05');
    expect(durShort(0)).toBe('0 h 00');
  });

  it('lange Dauer für die Zusammenfassung („7 h 28 min“)', () => {
    expect(durLong(7 * 3600 + 28 * 60)).toBe('7 h 28 min');
    expect(durLong(4 * 3600 + 51 * 60 + 40)).toBe('4 h 51 min');
    expect(durLong(12 * 60)).toBe('12 min');
    expect(durLong(2 * 3600 + 59)).toBe('2 h');
    expect(durLong(30)).toBe('< 1 min');
    expect(durLong(0)).toBe('0 min');
  });

  it('Uhrzeit und Datum in Europe/Berlin (Sommer- und Winterzeit)', () => {
    expect(hm('2026-12-04T07:02:00Z')).toBe('08:02');
    expect(hm('2026-07-01T06:00:00Z')).toBe('08:00');
    expect(hm(null)).toBe('–');
    expect(dateDe('2026-12-04T07:02:00Z')).toBe('04.12.2026');
    expect(sameDay('2026-12-04T23:30:00Z', '2026-12-05T08:00:00+01:00')).toBe(true);
    expect(sameDay('2026-12-04T22:30:00Z', '2026-12-05T08:00:00+01:00')).toBe(false);
  });

  it('Serverversatz aus serverTime', () => {
    expect(serverOffsetMs('2026-12-04T12:00:05.000Z', Date.parse('2026-12-04T12:00:00.000Z'))).toBe(5000);
    expect(serverOffsetMs(null, 123)).toBe(0);
    expect(serverOffsetMs('kaputt', 123)).toBe(0);
  });

  it('laufende Dauer: Intervalle addiert, auf Beginn und Ende gekappt', () => {
    const run = { startAt: '2026-12-04T07:00:00Z', endAt: '2026-12-04T14:30:00Z', endedAt: null };
    const now = Date.parse('2026-12-04T11:53:00Z');
    // vor Beginn eingecheckt → zählt ab Beginn
    expect(liveDurationSeconds([iv('2026-12-04T06:56:00Z', null)], run, now)).toBe((4 * 60 + 53) * 60);
    // zwei Intervalle
    const two = [iv('2026-12-04T07:00:00Z', '2026-12-04T08:00:00Z'), iv('2026-12-04T09:00:00Z', null)];
    expect(liveDurationSeconds(two, run, now)).toBe(3600 + (2 * 60 + 53) * 60);
    // offizielles Ende kappt
    expect(liveDurationSeconds([iv('2026-12-04T07:00:00Z', null)], { ...run, endedAt: '2026-12-04T10:00:00Z' }, now)).toBe(3 * 3600);
  });

  it('Anteil an der geplanten Dauer', () => {
    expect(pctOf(17460, 27000)).toBe(65);
    expect(pctOf(30000, 27000)).toBe(100);
    expect(pctOf(10, 0)).toBe(0);
  });

  it('Datum + Uhrzeit → ISO (Gerätezeitzone)', () => {
    const iso = localDateTimeIso('2026-12-04', '08:00');
    expect(iso).not.toBeNull();
    expect(new Date(iso!).getHours()).toBe(8);
    expect(localDateTimeIso('04.12.2026', '08:00')).toBeNull();
    expect(localDateTimeIso('2026-12-04', '8')).toBeNull();
  });
});
