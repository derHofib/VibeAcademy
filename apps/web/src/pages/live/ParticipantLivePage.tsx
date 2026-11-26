import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarX2, CloudOff } from 'lucide-react';
import type { ManualCheckoutReason } from '@sn/shared';
import { ApiError, del, post } from '@/lib/api';
import { Button, Card, EmptyState, Panel, StatusChip } from '@/components/ui';
import { tl } from '@/i18n/live';
import { ErrorScreen, LoadingScreen } from '@/features/participant/ScreenStates';
import {
  fetchParticipantSnapshot,
  liveKeys,
  retryUnlessClientError,
  type ParticipantQuestion,
  type ParticipantSnapshot,
  type ParticipantState,
  type ScanResponse,
} from '@/features/live/api';
import { useLiveChannel, useServerNow } from '@/features/live/hooks';
import { POLL_FALLBACK_MS } from '@/features/live/liveReducer';
import { browserStore, enqueueScan, flushScans, readQueue } from '@/features/live/offlineQueue';
import { checkScannedToken } from '@/features/live/scanLogic';
import { hm, liveDurationSeconds } from '@/features/live/time';
import { ScanView } from '@/features/live/participant/ScanView';
import { PollCard, type AnswerFeedback } from '@/features/live/participant/PollCard';
import { AskSheet, QuestionsCard } from '@/features/live/participant/QuestionsCard';
import { ManualCheckoutSheet } from '@/features/live/participant/ManualCheckoutSheet';
import {
  ClockCard,
  ConfirmForm,
  ConfirmedView,
  LandingView,
  LiveHeader,
  NotePanel,
  PendingPolls,
  SummaryCard,
} from '@/features/live/participant/views';

const t = tl.tn;

const errText = (e: unknown) =>
  e instanceof ApiError ? e.message : e instanceof Error && e.message ? e.message : 'Etwas ist schiefgelaufen. Bitte erneut versuchen.';

type AnswerResponse =
  | { mode: 'wissenscheck'; option: number; correct: boolean; correctOption: number; explanation: string | null }
  | { mode: 'stimmungsbild'; option: number };

