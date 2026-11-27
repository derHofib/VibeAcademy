import type { BookingStatus } from '@sn/shared';

/** Externe Schulungen (Phase 4.3, E-55): Antworten der API. */
export interface BookingView {
  id: string;
  titel: string;
  trainingId: string | null;
  requirementId: string | null;
  provider: { name: string; contact: string | null; phone: string | null; email: string | null; web: string | null };
  bookingNo: string | null;
  format: 'praesenz' | 'online';
  address: string | null;
  room: string | null;
  meetingPoint: string | null;
  onlinePlatform: string | null;
  onlineUrl: string | null;
  travel: { mode: 'firmenwagen' | 'bahn' | 'flug' | 'privat' | null; departure: string | null; carpool: string | null; notes: string | null; catering: string | null; bringAlong: string | null };
  hotel: { name: string | null; address: string | null; checkIn: string | null; checkOut: string | null; bookingNo: string | null };
  internalContact: string | null;
  costs: { feeCents: number; hotelCents: number; travelCents: number; costCenter: string | null; totalCents: number; cancelCostCents: number | null };
  approval: { required: boolean; approverPersonId: string | null; approvedAt: string | null };
  cancelled: { at: string; reason: string } | null;
  reminders: { daysBefore: number; escalateAfterDays: number };
  days: Array<{ dayNo: number; startAt: string; endAt: string; label: string }>;
  participants: Array<{
    id: string;
    personId: string;
    name: string;
    email: string | null;
    orgUnit: string | null;
    status: BookingStatus;
    statusLabel: string;
    statusAt: string;
    statusReason: string | null;
    invitedAt: string | null;
    confirmedAt: string | null;
    problem: { note: string; at: string } | null;
    externalRecordId: string | null;
    recordStatus: string | null;
    validUntil: string | null;
  }>;
  files: Array<{ id: string; file_name: string; content_type: string; size_bytes: number; sha256: string; created_at: string }>;
  createdAt: string;
}

export interface BookingReport {
  totalCents: number;
  byCostCenter: Array<{ costCenter: string; cents: number }>;
  perPerson: Array<{ name: string; cents: number; bookings: number }>;
  openCertificates: number;
  bookings: number;
}

export interface MyBookingView {
  tenantName: string;
  booking: Omit<BookingView, 'participants' | 'costs' | 'approval' | 'reminders'>;
  me: { name: string; status: BookingStatus; statusLabel: string; confirmedAt: string | null; problem: { note: string; at: string } | null; recordStatus: string | null };
  can: { confirm: boolean; problem: boolean; upload: boolean };
}

export const bookingKeys = {
  list: ['admin', 'external-bookings'] as const,
  one: (id: string) => ['admin', 'external-bookings', id] as const,
  report: ['admin', 'external-bookings', 'report'] as const,
};

/** Status-Ton für Chips. */
export function statusTone(s: BookingStatus): 'success' | 'info' | 'warn' | 'danger' | 'neutral' {
  if (s === 'freigegeben' || s === 'bestaetigt') return 'success';
  if (s === 'eingereicht' || s === 'zur_freigabe' || s === 'verschoben') return 'warn';
  if (s === 'abgesagt' || s === 'nicht_erschienen') return 'danger';
  if (s === 'geplant') return 'neutral';
  return 'info';
}

/** Gesamtstatus einer Buchung = am weitesten zurückliegender offener Status der Teilnehmer. */
export function overallStatus(b: Pick<BookingView, 'participants' | 'cancelled'>): BookingStatus {
  if (b.cancelled) return 'abgesagt';
  const order: BookingStatus[] = ['geplant', 'zur_freigabe', 'gebucht', 'verschoben', 'eingeladen', 'bestaetigt', 'teilgenommen', 'eingereicht', 'freigegeben'];
  const open = b.participants.filter((p) => !['abgesagt', 'nicht_erschienen'].includes(p.status));
  if (!open.length) return b.participants[0]?.status ?? 'geplant';
  return open.map((p) => p.status).sort((a, z) => order.indexOf(a) - order.indexOf(z))[0]!;
}

/** Filtergruppen der Übersicht. */
export type BookingFilter = 'alle' | 'geplant' | 'gebucht' | 'offen' | 'abgeschlossen' | 'abgesagt';
export function matchesFilter(b: BookingView, f: BookingFilter): boolean {
  const s = overallStatus(b);
  switch (f) {
    case 'geplant':
      return s === 'geplant' || s === 'zur_freigabe';
    case 'gebucht':
      return ['gebucht', 'eingeladen', 'bestaetigt', 'verschoben'].includes(s);
    case 'offen':
      return s === 'teilgenommen' || s === 'eingereicht';
    case 'abgeschlossen':
      return s === 'freigegeben';
    case 'abgesagt':
      return s === 'abgesagt';
    default:
      return true;
  }
}

/** Lokale Datum-/Zeitfelder → ISO mit Offset (Europe/Berlin). */
export function berlinIso(date: string, time: string): string {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
  }).formatToParts(new Date(guess));
  const g = (k: string) => Number(parts.find((p) => p.type === k)!.value);
  const off = (Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - guess) / 60000;
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${date}T${time}:00${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

/** ISO → { date: 'YYYY-MM-DD', time: 'HH:MM' } in Ortszeit. */
export function berlinParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const time = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }).format(d);
  return { date, time };
}
