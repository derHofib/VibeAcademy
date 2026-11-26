/**
 * Uhr- und Dauerformate für Präsenz/Live (Zeitzone Europe/Berlin, getestet in __tests__/time.test.ts).
 * Laufende Werte rechnen mit der Serverzeit (Versatz aus `serverTime`), nie mit der Geräteuhr allein.
 */
import { attendanceDurationMs } from '@sn/shared';
import type { AttendanceInterval, RunView } from './api';

const TZ = 'Europe/Berlin';
const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('de-DE', { timeZone: TZ, ...opts });
const hmFmt = fmt({ hour: '2-digit', minute: '2-digit' });
const dateFmt = fmt({ day: '2-digit', month: '2-digit', year: 'numeric' });
const dayFmt = fmt({ year: 'numeric', month: '2-digit', day: '2-digit' });
const weekdayFmt = fmt({ weekday: 'short' });

const toDate = (v: string | number | Date) => (v instanceof Date ? v : new Date(v));

/** „08:02“ */
export function hm(v: string | number | Date | null | undefined): string {
  if (v === null || v === undefined) return '–';
  const d = toDate(v);
  return Number.isNaN(d.getTime()) ? '–' : hmFmt.format(d);
}

/** „04.12.2026“ */
export function dateDe(v: string | number | Date): string {
  return dateFmt.format(toDate(v));
}

/** „Do“ */
export function weekdayDe(v: string | number | Date): string {
  return weekdayFmt.format(toDate(v)).replace('.', '');
}

/** Gleicher Kalendertag in Berlin? */
export function sameDay(a: string | number | Date, b: string | number | Date): boolean {
  return dayFmt.format(toDate(a)) === dayFmt.format(toDate(b));
}

/** Laufende Uhr „4:51:00“ (Stunden ohne führende Null). */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Tabelle Organisator: „7 h 30“, „0 h 05“. */
export function durShort(totalSeconds: number): string {
  const m = Math.max(0, Math.floor(totalSeconds / 60));
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

/** Zusammenfassung Teilnehmer: „7 h 28 min“, volle Stunden „2 h“, unter einer Stunde „5 min“, unter einer Minute „< 1 min“. */
export function durLong(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return s === 0 ? '0 min' : '< 1 min';
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (!h) return `${m} min`;
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

/** Versatz Server − Gerät in ms (positiv: Server geht vor). */
export function serverOffsetMs(serverTimeIso: string | null | undefined, receivedAtMs: number): number {
  if (!serverTimeIso) return 0;
  const t = Date.parse(serverTimeIso);
  return Number.isNaN(t) ? 0 : t - receivedAtMs;
}

/** Laufende Anwesenheitsdauer in Sekunden (wie im Backend: Intervalle, gekappt auf Beginn/offizielles bzw. geplantes Ende). */
export function liveDurationSeconds(
  intervals: AttendanceInterval[],
  run: Pick<RunView, 'startAt' | 'endAt' | 'endedAt'>,
  nowMs: number,
): number {
  const ms = attendanceDurationMs(
    intervals.map((iv) => ({ inAt: Date.parse(iv.in), outAt: iv.out ? Date.parse(iv.out) : null })),
    { startAt: Date.parse(run.startAt), endAt: Date.parse(run.endAt), endedAt: run.endedAt ? Date.parse(run.endedAt) : null },
    nowMs,
  );
  return Math.floor(ms / 1000);
}

/** Anteil an der geplanten Dauer in % (0–100, ganzzahlig abgerundet wie im Mockup). */
export function pctOf(seconds: number, plannedSeconds: number): number {
  if (plannedSeconds <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((seconds / plannedSeconds) * 100)));
}

/** ISO-Zeitpunkt aus Datum (JJJJ-MM-TT) und Uhrzeit (HH:MM) in der Zeitzone des Geräts. */
export function localDateTimeIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const d = new Date(`${date}T${time}:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
