/**
 * Reine Logik für externe Nachweise (ohne React, getestet in __tests__/model.test.ts):
 * Status-Chips, Gültigkeitstexte, Zeitangaben der Warteschlange, Skalierung der OCR-Rahmen, Belegarten.
 */
import { addMonths } from '@sn/shared';
import type { StatusTone } from '@/components/ui/status';
import { isoDate } from '@/features/admin/format';
import { tx } from '@/i18n/external';
import type { CaseItem, ComplianceState, ExtStatus, OcrBox, OcrFields, PreviewPerson, Requirement, TargetOption } from './api';

export interface Chip {
  label: string;
  tone: StatusTone;
}

/** „2028-12-04“ → „12/28“ (Kurzform wie in Screen 9: „bis 12/28“, „läuft ab 12/26“). */
export function mmYY(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}/.test(iso)) return '—';
  return `${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
}

/** „2028-12-04“ → „04.12.2028“ (reines Datum ohne Zeitzonenumrechnung). */
export function deDate(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '—';
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

/** Erfüllungsstand → Chip (Matrix und „Was sich ändert“). */
export function stateChip(state: ComplianceState | 'neu' | null | undefined, validUntil?: string | null): Chip {
  switch (state) {
    case 'gueltig':
      return { label: validUntil ? tx.state.gueltigBis(mmYY(validUntil)) : tx.state.gueltig, tone: 'success' };
    case 'laeuft_ab':
      return { label: validUntil ? tx.state.laeuftAb(mmYY(validUntil)) : tx.state.laeuftAbPlain, tone: 'warn' };
    case 'abgelaufen':
      return { label: tx.state.abgelaufen, tone: 'danger' };
    case 'fehlt':
      return { label: tx.state.fehlt, tone: 'danger' };
    case 'befreit':
      return { label: tx.state.befreit, tone: 'neutral' };
    default:
      return { label: tx.state.neu, tone: 'neutral' };
  }
}

/** Zeile „Was sich ändert“: bisher → neu. */
export function effectRow(p: PreviewPerson): { from: Chip; to: Chip | null } {
  return {
    from: stateChip(p.current.state, p.current.validUntil),
    to: p.next.validUntil ? { label: tx.state.bis(mmYY(p.next.validUntil)), tone: 'success' } : null,
  };
}

/** Status eines externen Nachweises → Chip (Teilnehmersicht, eigene Einreichungen). */
export function statusChip(status: ExtStatus): Chip {
  const label = tx.status[status] ?? status;
  switch (status) {
    case 'freigegeben':
      return { label, tone: 'success' };
    case 'eingereicht':
      return { label, tone: 'info' };
    case 'zurueckgegeben':
      return { label, tone: 'warn' };
    case 'abgelaufen':
    case 'widerrufen':
      return { label, tone: 'danger' };
    default:
      return { label, tone: 'neutral' };
  }
}

/** Chip einer Karte in der Warteschlange: Prüfhinweis oder – nach Entscheidung – Ergebnis. */
export function queueChip(item: Pick<CaseItem, 'chip' | 'status'>, decided?: ExtStatus | null): Chip & { check?: boolean } {
  const s = decided ?? item.status;
  if (s === 'freigegeben') return { label: tx.queue.approvedChip, tone: 'success', check: true };
  if (s === 'zurueckgegeben') return { label: tx.queue.returnedChip, tone: 'warn' };
  return { label: item.chip.label, tone: item.chip.tone === 'ok' ? 'success' : 'warn' };
}

const TZ = 'Europe/Berlin';
function hhmm(d: Date): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
}

/** „heute, 21:04“ · „gestern“ (bzw. „gestern, 08:12“ mit `withTimeYesterday`) · „23.11.“ */
export function relativeDay(iso: string | null | undefined, now: Date = new Date(), withTimeYesterday = false): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const day = isoDate(d);
  if (day === isoDate(now)) return tx.time.today(hhmm(d));
  if (day === isoDate(new Date(now.getTime() - 86_400_000))) return withTimeYesterday ? tx.time.yesterdayAt(hhmm(d)) : tx.time.yesterday;
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.`;
}

/** Meta-Zeile einer Karte: „heute, 21:04 · selbst eingereicht · Foto“. */
export function caseMeta(item: Pick<CaseItem, 'submittedAt' | 'sourceLabel' | 'fileKind'>, now: Date = new Date()): string {
  return [relativeDay(item.submittedAt, now), item.sourceLabel, item.fileKind].filter(Boolean).join(' · ');
}

