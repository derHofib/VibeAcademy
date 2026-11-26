import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, get, patch, post } from '@/lib/api';
import {
  fetchOrganizerSnapshot,
  liveKeys,
  retryUnlessClientError,
  type AttendanceRow,
  type OrganizerSnapshot,
  type PollMode,
  type PoolQuestion,
  type QrCodeResponse,
  type QuestionStatus,
} from '../api';
import { useLiveChannel } from '../hooks';
import { POLL_FALLBACK_MS } from '../liveReducer';
import { qrRefetchDelayMs } from '../qrSchedule';

/** Organisator-Live-Daten: Snapshot (Anwesenheit, Fragen, Kontrollfragen) + SSE, Ausweichen auf Abfragen. */
export function useOrganizerLive(runId: string) {
  const key = liveKeys.organizer(runId);
  const modeRef = useRef<string>('connecting');
  const q = useQuery({
    queryKey: key,
    queryFn: () => fetchOrganizerSnapshot(runId),
    retry: retryUnlessClientError,
    refetchInterval: () => (modeRef.current === 'polling' ? POLL_FALLBACK_MS : false),
  });
  const mode = useLiveChannel({ runId, queryKey: key, enabled: !!q.data });
  modeRef.current = mode;
  return { ...q, mode };
}

/** Rotierender QR-Code: holt kurz nach jedem Slot-Wechsel den neuen Code; nach dem Ende nicht mehr. */
export function useRotatingQr(runId: string, kind: 'start' | 'end', enabled: boolean) {
  return useQuery({
    queryKey: liveKeys.qr(runId, kind),
    queryFn: () => get<QrCodeResponse>(`/runs/${runId}/qr?kind=${kind}`),
    enabled,
    retry: retryUnlessClientError,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: (query) => (query.state.data ? qrRefetchDelayMs(query.state.data.expiresInSeconds) : false),
    refetchIntervalInBackground: true,
  });
}

export function usePollPool(runId: string, enabled: boolean) {
  return useQuery({
    queryKey: liveKeys.pool(runId),
    queryFn: () => get<PoolQuestion[]>(`/runs/${runId}/poll-pool`),
    enabled,
    retry: retryUnlessClientError,
  });
}

/** Alle schreibenden Organisator-Aktionen; danach wird der Snapshot neu geladen (SSE liefert es meist schon vorher). */
export function useOrganizerActions(runId: string) {
  const qc = useQueryClient();
  const key = liveKeys.organizer(runId);
  const done = () => Promise.all([qc.invalidateQueries({ queryKey: key }), qc.invalidateQueries({ queryKey: liveKeys.termine })]);
  const patchRow = (row: AttendanceRow | undefined) => {
    if (!row) return;
    qc.setQueryData<OrganizerSnapshot>(key, (prev) =>
      prev
        ? { ...prev, attendance: { ...prev.attendance, rows: prev.attendance.rows.map((r) => (r.personId === row.personId ? row : r)) } }
        : prev,
    );
  };
  const m = <V, R>(fn: (v: V) => Promise<R>, after?: (r: R) => void) =>
    useMutation({ mutationFn: fn, onSuccess: async (r) => { after?.(r); await done(); } });

  return {
    start: m(() => post(`/runs/${runId}/start`)),
    end: m(() => post<{ status: string; endedAt: string; closedWithOfficialEnd: number; notified: number }>(`/runs/${runId}/end`)),
    staffScan: m((v: { personId: string; direction: 'in' | 'out'; method: 'kiosk' | 'trainer' }) =>
      post(`/runs/${runId}/attendance/${v.direction === 'in' ? 'checkin' : 'checkout'}`, { personId: v.personId, method: v.method }),
    ),
    review: m(
      (v: { attendanceId: string; decision: 'akzeptiert' | 'rueckfrage'; message?: string }) =>
        post<AttendanceRow>(`/attendance/${v.attendanceId}/review`, { decision: v.decision, message: v.message ?? null }),
      patchRow,
    ),
    release: m(
      (v: { attendanceId: string; decision: 'freigegeben' | 'abgelehnt' }) =>
        post<AttendanceRow>(`/attendance/${v.attendanceId}/release`, { decision: v.decision }),
      patchRow,
    ),
    kioskConfirm: m(
      (v: { attendanceId: string; signaturePng: string }) =>
        post<AttendanceRow>(`/attendance/${v.attendanceId}/kiosk-confirm`, { signaturePng: v.signaturePng }),
      patchRow,
    ),
    countersign: m((v: { password: string }) =>
      post<{ countersignedAt: string; countersignName: string; evidenceQueued: number }>(`/runs/${runId}/countersign`, v),
    ),
    questionStatus: m((v: { id: string; status: QuestionStatus }) => patch(`/questions/${v.id}`, { status: v.status })),
    createPoll: m(
      (v: { mode: PollMode; sourceQuestionId?: string; question?: string; options?: string[]; correct?: number | null; explanation?: string | null }) =>
        post(`/runs/${runId}/polls`, v),
      () => void qc.invalidateQueries({ queryKey: liveKeys.pool(runId) }),
    ),
    closePoll: m((pollId: string) => post(`/polls/${pollId}/close`)),
    addParticipants: m((v: { personIds: string[]; orgUnitIds: string[]; sendMail: boolean }) =>
      post<{ created: number; skipped: number; mailsQueued: number; withoutEmail: string[] }>(`/runs/${runId}/participants`, v),
    ),
  };
}

export function isEndedError(e: unknown) {
  return e instanceof ApiError && e.code === 'beendet';
}
