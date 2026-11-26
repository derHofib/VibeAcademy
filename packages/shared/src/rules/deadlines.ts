/**
 * Fristen-Engine (SPEZIFIKATION 4.5, E-13, E-24): reine Regeln ohne Datenbank.
 * Die API (nächtlicher Job, 02:00 Europe/Berlin) entscheidet mit diesen Funktionen, was fällig ist;
 * eine Protokolltabelle mit eindeutigem Schlüssel (noticeKey) garantiert, dass jede Stufe genau einmal versendet wird.
 *
 * Datumswerte ohne Uhrzeit („gültig bis“) sind Kalendertage in Europe/Berlin im Format YYYY-MM-DD.
 */

export const DEADLINE_TZ = 'Europe/Berlin';
const DAY_MS = 86_400_000;

export interface DeadlinePolicy {
  /** Erinnerungen relativ zur Frist in Tagen (negativ = vorher). Standard T−7, T−2, T+1 (E-24). */
  reminderOffsetsDays: readonly number[];
  /** Eskalation an den Vorgesetzten, Tage nach der Frist. Standard T+1 (E-24). */
  escalationOffsetDays: number;
  /** „läuft ab“ ab so vielen Tagen vor Ablauf (Dashboard „läuft in 30 Tagen ab“). */
  soonDays: number;
  /** Automatische Wiedereinladung so viele Tage vor Ablauf (je Anforderung überschreibbar). */
  reinviteLeadDays: number;
}

export const DEFAULT_DEADLINE_POLICY: DeadlinePolicy = {
  reminderOffsetsDays: [-7, -2, 1],
  escalationOffsetDays: 1,
  soonDays: 30,
  reinviteLeadDays: 30,
};

export type ReminderStage = `T${'+' | '-'}${number}`;
export const stageName = (offsetDays: number): ReminderStage =>
  (offsetDays < 0 ? `T-${-offsetDays}` : `T+${offsetDays}`) as ReminderStage;

export interface DueReminder {
  stage: ReminderStage;
  offsetDays: number;
  /** Zeitpunkt, ab dem die Stufe fällig ist */
  at: Date;
}

/**
 * Welche Erinnerungsstufe ist zum Zeitpunkt `now` fällig? Es zählt nur die jüngste erreichte Stufe –
 * verpasste ältere Stufen werden nicht nachgeholt (keine Mail-Flut nach einem Ausfall).
 * Stufen, die vor der Einladung lagen (`invitedAt`), entfallen (z. B. kein „T−7“ bei einer Frist von 3 Tagen).
 */
export function dueReminderStage(
  dueAt: Date,
  now: Date,
  invitedAt: Date | null = null,
  policy: DeadlinePolicy = DEFAULT_DEADLINE_POLICY,
): DueReminder | null {
  const offsets = [...policy.reminderOffsetsDays].sort((a, b) => a - b);
  let hit: DueReminder | null = null;
  for (const o of offsets) {
    const at = new Date(dueAt.getTime() + o * DAY_MS);
    if (at.getTime() <= now.getTime()) hit = { stage: stageName(o), offsetDays: o, at };
  }
  if (!hit) return null;
  if (invitedAt && hit.at.getTime() < invitedAt.getTime()) return null;
  return hit;
}

/** Eskalation an den Vorgesetzten fällig? */
export function escalationDue(dueAt: Date, now: Date, policy: DeadlinePolicy = DEFAULT_DEADLINE_POLICY): boolean {
  return now.getTime() >= dueAt.getTime() + policy.escalationOffsetDays * DAY_MS;
}

export const isOverdue = (dueAt: Date, now: Date) => now.getTime() > dueAt.getTime();

// ── Kalendertage ────────────────────────────────────────────

/** Kalendertag (YYYY-MM-DD) eines Zeitpunkts in Europe/Berlin. */
export function berlinDate(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: DEADLINE_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return parts; // en-CA liefert YYYY-MM-DD
}

