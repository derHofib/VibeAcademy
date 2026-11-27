import { describe, expect, it } from 'vitest';
import { bookingTotalCents, canTransition, dueBookingStages, formatEuro, parseEuro } from './external-booking';
import { buildIcs, foldLine, icsEscape } from './ics';

const start = new Date('2027-01-12T07:30:00Z');
const end = new Date('2027-01-13T14:00:00Z');
const D = 86_400_000;
const policy = { daysBefore: 7, escalateAfterDays: 7 };

describe('Status externer Schulungen', () => {
  it('Hauptpfad und Nebenzweige', () => {
    expect(canTransition('geplant', 'zur_freigabe')).toBe(true);
    expect(canTransition('gebucht', 'eingeladen')).toBe(true);
    expect(canTransition('eingeladen', 'bestaetigt')).toBe(true);
    expect(canTransition('teilgenommen', 'eingereicht')).toBe(true);
    expect(canTransition('eingereicht', 'freigegeben')).toBe(true);
    expect(canTransition('verschoben', 'eingeladen')).toBe(true);
    expect(canTransition('freigegeben', 'abgesagt')).toBe(false);
    expect(canTransition('geplant', 'freigegeben')).toBe(false);
  });

  it('Erinnerungen genau einmal: 7 Tage vorher, Vortag, Upload, Eskalation', () => {
    const p = (status: 'eingeladen' | 'bestaetigt' | 'teilgenommen' | 'eingereicht', sent: Array<'vorher' | 'vortag' | 'upload' | 'eskalation'> = []) => ({ status, firstStart: start, lastEnd: end, sent });
    expect(dueBookingStages(p('bestaetigt'), policy, new Date(start.getTime() - 8 * D))).toEqual([]);
    expect(dueBookingStages(p('bestaetigt'), policy, new Date(start.getTime() - 6 * D))).toEqual(['vorher']);
    expect(dueBookingStages(p('bestaetigt', ['vorher']), policy, new Date(start.getTime() - 6 * D))).toEqual([]);
    expect(dueBookingStages(p('bestaetigt', ['vorher']), policy, new Date(start.getTime() - 3600_000))).toEqual(['vortag']);
    expect(dueBookingStages(p('teilgenommen', ['vorher', 'vortag']), policy, new Date(end.getTime() + 3600_000))).toEqual(['upload']);
    expect(dueBookingStages(p('teilgenommen', ['vorher', 'vortag', 'upload']), policy, new Date(end.getTime() + 8 * D))).toEqual(['eskalation']);
    expect(dueBookingStages(p('eingereicht', ['upload']), policy, new Date(end.getTime() + 8 * D))).toEqual([]);
  });
});

describe('Kosten', () => {
  it('Gebühr und Hotel je Person, Reise je Buchung; Euro lesen und schreiben', () => {
    expect(bookingTotalCents({ feeCents: 129_000, hotelCents: 23_600, travelCents: 0 }, 2)).toBe(305_200);
    expect(formatEuro(305_200)).toBe('3.052,00 €');
    expect(parseEuro('1.290,00')).toBe(129_000);
    expect(parseEuro('1290')).toBe(129_000);
    expect(parseEuro('236,5')).toBe(23_650);
    expect(parseEuro('')).toBe(0);
    expect(parseEuro('abc')).toBeNull();
    expect(parseEuro('-5')).toBeNull();
  });
});

describe('Kalendereintrag (.ics)', () => {
  it('je Tag ein Termin, maskiert, gefaltet, Absage mit METHOD:CANCEL', () => {
    const ics = buildIcs({
      method: 'REQUEST',
      sequence: 0,
      now: new Date('2026-11-27T10:00:00Z'),
      organizer: { name: 'Muster Elektrotechnik GmbH', email: 'no-reply@example.org' },
      attendee: { name: 'Lea Wagner', email: 'lea@example.org' },
      events: [
        { uid: 'b1-p1-1', start, end: new Date('2027-01-12T15:30:00Z'), summary: 'Elektrofachkraft Hochvolt (HV2), Tag 1', location: 'Industriestr. 14, 70565 Stuttgart; Raum 2' },
        { uid: 'b1-p1-2', start: new Date('2027-01-13T07:00:00Z'), end, summary: 'Elektrofachkraft Hochvolt (HV2), Tag 2' },
      ],
    });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain('DTSTART:20270112T073000Z');
    expect(ics).toContain('LOCATION:Industriestr. 14\\, 70565 Stuttgart\\; Raum 2');
    expect(ics).toContain('METHOD:REQUEST');
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    const cancel = buildIcs({ method: 'CANCEL', sequence: 2, now: new Date(), events: [{ uid: 'b1-p1-1', start, end, summary: 'x' }] });
    expect(cancel).toContain('METHOD:CANCEL');
    expect(cancel).toContain('STATUS:CANCELLED');
    expect(cancel).toContain('SEQUENCE:2');
  });

  it('Hilfen', () => {
    expect(icsEscape('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    const long = 'DESCRIPTION:' + 'ä'.repeat(80);
    expect(foldLine(long).split('\r\n ').length).toBeGreaterThan(1);
  });
});
