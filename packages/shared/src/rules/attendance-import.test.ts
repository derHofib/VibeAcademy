import { describe, expect, it } from 'vitest';
import {
  berlinLocal, decodeText, normalizeName, parseAttendanceTable, parseDuration, parseReportTime, secondsWithin, splitTable,
} from './attendance-import';

const ctx = { startAt: berlinLocal(2026, 11, 18, 9, 0), endAt: berlinLocal(2026, 11, 18, 10, 0) };

const TEAMS_DE = [
  '1. Zusammenfassung',
  'Besprechungstitel\tUnterweisung Die fünf Sicherheitsregeln',
  'Teilnehmer insgesamt\t4',
  'Startzeit\t18.11.26, 09:00:05',
  'Endzeit\t18.11.26, 10:00:30',
  '',
  '2. Teilnehmer',
  'Name\tErster Beitritt\tLetztes Verlassen\tDauer der Besprechung\tE-Mail-Adresse\tTeilnehmer-ID (UPN)\tRolle',
  'Dennis Hofmann\t18.11.26, 08:58:00\t18.11.26, 10:00:30\t1 Std. 2 Min. 30 Sek.\tdennis.hofmann@muster-elektro.de\tdennis.hofmann@muster-elektro.de\tOrganisator',
  'Lea Wagner\t18.11.26, 09:01:12\t18.11.26, 10:00:05\t58 Min. 53 Sek.\tlea.wagner@muster-elektro.de\tlea.wagner@muster-elektro.de\tTeilnehmer',
  'Anna Schulz\t18.11.26, 09:12:00\t18.11.26, 10:00:00\t43 Min.\tanna.schulz@muster-elektro.de\tanna.schulz@muster-elektro.de\tTeilnehmer',
  'Becker, Jonas (Gast)\t18.11.26, 09:05:00\t18.11.26, 09:55:00\t50 Min.\t\t\tTeilnehmer',
  '',
  '3. Aktivitäten in der Besprechung',
  'Name\tBeitrittszeit\tZeit des Verlassens\tDauer\tE-Mail-Adresse\tRolle',
  'Dennis Hofmann\t18.11.26, 08:58:00\t18.11.26, 10:00:30\t1 Std. 2 Min. 30 Sek.\tdennis.hofmann@muster-elektro.de\tOrganisator',
  'Lea Wagner\t18.11.26, 09:01:12\t18.11.26, 10:00:05\t58 Min. 53 Sek.\tlea.wagner@muster-elektro.de\tTeilnehmer',
  'Anna Schulz\t18.11.26, 09:12:00\t18.11.26, 09:40:00\t28 Min.\tanna.schulz@muster-elektro.de\tTeilnehmer',
  'Anna Schulz\t18.11.26, 09:45:00\t18.11.26, 10:00:00\t15 Min.\tanna.schulz@muster-elektro.de\tTeilnehmer',
  'Becker, Jonas (Gast)\t18.11.26, 09:05:00\t18.11.26, 09:55:00\t50 Min.\t\tTeilnehmer',
].join('\r\n');

const utf16 = (s: string) => {
  const b = new Uint8Array(2 + s.length * 2);
  b[0] = 0xff;
  b[1] = 0xfe;
  for (let i = 0; i < s.length; i++) {
    b[2 + i * 2] = s.charCodeAt(i) & 0xff;
    b[3 + i * 2] = s.charCodeAt(i) >> 8;
  }
  return b;
};

