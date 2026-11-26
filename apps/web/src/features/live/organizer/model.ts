/** Ableitungen für die Organisator-Ansicht (getestet in __tests__/organizerModel.test.ts). */
import type { StatusTone } from '@/components/ui';
import { tl } from '@/i18n/live';
import type { AttendanceKpis, AttendanceRow, AttendanceStatus, OrganizerQuestion, PollResult, PoolQuestion } from '../api';

export function statusTone(s: AttendanceStatus): StatusTone {
  switch (s) {
    case 'anwesend':
    case 'vermerk_akzeptiert':
    case 'bestaetigt':
      return 'success';
    case 'bestaetigung_offen':
      return 'info';
    case 'vermerk_pruefen':
    case 'rueckfrage':
    case 'pruefen':
      return 'warn';
    default:
      return 'neutral';
  }
}

export interface KpiChip {
  key: string;
  label: string;
  tone: StatusTone;
}

/** Zähler-Chips über der Liste: laufend (12a) bzw. nach dem Ende (12d). */
export function kpiChips(k: AttendanceKpis, ended: boolean): KpiChip[] {
  const c = tl.org.kpi;
  if (ended) {
    return [
      { key: 'participated', label: c.participated(k.participated), tone: 'success' },
      { key: 'open', label: c.confirmationsOpen(k.confirmationsOpen), tone: 'info' },
      ...(k.manual ? [{ key: 'notes', label: c.notes(k.manual), tone: 'warn' as const }] : []),
      ...(k.confirmed ? [{ key: 'confirmed', label: c.confirmed(k.confirmed), tone: 'success' as const }] : []),
      { key: 'missing', label: c.missing(k.missing), tone: 'neutral' },
    ];
  }
  return [
    { key: 'present', label: c.present(k.present), tone: 'success' },
    { key: 'outQr', label: c.outQr(k.checkedOutQr), tone: 'info' },
    { key: 'manual', label: c.manual(k.manual), tone: 'warn' },
    ...(k.confirmed ? [{ key: 'confirmed', label: c.confirmed(k.confirmed), tone: 'success' as const }] : []),
    { key: 'missing', label: c.missing(k.missing), tone: 'neutral' },
  ];
}

/** Kurzlabel der Methode im Tabellenstil des Mockups („QR“, „Ende-QR“, „Tablet“, „manuell“, „offizielles Ende“). */
export const methodShort = (m: string | null | undefined) => (m ? (tl.org.method[m] ?? m) : '');

/** Freigabe-Aktion bei „teilweise“ anbieten? (nach dem Auschecken, Vermerk nicht mehr offen, noch keine Entscheidung) */
export function needsRelease(r: AttendanceRow): boolean {
  return !!r.attendanceId && r.intervals.length > 0 && !r.checkedIn && r.belowThreshold && r.release === null && r.noteReview !== 'offen' && r.noteReview !== 'rueckfrage';
}

/** Offene Fragen zuerst, dann nach Stimmen (Server sortiert bereits so – hier stabil für lokale Updates). */
export function sortQuestions<Q extends Pick<OrganizerQuestion, 'status' | 'votes' | 'createdAt'>>(list: Q[]): Q[] {
  return [...list].sort(
    (a, b) => Number(a.status !== 'offen') - Number(b.status !== 'offen') || b.votes - a.votes || a.createdAt.localeCompare(b.createdAt),
  );
}

export const openQuestionCount = (list: Pick<OrganizerQuestion, 'status'>[]) => list.filter((q) => q.status === 'offen').length;

/** Pool-Eintrag mit Zustand: läuft / ausgewertet (mit Ergebnis) / bereit. */
export function poolState(p: PoolQuestion, polls: PollResult[]): { state: 'running' | 'done' | 'ready'; last: PollResult | null } {
  const mine = polls.filter((x) => x.sourceQuestionId === p.id);
  const last = mine[mine.length - 1] ?? null;
  if (last?.open) return { state: 'running', last };
  return { state: last ? 'done' : 'ready', last };
}

/** Balkenbreite in % relativ zur Gesamtzahl der Antworten. */
export const barPct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
