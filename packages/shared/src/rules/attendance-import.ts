/**
 * Import von Teilnehmerlisten für nachträglich erfasste Termine (E-54):
 * Microsoft-Teams-Anwesenheitsbericht (neues Format mit Abschnitten, altes Format mit Beitritt/Verlassen-Ereignissen),
 * beliebige Tabellen (CSV/XLSX → Zeilen) mit Spalten Name, E-Mail, Beitritt, Verlassen, Dauer.
 * Rein und ohne Abhängigkeiten – die API liest XLSX vorher in Zeilen ein.
 */

export type ImportFormat = 'teams' | 'teams_ereignisse' | 'tabelle';

export interface ImportInterval {
  inAt: Date;
  outAt: Date;
}

export interface ImportEntry {
  /** Zeilennummer in der Datei (1-basiert) zur Nachvollziehbarkeit */
  line: number;
  name: string;
  email: string | null;
  role: string | null;
  /** Zeiten aus dem Bericht; leer = keine Zeiten in der Datei (ganze Dauer, wenn übernommen) */
  intervals: ImportInterval[];
  /** im Bericht genannte Dauer in Sekunden (falls vorhanden) */
  reportedSeconds: number | null;
}

export interface ImportResult {
  format: ImportFormat;
  entries: ImportEntry[];
  warnings: string[];
}

// ── Text und Tabelle ─────────────────────────────────────────

/** Text aus Bytes: UTF-16 (Teams-Export), UTF-8 mit/ohne BOM, sonst Windows-1252. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  // UTF-16LE ohne BOM: jedes zweite Byte 0
  const sample = bytes.subarray(0, Math.min(bytes.length, 200));
  let zeros = 0;
  for (let i = 1; i < sample.length; i += 2) if (sample[i] === 0) zeros++;
  if (sample.length > 4 && zeros > sample.length / 4) return new TextDecoder('utf-16le').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Zeilen und Zellen; Trennzeichen Tab, Semikolon oder Komma (das häufigste in der Kopfzeile), Anführungszeichen wie CSV. */
export function splitTable(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const probe = lines.find((l) => l.trim()) ?? '';
  const counts = (['\t', ';', ','] as const).map((d) => [d, probe.split(d).length] as const);
  const delimiter = counts.sort((a, b) => b[1] - a[1])[0]![1] > 1 ? counts[0]![0] : '\t';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows;
}

// ── Zeit ─────────────────────────────────────────────────────

/** Ortszeit Europe/Berlin → Zeitpunkt (berücksichtigt Sommer-/Winterzeit). */
export function berlinLocal(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const offset = (t: number) => {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Berlin', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    }).formatToParts(new Date(t));
    const g = (k: string) => Number(p.find((x) => x.type === k)!.value);
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - t;
  };
  const first = guess - offset(guess);
  return new Date(guess - offset(first));
}

const year4 = (y: number) => (y < 100 ? 2000 + y : y);

/**
 * Zeitangabe aus Berichten: „18.11.2026, 09:01:12“, „18.11.26 09:01“, „11/18/26, 9:01:12 AM“ (US),
 * „2026-11-18 09:01:12“, ISO mit Zone, nur Uhrzeit „09:01“ (dann Datum aus `day`).
 */
export function parseReportTime(raw: string, day?: Date): Date | null {
  const s = raw.trim().replace(/\u202f|\u00a0/g, ' ');
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : new Date(t);
  }
  const time = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?/.exec(s);
  let h = time ? Number(time[1]) : 0;
  const mi = time ? Number(time[2]) : 0;
  const sec = time?.[3] ? Number(time[3]) : 0;
  if (time?.[4]) {
    const pm = time[4].toLowerCase() === 'pm';
    if (pm && h < 12) h += 12;
    if (!pm && h === 12) h = 0;
  }
  let m: RegExpExecArray | null;
  if ((m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return berlinLocal(Number(m[1]), Number(m[2]), Number(m[3]), h, mi, sec);
  if ((m = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(s))) return berlinLocal(year4(Number(m[3])), Number(m[2]), Number(m[1]), h, mi, sec);
  if ((m = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s))) return berlinLocal(year4(Number(m[3])), Number(m[1]), Number(m[2]), h, mi, sec);
  if (time && day) {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(day).split('-');
    return berlinLocal(Number(p[0]), Number(p[1]), Number(p[2]), h, mi, sec);
  }
  return null;
}

/** Dauer: „1h 2m 3s“, „59m 3s“, „59 Min. 3 Sek.“, „1 Std. 2 Min.“, „00:59:03“, „59“ (Minuten). */
export function parseDuration(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(s))) return m[3] ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(m[1]) * 60 + Number(m[2]);
  if (/^\d+([.,]\d+)?$/.test(s)) return Math.round(Number(s.replace(',', '.')) * 60);
  const unit = (re: RegExp) => Number(re.exec(s)?.[1] ?? 0);
  const h = unit(/(\d+)\s*(?:h|std|stunden?|hr|hours?)\b/);
  const mi = unit(/(\d+)\s*(?:m|min|minuten?|minutes?)\b/);
  const sec = unit(/(\d+)\s*(?:s|sek|sekunden?|sec|seconds?)\b/);
  const total = h * 3600 + mi * 60 + sec;
  return total || null;
}

