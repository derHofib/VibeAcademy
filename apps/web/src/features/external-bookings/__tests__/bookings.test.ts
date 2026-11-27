import { bookingBody } from '@/pages/external-bookings/ExternalBookingPage';
import { berlinIso, berlinParts, matchesFilter, overallStatus, statusTone, type BookingView } from '../api';

const p = (status: BookingView['participants'][number]['status']) => ({ status }) as BookingView['participants'][number];
const view = (statuses: Array<BookingView['participants'][number]['status']>, cancelled = false) =>
  ({ participants: statuses.map(p), cancelled: cancelled ? { at: '2026-12-01', reason: 'x' } : null }) as unknown as BookingView;

describe('Externe Schulungen – Übersicht', () => {
  it('Gesamtstatus = am weitesten zurückliegender offener Status; Absage gewinnt', () => {
    expect(overallStatus(view(['bestaetigt', 'eingeladen']))).toBe('eingeladen');
    expect(overallStatus(view(['freigegeben', 'abgesagt']))).toBe('freigegeben');
    expect(overallStatus(view(['eingereicht', 'teilgenommen']))).toBe('teilgenommen');
    expect(overallStatus(view(['gebucht'], true))).toBe('abgesagt');
  });
  it('Filter und Farben', () => {
    expect(matchesFilter(view(['zur_freigabe']), 'geplant')).toBe(true);
    expect(matchesFilter(view(['verschoben']), 'gebucht')).toBe(true);
    expect(matchesFilter(view(['eingereicht']), 'offen')).toBe(true);
    expect(matchesFilter(view(['freigegeben']), 'abgeschlossen')).toBe(true);
    expect(matchesFilter(view(['freigegeben']), 'offen')).toBe(false);
    expect(statusTone('nicht_erschienen')).toBe('danger');
    expect(statusTone('bestaetigt')).toBe('success');
  });
  it('Ortszeit hin und zurück', () => {
    expect(berlinIso('2027-01-12', '08:30')).toBe('2027-01-12T08:30:00+01:00');
    expect(berlinParts('2027-01-12T07:30:00Z')).toEqual({ date: '2027-01-12', time: '08:30' });
  });
});

describe('Externe Schulung planen – Prüfung', () => {
  const base = {
    titel: 'Elektrofachkraft Hochvolt (HV2)', requirementId: '', providerName: 'Hochvolt Akademie Süd GmbH', providerContact: '', providerPhone: '', providerEmail: '',
    providerWeb: '', bookingNo: '', format: 'praesenz' as const, address: 'Industriestr. 14', room: '', meetingPoint: '', onlinePlatform: '', onlineUrl: '',
    travelMode: 'firmenwagen' as const, departure: '', carpool: '', hotelName: 'Hotel am Park', hotelAddress: '', hotelCheckIn: '2027-01-11', hotelCheckOut: '2027-01-13',
    hotelBookingNo: '', catering: '', bringAlong: '', travelNotes: '', internalContact: '', fee: '1.290,00', hotel: '236', travel: '', costCenter: '4100',
    approvalRequired: false, approverPersonId: '', reminderDaysBefore: '7', escalateAfterDays: '7',
    days: [{ date: '2027-01-12', start: '08:30', end: '16:30' }, { date: '2027-01-13', start: '08:00', end: '15:00' }], personIds: ['p1', 'p2'],
  };
  it('gültig → Körper mit Cent, ISO-Zeiten, Personen nur beim Anlegen', () => {
    const r = bookingBody(base, true);
    expect(r.errors).toEqual({});
    expect(r.body).toMatchObject({ feeCents: 129_000, hotelCents: 23_600, travelCents: 0, travelMode: 'firmenwagen', personIds: ['p1', 'p2'] });
    expect(r.body!.days).toEqual([
      { startAt: '2027-01-12T08:30:00+01:00', endAt: '2027-01-12T16:30:00+01:00' },
      { startAt: '2027-01-13T08:00:00+01:00', endAt: '2027-01-13T15:00:00+01:00' },
    ]);
    expect(bookingBody(base, false).body).not.toHaveProperty('personIds');
  });
  it('Fehler: Titel, Anbieter, Datum, Ende vor Beginn, Euro, Freigabe ohne Person', () => {
    const r = bookingBody({ ...base, titel: '', providerName: 'x', fee: 'abc', approvalRequired: true, days: [{ date: '', start: '08:00', end: '09:00' }, { date: '2027-01-13', start: '10:00', end: '09:00' }] }, true);
    expect(Object.keys(r.errors).sort()).toEqual(['approverPersonId', 'day0', 'day1', 'fee', 'providerName', 'titel']);
  });
});
