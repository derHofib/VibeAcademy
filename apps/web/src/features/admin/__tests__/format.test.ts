import {
  daysUntil,
  deviceLabel,
  formatBytes,
  formatClock,
  formatDate,
  formatDecimal,
  formatDuration,
  formatShortDateTime,
  invitationChip,
  parseDecimal,
  runStatusChip,
  sessionsSummary,
  shortHash,
} from '../format';

describe('Formatierung', () => {
  it('formatDuration: Sekunden als „6 min 22 s“', () => {
    expect(formatDuration(382)).toBe('6 min 22 s');
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(120)).toBe('2 min');
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(-3)).toBe('0 s');
    expect(formatDuration(59.6)).toBe('1 min');
  });

  it('formatClock: Millisekunden als m:ss (Seitenprotokoll)', () => {
    expect(formatClock(34_000)).toBe('0:34');
    expect(formatClock(708_000)).toBe('11:48');
    expect(formatClock(382_000)).toBe('6:22');
    expect(formatClock(0)).toBe('0:00');
  });

  it('Datum/Uhrzeit in Europe/Berlin', () => {
    expect(formatDate('2026-11-25T09:12:00Z')).toBe('25.11.2026');
    expect(formatShortDateTime('2026-11-03T11:47:00Z')).toBe('03.11. 12:47');
    // Sommerzeit
    expect(formatShortDateTime('2026-07-01T06:05:00Z')).toBe('01.07. 08:05');
    expect(formatDate(null)).toBe('—');
    expect(formatShortDateTime('kein Datum')).toBe('—');
  });

  it('formatBytes und shortHash', () => {
    expect(formatBytes(912)).toBe('912 B');
    expect(formatBytes(4_404_019)).toBe('4,2 MB');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(shortHash('9f3c4b2e1d0a71e9f3c4b2e1d0aa71e')).toBe('9f3c…a71e');
    expect(shortHash(null)).toBe('—');
  });

  it('Dezimalzahlen mit Komma', () => {
    expect(parseDecimal('0,6')).toBe(0.6);
    expect(parseDecimal(' 1.5 ')).toBe(1.5);
    expect(parseDecimal('200')).toBe(200);
    expect(parseDecimal('abc')).toBeNaN();
    expect(parseDecimal('')).toBeNaN();
    expect(formatDecimal(0.6)).toBe('0,6');
    expect(formatDecimal(1500)).toBe('1500');
  });

  it('daysUntil zählt Kalendertage', () => {
    const now = new Date('2026-11-26T22:30:00Z'); // 23:30 in Berlin
    expect(daysUntil('2026-11-27T08:00:00Z', now)).toBe(1);
    expect(daysUntil('2026-11-26T05:00:00Z', now)).toBe(0);
    expect(daysUntil('2026-11-20T05:00:00Z', now)).toBe(-6);
  });
});

describe('Status-Chips', () => {
  const now = new Date('2026-11-26T10:00:00Z');
  it('Durchführung: überfällig > abgeschlossen > Frist nah > läuft', () => {
    expect(
      runStatusChip({ eingeladen: 22, erledigt: 18, ueberfaellig: 4, deadline: '2026-12-11' }, now),
    ).toEqual({
      label: '4 überfällig',
      tone: 'danger',
    });
    expect(runStatusChip({ eingeladen: 9, erledigt: 9, ueberfaellig: 0, deadline: null }, now)).toEqual({
      label: 'Abgeschlossen',
      tone: 'success',
    });
    expect(
      runStatusChip({ eingeladen: 64, erledigt: 52, ueberfaellig: 0, deadline: '2026-12-01T22:59:59Z' }, now),
    ).toEqual({
      label: 'Frist in 5 Tagen',
      tone: 'warn',
    });
    expect(
      runStatusChip({ eingeladen: 5, erledigt: 3, ueberfaellig: 0, deadline: '2026-11-27T12:00:00Z' }, now)
        .label,
    ).toBe('Frist morgen');
    expect(
      runStatusChip({ eingeladen: 48, erledigt: 41, ueberfaellig: 0, deadline: '2026-12-15' }, now),
    ).toEqual({
      label: 'Läuft',
      tone: 'info',
    });
    expect(runStatusChip({ eingeladen: 0, erledigt: 0, ueberfaellig: 0, deadline: null }, now).tone).toBe(
      'neutral',
    );
  });

  it('Einladung: überfällig nur solange nicht erledigt', () => {
    expect(invitationChip('geoeffnet', true)).toEqual({ label: 'Überfällig', tone: 'danger' });
    expect(invitationChip('bestaetigt', true)).toEqual({ label: 'Erledigt', tone: 'success' });
    expect(invitationChip('offen')).toEqual({ label: 'Eingeladen', tone: 'neutral' });
    expect(invitationChip('bestanden').tone).toBe('warn');
  });

  it('Sitzungen mit Gerät', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148';
    const pc = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0';
    expect(deviceLabel(iphone)).toBe('Handy');
    expect(deviceLabel(pc)).toBe('PC');
    expect(deviceLabel(null)).toBe('unbekannt');
    expect(sessionsSummary([{ user_agent: iphone }, { user_agent: iphone }, { user_agent: pc }])).toBe(
      '3 (Handy, PC)',
    );
    expect(sessionsSummary([])).toBe('0');
  });
});
