/** Externe Schulungen planen, buchen und nachverfolgen (E-55/E-56) – Status, Übergänge, Erinnerungen, Kosten. */

export const BOOKING_STATUSES = [
  'geplant', 'zur_freigabe', 'gebucht', 'eingeladen', 'bestaetigt', 'teilgenommen', 'eingereicht', 'freigegeben',
  'abgesagt', 'nicht_erschienen', 'verschoben',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  geplant: 'geplant',
  zur_freigabe: 'zur Freigabe',
  gebucht: 'gebucht',
  eingeladen: 'Einladung versendet',
  bestaetigt: 'vom Mitarbeiter bestätigt',
  teilgenommen: 'teilgenommen',
  eingereicht: 'Nachweis eingereicht',
  freigegeben: 'geprüft/freigegeben',
  abgesagt: 'abgesagt/storniert',
  nicht_erschienen: 'nicht erschienen',
  verschoben: 'verschoben',
};

/** Hauptpfad in Reihenfolge (für Fortschritt/Statusverlauf). */
export const BOOKING_MAIN_PATH: BookingStatus[] = ['geplant', 'zur_freigabe', 'gebucht', 'eingeladen', 'bestaetigt', 'teilgenommen', 'eingereicht', 'freigegeben'];

/** Erlaubte Wechsel (alles andere lehnt die API ab). */
export const BOOKING_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  geplant: ['zur_freigabe', 'gebucht', 'abgesagt'],
  zur_freigabe: ['gebucht', 'geplant', 'abgesagt'],
  gebucht: ['eingeladen', 'abgesagt', 'verschoben'],
  eingeladen: ['bestaetigt', 'teilgenommen', 'abgesagt', 'nicht_erschienen', 'verschoben'],
  bestaetigt: ['teilgenommen', 'abgesagt', 'nicht_erschienen', 'verschoben'],
  verschoben: ['eingeladen', 'bestaetigt', 'teilgenommen', 'abgesagt', 'nicht_erschienen'],
  teilgenommen: ['eingereicht', 'nicht_erschienen'],
  eingereicht: ['freigegeben', 'teilgenommen'],
  freigegeben: [],
  abgesagt: [],
  nicht_erschienen: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[from].includes(to);
}

export type BookingReminderStage = 'vorher' | 'vortag' | 'upload' | 'eskalation';

export interface BookingReminderPolicy {
  /** Erinnerung so viele Tage vor dem ersten Tag (Anreise, Unterlagen) */
  daysBefore: number;
  /** nach dem letzten Tag so viele Tage warten, dann Eskalation an die Verwaltung, wenn nichts hochgeladen ist */
  escalateAfterDays: number;
}

const DAY = 86_400_000;

/**
 * Fällige Erinnerungsstufe je Teilnehmer (jede Stufe genau einmal, `sent` = bereits verschickte Stufen):
 * „vorher“ ab daysBefore Tage vor Beginn, „vortag“ ab 24 h vorher, „upload“ ab Ende des letzten Tags,
 * „eskalation“ ab escalateAfterDays nach dem Ende ohne Nachweis.
 */
export function dueBookingStages(
  p: { status: BookingStatus; firstStart: Date; lastEnd: Date; sent: readonly BookingReminderStage[] },
  policy: BookingReminderPolicy,
  now: Date,
): BookingReminderStage[] {
  const out: BookingReminderStage[] = [];
  const t = now.getTime();
  const upcoming = ['eingeladen', 'bestaetigt', 'verschoben'].includes(p.status);
  if (upcoming && t < p.firstStart.getTime()) {
    const vortag = t >= p.firstStart.getTime() - DAY;
    if (!vortag && policy.daysBefore > 1 && t >= p.firstStart.getTime() - policy.daysBefore * DAY && !p.sent.includes('vorher')) out.push('vorher');
    if (vortag && !p.sent.includes('vortag')) out.push('vortag');
  }
  const after = t >= p.lastEnd.getTime();
  const waiting = ['eingeladen', 'bestaetigt', 'verschoben', 'teilgenommen'].includes(p.status);
  if (after && waiting && !p.sent.includes('upload')) out.push('upload');
  if (after && waiting && t >= p.lastEnd.getTime() + policy.escalateAfterDays * DAY && !p.sent.includes('eskalation')) out.push('eskalation');
  return out;
}

export interface BookingCosts {
  feeCents: number;
  hotelCents: number;
  travelCents: number;
}

/** Summe: Gebühr und Hotel je Person, Reise je Buchung. */
export function bookingTotalCents(c: BookingCosts, participants: number): number {
  return (c.feeCents + c.hotelCents) * participants + c.travelCents;
}

export function formatEuro(cents: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

/** „1.290,00“ / „1290“ / „1290.5“ → Cent; leer → 0; ungültig → null. */
export function parseEuro(raw: string): number | null {
  const s = raw.trim().replace(/\s|€/g, '');
  if (!s) return 0;
  const norm = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = Number(norm);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}
