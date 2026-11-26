/**
 * Reine Logik für „Meine Nachweise“ (E-25): Gruppierung in Offen/Erledigt und Gültigkeit.
 * Ohne React, damit sie mit Vitest testbar ist.
 */
import type { InvitationStatus } from '@/features/participant/api';

/** Zeile aus `GET /api/me/evidence` (SQL `app.evidence_for_account`). */
export interface MyEvidence {
  invitation_id: string;
  tenant_name: string;
  training_titel: string;
  version_no: number;
  completed_at: string | null;
  valid_until: string | null;
  status: InvitationStatus;
  nachweis_nr: string | null;
  verify_code: string | null;
  evidence_status: 'ausstehend' | 'erzeugt' | 'fehler' | null;
  /** Phase 2: Art des Nachweises (online | praesenz | live | extern) */
  kind?: 'online' | 'praesenz' | 'live' | 'extern' | null;
  /** Einladung bzw. externer Nachweis (bei extern ist invitation_id null) */
  record_id?: string | null;
  /** Download-Pfad des versiegelten Nachweises (je Art verschieden) */
  download_url?: string | null;
}

/** Stabiler Schlüssel je Zeile (externe Nachweise haben keine Einladung). */
export function evidenceKey(e: Pick<MyEvidence, 'invitation_id' | 'record_id' | 'kind'>): string {
  return `${e.kind ?? 'online'}-${e.record_id ?? e.invitation_id}`;
}

/** Zeile aus `GET /api/me/link-candidates`. */
export interface LinkCandidate {
  person_id: string;
  person_name: string;
  tenant_id: string;
  tenant_name: string;
  linked: boolean;
}

/** Ab so vielen Tagen vor Ablauf wird gelb „läuft bald ab“ angezeigt. */
export const EXPIRY_WARN_DAYS = 30;

const DAY_MS = 86_400_000;

export type ValidityKind = 'gueltig' | 'laeuftAb' | 'abgelaufen' | 'keine';

export interface Validity {
  kind: ValidityKind;
  /** Ganze Tage bis zum Ablauf (aufgerundet); negativ = seit so vielen Tagen abgelaufen; null ohne Datum */
  daysLeft: number | null;
}

export function validity(validUntil: string | null | undefined, now: Date = new Date()): Validity {
  if (!validUntil) return { kind: 'keine', daysLeft: null };
  const until = new Date(validUntil).getTime();
  if (Number.isNaN(until)) return { kind: 'keine', daysLeft: null };
  const diff = until - now.getTime();
  const daysLeft = Math.ceil(diff / DAY_MS);
  if (diff <= 0) return { kind: 'abgelaufen', daysLeft };
  if (daysLeft <= EXPIRY_WARN_DAYS) return { kind: 'laeuftAb', daysLeft };
  return { kind: 'gueltig', daysLeft };
}

/** Erledigt = bestätigt (Nachweis vorhanden) oder befreit; alles andere ist noch offen („Weiter“). */
export function isDone(e: Pick<MyEvidence, 'status'> & { kind?: MyEvidence['kind'] }): boolean {
  // Externe Nachweise erscheinen erst nach der Freigabe (auch wenn inzwischen abgelaufen)
  return e.kind === 'extern' || e.status === 'bestaetigt' || e.status === 'befreit';
}

/** Ein erledigter Eintrag mit Nachweis (befreit hat keinen). */
export function hasEvidence(e: Pick<MyEvidence, 'status'> & { kind?: MyEvidence['kind'] }): boolean {
  return e.status === 'bestaetigt' || (e.kind === 'extern' && e.status !== 'befreit');
}

export function canDownload(e: Pick<MyEvidence, 'status' | 'evidence_status'> & { kind?: MyEvidence['kind'] }): boolean {
  return hasEvidence(e) && e.evidence_status === 'erzeugt';
}

/** Reihenfolge der offenen Einträge: überfällig zuerst, dann fast fertig vor neu. */
const OPEN_RANK: Record<string, number> = { ueberfaellig: 0, bestanden: 1, gelesen: 2, geoeffnet: 3, offen: 4 };
/** Reihenfolge der erledigten Einträge: zuerst, was Handlung braucht. */
const VALIDITY_RANK: Record<ValidityKind, number> = { abgelaufen: 0, laeuftAb: 1, gueltig: 2, keine: 3 };

const time = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);

export interface EvidenceGroups {
  open: MyEvidence[];
  done: Array<MyEvidence & { validity: Validity }>;
  /** Erledigte, die in ≤ 30 Tagen ablaufen (nicht schon abgelaufen) */
  expiringCount: number;
}

export function groupEvidence(rows: readonly MyEvidence[], now: Date = new Date()): EvidenceGroups {
  const open = rows
    .filter((r) => !isDone(r))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (OPEN_RANK[a.r.status] ?? 5) - (OPEN_RANK[b.r.status] ?? 5) || a.i - b.i)
    .map(({ r }) => r);
  const done = rows
    .filter(isDone)
    .map((r) => ({ ...r, validity: hasEvidence(r) ? validity(r.valid_until, now) : { kind: 'keine' as const, daysLeft: null } }))
    .sort(
      (a, b) =>
        VALIDITY_RANK[a.validity.kind] - VALIDITY_RANK[b.validity.kind] || time(b.completed_at) - time(a.completed_at),
    );
  return { open, done, expiringCount: done.filter((d) => d.validity.kind === 'laeuftAb').length };
}

/** Konto ohne Mitgliedschaft in einer Organisation = reines Teilnehmerkonto. */
export function isParticipantOnly(me: { memberships: readonly unknown[] } | null | undefined): boolean {
  return !!me && me.memberships.length === 0;
}

/** Startseite nach der Anmeldung: reine Teilnehmer → `/konto`, Mitglieder → `/verwaltung`. */
export function homePathFor(me: { memberships: readonly unknown[] } | null | undefined): string {
  return isParticipantOnly(me) ? '/konto' : '/verwaltung';
}

/** Vorname für die Begrüßung („Lea Wagner“ → „Lea“). */
export function firstNameOf(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}

/** Link „Konto anlegen“ im Teilnehmer-Modus, optional mit vorbelegter E-Mail-Adresse. */
export function participantRegisterPath(email?: string | null): string {
  const q = new URLSearchParams({ teilnehmer: '1' });
  if (email?.trim()) q.set('email', email.trim());
  return `/registrieren?${q.toString()}`;
}
