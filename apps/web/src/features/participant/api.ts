import { useQuery } from '@tanstack/react-query';
import { ApiError, get } from '@/lib/api';

/** Antworttypen der Teilnehmer-API (apps/api/src/participant, reading, quiz, signature, evidence). */

export type InvitationStatus =
  | 'offen'
  | 'geoeffnet'
  | 'gelesen'
  | 'bestanden'
  | 'bestaetigt'
  | 'ueberfaellig'
  | 'befreit';

export interface Chapter {
  idx: number;
  title: string;
  short_name: string | null;
  from_page: number;
  to_page: number;
}

export interface InvitationStart {
  id: string;
  status: InvitationStatus;
  dueAt: string | null;
  personName: string;
  tenantName: string;
  training: { titel: string; kategorie: string | null; rechtsgrundlage: string | null; ansprechpartner: string | null };
  version: { id: string; versionNo: number; pageCount: number; sha256: string };
  rules: { strictMode: boolean; passPct: number; maxAttempts: number };
  totals: { pages: number; minReadingSeconds: number; questions: number };
  chapters: Chapter[];
  pages: Array<{ pageNo: number; title: string | null; tMinSeconds: number }>;
  hasAccount: boolean;
}

export interface PageProgress {
  pageNo: number;
  tMinMs: number;
  dwellMs: number;
  fulfilled: boolean;
  allowed: boolean;
}

export interface ProgressSummary {
  complete: boolean;
  strictMode: boolean;
  pages: PageProgress[];
  current?: { pageNo: number; remainingMs: number };
}

export interface SessionStart extends ProgressSummary {
  sessionId: string;
  heartbeatIntervalMs: number;
}

export interface HeartbeatBody {
  seq: number;
  page: number;
  visibleRatio: number;
  focused: boolean;
  lastInputAgeMs: number;
  clientTs: number;
  offline?: boolean;
}

export interface HeartbeatResponse extends ProgressSummary {
  accepted: boolean;
  reason: string;
  newlyFulfilled: number[];
}

export interface QuizAnswer {
  option: number;
  correct: number;
  isCorrect: boolean;
  explanation: string | null;
}

export interface QuizQuestion {
  id: string;
  text: string;
  options: string[];
  answer?: QuizAnswer;
}

export interface QuizState {
  required: boolean;
  passPct?: number;
  maxAttempts?: number;
  attemptsUsed?: number;
  passed?: boolean;
  locked?: boolean;
  result?: { scorePct: number; attemptNo: number };
  attempt?: { id: string; attemptNo: number; questions: QuizQuestion[] };
}

export interface QuizFinish {
  scorePct: number;
  passed: boolean;
  correct: number;
  total: number;
  attemptNo: number;
  attemptsLeft: number;
  locked: boolean;
}

export interface SignatureInfo {
  confirmText: string;
  confirmTextSha256: string;
  requirements: { pagesComplete: boolean; quizRequired: boolean; quizPassed: boolean };
  ready: boolean;
  signedAt: string | null;
  verifyCode: string | null;
  authMethods: Array<'password' | 'otp_mail'>;
}

export interface EvidenceInfo {
  status: 'ausstehend' | 'erzeugt' | 'fehler';
  verifyCode: string;
  nachweisNr: string;
  sha256: string | null;
  sealedAt: string | null;
}

export interface VerifyResult {
  status: string;
  nachweisNr: string;
  sha256: string | null;
  versiegeltAm: string | null;
  schulung: string;
  version: number;
  teilnehmer: string;
  aussteller: string;
  art?: string;
}

export const participantKeys = {
  invitation: (id: string) => ['teilnahme', id] as const,
  progress: (id: string) => ['teilnahme', id, 'fortschritt'] as const,
  quiz: (id: string) => ['teilnahme', id, 'wissenscheck'] as const,
  signature: (id: string) => ['teilnahme', id, 'unterschrift'] as const,
  evidence: (id: string) => ['teilnahme', id, 'nachweis'] as const,
  verify: (code: string) => ['pruefung', code] as const,
};

/** Kein erneuter Versuch bei fachlichen Fehlern (4xx) – nur bei Netz-/Serverfehlern. */
const retryUnlessClientError = (count: number, err: Error) =>
  !(err instanceof ApiError && err.status < 500) && count < 2;

export function useInvitation(id: string) {
  return useQuery({
    queryKey: participantKeys.invitation(id),
    queryFn: () => get<InvitationStart>(`/me/invitations/${id}`),
    retry: retryUnlessClientError,
  });
}

export function useProgress(id: string) {
  return useQuery({
    queryKey: participantKeys.progress(id),
    queryFn: () => get<ProgressSummary>(`/me/invitations/${id}/progress`),
    retry: retryUnlessClientError,
  });
}

export function useQuiz(id: string) {
  return useQuery({
    queryKey: participantKeys.quiz(id),
    queryFn: () => get<QuizState>(`/me/invitations/${id}/quiz`),
    retry: retryUnlessClientError,
    staleTime: Infinity,
  });
}

export function useSignatureInfo(id: string) {
  return useQuery({
    queryKey: participantKeys.signature(id),
    queryFn: () => get<SignatureInfo>(`/me/invitations/${id}/signature`),
    retry: retryUnlessClientError,
  });
}

/** Nachweis-Status; pollt alle 2 s, bis das PDF erzeugt ist. */
export function useEvidence(id: string, enabled: boolean) {
  return useQuery({
    queryKey: participantKeys.evidence(id),
    queryFn: () => get<EvidenceInfo>(`/me/invitations/${id}/evidence`),
    enabled,
    retry: (count, err) => (err instanceof ApiError && err.status === 404 ? count < 10 : count < 2),
    retryDelay: 1500,
    refetchInterval: (q) => (q.state.data?.status === 'erzeugt' ? false : 2000),
  });
}

export function useVerify(code: string) {
  return useQuery({
    queryKey: participantKeys.verify(code),
    queryFn: () => get<VerifyResult>(`/verify/${encodeURIComponent(code)}`),
    retry: retryUnlessClientError,
  });
}

/** Leitet aus dem Einladungsstatus den nächsten sinnvollen Schritt ab. */
export function nextStep(status: InvitationStatus, hasQuiz: boolean): 'lesen' | 'wissenscheck' | 'abschluss' | 'nachweis' | 'befreit' {
  switch (status) {
    case 'gelesen':
      return hasQuiz ? 'wissenscheck' : 'abschluss';
    case 'bestanden':
      return 'abschluss';
    case 'bestaetigt':
      return 'nachweis';
    case 'befreit':
      return 'befreit';
    default:
      return 'lesen';
  }
}

export const participantPath = {
  start: (id: string) => `/teilnahme/${id}`,
  read: (id: string, page?: number) => `/teilnahme/${id}/lesen${page ? `?seite=${page}` : ''}`,
  quiz: (id: string) => `/teilnahme/${id}/wissenscheck`,
  sign: (id: string) => `/teilnahme/${id}/abschluss`,
  verify: (code: string) => `/verify/${code}`,
};
