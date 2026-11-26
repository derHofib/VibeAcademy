import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Lock } from 'lucide-react';
import { ApiError, post } from '@/lib/api';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/card';
import { QuizOption } from '@/components/ui/quiz-option';
import { cn } from '@/lib/cn';
import { tp } from '@/i18n/participant';
import { useParticipantLang } from '@/i18n/lang';
import {
  participantKeys,
  participantPath,
  useInvitation,
  useProgress,
  useQuiz,
  type QuizAnswer,
  type QuizFinish,
} from '@/features/participant/api';
import { AskPanel } from '@/features/participant/AskPanel';
import { ChapterRail, type RailStep } from '@/features/participant/ChapterRail';
import { firstOpenQuestion, optionState, quizRingState } from '@/features/participant/quizLogic';
import { ErrorScreen, LoadingScreen } from '@/features/participant/ScreenStates';
import { TocList } from '@/features/participant/TocList';
import { useViewerZoom } from '@/features/participant/useViewerZoom';
import { ViewerShell, type ViewerRing, type ViewerStatus } from '@/features/participant/ViewerShell';
import { VIEWER_DESKTOP_QUERY, pageFraction, parseContact } from '@/features/participant/viewerModel';

type Result = { kind: 'passed'; correct?: number; total?: number } | { kind: 'failed'; finish: QuizFinish } | { kind: 'locked' };

