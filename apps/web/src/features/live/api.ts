/**
 * Präsenz-/Live-API (apps/api/src/presence/*.ts, apps/api/src/live/*.ts): Antworttypen, Query-Keys und Abrufe.
 * Zeiten kommen als ISO-Strings; maßgeblich ist immer die Serverzeit (E-17).
 */
import { ApiError, get } from '@/lib/api';
import type { CheckInMethod, CheckOutMethod, ManualCheckoutReason } from '@sn/shared';

export type RunTyp = 'termin' | 'live_extern';
export type RunStatus = 'geplant' | 'laeuft' | 'beendet';

export interface RunView {
  id: string;
  typ: RunTyp;
  titel: string;
  trainingId: string | null;
  provider: string | null;
  ort: string | null;
  startAt: string;
  endAt: string;
  plannedSeconds: number;
  status: RunStatus;
  startedAt: string | null;
  endedAt: string | null;
  autoEnded: boolean;
  completenessPct: number;
  qrMode: string | null;
  allowWalkIn: boolean;
  trainer: { personId: string; name: string | null } | null;
  countersign: { at: string; name: string | null; method: string | null } | null;
  tenantName: string;
  confirmText: string;
  serverTime: string;
}

export interface AttendanceInterval {
  in: string;
  out: string | null;
  inMethod: CheckInMethod;
  outMethod: CheckOutMethod | null;
  inOffline: boolean;
  outOffline: boolean;
}

export type AttendanceStatus =
  | 'nicht_eingecheckt'
  | 'nicht_teilgenommen'
  | 'anwesend'
  | 'ausgecheckt'
  | 'vermerk_pruefen'
  | 'rueckfrage'
  | 'vermerk_akzeptiert'
  | 'pruefen'
  | 'bestaetigung_offen'
  | 'bestaetigt';

export interface AttendanceRow {
  attendanceId: string | null;
  invitationId: string;
  personId: string;
  personName: string;
  initials: string;
  checkedIn: boolean;
  firstIn: string | null;
  lastOut: string | null;
  inMethod: CheckInMethod | null;
  outMethod: CheckOutMethod | null;
  inMethodLabel: string | null;
  outMethodLabel: string | null;
  intervals: AttendanceInterval[];
  durationSeconds: number;
  plannedSeconds: number;
  completenessPct: number;
  completenessState: 'vollstaendig' | 'teilweise';
  belowThreshold: boolean;
  manual: { reason: ManualCheckoutReason; reasonLabel: string; note: string } | null;
  noteReview: 'offen' | 'akzeptiert' | 'rueckfrage' | null;
  noteReviewMessage: string | null;
  autoClosed: boolean;
  release: 'freigegeben' | 'abgelehnt' | null;
  confirmedAt: string | null;
  confirmedVia: 'selbst' | 'kiosk' | null;
  canConfirm: boolean;
  askedQuestion: boolean;
  evidence: { id: string; status: string; nachweisNr: string | null; verifyCode: string | null } | null;
  status: AttendanceStatus;
  statusLabel: string;
}

export interface AttendanceKpis {
  invited: number;
  present: number;
  participated: number;
  checkedOutQr: number;
  manual: number;
  notesToReview: number;
  missing: number;
  confirmationsOpen: number;
  confirmed: number;
}

export interface OrganizerAttendance {
  kpis: AttendanceKpis;
  rows: AttendanceRow[];
}

export type QuestionStatus = 'offen' | 'beantwortet' | 'per_mail';

export interface LiveQuestionBase {
  id: string;
  text: string;
  votes: number;
  status: QuestionStatus;
  createdAt: string;
  statusAt: string | null;
  anonymous: boolean;
}
export interface OrganizerQuestion extends LiveQuestionBase {
  author: string | null;
}
export interface ParticipantQuestion extends LiveQuestionBase {
  author: string;
  mine: boolean;
  voted: boolean;
}

export type PollMode = 'stimmungsbild' | 'wissenscheck';

export interface PollResult {
  id: string;
  question: string;
  options: string[];
  correct: number | null;
  explanation: string | null;
  mode: PollMode;
  sourceQuestionId: string | null;
  openedAt: string;
  closedAt: string | null;
  open: boolean;
  answered: number;
  lateAnswers: number;
  eligible: number;
  distribution: number[];
  distributionPct: number[];
  rightPct: number | null;
}

export interface OrganizerPolls {
  active: PollResult | null;
  list: PollResult[];
}

export type MyPollAnswer =
  | { option: number; correct: boolean; correctOption: number; explanation: string | null; late: boolean }
  | { answered: true };

export interface ParticipantPolls {
  openPoll: { id: string; question: string; options: string[]; mode: PollMode; openedAt: string; myAnswer: MyPollAnswer | null } | null;
  pendingPolls: Array<{ id: string; question: string; options: string[]; mode: PollMode }>;
  myResults: Array<{ pollId: string; question: string } & Partial<Extract<MyPollAnswer, { option: number }>>>;
}

export interface PoolQuestion {
  id: string;
  text: string;
  options: string[];
  correct: number;
  explanation: string | null;
  used: boolean;
}