/** Teilnehmersicht Live/Präsenz (13a–13i): einchecken, Uhr, Kontrollfragen, Fragen, auschecken, bestätigen. */
export default function ParticipantLivePage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const qc = useQueryClient();
  const key = liveKeys.participant(id);
  const modeRef = useRef<string>('connecting');
  const snap = useQuery({
    queryKey: key,
    queryFn: () => fetchParticipantSnapshot(id),
    retry: retryUnlessClientError,
    refetchInterval: () => (modeRef.current === 'polling' ? POLL_FALLBACK_MS : false),
  });
  const mode = useLiveChannel({ runId: snap.data?.run.id, queryKey: key, asParticipant: true, enabled: !!snap.data });
  modeRef.current = mode;
  const nowMs = useServerNow(snap.data?.run.serverTime);

  const [overlay, setOverlay] = useState<'start' | 'end' | null>(null);
  const [scanErr, setScanErr] = useState<string | null>(null);
  const [recognized, setRecognized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>((location.state as { notice?: string } | null)?.notice ?? null);
  const [pendingScans, setPendingScans] = useState(() => readQueue(browserStore()).length);
  const [askOpen, setAskOpen] = useState(false);
  const [askErr, setAskErr] = useState<string | null>(null);
  const [askBusy, setAskBusy] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualErr, setManualErr] = useState<string | null>(null);
  const [manualBusy, setManualBusy] = useState(false);
  const [votingId, setVotingId] = useState<string | null>(null);
  const [pollBusy, setPollBusy] = useState<string | null>(null);
  const [pollErr, setPollErr] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmErr, setConfirmErr] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');

  const applyState = useCallback(
    (st: ParticipantState) =>
      qc.setQueryData<ParticipantSnapshot>(liveKeys.participant(id), (prev) =>
        prev ? { ...prev, run: st.run, attendance: st.me } : prev,
      ),
    [qc, id],
  );
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: liveKeys.participant(id) }), [qc, id]);

  // Hinweise nach einigen Sekunden ausblenden
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Offline gespeicherte Scans übertragen (beim Öffnen und sobald wieder online)
  const flush = useCallback(async () => {
    const store = browserStore();
    if (!readQueue(store).length) return;
    const report = await flushScans(store, async (s) => {
      try {
        await post(s.kind === 'start' ? '/checkin' : '/checkout', { token: s.token, offline: true, deviceTime: s.deviceTime });
        return { result: 'ok' as const };
      } catch (e) {
        return e instanceof ApiError ? { result: 'rejected' as const, message: e.message } : { result: 'network' as const };
      }
    });
    setPendingScans(report.remaining.length);
    if (report.sent.length) {
      setNotice(t.scan.offlineSynced(report.sent.length));
      void refresh();
    } else if (report.rejected.length) setNotice(report.rejected[0]!.message);
  }, [refresh]);
  useEffect(() => {
    void flush();
    const on = () => void flush();
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, [flush]);

  // Neue Kontrollfrage ansagen
  const openPollId = snap.data?.polls.openPoll?.id ?? null;
  const openPollQ = snap.data?.polls.openPoll?.question ?? '';
  useEffect(() => {
    if (!openPollId) return;
    setAnnounce(t.poll.incoming(openPollQ));
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(150);
  }, [openPollId, openPollQ]);

  if (snap.isError) {
    const e = snap.error;
    const noSession = e instanceof ApiError && (e.status === 401 || e.status === 403);
    return <ErrorScreen title={t.errors.title} message={noSession ? t.errors.noSession : errText(e)} />;
  }
  if (!snap.data) return <LoadingScreen />;
  const { run, attendance: me, questions, polls } = snap.data;

  const closeScan = () => {
    setOverlay(null);
    setScanErr(null);
    setRecognized(false);
  };

  const handleScan = async (raw: string) => {
    if (!overlay || busy) return;
    const kind = overlay;
    const c = checkScannedToken(raw, kind, run.id);
    if (!c.ok) {
      setScanErr(c.message);
      return;
    }
    setScanErr(null);
    setRecognized(true);
    setBusy(true);
    const deviceTime = new Date().toISOString();
    const queue = () => {
      setPendingScans(enqueueScan(browserStore(), { kind, token: c.token, deviceTime, invitationId: id }).length);
      setNotice(t.scan.offlineQueued);
      closeScan();
    };
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        queue();
        return;
      }
      const res = await post<ScanResponse>(kind === 'start' ? '/checkin' : '/checkout', { token: c.token, deviceTime });
      applyState(res);
      setNotice(kind === 'start' ? (res.alreadyCheckedIn ? t.in.already : me.intervals.length ? t.in.rejoined : t.in.checkedInNow) : null);
      closeScan();
      void refresh();
    } catch (e) {
      if (e instanceof ApiError) {
        setScanErr(e.message);
        setRecognized(false);
      } else queue();
    } finally {
      setBusy(false);
    }
  };

  if (overlay) {
    return (
      <ScanView
        key={overlay}
        kind={overlay}
        onClose={closeScan}
        onDetected={(raw) => void handleScan(raw)}
        busy={busy}
        recognized={recognized}
        error={scanErr}
      />
    );
  }

  const answer = async (pollId: string, option: number): Promise<AnswerFeedback | null> => {
    setPollBusy(pollId);
    setPollErr(null);
    try {
      const r = await post<AnswerResponse>(`/polls/${pollId}/answers`, { option });
      void refresh();
      return r.mode === 'wissenscheck'
        ? { mode: 'wissenscheck', option: r.option, correct: r.correct, correctOption: r.correctOption, explanation: r.explanation }
        : { mode: 'stimmungsbild', option };
    } catch (e) {
      setPollErr(errText(e));
      return null;
    } finally {
      setPollBusy(null);
    }
  };

  const ask = async (text: string, anonymous: boolean) => {
    setAskBusy(true);
    setAskErr(null);
    try {
      await post(`/runs/${run.id}/questions`, { text, anonymous });
      setAskOpen(false);
      setNotice(t.ask.sent);
      void refresh();
      return true;
    } catch (e) {
      setAskErr(errText(e));
      return false;
    } finally {
      setAskBusy(false);
    }
  };

  const vote = async (q: ParticipantQuestion) => {
    setVotingId(q.id);
    try {
      if (q.voted) await del(`/questions/${q.id}/vote`);
      else await post(`/questions/${q.id}/vote`);
      await refresh();
    } catch (e) {
      setNotice(errText(e));
    } finally {
      setVotingId(null);
    }
  };

  const manualOut = async (reason: ManualCheckoutReason, note: string) => {
    setManualBusy(true);
    setManualErr(null);
    try {
      applyState(await post<ParticipantState>('/checkout/manual', { invitationId: id, reason, note }));
      setManualOpen(false);
      void refresh();
    } catch (e) {
      setManualErr(errText(e));
    } finally {
      setManualBusy(false);
    }
  };

  const confirm = async () => {
    if (!me.attendanceId) return;
    setConfirmBusy(true);
    setConfirmErr(null);
    try {
      applyState(await post<ParticipantState>(`/attendance/${me.attendanceId}/confirm`, { confirmed: true }));
      void qc.invalidateQueries({ queryKey: liveKeys.evidence(id) });
    } catch (e) {
      setConfirmErr(errText(e));
    } finally {
      setConfirmBusy(false);
    }
  };

  const ended = run.status === 'beendet';
  const attended = me.intervals.length > 0;
  const elapsed = liveDurationSeconds(me.intervals, run, nowMs);
  const view = me.confirmedAt ? 'done' : me.checkedIn ? 'in' : attended ? 'confirm' : ended ? 'missed' : 'landing';

  return (
    <div className="min-h-dvh bg-bg" data-live-mode={mode} data-view={view}>
      <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col gap-3 px-4 pt-3.5 md:max-w-[560px] md:pt-8">
        <div className="sr-only" aria-live="assertive">
          {announce}
        </div>
        {view !== 'confirm' && view !== 'done' && <LiveHeader run={run} />}
        {notice && (
          <Panel tone="accent" role="status" className="py-3 text-[14px] font-medium">
            {notice}
          </Panel>
        )}
        {mode === 'polling' && view === 'in' && (
          <p className="flex items-center gap-1.5 px-1 text-[12.5px] text-muted">
            <CloudOff aria-hidden="true" className="size-3.5" /> {tl.org.liveConnection.polling}
          </p>
        )}

        {view === 'landing' && <LandingView onScan={() => setOverlay('start')} pendingScans={pendingScans} />}

        {view === 'missed' && (
          <Card>
            <EmptyState icon={<CalendarX2 />} title={t.landing.endedNotAttended} description={t.landing.endedNotAttendedText} />
          </Card>
        )}

        {view === 'in' && (
          <>
            <main className="flex flex-1 flex-col gap-3">
              <ClockCard run={run} me={me} elapsed={elapsed} nowMs={nowMs} />
              {pendingScans > 0 && (
                <StatusChip tone="warn" size="md" icon={<CloudOff aria-hidden="true" />} className="w-fit">
                  {t.scan.offlinePending(pendingScans)}
                </StatusChip>
              )}
              {polls.openPoll && (
                <PollCard
                  key={polls.openPoll.id}
                  poll={polls.openPoll}
                  pending={pollBusy === polls.openPoll.id}
                  error={pollErr}
                  onAnswer={(o) => answer(polls.openPoll!.id, o)}
                />
              )}
              <QuestionsCard
                questions={questions}
                onAsk={() => {
                  setAskErr(null);
                  setAskOpen(true);
                }}
                onVote={(q) => void vote(q)}
                votingId={votingId}
                canInteract
              />
            </main>
            <footer className="sticky bottom-0 flex gap-2.5 bg-bg pt-2.5 pb-[max(20px,env(safe-area-inset-bottom))]">
              <Button
                variant="secondary"
                size="lg"
                className="h-[54px] flex-1 px-3 text-[14px]"
                onClick={() => {
                  setManualErr(null);
                  setManualOpen(true);
                }}
              >
                {t.in.manualOut}
              </Button>
              <Button size="lg" className="h-[54px] flex-[1.3] px-3 text-[15px]" onClick={() => setOverlay('end')}>
                {t.in.scanEnd}
              </Button>
            </footer>
            <AskSheet open={askOpen} onOpenChange={setAskOpen} onSend={ask} pending={askBusy} error={askErr} />
            <ManualCheckoutSheet
              key={manualOpen ? 'offen' : 'zu'}
              open={manualOpen}
              onOpenChange={setManualOpen}
              nowLabel={hm(nowMs)}
              onSubmit={(r, n) => void manualOut(r, n)}
              pending={manualBusy}
              error={manualErr}
            />
          </>
        )}

        {view === 'confirm' && (
          <>
            <header className="px-0.5 pt-0.5 pb-1">
              <p className="text-[12px] text-muted">{t.confirm.kicker}</p>
              <h1 className="mt-0.5 font-heading text-[21px] font-bold text-ink">{t.confirm.title}</h1>
            </header>
            <SummaryCard run={run} me={me} />
            <NotePanel me={me} />
            <PendingPolls polls={polls.pendingPolls} pendingId={pollBusy} onAnswer={answer} />
            {me.canConfirm && (
              <ConfirmForm
                confirmText={run.confirmText}
                onConfirm={() => void confirm()}
                pending={confirmBusy}
                error={confirmErr}
                footerExtra={
                  !ended ? (
                    <Button variant="ghost" fullWidth onClick={() => setOverlay('start')}>
                      {t.confirm.rejoin}
                    </Button>
                  ) : null
                }
              />
            )}
          </>
        )}

        {view === 'done' && <ConfirmedView run={run} me={me} invitationId={id} />}
      </div>
    </div>
  );
}
