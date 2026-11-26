/**
 * Reine Logik der Pflichtmatrix (getestet in __tests__/model.test.ts): Raster Person × Pflichtschulung,
 * Filter, Zellen-Chips, Rangfolge der Zustände.
 */
import type { ComplianceState } from '@/features/external/api';
import { mmYY, type Chip } from '@/features/external/model';
import { tx } from '@/i18n/external';
import type { ComplianceRequirement, ComplianceRow } from './api';

export const STATES: ComplianceState[] = ['gueltig', 'laeuft_ab', 'abgelaufen', 'fehlt', 'befreit'];

/** Je kleiner, desto dringender. */
export const STATE_RANK: Record<ComplianceState, number> = { abgelaufen: 0, fehlt: 1, laeuft_ab: 2, gueltig: 3, befreit: 4 };

export const STATE_LABEL: Record<ComplianceState, string> = {
  gueltig: tx.state.gueltig,
  laeuft_ab: tx.state.laeuftAbPlain,
  abgelaufen: tx.state.abgelaufen,
  fehlt: tx.state.fehlt,
  befreit: tx.state.befreit,
};

/** Kompakter Chip je Zelle: „bis 12/28“, „läuft ab 12/26“, „abgelaufen“, „fehlt“, „befreit“. */
export function cellChip(row: Pick<ComplianceRow, 'state' | 'validUntil'>): Chip {
  switch (row.state) {
    case 'gueltig':
      return { label: row.validUntil ? tx.state.bis(mmYY(row.validUntil)) : tx.state.gueltig, tone: 'success' };
    case 'laeuft_ab':
      return { label: row.validUntil ? tx.state.laeuftAb(mmYY(row.validUntil)) : tx.state.laeuftAbPlain, tone: 'warn' };
    case 'abgelaufen':
      return { label: tx.state.abgelaufen, tone: 'danger' };
    case 'fehlt':
      return { label: tx.state.fehlt, tone: 'danger' };
    default:
      return { label: tx.state.befreit, tone: 'neutral' };
  }
}

export interface MatrixFilter {
  search: string;
  state: ComplianceState | '';
  qualificationId: string;
}

export interface MatrixPerson {
  personId: string;
  name: string;
  personalnr: string | null;
  orgUnitName: string | null;
  cells: Record<string, ComplianceRow>;
  worst: ComplianceState;
}

export interface MatrixGrid {
  columns: ComplianceRequirement[];
  persons: MatrixPerson[];
  /** Personen vor Anwendung der Filter */
  total: number;
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

/** Baut das Raster und wendet Suche, Status- und Qualifikationsfilter an. */
export function buildGrid(rows: ComplianceRow[], requirements: ComplianceRequirement[], f: MatrixFilter): MatrixGrid {
  const qualRows = f.qualificationId ? rows.filter((r) => r.qualificationId === f.qualificationId) : rows;
  const usedReqs = new Set(qualRows.map((r) => r.requirementId));
  const columns = requirements.filter((r) => usedReqs.has(r.id));
  const byPerson = new Map<string, MatrixPerson>();
  for (const r of qualRows) {
    let p = byPerson.get(r.personId);
    if (!p) {
      p = { personId: r.personId, name: r.personName, personalnr: r.personalnr ?? null, orgUnitName: r.orgUnitName, cells: {}, worst: 'befreit' };
      byPerson.set(r.personId, p);
    }
    p.cells[r.requirementId] = r;
    if (STATE_RANK[r.state] < STATE_RANK[p.worst]) p.worst = r.state;
  }
  const total = new Set(rows.map((r) => r.personId)).size;
  const q = norm(f.search.trim());
  const persons = [...byPerson.values()]
    .filter((p) => !q || norm(p.name).includes(q) || (p.personalnr ?? '').toLowerCase().includes(q))
    .filter((p) => !f.state || Object.values(p.cells).some((c) => c.state === f.state))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return { columns, persons, total };
}

/** Ein ISO-Datum „yyyy-mm-dd“ als „dd.mm.yyyy“. */
export { deDate } from '@/features/external/model';

/** Standard-Zeitraum der Nachweismappe: 1. Januar des laufenden Jahres bis heute. */
export function defaultExportRange(todayIso: string): { from: string; to: string } {
  return { from: `${todayIso.slice(0, 4)}-01-01`, to: todayIso };
}
