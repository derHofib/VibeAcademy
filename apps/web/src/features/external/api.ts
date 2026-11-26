/**
 * Externe Nachweise (Schritt 2.10): Typen der API-Antworten (apps/api/src/external/*) und Query-Keys.
 * Verwaltung: `/api/external-records*`, Mitarbeiter (Teilnehmerkonto, E-34): `/api/me/external-records*`.
 */
import { get } from '@/lib/api';

export type ExtStatus = 'entwurf' | 'eingereicht' | 'freigegeben' | 'zurueckgegeben' | 'abgelaufen' | 'widerrufen';
export type ExtSource = 'verwaltung' | 'selbst' | 'import';
export type OcrStatus = 'keine' | 'ausstehend' | 'fertig' | 'fehler';
export type ComplianceState = 'gueltig' | 'laeuft_ab' | 'abgelaufen' | 'fehlt' | 'befreit';

/** Relativer Rahmen (0…1) auf einer Belegseite. */
export interface OcrBox {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface OcrField {
  value: string;
  normalized?: string | number | null;
  confidence: number;
  box: OcrBox | null;
}
export interface OcrFields {
  course: OcrField | null;
  name: OcrField | null;
  date: OcrField | null;
  provider: OcrField | null;
  duration: OcrField | null;
  nameMatches?: boolean | null;
}

export interface Hint {
  code: string;
  label: string;
  personId?: string;
  note?: string | null;
}
export interface Flag {
  code: 'unterschrift_unleserlich' | 'sonstiges';
  note?: string | null;
}
export interface CheckItem {
  key: string;
  state: 'ok' | 'warn' | 'info';
  label: string;
  value: string;
  note: string;
}
export interface EvidenceRef {
  id: string;
  status: string;
  nachweisNr: string;
  verifyCode: string;
  sha256: string | null;
  revoked: boolean;
}
export interface ReceiptFileInfo {
  index: number;
  name: string;
  mime: string;
  size: number;
  pages: number;
  sha256?: string;
  url: string;
}

export interface UploadResult {
  id: string;
  name: string;
  mime: string;
  size: number;
  pages: number;
  sha256: string;
}

export interface PreviewPerson {
  personId: string;
  name: string;
  current: { state: ComplianceState | 'neu' | null; validUntil: string | null };
  next: { validUntil: string | null };
}
export interface Preview {
  label: string | null;
  intervalMonths: number | null;
  validUntilProposed: string | null;
  validUntil: string | null;
  credited: boolean;
  persons: PreviewPerson[];
}

export interface CreateResult {
  groupId: string | null;
  status: ExtStatus;
  records: Array<{ id: string; personId: string; personName: string; status: ExtStatus; validUntil: string | null; evidence: unknown }>;
}

export interface CaseItem {
  caseId: string;
  groupId: string | null;
  primaryRecordId: string;
  recordIds: string[];
  kind: 'einzel' | 'gruppe';
  label: string;
  title: string | null;
  persons: Array<{ recordId: string; personId: string; name: string; status: ExtStatus }>;
  status: ExtStatus;
  source: ExtSource;
  sourceLabel: string;
  submittedAt: string;
  reviewedAt: string | null;
  heldOn: string | null;
  validUntil: string | null;
  isMedical: boolean;
  fileKind: string | null;
  fileCount: number;
  ocrStatus: OcrStatus;
  chip: { label: string; tone: 'ok' | 'warn' };
  hints: Hint[];
}
export interface CaseList {
  counts: Record<ExtStatus, number>;
  items: CaseItem[];
}

export interface RecordDto {
  id: string;
  personId: string;
  personName: string;
  personalnr: string | null;
  orgUnitName: string | null;
  groupId: string | null;
  status: ExtStatus;
  source: ExtSource;
  sourceLabel: string;
  requirementId: string | null;
  qualificationId: string | null;
  qualificationName: string | null;
  trainingId: string | null;
  trainingTitle: string | null;
  freeTitle: string | null;
  title: string | null;
  provider: string | null;
  heldOn: string | null;
  durationHours: number | null;
  durationLabel: string | null;
  location: string | null;
  validUntil: string | null;
  isMedical: boolean;
  flags: Flag[];
  ocrStatus: OcrStatus;
  submittedAt: string | null;
  submittedByName: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  reviewNote: string | null;
  createdAt: string;
  supersedes: string | null;
}

export interface GroupMember {
  recordId: string;
  personId: string;
  name: string;
  personalnr: string | null;
  status: ExtStatus;
  flags: Flag[];
  hints: Hint[];
  evidence: EvidenceRef | null;
}

export interface RecordDetail {
  record: RecordDto;
  group: GroupMember[];
  files: ReceiptFileInfo[];
  ocr: {
    status: OcrStatus;
    engine: string | null;
    pages: Array<{ width: number; height: number }>;
    fields: OcrFields | null;
    suggestedRequirementId: string | null;
    error: string | null;
  };
  checks: CheckItem[];
  hints: Hint[];
  chip: { label: string; tone: 'ok' | 'warn' };
  validity: { proposed: string | null; current: string | null; intervalMonths: number | null; qualificationName: string | null };
  effect: { text: string; previousValidUntil: string | null; newValidUntil: string | null };
  evidence: EvidenceRef | null;
  undo: { possible: boolean; until: string | null };
  permissions: { approve: boolean; return: boolean; undo: boolean; edit: boolean };
}

export interface ApproveResult {
  records: Array<{ id: string; status: ExtStatus; validUntil: string | null; evidence: unknown }>;
  undoUntil: string;
}
export interface UndoResult {
  records: Array<{ id: string; replaces: string; status: ExtStatus }>;
}

export interface ImportRow {
  line: number;
  ok: boolean;
  personName?: string;
  recordId?: string;
  errors?: string[];
}
export interface ImportResult {
  dryRun: boolean;
  mode: 'pruefen' | 'freigeben';
  status: ExtStatus;
  rows: ImportRow[];
  created: number;
  receipts: number;
}

/** Anforderung (Pflichtmatrix) – gleiche Form wie `GET /api/requirements`. */
export interface Requirement {
  id: string;
  qualification_id: string;
  qualification_name: string;
  training_id: string;
  training_title: string;
  training_format: string;
  interval_months: number;
  grace_days: number;
  reinvite_days: number;
  auto_invite: boolean;
  active: boolean;
  created_at: string;
  person_count: number;
}

// ── Mitarbeiter (Teilnehmerkonto) ──
export interface TargetOption {
  requirementId: string;
  trainingId: string;
  qualificationName: string;
  trainingTitle: string;
  trainingFormat: string;
  intervalMonths: number;
  label: string;
  current: { state: ComplianceState; validUntil: string | null };
}
export interface Target {
  personId: string;
  personName: string;
  tenantId: string;
  tenantName: string;
  options: TargetOption[];
}
export interface MySubmission {
  id: string;
  tenantId: string;
  tenantName: string;
  title: string | null;
  status: ExtStatus;
  source: ExtSource;
  heldOn: string | null;
  validUntil: string | null;
  qualificationName: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  evidence: EvidenceRef | null;
}
export interface TimelineStep {
  step: 'eingereicht' | 'in_pruefung' | 'freigegeben';
  done: boolean;
  current?: boolean;
  at: string | null;
  note: string | null;
}
export interface MyRecordView {
  record: RecordDto;
  tenantName: string;
  files: ReceiptFileInfo[];
  ocr: { status: OcrStatus; pages: Array<{ width: number; height: number }>; fields: OcrFields | null; suggestedRequirementId: string | null };
  validity: { proposed: string | null; intervalMonths: number | null };
  credit: { label: string; validUntil: string } | null;
  reviewerName: string | null;
  timeline: TimelineStep[];
  evidence: EvidenceRef | null;
}

export const xk = {
  all: ['admin', 'extern'] as const,
  list: (status: string) => ['admin', 'extern', 'list', status] as const,
  detail: (id: string) => ['admin', 'extern', 'detail', id] as const,
  preview: (body: unknown) => ['admin', 'extern', 'preview', body] as const,
  requirements: ['admin', 'requirements'] as const,
  mine: ['konto', 'extern'] as const,
  mineList: ['konto', 'extern', 'liste'] as const,
  mineDetail: (id: string) => ['konto', 'extern', id] as const,
  targets: ['konto', 'extern', 'ziele'] as const,
};

export const fetchRequirements = () => get<Requirement[]>('/requirements');
export const myEvidencePdfUrl = (id: string) => `/api/me/external-records/${id}/evidence/pdf`;