// ── Namen ────────────────────────────────────────────────────

/** Für den Abgleich per Name: klein, ohne Akzente/Zusätze, „Nachname, Vorname“ → „vorname nachname“. */
export function normalizeName(raw: string): string {
  let s = raw.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  s = s.replace(/\((?:gast|guest|extern|external|unverified|nicht verifiziert)\)/g, '').replace(/ß/g, 'ss').trim();
  const comma = /^([^,]+),\s*(.+)$/.exec(s);
  if (comma) s = `${comma[2]} ${comma[1]}`;
  return s.replace(/[^a-z0-9 -]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── Erkennung ────────────────────────────────────────────────

const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[„“"]/g, '');
const SYN = {
  name: ['name', 'vollständiger name', 'full name', 'teilnehmer', 'teilnehmende', 'participant', 'teilnehmer/in', 'anzeigename', 'display name'],
  email: ['e-mail', 'email', 'e-mail-adresse', 'email address', 'mail', 'teilnehmer-id (upn)', 'participant id (upn)', 'upn'],
  join: ['erster beitritt', 'first join', 'first join time', 'beitritt', 'beitrittszeit', 'join time', 'joined', 'beginn', 'von', 'start', 'check-in'],
  leave: ['letztes verlassen', 'last leave', 'last leave time', 'verlassen', 'zeit des verlassens', 'leave time', 'left', 'ende', 'bis', 'end', 'check-out'],
  duration: ['dauer der besprechung', 'in-meeting duration', 'dauer', 'duration', 'teilnahmedauer', 'minuten', 'anwesenheit (min)'],
  role: ['rolle', 'role'],
  action: ['benutzeraktion', 'user action', 'aktion', 'action'],
  timestamp: ['zeitstempel', 'timestamp'],
} as const;
type Col = keyof typeof SYN;

function headerMap(row: string[]): Partial<Record<Col, number>> {
  const out: Partial<Record<Col, number>> = {};
  row.forEach((cell, i) => {
    const c = norm(cell);
    for (const k of Object.keys(SYN) as Col[]) {
      if (out[k] === undefined && (SYN[k] as readonly string[]).includes(c)) out[k] = i;
    }
  });
  return out;
}

const SECTION = /^\s*\d\.\s/;

/**
 * Tabelle aus einer Datei in Anwesenheiten umwandeln. `ctx` = geplanter Termin (für Uhrzeiten ohne Datum
 * und Dauer-Angaben ohne Zeiten).
 */
export function parseAttendanceTable(rows: string[][], ctx: { startAt: Date; endAt: Date }): ImportResult {
  const warnings: string[] = [];
  const cleaned = rows.map((r) => r.map((c) => c.replace(/^\uFEFF/, '')));
  // 1. Neues Teams-Format: Abschnitt „3. Aktivitäten in der Besprechung“ (je Beitritt eine Zeile), sonst „2. Teilnehmer“
  let headerIdx = -1;
  let activitiesIdx = -1;
  for (let i = 0; i < cleaned.length; i++) {
    const h = headerMap(cleaned[i]!);
    if (h.name !== undefined && h.join !== undefined && h.leave !== undefined) {
      const prevSection = [...cleaned.slice(Math.max(0, i - 3), i)].reverse().find((r) => SECTION.test(r[0] ?? ''))?.[0] ?? '';
      if (/^\s*3\./.test(prevSection) || /aktivit|activities/i.test(prevSection)) activitiesIdx = i;
      else if (headerIdx < 0) headerIdx = i;
    }
  }
  const classic = cleaned.findIndex((r) => {
    const h = headerMap(r);
    return h.name !== undefined && h.action !== undefined && h.timestamp !== undefined;
  });

  if (classic >= 0 && headerIdx < 0 && activitiesIdx < 0) return parseClassicTeams(cleaned, classic, ctx, warnings);

  const isTeams = cleaned.some((r) => SECTION.test(r[0] ?? '') && /zusammenfassung|summary|teilnehmer|participants/i.test(r[0] ?? ''));
  const useIdx = activitiesIdx >= 0 ? activitiesIdx : headerIdx;
  if (useIdx < 0) {
    // 2. Tabelle ohne Zeiten: Name/E-Mail (und ggf. Dauer)
    const anyIdx = cleaned.findIndex((r) => headerMap(r).name !== undefined || headerMap(r).email !== undefined);
    if (anyIdx < 0) return { format: 'tabelle', entries: [], warnings: ['Keine Kopfzeile mit Name oder E-Mail gefunden.'] };
    return { format: 'tabelle', entries: readRows(cleaned, anyIdx, ctx, warnings), warnings };
  }
  const entries = readRows(cleaned, useIdx, ctx, warnings);
  // Mehrere Zeilen derselben Person (Wiedereintritt) zusammenfassen
  const byKey = new Map<string, ImportEntry>();
  for (const e of entries) {
    const key = e.email?.toLowerCase() || normalizeName(e.name);
    const prev = byKey.get(key);
    if (prev) {
      prev.intervals.push(...e.intervals);
      prev.reportedSeconds = (prev.reportedSeconds ?? 0) + (e.reportedSeconds ?? 0) || null;
    } else byKey.set(key, { ...e, intervals: [...e.intervals] });
  }
  return { format: isTeams ? 'teams' : 'tabelle', entries: [...byKey.values()], warnings };
}

function readRows(rows: string[][], headerIdx: number, ctx: { startAt: Date; endAt: Date }, warnings: string[]): ImportEntry[] {
  const h = headerMap(rows[headerIdx]!);
  const out: ImportEntry[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i]!;
    if (!r.some((c) => c)) {
      // Leerzeile beendet einen Abschnitt im Teams-Bericht
      if (rows.slice(i + 1).some((x) => SECTION.test(x[0] ?? ''))) break;
      continue;
    }
    if (SECTION.test(r[0] ?? '')) break;
    const name = (h.name !== undefined ? r[h.name] : '')?.trim() ?? '';
    const email = (h.email !== undefined ? r[h.email]?.trim() : '') || null;
    if (!name && !email) continue;
    const role = (h.role !== undefined ? r[h.role]?.trim() : '') || null;
    const dur = h.duration !== undefined ? parseDuration(r[h.duration] ?? '') : null;
    const inAt = h.join !== undefined ? parseReportTime(r[h.join] ?? '', ctx.startAt) : null;
    let outAt = h.leave !== undefined ? parseReportTime(r[h.leave] ?? '', ctx.startAt) : null;
    const intervals: ImportInterval[] = [];
    if (inAt && outAt && outAt < inAt) outAt = null;
    if (inAt && outAt) {
      // Teilnehmer-Abschnitt: erster Beitritt bis letztes Verlassen, gedeckelt durch die gemeldete Dauer
      const end = dur !== null ? new Date(Math.min(outAt.getTime(), inAt.getTime() + dur * 1000)) : outAt;
      intervals.push({ inAt, outAt: end });
    } else if (dur !== null) {
      intervals.push({ inAt: ctx.startAt, outAt: new Date(ctx.startAt.getTime() + dur * 1000) });
    } else if ((h.join !== undefined && r[h.join]) || (h.leave !== undefined && r[h.leave])) {
      warnings.push(`Zeile ${i + 1}: Zeiten nicht lesbar (${name || email}).`);
    }
    out.push({ line: i + 1, name: name || email || '', email: email && /@/.test(email) ? email : null, role, intervals, reportedSeconds: dur });
  }
  return out;
}

/** Altes Teams-Format: je Zeile ein Ereignis „Joined/Left“ bzw. „Beigetreten/Hat verlassen“ mit Zeitstempel. */
function parseClassicTeams(rows: string[][], headerIdx: number, ctx: { startAt: Date; endAt: Date }, warnings: string[]): ImportResult {
  const h = headerMap(rows[headerIdx]!);
  const open = new Map<string, { entry: ImportEntry; since: Date | null }>();
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i]!;
    const name = r[h.name!]?.trim();
    if (!name) continue;
    const action = norm(r[h.action!] ?? '');
    const at = parseReportTime(r[h.timestamp!] ?? '', ctx.startAt);
    if (!at) {
      warnings.push(`Zeile ${i + 1}: Zeitstempel nicht lesbar (${name}).`);
      continue;
    }
    const key = normalizeName(name);
    const cur = open.get(key) ?? { entry: { line: i + 1, name, email: null, role: null, intervals: [], reportedSeconds: null }, since: null };
    open.set(key, cur);
    const joined = /join|beigetreten|beitritt/.test(action);
    const left = /left|verlassen/.test(action);
    if (joined && !cur.since) cur.since = at;
    else if (left && cur.since) {
      cur.entry.intervals.push({ inAt: cur.since, outAt: at });
      cur.since = null;
    }
  }
  for (const v of open.values()) {
    // ohne „Verlassen“ bis zum geplanten Ende
    if (v.since) v.entry.intervals.push({ inAt: v.since, outAt: new Date(Math.max(v.since.getTime(), ctx.endAt.getTime())) });
  }
  return { format: 'teams_ereignisse', entries: [...open.values()].map((v) => v.entry), warnings };
}

/** Gesamtdauer innerhalb des geplanten Zeitfensters (Sekunden), Überschneidungen einmal gezählt. */
export function secondsWithin(intervals: ImportInterval[], startAt: Date, endAt: Date): number {
  const clipped = intervals
    .map((i) => [Math.max(i.inAt.getTime(), startAt.getTime()), Math.min(i.outAt.getTime(), endAt.getTime())] as const)
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curA = -1;
  let curB = -1;
  for (const [a, b] of clipped) {
    if (a > curB) {
      if (curB > curA) total += curB - curA;
      curA = a;
      curB = b;
    } else curB = Math.max(curB, b);
  }
  if (curB > curA) total += curB - curA;
  return Math.round(total / 1000);
}
