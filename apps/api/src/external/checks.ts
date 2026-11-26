import { extractFields, type OcrFields, type OcrLine } from './ocr';

/** Prüfhinweise der Prüfansicht (Screen 11, SPEZIFIKATION 4.7): Abweichungen markieren, nie automatisch entscheiden. */
export type HintCode =
  | 'name_abweichung'
  | 'datum_fehlt'
  | 'datum_zukunft'
  | 'datum_abweichung'
  | 'anbieter_fehlt'
  | 'kurs_fehlt'
  | 'beleg_fehlt'
  | 'unterschrift_unleserlich';

export interface Hint {
  code: HintCode;
  label: string;
  personId?: string;
  note?: string | null;
}
export interface CheckItem {
  key: 'person' | 'personen' | 'datum' | 'umfang' | 'anbieter' | 'kurs' | 'unterschriften' | 'gueltigkeit';
  state: 'ok' | 'warn' | 'info';
  label: string;
  value: string;
  note: string;
}
export interface Flag {
  code: 'unterschrift_unleserlich' | 'sonstiges';
  note?: string | null;
}

export interface CheckRecord {
  id: string;
  personId: string;
  personName: string;
  personalnr: string | null;
  heldOn: string | null;
  provider: string | null;
  title: string | null;
  durationLabel: string | null;
  isMedical: boolean;
  hasReceipt: boolean;
  flags: Flag[];
}
export interface CheckContext {
  today: string;
  ocrLines: OcrLine[] | null;
  ocrStatus: 'keine' | 'ausstehend' | 'fertig' | 'fehler';
  validity: { validUntil: string | null; intervalMonths: number | null; label: string | null };
  qualificationName: string | null;
}

const de = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '–');
const years = (m: number) => (m % 12 === 0 ? `${m / 12} ${m === 12 ? 'Jahr' : 'Jahre'}` : `${m} Monate`);

/** Hinweise je Datensatz (eine Person). */
export function recordHints(r: CheckRecord, ctx: CheckContext): { hints: Hint[]; ocr: (OcrFields & { nameMatches: boolean | null }) | null } {
  const hints: Hint[] = [];
  const ocr = ctx.ocrLines?.length ? extractFields(ctx.ocrLines, r.personName) : null;
  if (!r.hasReceipt) hints.push({ code: 'beleg_fehlt', label: 'Kein Beleg', personId: r.personId });
  if (!r.title) hints.push({ code: 'kurs_fehlt', label: 'Kurs fehlt', personId: r.personId });
  if (!r.heldOn) hints.push({ code: 'datum_fehlt', label: 'Datum fehlt', personId: r.personId });
  else if (r.heldOn > ctx.today) hints.push({ code: 'datum_zukunft', label: 'Datum in der Zukunft', personId: r.personId });
  else if (ocr?.date?.normalized && ocr.date.normalized !== r.heldOn && !r.isMedical) {
    hints.push({ code: 'datum_abweichung', label: 'Datum weicht vom Beleg ab', personId: r.personId, note: `Beleg: ${ocr.date.value}` });
  }
  if (!r.provider && !r.isMedical) hints.push({ code: 'anbieter_fehlt', label: 'Anbieter fehlt', personId: r.personId });
  if (ocr && ocr.nameMatches === false) hints.push({ code: 'name_abweichung', label: 'Name ≠ Person', personId: r.personId });
  for (const f of r.flags) {
    if (f.code === 'unterschrift_unleserlich') hints.push({ code: 'unterschrift_unleserlich', label: 'Unterschrift prüfen', personId: r.personId, note: f.note ?? null });
  }
  return { hints, ocr };
}

/** Chip in der Warteschlange: „alles passt“, „Datum fehlt“, „2 Unterschriften prüfen“ … */
export function summaryChip(hints: Hint[]): { label: string; tone: 'ok' | 'warn' } {
  if (!hints.length) return { label: 'alles passt', tone: 'ok' };
  const sig = hints.filter((h) => h.code === 'unterschrift_unleserlich').length;
  const other = hints.filter((h) => h.code !== 'unterschrift_unleserlich');
  const distinct = [...new Set(other.map((h) => h.label))];
  if (sig && !distinct.length) return { label: sig === 1 ? '1 Unterschrift prüfen' : `${sig} Unterschriften prüfen`, tone: 'warn' };
  if (!sig && distinct.length === 1) return { label: distinct[0]!, tone: 'warn' };
  return { label: `${distinct.length + (sig ? 1 : 0)} Hinweise`, tone: 'warn' };
}

