/** CSV-Import von Personen: Ergebnisdarstellung und Vorlage (reine Funktionen). */
import { adm } from '@/i18n/admin';

export interface ImportResult {
  created: number;
  updated: number;
  errors: Array<{ zeile: number; fehler: string }>;
}

export const CSV_TEMPLATE =
  'name;personalnr;email;mobil;org_einheit\nAnna Schulz;1040;anna.schulz@firma.de;;Service Nord\n';

export interface ImportSummary {
  tone: 'success' | 'warn' | 'danger';
  headline: string;
  lines: string[];
}

/** Fasst das Import-Ergebnis zusammen: Kopfzeile + eine Zeile je Fehler (nach Zeilennummer sortiert). */
export function summarizeImport(r: ImportResult): ImportSummary {
  const t = adm.persons.import;
  const ok = r.created + r.updated;
  const lines = [...r.errors].sort((a, b) => a.zeile - b.zeile).map((e) => t.errorLine(e.zeile, e.fehler));
  const headline = t.headline(r.created, r.updated, r.errors.length);
  const tone = r.errors.length === 0 ? 'success' : ok > 0 ? 'warn' : 'danger';
  return { tone, headline, lines };
}

/** Grobe Vorprüfung im Browser, bevor die Datei gesendet wird. */
export function precheckCsv(text: string): string | null {
  const t = adm.persons.import;
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (lines.length === 0) return t.empty;
  const head = lines[0]!
    .toLowerCase()
    .split(/[;,]/)
    .map((h) => h.trim().replace(/^"|"$/g, ''));
  if (!head.includes('name')) return t.missingName;
  if (lines.length < 2) return t.noRows;
  return null;
}
