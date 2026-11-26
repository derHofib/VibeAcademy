/**
 * Schritt-Logik des Assistenten „Schulung anlegen“ (Screen 2) – reine Funktionen.
 * Schritte: 1 Grunddaten · 2 Dokument & Regeln · 3 Zielgruppe · 4 Prüfen & einladen.
 */
import type { ChangeKind, OrgUnit, Person, Training, TrainingVersion, TrainingVersionSummary } from './api';
import { adm } from '@/i18n/admin';

export type WizardStep = 1 | 2 | 3 | 4;
export const WIZARD_STEPS: WizardStep[] = [1, 2, 3, 4];

export interface WizardState {
  training: Pick<Training, 'id' | 'quizRequired'> | null;
  /** Neueste Version (Entwurf oder veröffentlicht) */
  version: Pick<TrainingVersion, 'status' | 'versionNo' | 'publishedAt'> | null;
  /** Hat die Schulung bereits eine veröffentlichte Version? */
  hasPublished: boolean;
  activeQuestions: number;
  changeKind: ChangeKind | null;
  selectedPersons: number;
  selectedOrgUnits: number;
}

/** Liefert den deutschen Grund, warum der Schritt (noch) nicht erreichbar ist, sonst null. */
export function stepBlocker(step: WizardStep, s: WizardState): string | null {
  const g = adm.wizard.guards;
  if (step === 1) return null;
  if (!s.training) return g.saveBasics;
  if (step === 2) return null;
  // ab Schritt 3: ein lesbares Dokument
  const v = s.version;
  if (!v) return g.uploadPdf;
  if (v.status === 'hochgeladen' || v.status === 'analyse') return g.analysisRunning;
  if (v.status === 'fehler') return s.hasPublished ? null : g.analysisFailed;
  if (s.training.quizRequired && s.activeQuestions < 1) return g.questions;
  if (!v.publishedAt && v.versionNo >= 2 && !s.changeKind) return g.changeKind;
  if (step === 3) return null;
  if (s.selectedPersons + s.selectedOrgUnits === 0) return g.audience;
  return null;
}

/** Höchster Schritt, der erreichbar ist. */
export function maxReachableStep(s: WizardState): WizardStep {
  let max: WizardStep = 1;
  for (const step of WIZARD_STEPS) {
    if (stepBlocker(step, s) === null) max = step;
    else break;
  }
  return max;
}

export function parseStep(raw: string | null): WizardStep {
  const n = Number(raw);
  return n === 2 || n === 3 || n === 4 ? n : 1;
}

/** Neueste Version, an der gearbeitet wird. */
export function latestVersion(versions: TrainingVersionSummary[]): TrainingVersionSummary | null {
  return [...versions].sort((a, b) => b.version_no - a.version_no)[0] ?? null;
}

/** Muss beim Einladen noch veröffentlicht werden? */
export function needsPublish(v: Pick<TrainingVersion, 'status' | 'publishedAt'> | null): boolean {
  return !!v && v.status === 'bereit' && !v.publishedAt;
}

/** Vorschlag für den Bestätigungstext (Screen 2). */
export function defaultConfirmText(titel: string, ansprechpartner?: string | null, versionNo = 1): string {
  const t = titel.trim() || adm.wizard.basics.untitled;
  const base = `Ich habe die Unterweisung „${t}, Version ${versionNo}“ vollständig gelesen und verstanden.`;
  const who = ansprechpartner?.split(',')[0]?.trim();
  return who ? `${base} Rückfragen konnte ich an ${who} richten.` : base;
}

/** Alle Org-Einheiten inkl. Unter-Einheiten (wie die API beim Einladen). */
export function expandOrgUnits(
  selected: Iterable<string>,
  units: Pick<OrgUnit, 'id' | 'parent_id'>[],
): Set<string> {
  const out = new Set(selected);
  let grew = true;
  while (grew) {
    grew = false;
    for (const u of units) {
      if (u.parent_id && out.has(u.parent_id) && !out.has(u.id)) {
        out.add(u.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Vorschau der Zielgruppe: Personen direkt + aus Org-Einheiten (ohne Ausgetretene). */
export function audiencePreview(
  persons: Pick<Person, 'id' | 'org_unit_id' | 'email' | 'austritt_am'>[],
  units: Pick<OrgUnit, 'id' | 'parent_id'>[],
  personIds: Iterable<string>,
  orgUnitIds: Iterable<string>,
  today = new Date().toISOString().slice(0, 10),
) {
  const pick = new Set(personIds);
  const orgs = expandOrgUnits(orgUnitIds, units);
  const hit = persons.filter(
    (p) =>
      (pick.has(p.id) || (p.org_unit_id && orgs.has(p.org_unit_id))) &&
      (!p.austritt_am || p.austritt_am > today),
  );
  return { total: hit.length, withoutEmail: hit.filter((p) => !p.email).length, ids: hit.map((p) => p.id) };
}

export interface ChapterDraft {
  title: string;
  shortName: string;
  fromPage: number;
  toPage: number;
}

/** Prüft Kapitel wie die API: lückenlos, ohne Überschneidung, bis zur letzten Seite. */
export function chapterError(list: ChapterDraft[], pageCount: number): string | null {
  const c = adm.wizard.chapters;
  if (!list.length) return null;
  if (list.some((ch) => !ch.title.trim() || !ch.shortName.trim())) return c.errorNames;
  const sorted = [...list].sort((a, b) => a.fromPage - b.fromPage);
  let expected = 1;
  for (const ch of sorted) {
    if (ch.fromPage !== expected || ch.toPage < ch.fromPage) return c.errorGaps;
    expected = ch.toPage + 1;
  }
  if (expected - 1 !== pageCount) return c.errorEnd(pageCount);
  return null;
}