/** CSS-Prozentwerte für einen OCR-Rahmen (0…1) mit etwas Luft (`pad` relativ zur Seite), auf die Seite begrenzt. */
export function boxStyle(box: OcrBox, pad = 0.006): { left: string; top: string; width: string; height: string } {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const x0 = clamp(box.x - pad);
  const y0 = clamp(box.y - pad);
  const x1 = clamp(box.x + box.w + pad);
  const y1 = clamp(box.y + box.h + pad);
  const pct = (v: number) => `${Math.round(v * 10000) / 100}%`;
  return { left: pct(x0), top: pct(y0), width: pct(x1 - x0), height: pct(y1 - y0) };
}

/** Rahmen in Pixel (z. B. für Canvas), skaliert auf die angezeigte Größe. */
export function scaleBox(box: OcrBox, width: number, height: number): { x: number; y: number; w: number; h: number } {
  return { x: Math.round(box.x * width), y: Math.round(box.y * height), w: Math.round(box.w * width), h: Math.round(box.h * height) };
}

export interface FieldBox {
  key: keyof Omit<OcrFields, 'nameMatches'>;
  label: string;
  box: OcrBox;
  value: string;
}

const FIELD_ORDER: Array<FieldBox['key']> = ['name', 'date', 'course', 'duration', 'provider'];

/** Erkannte Felder mit Rahmen auf einer Seite (doppelte Rahmen derselben Zeile nur einmal). */
export function fieldBoxes(fields: OcrFields | null | undefined, page = 1, keys: Array<FieldBox['key']> = FIELD_ORDER): FieldBox[] {
  if (!fields) return [];
  const out: FieldBox[] = [];
  const seen = new Set<string>();
  for (const k of keys) {
    const f = fields[k];
    if (!f?.box || f.box.page !== page) continue;
    const sig = `${f.box.x}|${f.box.y}|${f.box.w}|${f.box.h}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ key: k, label: tx.receipt.boxLabels[k] ?? k, box: f.box, value: f.value });
  }
  return out;
}

/** Bildseitenverhältnis aus den OCR-Seitenmaßen (Fallback A4 hoch). */
export function pageRatio(pages: Array<{ width: number; height: number }> | undefined, page = 1): number {
  const p = pages?.[page - 1];
  return p && p.width > 1 && p.height > 1 ? p.height / p.width : 842 / 595;
}

/** Dateiart für das Icon in der Belegliste. */
export function fileExt(name: string, mime?: string): 'PDF' | 'JPG' | 'PNG' | 'DATEI' {
  const m = (mime ?? '').toLowerCase();
  const n = name.toLowerCase();
  if (m === 'application/pdf' || n.endsWith('.pdf')) return 'PDF';
  if (m === 'image/png' || n.endsWith('.png')) return 'PNG';
  if (m.startsWith('image/') || /\.(jpe?g|heic|webp)$/.test(n)) return 'JPG';
  return 'DATEI';
}

/** Restzeit „9:41“ (mm:ss), nie negativ. */
export function formatMmSs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Ein Datum (ISO yyyy-mm-dd) liegt nach heute (Berliner Zeit)? */
export function isFutureDate(iso: string | null | undefined, now: Date = new Date()): boolean {
  return !!iso && iso > isoDate(now);
}

/** Intervall „alle 2 Jahre“ / „jährlich“ / „alle 6 Monate“. */
export function intervalLabel(months: number): string {
  return tx.matrix.every(months);
}

/** Option „Erste-Hilfe-Fortbildung · Qualifikation Ersthelfer · alle 2 Jahre“. */
export function requirementLabel(r: Pick<Requirement, 'training_title' | 'qualification_name' | 'interval_months'>): string {
  return tx.capture.optionLabel(r.training_title, r.qualification_name, intervalLabel(r.interval_months));
}

/** Vorschlag „gültig bis“ wie im Backend (gemeinsame Regel aus @sn/shared) – nur für sofortiges Feedback. */
export const addMonthsIso = addMonths;

/** Text in der Teilnehmersicht: „Wird angerechnet auf Ersthelfer – gültig bis 04.12.2028“. */
export function creditFor(
  option: Pick<TargetOption, 'qualificationName' | 'intervalMonths'> | null | undefined,
  heldOn: string | null | undefined,
): { label: string; validUntil: string | null } | null {
  if (!option) return null;
  return { label: option.qualificationName, validUntil: heldOn ? addMonthsIso(heldOn, option.intervalMonths) : null };
}

/** Upload-Fortschritt in Prozent. */
export const pct = (ratio: number) => Math.round(Math.min(1, Math.max(0, ratio)) * 100);

/** Statuswerte je Reiter der Warteschlange. */
export const TAB_STATUSES: Record<string, ExtStatus[]> = {
  open: ['eingereicht'],
  approved: ['freigegeben'],
  returned: ['zurueckgegeben'],
  drafts: ['entwurf'],
};
