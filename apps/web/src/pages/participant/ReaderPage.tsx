import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { MonitorSmartphone } from 'lucide-react';
import { post } from '@/lib/api';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { Button } from '@/components/ui/button';
import { tp } from '@/i18n/participant';
import {
  participantKeys,
  participantPath,
  useInvitation,
  type HeartbeatBody,
  type HeartbeatResponse,
  type ProgressSummary,
  type SessionStart,
} from '@/features/participant/api';
import { AskPanel } from '@/features/participant/AskPanel';
import { ChapterRail, type RailStep } from '@/features/participant/ChapterRail';
import { PdfPage } from '@/features/participant/PdfPage';
import { ErrorScreen, LoadingScreen } from '@/features/participant/ScreenStates';
import { TocList } from '@/features/participant/TocList';
import { useReadingTracker } from '@/features/participant/useReadingTracker';
import { useViewerZoom } from '@/features/participant/useViewerZoom';
import { ViewerShell, type ViewerStatus } from '@/features/participant/ViewerShell';
import { VIEWER_DESKTOP_QUERY, chapterLabel, chapterOf, pageFraction, pageTitle, parseContact, resumePage } from '@/features/participant/viewerModel';

const sendHeartbeat = (sid: string, body: HeartbeatBody) => post<HeartbeatResponse>(`/me/reading-sessions/${sid}/heartbeat`, body);

