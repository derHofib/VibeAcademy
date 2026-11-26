/**
 * Verwaltungs-API: Typen der Antworten (siehe apps/api/src/**) und Query-Keys.
 * Abrufe laufen über den gemeinsamen Client `@/lib/api` (Cookie-Sitzung + CSRF).
 */
import { get } from '@/lib/api';

export type InvitationStatus =
  'offen' | 'geoeffnet' | 'gelesen' | 'bestanden' | 'bestaetigt' | 'ueberfaellig' | 'befreit';
export type VersionStatus = 'hochgeladen' | 'analyse' | 'bereit' | 'fehler' | 'veroeffentlicht';
export type ChangeKind = 'redaktionell' | 'inhaltlich';

export interface DashboardRun {
  id: string;
  titel: string;
  version_no: number;
  page_count: number | null;
  quiz_required: boolean;
  deadline: string | null;
  eingeladen: number;
  erledigt: number;
  ueberfaellig: number;
}

export interface Dashboard {
  kpi: {
    erledigt: number;
    gesamt: number;
    ueberfaellig: number;
    laeuft_ab: number;
    offen: number;
    geoeffnet: number;
    erfuellungsquote: number | null;
  };
  laufend: DashboardRun[];
  ueberfaellig: Array<{ id: string; name: string; titel: string; due_at: string; tage: number }>;
  termine: unknown[];
}

export interface TrainingListItem {
  id: string;
  titel: string;
  kategorie: string | null;
  format: string;
  created_at: string;
  archived_at: string | null;
  latest_version_id: string | null;
  latest_version_no: number | null;
  latest_version_status: VersionStatus | null;
  page_count: number | null;
  published_version_no: number | null;
  published_at: string | null;
}

export interface TrainingSettings {
  wordsPerMinute: number;
  factor: number;
  floorSeconds: number;
  capSeconds: number;
  strictMode: boolean;
  passPct: number;
  maxAttempts: number;
  quizQuestionCount: number;
  requireStepUp: boolean;
  allowDownload: boolean;
  deadlineDays: number;
  intervalMonths: number;
  completenessPct: number;
}

export interface TrainingVersionSummary {
  id: string;
  version_no: number;
  status: VersionStatus;
  file_name: string | null;
  file_size: string | number | null;
  sha256: string | null;
  page_count: number | null;
  word_count: number | null;
  analysis_error: string | null;
  change_kind: ChangeKind | null;
  change_note: string | null;
  changed_pages: number[] | null;
  published_at: string | null;
  created_at: string;
}

export interface Training {
  id: string;
  titel: string;
  kategorie: string | null;
  rechtsgrundlage: string | null;
  format: string;
  quizRequired: boolean;
  confirmText: string;
  ansprechpartner: string | null;
  settings: TrainingSettings;
  versions: TrainingVersionSummary[];
}

export interface PageMeta {
  page_no: number;
  word_count: number;
  has_text: boolean;
  t_min_seconds: number;
  t_min_manual: number | null;
  t_min_effective: number;
  title: string | null;
  has_thumb: boolean;
}

export interface Chapter {
  idx: number;
  title: string;
  short_name: string;
  from_page: number;
  to_page: number;
  source: string;
}

export interface TrainingVersion {
  id: string;
  versionNo: number;
  status: VersionStatus;
  fileName: string | null;
  fileSize: number;
  sha256: string | null;
  pageCount: number | null;
  analysisError: string | null;
  changeKind: ChangeKind | null;
  changeNote: string | null;
  changedPages: number[] | null;
  publishedAt: string | null;
  createdAt: string;
  totals: { words: number; minReadingSeconds: number; pagesWithoutText: number };
  pages: PageMeta[];
  chapters: Chapter[];
}

export interface Question {
  id: string;
  text: string;
  options: string[];
  correct: number;
  explanation: string | null;
  active: boolean;
  created_at: string;
}

export interface Person {
  id: string;
  name: string;
  personalnr: string | null;
  email: string | null;
  mobil: string | null;
  org_unit_id: string | null;
  org_unit_name: string | null;
  extern: boolean;
  birthdate_under18: boolean;
  austritt_am: string | null;
  reading_time_factor: string | number;
  has_account: boolean;
}