function parseDate(s: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`Ungültiges Datum: ${s}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}
const fmt = (y: number, m: number, d: number) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Monate addieren wie PostgreSQL (`date + interval 'n months'`): Monatsende wird gekappt (31.01. + 1 = 28./29.02.). */
export function addMonths(date: string, months: number): string {
  const { y, m, d } = parseDate(date);
  const idx = y * 12 + (m - 1) + months;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return fmt(ny, nm, Math.min(d, last));
}

export function addDays(date: string, days: number): string {
  const { y, m, d } = parseDate(date);
  const t = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS);
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Tage von a bis b (b − a). */
export function daysBetween(a: string, b: string): number {
  const x = parseDate(a);
  const y = parseDate(b);
  return Math.round((Date.UTC(y.y, y.m - 1, y.d) - Date.UTC(x.y, x.m - 1, x.d)) / DAY_MS);
}

/** „Gültig bis“-Vorschlag aus dem Intervall (z. B. Ersthelfer 24 Monate). */
export const proposeValidUntil = (completedOn: string, intervalMonths: number) => addMonths(completedOn, intervalMonths);

// ── Pflichtmatrix ───────────────────────────────────────────

export const COMPLIANCE_STATES = ['gueltig', 'laeuft_ab', 'abgelaufen', 'fehlt', 'befreit'] as const;
export type ComplianceState = (typeof COMPLIANCE_STATES)[number];

export interface ComplianceInput {
  /** gültig bis (einschließlich); null = nie erfüllt */
  validUntil: string | null;
  /** heutiger Kalendertag (Europe/Berlin) */
  today: string;
  graceDays?: number;
  exempt?: boolean;
  soonDays?: number;
}

/**
 * Zustand je Person × Anforderung. Gleiche Regel wie die SQL-Funktion `app.compliance()`:
 * Ablauf = gültig bis + Kulanztage; abgelaufen, wenn heute danach liegt; „läuft ab“, wenn ≤ soonDays bis Ablauf.
 */
export function complianceState(i: ComplianceInput): ComplianceState {
  if (i.exempt) return 'befreit';
  if (!i.validUntil) return 'fehlt';
  const expiry = addDays(i.validUntil, i.graceDays ?? 0);
  const left = daysBetween(i.today, expiry);
  if (left < 0) return 'abgelaufen';
  if (left <= (i.soonDays ?? DEFAULT_DEADLINE_POLICY.soonDays)) return 'laeuft_ab';
  return 'gueltig';
}

/** Ist die automatische Wiedereinladung fällig? (Ablauf naht oder nie erfüllt) */
export function reinviteDue(validUntil: string | null, today: string, leadDays = DEFAULT_DEADLINE_POLICY.reinviteLeadDays): boolean {
  if (!validUntil) return true;
  return daysBetween(today, validUntil) <= leadDays;
}

/** Tag der automatischen Wiedereinladung (für „Wiedereinladung automatisch am …“). */
export const reinviteOn = (validUntil: string, leadDays = DEFAULT_DEADLINE_POLICY.reinviteLeadDays) => addDays(validUntil, -leadDays);

// ── Idempotenz-Schlüssel ────────────────────────────────────

export const noticeKey = {
  reminder: (invitationId: string, stage: ReminderStage) => `inv:${invitationId}:${stage}`,
  escalation: (invitationId: string) => `inv:${invitationId}:eskalation`,
  overdue: (invitationId: string) => `inv:${invitationId}:ueberfaellig`,
  /** je Person, Anforderung und Gültigkeitszyklus genau eine Wiedereinladung */
  reinvite: (personId: string, requirementId: string, validUntil: string | null) => `req:${personId}:${requirementId}:${validUntil ?? 'fehlt'}:einladung`,
  /** externe Kurse: Hinweis „neuen Termin buchen“ */
  bookCourse: (personId: string, requirementId: string, validUntil: string | null) => `req:${personId}:${requirementId}:${validUntil ?? 'fehlt'}:buchen`,
  /** neue inhaltliche Version: Betroffene einmal neu einladen */
  newVersion: (versionId: string, personId: string) => `ver:${versionId}:${personId}`,
} as const;