/** „Angaben prüfen“ (Screen 11a/11b) für einen Vorgang (eine Person oder Gruppe mit gemeinsamem Beleg). */
export function reviewChecks(records: CheckRecord[], ctx: CheckContext): { checks: CheckItem[]; hints: Hint[]; chip: { label: string; tone: 'ok' | 'warn' } } {
  const per = records.map((r) => ({ r, ...recordHints(r, ctx) }));
  const hints = per.flatMap((p) => p.hints);
  const first = per[0]!;
  const checks: CheckItem[] = [];
  const ocrReady = ctx.ocrStatus === 'fertig' && !!ctx.ocrLines?.length;
  if (records.length === 1) {
    const r = first.r;
    const nm = first.ocr?.nameMatches;
    checks.push({
      key: 'person', state: nm === false ? 'warn' : nm ? 'ok' : 'info', label: 'Person',
      value: `${r.personName}${r.personalnr ? ` · Pers.-Nr. ${r.personalnr}` : ''}`,
      note: nm === false ? 'Name auf dem Beleg nicht gefunden – bitte prüfen' : nm ? 'Name stimmt mit Beleg überein' : ocrReady ? '' : 'Beleg nicht automatisch gelesen',
    });
  } else {
    const missing = per.filter((p) => p.ocr?.nameMatches === false).map((p) => p.r.personName);
    checks.push({
      key: 'personen', state: missing.length ? 'warn' : 'ok', label: 'Personen',
      value: `${records.length} erfasst`,
      note: missing.length ? `Nicht auf dem Beleg gefunden: ${missing.join(', ')}` : ocrReady ? 'alle Namen auf dem Beleg gefunden' : '',
    });
  }
  const dateHint = first.hints.find((h) => h.code.startsWith('datum_'));
  checks.push({
    key: 'datum', state: dateHint ? 'warn' : 'ok', label: 'Datum',
    value: first.r.heldOn ? de(first.r.heldOn) : 'nicht erkannt',
    note: dateHint?.code === 'datum_fehlt' ? 'Datum fehlt – bitte ergänzen oder nachfragen'
      : dateHint?.code === 'datum_zukunft' ? 'Datum liegt in der Zukunft'
      : dateHint ? `${dateHint.label}${dateHint.note ? ` (${dateHint.note})` : ''}`
      : first.ocr?.date ? 'auf dem Beleg erkannt' : '',
  });
  if (!first.r.isMedical) {
    checks.push({ key: 'kurs', state: first.r.title ? 'ok' : 'warn', label: 'Kurs', value: first.r.title ?? 'fehlt', note: '' });
    if (first.r.durationLabel) {
      checks.push({ key: 'umfang', state: 'ok', label: 'Umfang', value: first.r.durationLabel, note: ctx.qualificationName ? `angerechnet auf ${ctx.qualificationName}` : '' });
    }
    checks.push({ key: 'anbieter', state: first.r.provider ? 'ok' : 'warn', label: 'Anbieter', value: first.r.provider ?? 'fehlt', note: '' });
  }
  const sig = hints.filter((h) => h.code === 'unterschrift_unleserlich');
  if (sig.length) {
    checks.push({
      key: 'unterschriften', state: 'warn', label: 'Unterschriften', value: `${sig.length} unleserlich`,
      note: (sig.map((h) => h.note || records.find((r) => r.personId === h.personId)?.personName).filter(Boolean) as string[])
        .sort((a, b) => a.localeCompare(b, 'de', { numeric: true }))
        .join(', ') + ' prüfen',
    });
  }
  const v = ctx.validity;
  checks.push({
    key: 'gueltigkeit', state: 'info', label: 'Gültigkeit',
    value: v.validUntil ? `bis ${de(v.validUntil)}` : v.intervalMonths ? 'erst mit Datum berechenbar' : 'ohne Ablauf',
    note: v.intervalMonths ? `Vorschlag aus Intervall ${years(v.intervalMonths)}` : v.label ?? 'nur Dokumentation, keine Anrechnung',
  });
  return { checks, hints, chip: summaryChip(hints) };
}
