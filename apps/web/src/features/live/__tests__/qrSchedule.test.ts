import { formatCountdown, qrRefetchDelayMs, secondsLeft, validWindowLabel } from '../qrSchedule';

describe('QR-Aktualisierung', () => {
  it('holt kurz nach dem Slot-Wechsel den neuen Code', () => {
    expect(qrRefetchDelayMs(21)).toBe(21_400);
    expect(qrRefetchDelayMs(30)).toBe(30_400);
    // nie schneller als 1 s, nie langsamer als ein Slot + 1 s
    expect(qrRefetchDelayMs(0)).toBe(1000);
    expect(qrRefetchDelayMs(500)).toBe(31_000);
    expect(qrRefetchDelayMs(undefined)).toBe(30_400);
    expect(qrRefetchDelayMs(Number.NaN)).toBe(30_400);
  });

  it('Countdown bis zum Code-Wechsel', () => {
    const fetched = 1_000_000;
    expect(secondsLeft(fetched, 21, fetched)).toBe(21);
    expect(secondsLeft(fetched, 21, fetched + 500)).toBe(21);
    expect(secondsLeft(fetched, 21, fetched + 20_100)).toBe(1);
    expect(secondsLeft(fetched, 21, fetched + 60_000)).toBe(0);
    expect(secondsLeft(fetched, undefined, fetched)).toBe(0);
    expect(formatCountdown(21)).toBe('0:21');
    expect(formatCountdown(75)).toBe('1:15');
  });

  it('Gültigkeitsfenster „heute“ bzw. mit Datum', () => {
    const from = '2026-12-04T06:30:00Z';
    const until = '2026-12-04T15:30:00Z';
    expect(validWindowLabel(from, until, Date.parse('2026-12-04T10:00:00Z'))).toBe('heute 07:30–16:30');
    expect(validWindowLabel(from, until, Date.parse('2026-12-01T10:00:00Z'))).toBe('am 04.12.2026 07:30–16:30');
  });
});