/** Lesen (Screens 5b–5d, 5h, 5i): Seite für Seite mit Live-Erfassung. */
export default function ReaderPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const desktop = useMediaQuery(VIEWER_DESKTOP_QUERY);
  const inv = useInvitation(id);

  const [session, setSession] = useState<SessionStart | null>(null);
  const [summary, setSummary] = useState<ProgressSummary | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [page, setPage] = useState<number | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [zoom, setZoom] = useViewerZoom();
  const [card, setCard] = useState<HTMLElement | null>(null);
  const requestedPage = Number(params.get('seite')) || null;
  const requestedRef = useRef(requestedPage);

  const startSession = useCallback(async () => {
    setSessionError(null);
    try {
      const s = await post<SessionStart>(`/me/invitations/${id}/sessions`);
      setSession(s);
      setSummary(s);
      setPage((cur) => {
        if (cur) return cur;
        const want = requestedRef.current;
        if (want && s.pages.some((p) => p.pageNo === want && p.allowed)) return want;
        return resumePage(s.pages);
      });
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : tp.reader.sessionError);
    }
  }, [id]);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void startSession();
  }, [startSession]);

  // Seite in der Adresse halten (Neuladen, Teilen innerhalb der Sitzung)
  useEffect(() => {
    if (page && Number(params.get('seite')) !== page) setParams({ seite: String(page) }, { replace: true });
  }, [page, params, setParams]);

  const onResponse = useCallback((r: HeartbeatResponse) => setSummary(r), []);
  // Mobil pausiert die Erfassung, solange ein Sheet die Seite verdeckt (5d)
  const paused = !desktop && (tocOpen || askOpen);
  const tracker = useReadingTracker({
    sessionId: session?.sessionId ?? null,
    page: page ?? 1,
    target: card,
    paused,
    intervalMs: session?.heartbeatIntervalMs ?? 5000,
    send: sendHeartbeat,
    onResponse,
  });

  const complete = !!summary?.complete;
  // Nach dem Lesen: Einladungsstatus (gelesen/bestanden) neu laden
  useEffect(() => {
    if (complete) void qc.invalidateQueries({ queryKey: participantKeys.invitation(id) });
  }, [complete, id, qc]);

  const start = inv.data;
  const contact = useMemo(() => parseContact(start?.training.ansprechpartner), [start?.training.ansprechpartner]);

  if (inv.isError) return <ErrorScreen message={inv.error.message} />;
  if (sessionError) {
    return (
      <ErrorScreen
        message={sessionError}
        action={<Button onClick={() => void startSession()}>{tp.common.retry}</Button>}
      />
    );
  }
  if (!start || !summary || !page) return <LoadingScreen />;

  const total = summary.pages.length;
  const cur = summary.pages.find((p) => p.pageNo === page) ?? summary.pages[0]!;
  const hasQuiz = start.totals.questions > 0;
  const isLast = page === summary.pages[total - 1]?.pageNo;
  const tracking = tracker.phase === 'tracking';

  // Countdown: Serverwert ist maßgeblich, zwischen zwei Heartbeats lokal fortgeschrieben
  let dwell = cur.dwellMs;
  const last = tracker.lastResponse;
  if (!cur.fulfilled && tracking && last?.current?.pageNo === page && tracker.lastResponseAt !== null) {
    dwell += Math.min(5000, Math.max(0, tracker.nowMs - tracker.lastResponseAt));
  }
  const remaining = cur.fulfilled ? 0 : Math.max(0, cur.tMinMs - dwell);
  const seconds = cur.fulfilled ? 0 : Math.max(1, Math.ceil(remaining / 1000));
  const fraction = cur.fulfilled ? 1 : Math.min(0.97, cur.tMinMs ? dwell / cur.tMinMs : 0);
  const segments = summary.pages.map((p) => (p.pageNo === page ? fraction : pageFraction(p)));
  const doneCount = summary.pages.filter((p) => p.fulfilled).length;

  const chapter = chapterOf(start.chapters, page);
  const chLabel = chapter ? chapterLabel(chapter) : null;

  const goTo = (n: number) => {
    setTocOpen(false);
    setPage(n);
    tracker.markInput();
  };

  const advance = () => {
    if (!cur.fulfilled) return;
    if (complete && isLast) {
      navigate(hasQuiz ? participantPath.quiz(id) : participantPath.sign(id));
      return;
    }
    const next = summary.pages.find((p) => p.pageNo > page && p.allowed) ?? summary.pages.find((p) => !p.fulfilled && p.allowed);
    if (next) goTo(next.pageNo);
    else if (complete) navigate(hasQuiz ? participantPath.quiz(id) : participantPath.sign(id));
  };

  const ringLabel = !cur.fulfilled
    ? tp.reader.ring.waiting(seconds)
    : complete && isLast
      ? hasQuiz
        ? tp.reader.ring.toQuiz
        : tp.reader.ring.toSign
      : tp.reader.ring.nextPage;

  let status: ViewerStatus | null;
  switch (tracker.phase) {
    case 'superseded':
      status = null;
      break;
    case 'starting':
      status = { text: tp.reader.status.starting, tone: 'muted' };
      break;
    case 'offline':
      status = { text: tp.reader.status.offline, tone: 'warn' };
      break;
    default:
      if (cur.fulfilled) {
        status = complete
          ? { text: hasQuiz ? tp.reader.status.allCaptured : tp.reader.status.allCapturedNoQuiz, tone: 'success' }
          : { text: desktop ? tp.reader.status.capturedDesktop(page) : tp.reader.status.captured, tone: 'success' };
      } else if (tracker.phase === 'paused-sheet') {
        status = { text: tocOpen ? tp.reader.status.pausedToc : tp.reader.status.pausedSheet, tone: 'warn' };
      } else if (tracker.phase === 'paused-window') {
        status = { text: tp.reader.status.pausedWindow, tone: 'warn' };
      } else if (tracker.phase === 'idle') {
        status = { text: tp.reader.status.idle, tone: 'warn' };
      } else if (tracker.phase === 'not-visible') {
        status = { text: tp.reader.status.pausedNotVisible, tone: 'warn' };
      } else {
        status = {
          text: desktop ? tp.reader.status.capturingSeconds(seconds) : tp.reader.status.capturing,
          tone: 'accent',
          pulse: true,
        };
      }
  }

  const st = start.status;
  const quizStep: RailStep | null = hasQuiz ? (['bestanden', 'bestaetigt'].includes(st) ? 'passed' : complete ? 'unlocked' : 'locked') : null;
  const signStep: RailStep =
    st === 'bestaetigt' ? 'passed' : st === 'bestanden' || (complete && !hasQuiz) ? 'unlocked' : 'locked';

  const overlay =
    tracker.phase === 'superseded' ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4">
        <div role="alertdialog" aria-labelledby="abgeloest-titel" aria-describedby="abgeloest-text" className="w-full max-w-[420px] rounded-card-lg bg-surface p-6 text-center shadow-float">
          <div aria-hidden="true" className="mx-auto mb-3 flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent-text">
            <MonitorSmartphone className="size-6" />
          </div>
          <h2 id="abgeloest-titel" className="font-heading text-[19px] font-bold text-ink">
            {tp.reader.superseded.title}
          </h2>
          <p id="abgeloest-text" className="mt-2 text-[14.5px] leading-[1.55] text-ink-2">
            {tp.reader.superseded.text}
          </p>
          <Button className="mt-5" size="lg" fullWidth autoFocus onClick={() => void startSession()}>
            {tp.reader.superseded.action}
          </Button>
        </div>
      </div>
    ) : null;

  return (
    <ViewerShell
      desktop={desktop}
      trainingTitle={start.training.titel}
      kicker={chLabel ? tp.reader.chapterOf(chLabel.no, start.chapters.length) : start.training.titel}
      title={chLabel ? chLabel.title : tp.reader.pageOf(page, total)}
      desktopSub={chLabel ? `${tp.reader.chapter(chLabel.no)} · ${chLabel.title}` : tp.reader.pageOf(page, total)}
      overall={total ? doneCount / total : 0}
      segments={segments}
      currentSegment={summary.pages.findIndex((p) => p.pageNo === page)}
      doneCount={doneCount}
      status={status}
      ring={{
        state: cur.fulfilled ? 'ready' : 'counting',
        progress: fraction,
        seconds,
        label: ringLabel,
        onClick: advance,
      }}
      onClose={() => navigate(participantPath.start(id))}
      onBack={() => {
        const prev = [...summary.pages].reverse().find((p) => p.pageNo < page && p.allowed);
        if (prev) goTo(prev.pageNo);
      }}
      backDisabled={!summary.pages.some((p) => p.pageNo < page && p.allowed)}
      tocOpen={tocOpen}
      onTocOpenChange={(o) => {
        setTocOpen(o);
        if (o) setAskOpen(false);
      }}
      tocDescription={tp.reader.toc.pausedHint}
      toc={<TocList start={start} pages={summary.pages} current={page} onGo={goTo} desktop={desktop} />}
      askOpen={askOpen}
      onAskOpenChange={(o) => {
        setAskOpen(o);
        if (o) setTocOpen(false);
      }}
      askTitle={tp.reader.ask.title(tp.reader.pageLabel(page))}
      ask={<AskPanel contact={contact} trainingTitle={start.training.titel} refLabel={tp.reader.pageLabel(page)} desktop={desktop} />}
      zoom={zoom}
      onZoomChange={setZoom}
      rail={
        desktop ? (
          <ChapterRail
            start={start}
            pages={summary.pages}
            currentPage={page}
            quiz={quizStep}
            sign={signStep}
            active="read"
            onGoPage={goTo}
            onQuiz={() => navigate(participantPath.quiz(id))}
            onSign={() => navigate(participantPath.sign(id))}
          />
        ) : undefined
      }
      cardLabel={tp.reader.pageLabel(page)}
      cardRef={setCard}
      overlay={overlay}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="rounded-pill bg-accent-soft px-2.5 py-[5px] text-[12px] font-semibold text-accent-text md:px-3 md:py-1.5 md:text-[13px]">
          {desktop
            ? `${chLabel ? `${tp.reader.chapter(chLabel.no)} · ` : ''}${tp.reader.pageOf(page, total)}`
            : chLabel
              ? tp.reader.chapter(chLabel.no)
              : pageTitle(start, page)}
        </span>
        {!desktop && <span className="text-[12px] text-muted">{tp.reader.pageOf(page, total)}</span>}
      </div>
      <PdfPage invitationId={id} pageNo={page} zoom={zoom} />
    </ViewerShell>
  );
}