export interface QrCodeResponse {
  token: string;
  url: string;
  svg: string;
  kind: 'start' | 'end';
  mode: 'rotierend' | 'gedruckt';
  slot?: number;
  rotatesEverySeconds?: number;
  expiresInSeconds?: number;
  validWindow: { from: string; until: string };
  serverTime?: string;
}

export interface TerminListItem {
  id: string;
  typ: RunTyp;
  status: RunStatus;
  titel: string;
  provider: string | null;
  ort: string | null;
  start_at: string;
  end_at: string;
  ended_at: string | null;
  trainer_person_id: string | null;
  trainer_name: string | null;
  countersigned_at: string | null;
  invited: number;
  participated: number;
  present: number;
  confirmed: number;
  notes_to_review: number;
  /** E-52/E-53 */
  delivery?: 'praesenz' | 'live_online' | null;
  platform?: string | null;
  backdated_at?: string | null;
}

/** Gemeinsame Form beider Live-Sichten (SSE-Snapshot, danach Teilstücke). */
export interface LiveSnapshot<A, Q, P> {
  run: RunView;
  attendance: A;
  questions: Q;
  polls: P;
}

export type OrganizerSnapshot = LiveSnapshot<OrganizerAttendance, OrganizerQuestion[], OrganizerPolls> & { role?: 'organizer' };
export type ParticipantSnapshot = LiveSnapshot<AttendanceRow, ParticipantQuestion[], ParticipantPolls> & {
  role?: 'participant';
  invitationId: string;
};

export interface ParticipantState {
  run: RunView;
  invitationId: string;
  me: AttendanceRow;
}
export interface ScanResponse extends ParticipantState {
  alreadyCheckedIn: boolean;
  newSession: boolean;
}

export interface AttendanceEvidence {
  status: 'ausstehend' | 'erzeugt' | 'fehler';
  verifyCode: string;
  nachweisNr: string;
  sha256: string | null;
  sealedAt: string | null;
}

export interface MyInvitationRow {
  invitation_id: string;
  typ?: string | null;
  run_id?: string | null;
  start_at?: string | null;
}

export const liveKeys = {
  all: ['live'] as const,
  termine: ['admin', 'termine'] as const,
  organizer: (runId: string) => ['admin', 'live', runId] as const,
  qr: (runId: string, kind: 'start' | 'end') => ['admin', 'live', runId, 'qr', kind] as const,
  qrPrint: (runId: string, kind: 'start' | 'end') => ['admin', 'live', runId, 'qr-print', kind] as const,
  pool: (runId: string) => ['admin', 'live', runId, 'pool'] as const,
  participant: (invitationId: string) => ['teilnahme', invitationId, 'live'] as const,
  evidence: (invitationId: string) => ['teilnahme', invitationId, 'live', 'nachweis'] as const,
  myInvitations: ['teilnahme', 'meine-einladungen'] as const,
};

export const isLiveTyp = (typ: string | null | undefined): typ is RunTyp => typ === 'termin' || typ === 'live_extern';

export const livePath = {
  participant: (invitationId: string) => `/teilnahme/${invitationId}/live`,
  organizer: (runId: string) => `/verwaltung/termine/${runId}`,
  kiosk: (runId: string) => `/verwaltung/termine/${runId}/kiosk`,
  print: (runId: string, kind: 'start' | 'end') => `/verwaltung/termine/${runId}/aushang?art=${kind}`,
  list: '/verwaltung/termine',
  evidencePdf: (invitationId: string) => `/api/me/invitations/${invitationId}/attendance/evidence/pdf`,
};

/** Organisator: Anwesenheit + Fragen + Kontrollfragen in einem Snapshot (wie das SSE-Ereignis „snapshot“). */
export async function fetchOrganizerSnapshot(runId: string): Promise<OrganizerSnapshot> {
  const [att, questions, polls] = await Promise.all([
    get<{ run: RunView } & OrganizerAttendance>(`/runs/${runId}/attendance`),
    get<OrganizerQuestion[]>(`/runs/${runId}/questions`),
    get<OrganizerPolls>(`/runs/${runId}/polls`),
  ]);
  return { role: 'organizer', run: att.run, attendance: { kpis: att.kpis, rows: att.rows }, questions, polls };
}

export function fetchParticipantSnapshot(invitationId: string): Promise<ParticipantSnapshot> {
  return get<ParticipantSnapshot>(`/me/invitations/${invitationId}/live`);
}

/** Kein erneuter Versuch bei fachlichen Fehlern (4xx). */
export const retryUnlessClientError = (count: number, err: Error) => !(err instanceof ApiError && err.status < 500) && count < 2;

/**
 * Art einer Einladung (für die Weiterleitung von Startseite/Link): Präsenz-/Live-Termine haben keinen Lese-Start.
 * Liefert `null`, wenn die Einladung nicht in der Liste der Sitzung steht.
 */
export async function invitationKind(invitationId: string): Promise<MyInvitationRow | null> {
  const rows = await get<MyInvitationRow[]>('/me/invitations');
  return rows.find((r) => r.invitation_id === invitationId) ?? null;
}
