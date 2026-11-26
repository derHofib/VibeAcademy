/**
 * Reine Formatierungs- und Ableitungsfunktionen der Verwaltung (getestet in __tests__/format.test.ts).
 * Zeitzone: Europe/Berlin, Locale de-DE.
 */
import type { StatusTone } from '@/components/ui/status';
import type { DashboardRun, InvitationStatus } from './api';
import { adm } from '@/i18n/admin';

const TZ = 'Europe/Berlin';
const nf = new Intl.NumberFormat('de-DE');

export const formatNumber = (n: number) => nf.format(n);

/** 382 → „6 min 22 s“, 45 → „45 s“, 3600 → „60 min“. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}

/** Millisekunden als „m:ss“ (Seitenprotokoll): 34_000 → „0:34“, 708_000 → „11:48“. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function parts(value: string | Date, opts: Intl.DateTimeFormatOptions) {
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('de-DE', { timeZone: TZ, ...opts }).formatToParts(d);
}

function pick(p: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return p.find((x) => x.type === type)?.value ?? '';
}

/** „25.11.2026“ */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const p = parts(value, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return p ? `${pick(p, 'day')}.${pick(p, 'month')}.${pick(p, 'year')}` : '—';
}

/** „03.11. 12:47“ */
export function formatShortDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const p = parts(value, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return p ? `${pick(p, 'day')}.${pick(p, 'month')}. ${pick(p, 'hour')}:${pick(p, 'minute')}` : '—';
}

/** „25.11.2026 10:12“ */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const p = parts(value, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return p
    ? `${pick(p, 'day')}.${pick(p, 'month')}.${pick(p, 'year')} ${pick(p, 'hour')}:${pick(p, 'minute')}`
    : '—';
}

/** ISO-Datum (yyyy-mm-dd) in Berliner Zeit, z. B. für <input type="date">. */
export function isoDate(value: Date): string {
  const p = parts(value, { day: '2-digit', month: '2-digit', year: 'numeric' })!;
  return `${pick(p, 'year')}-${pick(p, 'month')}-${pick(p, 'day')}`;
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

/** 4_404_019 → „4,2 MB“, 912 → „912 B“ */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(v)} ${units[i]}`;
}

/** „9f3c4b…a71e“ → „9f3c…a71e“ */
export function shortHash(hash: string | null | undefined): string {
  if (!hash) return '—';
  return hash.length <= 10 ? hash : `${hash.slice(0, 4)}…${hash.slice(-4)}`;
}

/** Ganze Kalendertage bis zum Datum (negativ = vorbei). */
export function daysUntil(value: string | Date, now: Date = new Date()): number {
  const d = typeof value === 'string' ? new Date(value) : value;
  const a = Date.parse(isoDate(d));
  const b = Date.parse(isoDate(now));
  return Math.round((a - b) / 86_400_000);
}

export interface Chip {
  label: string;
  tone: StatusTone;
}

/** Status-Chip je laufender Durchführung (Dashboard, Screen 1). */
export function runStatusChip(
  run: Pick<DashboardRun, 'eingeladen' | 'erledigt' | 'ueberfaellig' | 'deadline'>,
  now = new Date(),
): Chip {
  const t = adm.status.run;
  if (run.ueberfaellig > 0) return { label: t.overdue(run.ueberfaellig), tone: 'danger' };
  if (run.eingeladen > 0 && run.erledigt >= run.eingeladen) return { label: t.done, tone: 'success' };
  if (run.eingeladen === 0) return { label: t.noInvites, tone: 'neutral' };
  if (run.deadline) {
    const d = daysUntil(run.deadline, now);
    if (d <= 7) return { label: d <= 0 ? t.dueToday : t.dueIn(d), tone: 'warn' };
  }
  return { label: t.running, tone: 'info' };
}

/** Fortschrittsfarbe passend zum Chip. */
export function runProgressTone(chip: Chip): 'accent' | 'success' | 'warn' | 'danger' {
  return chip.tone === 'danger'
    ? 'danger'
    : chip.tone === 'success'
      ? 'success'
      : chip.tone === 'warn'
        ? 'warn'
        : 'accent';
}

/** Einladungsstatus → Chip (überfällig hat Vorrang, solange nicht erledigt). */
export function invitationChip(status: InvitationStatus, overdue = false): Chip {
  const t = adm.status.invitation;
  if (overdue && status !== 'bestaetigt' && status !== 'befreit')
    return { label: t.ueberfaellig, tone: 'danger' };
  switch (status) {
    case 'offen':
      return { label: t.offen, tone: 'neutral' };
    case 'geoeffnet':
      return { label: t.geoeffnet, tone: 'info' };
    case 'gelesen':
      return { label: t.gelesen, tone: 'info' };
    case 'bestanden':
      return { label: t.bestanden, tone: 'warn' };
    case 'bestaetigt':
      return { label: t.bestaetigt, tone: 'success' };
    case 'ueberfaellig':
      return { label: t.ueberfaellig, tone: 'danger' };
    case 'befreit':
      return { label: t.befreit, tone: 'neutral' };
    default:
      return { label: String(status), tone: 'neutral' };
  }
}

/** Gerät grob aus dem User-Agent („Handy“/„Tablet“/„PC“) – nur für die Anzeige. */
export function deviceLabel(ua: string | null | undefined): string {
  if (!ua) return adm.report.deviceUnknown;
  if (/iPad|Tablet/i.test(ua)) return adm.report.deviceTablet;
  if (/Mobile|Android|iPhone/i.test(ua)) return adm.report.devicePhone;
  return adm.report.devicePc;
}

/** „3 (Handy, PC)“ */
export function sessionsSummary(sessions: Array<{ user_agent: string | null }>): string {
  if (!sessions.length) return '0';
  const devices = [...new Set(sessions.map((s) => deviceLabel(s.user_agent)))];
  return `${sessions.length} (${devices.join(', ')})`;
}

/** Komma-Dezimalzahl aus einem Eingabefeld („0,6“ → 0.6); ungültig → NaN. */
export function parseDecimal(input: string): number {
  const t = input.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return Number.NaN;
  return Number(t);
}

/** Zahl für Eingabefelder mit Komma: 0.6 → „0,6“ */
export function formatDecimal(n: number): string {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2, useGrouping: false }).format(n);
}
