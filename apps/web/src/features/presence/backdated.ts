import type { Platform } from '@sn/shared';

/** Nachträgliche Erfassung (Phase 4.2, E-53/E-54): Typen der API und reine Hilfen der Oberfläche. */

export interface ImportRow {
  index: number;
  line: number;
  name: string;
  email: string | null;
  role: string | null;
  minutes: number | null;
  pct: number | null;
  state: 'vollstaendig' | 'teilweise' | 'ohne_zeiten';
  match: { personId: string; personName: string; by: 'email' | 'name' } | null;
}

export interface ImportResult {
  importId: string;
  format: 'teams' | 'teams_ereignisse' | 'tabelle';
  fileName: string;
  warnings: string[];
  plannedMinutes: number;
  completenessPct: number;
  rows: ImportRow[];
}

export interface BackdatedState {
  run: {
    id: string;
    titel: string;
    delivery: 'praesenz' | 'live_online' | null;
    platform: Platform | null;
    meetingUrl: string | null;
    ort: string | null;
    startAt: string;
    endAt: string;
    completenessPct: number;
    trainerName: string | null;
    backdatedAt: string;
    backdatedByName: string | null;
    reason: string;
    kombiniert: boolean;
    followupRunId: string | null;
    countersignedAt: string | null;
    countersignName: string | null;
    anlassTyp: string | null;
    anlassText: string | null;
  };
  attendances: Array<{
    id: string;
    personId: string;
    name: string;
    email: string | null;
    minutes: number;
    pct: number;
    state: 'vollstaendig' | 'teilweise';
    release: 'freigegeben' | 'abgelehnt' | null;
    confirmedAt: string | null;
    source: 'import' | 'trainer' | string;
    verifyCode: string | null;
  }>;
  documents: Array<{ id: string; kind: 'import' | 'beleg'; file_name: string; sha256: string; created_at: string }>;
}

/** Je Importzeile: übernehmen? welche Person (vorhanden, neu, keine)? bei „teilweise“ trotzdem anrechnen? */
export interface RowChoice {
  include: boolean;
  personId: string | null;
  createNew: boolean;
  credit: boolean;
}

/** Vorbelegung: zugeordnete Zeilen übernehmen, Organisator/Unbekannte nicht. */
export function defaultChoices(rows: ImportRow[]): Record<number, RowChoice> {
  const out: Record<number, RowChoice> = {};
  for (const r of rows) {
    const organizer = /organi[sz]/i.test(r.role ?? '');
    out[r.index] = { include: !!r.match && !organizer, personId: r.match?.personId ?? null, createNew: false, credit: false };
  }
  return out;
}

export interface ApplyEntry {
  index?: number;
  personId?: string;
  newPerson?: { name: string; email: string | null };
  credit: boolean;
}

/** Auswahl → Einträge für `POST runs/:id/nachtraeglich/anwesenheit`; Personen aus der Checkliste ohne Zeiten. */
export function buildEntries(rows: ImportRow[], choices: Record<number, RowChoice>, checklist: string[]): { entries: ApplyEntry[]; missing: string[] } {
  const entries: ApplyEntry[] = [];
  const missing: string[] = [];
  const used = new Set<string>();
  for (const r of rows) {
    const c = choices[r.index];
    if (!c?.include) continue;
    if (c.createNew) {
      entries.push({ index: r.index, newPerson: { name: cleanName(r.name), email: r.email }, credit: c.credit });
    } else if (c.personId) {
      if (used.has(c.personId)) continue;
      used.add(c.personId);
      entries.push({ index: r.index, personId: c.personId, credit: c.credit });
    } else missing.push(r.name);
  }
  for (const id of checklist) if (!used.has(id)) entries.push({ personId: id, credit: false });
  return { entries, missing };
}

/** „Becker, Jonas (Gast)“ → „Jonas Becker“ für neu angelegte Personen. */
export function cleanName(raw: string): string {
  const s = raw.replace(/\((?:gast|guest|extern|external)\)/gi, '').trim();
  const m = /^([^,]+),\s*(.+)$/.exec(s);
  return (m ? `${m[2]} ${m[1]}` : s).replace(/\s+/g, ' ').trim();
}

/** Lokale Datum-/Zeitfelder (Europe/Berlin) → ISO mit Offset für die API. */
export function berlinIso(date: string, time: string): string {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
  }).formatToParts(new Date(guess));
  const g = (k: string) => Number(parts.find((p) => p.type === k)!.value);
  const offsetMin = (Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - guess) / 60000;
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  return `${date}T${time}:00${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}