export interface OrgUnit {
  id: string;
  name: string;
  parent_id: string | null;
  leiter_person_id: string | null;
  leiter_name: string | null;
}

export interface RunListItem {
  id: string;
  typ: string;
  status: string;
  deadline: string | null;
  created_at: string;
  titel: string;
  training_id: string;
  version_no: number;
  page_count: number | null;
  invited: number;
  done: number;
  overdue: number;
}

export interface RunInvitation {
  id: string;
  person_id: string;
  person_name: string;
  org_unit_name: string | null;
  status: InvitationStatus;
  sent_at: string | null;
  opened_at: string | null;
  completed_at: string | null;
  due_at: string | null;
  overdue: boolean;
  has_email: boolean;
}

export interface RunDetail {
  id: string;
  training_id: string;
  titel_effektiv: string;
  status: string;
  deadline: string | null;
  created_at: string;
  version_no: number;
  page_count: number | null;
  sha256: string | null;
  invitations: RunInvitation[];
}

export interface InviteResult {
  created: number;
  skipped: number;
  mailsQueued: number;
  withoutEmail: string[];
}

export interface ReportPage {
  page_no: number;
  title: string | null;
  soll_ms: number;
  ist_ms: number;
  first_seen_at: string | null;
  fulfilled_at: string | null;
}

export interface AuditEntry {
  ts: string;
  entity: string;
  action: string;
  payload: Record<string, unknown> | null;
}

export interface InvitationReport {
  invitation: {
    id: string;
    status: InvitationStatus;
    sentAt: string | null;
    openedAt: string | null;
    readCompletedAt: string | null;
    completedAt: string | null;
    dueAt: string | null;
  };
  person: { name: string; personalnr: string | null; orgUnit: string | null };
  training: {
    titel: string;
    versionNo: number;
    pageCount: number | null;
    sha256: string | null;
    quizRequired: boolean;
    passPct: number;
  };
  summary: { sessions: number; istMs: number; sollMs: number; plausibel: boolean };
  pages: ReportPage[];
  sessions: Array<{
    id: string;
    started_at: string;
    last_seen_at: string | null;
    ended_at: string | null;
    end_reason: string | null;
    user_agent: string | null;
  }>;
  attempts: Array<{
    attempt_no: number;
    score_pct: number | null;
    passed: boolean | null;
    submitted_at: string | null;
  }>;
  signature: { signed_at: string; auth_method: string } | null;
  evidence: {
    id: string;
    status: string;
    nachweis_nr: string | null;
    verify_code: string | null;
    pdf_sha256: string | null;
  } | null;
  audit: AuditEntry[];
}

export interface AuditVerify {
  ok: boolean;
  checked: number;
  firstBadId: string | null;
  firstBadSeq: number | null;
  reason: string | null;
}

export interface Member {
  id: string;
  account_id: string;
  email: string;
  name: string;
  roles: string[];
  created_at: string;
  active: boolean;
}

export const qk = {
  dashboard: ['admin', 'dashboard'] as const,
  trainings: ['admin', 'trainings'] as const,
  training: (id: string) => ['admin', 'training', id] as const,
  version: (id: string, vid: string) => ['admin', 'training', id, 'version', vid] as const,
  questions: (id: string) => ['admin', 'training', id, 'questions'] as const,
  persons: (q = '', org = '') => ['admin', 'persons', q, org] as const,
  personsAll: ['admin', 'persons'] as const,
  orgUnits: ['admin', 'org-units'] as const,
  runs: ['admin', 'runs'] as const,
  run: (id: string) => ['admin', 'run', id] as const,
  report: (id: string) => ['admin', 'report', id] as const,
  members: ['admin', 'members'] as const,
};

export function personsQueryFn(q: string, org: string) {
  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  if (org) params.set('org', org);
  const s = params.toString();
  return () => get<Person[]>(`/persons${s ? `?${s}` : ''}`);
}

export const thumbUrl = (trainingId: string, versionId: string, page: number) =>
  `/api/trainings/${trainingId}/versions/${versionId}/pages/${page}/thumb`;