describe('Teams-Anwesenheitsbericht', () => {
  it('deutsch, UTF-16, Abschnitt „Aktivitäten“ mit Wiedereintritt', () => {
    const r = parseAttendanceTable(splitTable(decodeText(utf16(TEAMS_DE))), ctx);
    expect(r.format).toBe('teams');
    expect(r.warnings).toEqual([]);
    expect(r.entries.map((e) => e.name)).toEqual(['Dennis Hofmann', 'Lea Wagner', 'Anna Schulz', 'Becker, Jonas (Gast)']);
    const anna = r.entries.find((e) => e.name === 'Anna Schulz')!;
    expect(anna.email).toBe('anna.schulz@muster-elektro.de');
    expect(anna.intervals).toHaveLength(2);
    expect(secondsWithin(anna.intervals, ctx.startAt, ctx.endAt)).toBe(43 * 60);
    const lea = r.entries.find((e) => e.name === 'Lea Wagner')!;
    expect(secondsWithin(lea.intervals, ctx.startAt, ctx.endAt)).toBe(58 * 60 + 48); // 09:01:12–10:00:00 im Zeitfenster
    expect(r.entries.find((e) => e.name.startsWith('Becker'))!.email).toBeNull();
    expect(r.entries[0]!.role).toBe('Organisator');
  });

  it('englisch (US-Datumsformat) ohne Abschnitt 3', () => {
    const en = [
      '1. Summary',
      'Meeting title\tSafety briefing',
      '',
      '2. Participants',
      'Name\tFirst Join\tLast Leave\tIn-Meeting Duration\tEmail\tParticipant ID (UPN)\tRole',
      'Lea Wagner\t11/18/26, 9:01:12 AM\t11/18/26, 10:00:05 AM\t58m 53s\tlea.wagner@muster-elektro.de\tlea.wagner@muster-elektro.de\tAttendee',
      'Kai Neumann\t11/18/26, 9:30:00 AM\t11/18/26, 9:50:00 AM\t20m\tkai.neumann@gmx.de\tkai.neumann@gmx.de\tAttendee',
    ].join('\n');
    const r = parseAttendanceTable(splitTable(en), ctx);
    expect(r.format).toBe('teams');
    expect(r.entries).toHaveLength(2);
    const kai = r.entries[1]!;
    expect(kai.intervals[0]!.inAt.toISOString()).toBe('2026-11-18T08:30:00.000Z');
    expect(secondsWithin(kai.intervals, ctx.startAt, ctx.endAt)).toBe(20 * 60);
  });

  it('altes Format mit Beitritt/Verlassen-Ereignissen', () => {
    const classic = [
      'Full Name\tUser Action\tTimestamp',
      'Lea Wagner\tJoined\t11/18/2026, 9:01:00 AM',
      'Anna Schulz\tJoined\t11/18/2026, 9:10:00 AM',
      'Anna Schulz\tLeft\t11/18/2026, 9:30:00 AM',
      'Anna Schulz\tJoined\t11/18/2026, 9:40:00 AM',
      'Lea Wagner\tLeft\t11/18/2026, 10:00:00 AM',
    ].join('\n');
    const r = parseAttendanceTable(splitTable(classic), ctx);
    expect(r.format).toBe('teams_ereignisse');
    const anna = r.entries.find((e) => e.name === 'Anna Schulz')!;
    // 9:10–9:30 und ab 9:40 ohne Verlassen bis zum geplanten Ende
    expect(secondsWithin(anna.intervals, ctx.startAt, ctx.endAt)).toBe(40 * 60);
  });
});

describe('Tabellen und Hilfen', () => {
  it('CSV mit Semikolon ohne Zeiten bzw. nur mit Dauer', () => {
    const r = parseAttendanceTable(splitTable('Name;E-Mail;Dauer\nLea Wagner;lea@example.org;55\n"Meier, Tobias";;\n'), ctx);
    expect(r.format).toBe('tabelle');
    expect(r.entries).toEqual([
      expect.objectContaining({ name: 'Lea Wagner', email: 'lea@example.org', reportedSeconds: 3300 }),
      expect.objectContaining({ name: 'Meier, Tobias', email: null, intervals: [] }),
    ]);
    expect(secondsWithin(r.entries[0]!.intervals, ctx.startAt, ctx.endAt)).toBe(3300);
  });

  it('ohne Kopfzeile → Hinweis', () => {
    expect(parseAttendanceTable([['a', 'b']], ctx)).toMatchObject({ entries: [], warnings: ['Keine Kopfzeile mit Name oder E-Mail gefunden.'] });
  });

  it('Zeit, Dauer, Namen', () => {
    expect(parseReportTime('18.11.2026, 09:01:12')!.toISOString()).toBe('2026-11-18T08:01:12.000Z');
    expect(parseReportTime('2026-07-01 12:00')!.toISOString()).toBe('2026-07-01T10:00:00.000Z'); // Sommerzeit
    expect(parseReportTime('09:30', ctx.startAt)!.toISOString()).toBe('2026-11-18T08:30:00.000Z');
    expect(parseReportTime('12:05:00 PM', ctx.startAt)!.toISOString()).toBe('2026-11-18T11:05:00.000Z');
    expect(parseReportTime('quatsch')).toBeNull();
    expect(parseDuration('1h 2m 3s')).toBe(3723);
    expect(parseDuration('59 Min. 3 Sek.')).toBe(3543);
    expect(parseDuration('1 Std. 2 Min.')).toBe(3720);
    expect(parseDuration('00:59:03')).toBe(3543);
    expect(parseDuration('45')).toBe(2700);
    expect(parseDuration('')).toBeNull();
    expect(normalizeName('Becker, Jonas (Gast)')).toBe('jonas becker');
    expect(normalizeName('Jürgen  Weiß')).toBe('jurgen weiss');
    expect(decodeText(new TextEncoder().encode('﻿Name'))).toBe('Name');
  });
});
