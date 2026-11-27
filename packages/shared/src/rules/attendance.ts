/**
 * Anwesenheit als Intervalle (E-17) – reine Rechenlogik, maßgeblich ist die Berechnung im Backend.
 *
 * Dauer = Summe der Intervalle, gekappt auf [geplanter Beginn, offizielles Ende]; ohne offizielles Ende auf
 * [geplanter Beginn, geplantes Ende] und – für die laufende Anzeige – höchstens bis „jetzt“.
 * Vollständigkeit = Dauer / geplante Dauer; Schwelle je Schulung (Standard 90 %), sonst „teilweise“.
 */

export const CHECK_IN_METHODS = ['qr_start', 'kiosk', 'trainer', 'import'] as const;
export const CHECK_OUT_METHODS = ['qr_end', 'manual', 'official_end', 'kiosk', 'trainer', 'import'] as const;
export type CheckInMethod = (typeof CHECK_IN_METHODS)[number];
export type CheckOutMethod = (typeof CHECK_OUT_METHODS)[number];

export const METHOD_LABEL: Record<CheckInMethod | CheckOutMethod, string> = {
  qr_start: 'Start-QR',
  qr_end: 'Ende-QR',
  kiosk: 'Tablet',
  trainer: 'durch Trainer',
  manual: 'manuell',
  official_end: 'offizielles Ende',
  import: 'aus Teilnehmerliste',
};

export const MANUAL_CHECKOUT_REASONS = ['vorzeitig', 'ende_qr_fehlt', 'technik', 'sonstiges'] as const;
export type ManualCheckoutReason = (typeof MANUAL_CHECKOUT_REASONS)[number];
export const MANUAL_REASON_LABEL: Record<ManualCheckoutReason, string> = {
  vorzeitig: 'Vorzeitig gegangen',
  ende_qr_fehlt: 'Ende-QR nicht verfügbar',
  technik: 'Technisches Problem',
  sonstiges: 'Sonstiges',
};
export const MANUAL_NOTE_MIN = 10;
export const MANUAL_NOTE_MAX = 1000;

/** Teilnahme bestätigen binnen 48 h, sonst Erinnerung (E-24). */
export const CONFIRM_REMINDER_MS = 48 * 3600_000;
export const DEFAULT_COMPLETENESS_PCT = 90;

export interface AttendanceIntervalInput {
  inAt: number;
  outAt: number | null;
}

export interface AttendanceWindow {
  /** geplanter Beginn */
  startAt: number;
  /** geplantes Ende */
  endAt: number;
  /** offizielles Ende (falls beendet) */
  endedAt: number | null;
}

export const plannedMs = (w: Pick<AttendanceWindow, 'startAt' | 'endAt'>) => Math.max(0, w.endAt - w.startAt);

/** Obergrenze, bis zu der Anwesenheit zählt. */
export const countUntil = (w: AttendanceWindow) => (w.endedAt !== null ? w.endedAt : w.endAt);

/**
 * Summe der Intervalle in ms, gekappt auf [startAt, offizielles/geplantes Ende]. Offene Intervalle zählen bis `nowMs`
 * (laufende Uhr). Überlappungen werden nur einmal gezählt.
 */
export function attendanceDurationMs(intervals: AttendanceIntervalInput[], w: AttendanceWindow, nowMs: number): number {
  const lo = w.startAt;
  const hi = countUntil(w);
  const parts = intervals
    .map((iv) => [Math.max(iv.inAt, lo), Math.min(iv.outAt ?? nowMs, hi)] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let curA = -Infinity;
  let curB = -Infinity;
  for (const [a, b] of parts) {
    if (a > curB) {
      if (curB > curA) total += curB - curA;
      curA = a;
      curB = b;
    } else if (b > curB) curB = b;
  }
  if (curB > curA) total += curB - curA;
  return total;
}

export type CompletenessState = 'vollstaendig' | 'teilweise';

export interface AttendanceSummary {
  durationMs: number;
  plannedMs: number;
  /** 0..1 (gekappt auf 1) */
  completeness: number;
  /** ganze Prozent, abgerundet */
  pct: number;
  state: CompletenessState;
}

export function summarizeAttendance(
  intervals: AttendanceIntervalInput[],
  w: AttendanceWindow,
  nowMs: number,
  thresholdPct = DEFAULT_COMPLETENESS_PCT,
): AttendanceSummary {
  const durationMs = attendanceDurationMs(intervals, w, nowMs);
  const planned = plannedMs(w);
  const completeness = planned > 0 ? Math.min(1, durationMs / planned) : 0;
  // Ganzzahlig vergleichen, damit 89,99 % nicht als 90 % durchgehen (Rundung nur für die Anzeige).
  const state: CompletenessState = planned > 0 && durationMs * 100 >= planned * thresholdPct ? 'vollstaendig' : 'teilweise';
  return { durationMs, plannedMs: planned, completeness, pct: Math.floor(completeness * 100), state };
}

export type ManualCheckoutError = 'grund_fehlt' | 'vermerk_zu_kurz' | 'vermerk_zu_lang';

export function validateManualCheckout(reason: unknown, note: unknown): ManualCheckoutError | null {
  if (typeof reason !== 'string' || !(MANUAL_CHECKOUT_REASONS as readonly string[]).includes(reason)) return 'grund_fehlt';
  const n = typeof note === 'string' ? note.trim() : '';
  if (n.length < MANUAL_NOTE_MIN) return 'vermerk_zu_kurz';
  if (n.length > MANUAL_NOTE_MAX) return 'vermerk_zu_lang';
  return null;
}

/** „7 h 30 min“ */
export function formatDuration(ms: number): string {
  const m = Math.floor(ms / 60_000);
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