/** Wissenscheck (Screens 5f, 5g, 5j): eine Frage je Ansicht, sofortiges Feedback, Ergebnis. */
export default function QuizPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const desktop = useMediaQuery(VIEWER_DESKTOP_QUERY);
  const inv = useInvitation(id);
  useParticipantLang(inv.data?.sprache);
  const progress = useProgress(id);
  const quiz = useQuiz(id);
  const [zoom, setZoom] = useViewerZoom();
  const [tocOpen, setTocOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const [local, setLocal] = useState<Record<string, QuizAnswer>>({});
  const [pending, setPending] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState<Result | null>(null);

  const attempt = quiz.data?.attempt;
  const questions = useMemo(
    () => (attempt?.questions ?? []).map((q) => ({ ...q, answer: q.answer ?? local[q.id] })),
    [attempt, local],
  );
  // Neuer Versuch → bei der ersten offenen Frage beginnen
  useEffect(() => {
    if (attempt) setIdx(firstOpenQuestion(attempt.questions));
  }, [attempt]);

  const notRequired = quiz.data?.required === false;
  useEffect(() => {
    if (notRequired) navigate(participantPath.sign(id), { replace: true });
  }, [notRequired, id, navigate]);

  const contact = useMemo(() => parseContact(inv.data?.training.ansprechpartner), [inv.data?.training.ansprechpartner]);

  if (quiz.isError) {
    const e = quiz.error;
    const readFirst = e instanceof ApiError && e.code === 'lesen_offen';
    return (
      <ErrorScreen
        title={readFirst ? tp.quiz.readFirstTitle : undefined}
        message={readFirst ? tp.quiz.readFirstText : e.message}
        action={<Button onClick={() => navigate(participantPath.read(id))}>{tp.quiz.toReading}</Button>}
      />
    );
  }
  if (inv.isError) return <ErrorScreen message={inv.error.message} />;
  const start = inv.data;
  const data = quiz.data;
  if (!start || !data || !progress.data || notRequired) return <LoadingScreen />;

  const pages = progress.data.pages;
  const doneCount = pages.filter((p) => p.fulfilled).length;
  const result: Result | null =
    finished ?? (data.passed ? { kind: 'passed' } : data.locked ? { kind: 'locked' } : null);

  const q = questions[idx];
  const total = questions.length;
  const answered = !!q?.answer;

  const pick = async (option: number) => {
    if (!q || !attempt || q.answer || pending !== null) return;
    setPending(option);
    setError(null);
    try {
      const r = await post<{ isCorrect: boolean; correct: number; explanation: string | null }>(`/me/invitations/${id}/quiz/answers`, {
        attemptId: attempt.id,
        questionId: q.id,
        option,
      });
      setLocal((m) => ({ ...m, [q.id]: { option, correct: r.correct, isCorrect: r.isCorrect, explanation: r.explanation } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : tp.common.errorTitle);
    } finally {
      setPending(null);
    }
  };

  const finish = async () => {
    if (!attempt || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await post<QuizFinish>(`/me/invitations/${id}/quiz/finish`, { attemptId: attempt.id });
      setFinished(r.passed ? { kind: 'passed', correct: r.correct, total: r.total } : r.locked ? { kind: 'locked' } : { kind: 'failed', finish: r });
      void qc.invalidateQueries({ queryKey: participantKeys.invitation(id) });
      void qc.invalidateQueries({ queryKey: participantKeys.signature(id) });
    } catch (e) {
      setError(e instanceof Error ? e.message : tp.common.errorTitle);
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    setFinished(null);
    setLocal({});
    setError(null);
    await qc.invalidateQueries({ queryKey: participantKeys.quiz(id) });
  };

  let ring: ViewerRing | null;
  let status: ViewerStatus;
  if (result?.kind === 'passed') {
    ring = { state: 'done', label: tp.quiz.ring.sign, onClick: () => navigate(participantPath.sign(id)) };
    status = { text: tp.quiz.status.passed, tone: 'success' };
  } else if (result?.kind === 'failed') {
    ring = { state: 'ready', label: tp.quiz.ring.retry, onClick: () => void retry() };
    status = { text: tp.quiz.status.failed, tone: 'warn' };
  } else if (result?.kind === 'locked') {
    ring = null;
    status = { text: tp.quiz.status.locked, tone: 'warn' };
  } else {
    ring = {
      state: quizRingState(answered),
      progress: total ? (idx + (answered ? 1 : 0)) / total : 0,
      label: answered ? (idx === total - 1 ? tp.quiz.ring.finish : tp.quiz.ring.next) : tp.quiz.status.pick,
      onClick: () => {
        if (!answered) return;
        if (idx < total - 1) setIdx(idx + 1);
        else void finish();
      },
    };
    status = busy ? { text: tp.quiz.status.saving, tone: 'muted' } : { text: answered ? tp.quiz.status.next : tp.quiz.status.pick, tone: 'accent' };
  }

  const hasQuiz = true;
  const passedNow = result?.kind === 'passed';
  const quizStep: RailStep = passedNow ? 'passed' : 'unlocked';
  const signStep: RailStep = start.status === 'bestaetigt' ? 'passed' : passedNow ? 'unlocked' : 'locked';
  const fs = (px: number) => ({ fontSize: `${Math.round(px * zoom * 10) / 10}px` });

  let content;
  if (result) {
    const passed = result.kind === 'passed';
    content = (
      <div className="flex flex-col items-center gap-3.5 py-6 md:gap-4 md:py-10" aria-live="polite">
        <div
          aria-hidden="true"
          className={cn('flex size-[84px] items-center justify-center rounded-full md:size-24', passed ? 'bg-success-soft text-success' : 'bg-warn-soft text-warn-strong')}
        >
          {passed ? <Check className="size-10" strokeWidth={3} /> : result.kind === 'locked' ? <Lock className="size-9" /> : <span className="font-heading text-[40px] font-bold">!</span>}
        </div>
        <h2 className="font-heading text-[24px] font-bold text-ink md:text-[30px]">
          {passed ? tp.quiz.passedTitle : result.kind === 'locked' ? tp.quiz.lockedTitle : tp.quiz.failedTitle}
        </h2>
        <p className="max-w-[290px] text-[15px] leading-[1.55] text-ink-2 md:max-w-[420px] md:text-[16px]">
          {result.kind === 'passed'
            ? result.correct !== undefined && result.total !== undefined
              ? tp.quiz.passedText(result.correct, result.total)
              : tp.quiz.passedTextShort
            : result.kind === 'locked'
              ? tp.quiz.lockedText
              : tp.quiz.failedText(result.finish.correct, result.finish.total, data.passPct ?? 80, result.finish.attemptsLeft)}
        </p>
        {result.kind === 'failed' && (
          <Button variant="soft" onClick={() => void retry()} className="mt-1">
            {tp.quiz.ring.retry}
          </Button>
        )}
      </div>
    );
  } else if (q && attempt) {
    content = (
      <>
        <div className="flex items-center justify-between gap-3">
          <span className="rounded-pill bg-accent-soft px-2.5 py-[5px] text-[12px] font-semibold text-accent-text md:px-3 md:py-1.5 md:text-[13px]">
            {tp.quiz.badge}
          </span>
          <span className="text-[12px] text-muted md:text-[13px]">{tp.quiz.meta(idx + 1, total, attempt.attemptNo)}</span>
        </div>
        <h2 id="frage-text" className="font-heading leading-[1.3] font-bold text-ink" style={fs(desktop ? 26 : 21)}>
          {q.text}
        </h2>
        <div role="group" aria-labelledby="frage-text" className="flex flex-col gap-2.5 md:gap-3">
          {q.options.map((o, i) => (
            <QuizOption
              key={i}
              state={optionState(i, q.answer, pending)}
              picked={q.answer?.option === i}
              onClick={() => void pick(i)}
              style={fs(desktop ? 16 : 15)}
              className={cn(desktop && 'min-h-14 rounded-[20px] px-5 py-4')}
            >
              {o}
            </QuizOption>
          ))}
        </div>
        <div aria-live="polite">
          {q.answer && (
            <Panel tone={q.answer.isCorrect ? 'success' : 'warn'} className="rounded-[18px] md:rounded-[20px]" style={fs(desktop ? 15 : 14)}>
              <strong>{q.answer.isCorrect ? tp.quiz.right : tp.quiz.wrong}</strong> {q.answer.explanation}
            </Panel>
          )}
        </div>
        {error && (
          <p role="alert" className="text-[13.5px] font-medium text-danger-text">
            {error}
          </p>
        )}
      </>
    );
  } else {
    content = <p className="text-[15px] text-ink-2">{tp.quiz.noQuestions}</p>;
  }

  return (
    <ViewerShell
      desktop={desktop}
      trainingTitle={start.training.titel}
      kicker={start.training.titel}
      title={result ? tp.quiz.resultTitle : tp.quiz.title}
      desktopSub={result ? tp.quiz.resultTitle : tp.quiz.title}
      overall={pages.length ? doneCount / pages.length : 0}
      segments={pages.map(pageFraction)}
      doneCount={doneCount}
      status={status}
      ring={ring}
      onClose={() => navigate(participantPath.start(id))}
      onBack={() => {
        if (!result && idx > 0) setIdx(idx - 1);
        else navigate(participantPath.read(id, pages[pages.length - 1]?.pageNo));
      }}
      tocOpen={tocOpen}
      onTocOpenChange={(o) => {
        setTocOpen(o);
        if (o) setAskOpen(false);
      }}
      toc={<TocList start={start} pages={pages} current={null} onGo={(n) => navigate(participantPath.read(id, n))} desktop={desktop} />}
      askOpen={askOpen}
      onAskOpenChange={(o) => {
        setAskOpen(o);
        if (o) setTocOpen(false);
      }}
      askTitle={tp.reader.ask.title(result ? tp.quiz.title : tp.quiz.questionRef(idx + 1))}
      ask={
        <AskPanel
          contact={contact}
          trainingTitle={start.training.titel}
          refLabel={result ? tp.quiz.title : tp.quiz.questionRef(idx + 1)}
          desktop={desktop}
        />
      }
      zoom={zoom}
      onZoomChange={setZoom}
      rail={
        desktop ? (
          <ChapterRail
            start={start}
            pages={pages}
            currentPage={null}
            quiz={hasQuiz ? quizStep : null}
            sign={signStep}
            active="quiz"
            onGoPage={(n) => navigate(participantPath.read(id, n))}
            onQuiz={() => undefined}
            onSign={() => navigate(participantPath.sign(id))}
          />
        ) : undefined
      }
      cardLabel={result ? tp.quiz.resultTitle : tp.quiz.title}
      centerCard={!!result}
    >
      {content}
    </ViewerShell>
  );
}
