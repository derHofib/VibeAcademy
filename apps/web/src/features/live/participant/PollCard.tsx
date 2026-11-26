import { useState } from 'react';
import { QuizOption, type QuizOptionState } from '@/components/ui';
import { cn } from '@/lib/cn';
import { tl } from '@/i18n/live';
import type { MyPollAnswer, PollMode } from '../api';

export interface PollView {
  id: string;
  question: string;
  options: string[];
  mode: PollMode;
  myAnswer: MyPollAnswer | null;
}

/** Ergebnis einer eigenen Antwort (Rückgabe von POST /polls/:id/answers oder aus dem Snapshot). */
export type AnswerFeedback =
  | { mode: 'wissenscheck'; option: number; correct: boolean; correctOption: number; explanation: string | null }
  | { mode: 'stimmungsbild'; option: number };

export function feedbackFrom(poll: PollView, local: AnswerFeedback | null): AnswerFeedback | null {
  if (local && poll.mode === local.mode) return local;
  const a = poll.myAnswer;
  if (!a) return null;
  if ('option' in a) return { mode: 'wissenscheck', option: a.option, correct: a.correct, correctOption: a.correctOption, explanation: a.explanation };
  return { mode: 'stimmungsbild', option: -1 };
}

export function optionState(fb: AnswerFeedback | null, k: number): QuizOptionState {
  if (!fb) return 'idle';
  if (fb.mode === 'wissenscheck') {
    if (k === fb.correctOption) return 'correct';
    if (k === fb.option) return 'wrong';
    return 'dimmed';
  }
  return k === fb.option ? 'selected' : 'dimmed';
}

/** Kontrollfrage vom Organisator (13b/13h): erscheint live, nach der Antwort Feedback mit Erklärung. */
export function PollCard({
  poll,
  onAnswer,
  pending,
  error,
  className,
}: {
  poll: PollView;
  onAnswer: (option: number) => Promise<AnswerFeedback | null>;
  pending: boolean;
  error?: string | null;
  className?: string;
}) {
  const [local, setLocal] = useState<AnswerFeedback | null>(null);
  const fb = feedbackFrom(poll, local);
  const t = tl.tn.poll;
  const headingId = `kontrollfrage-${poll.id}`;

  return (
    <section
      aria-labelledby={headingId}
      className={cn('flex flex-col gap-2.5 rounded-[24px] bg-accent-soft px-4 pt-4 pb-3.5 shadow-[inset_0_0_0_2px_var(--color-accent-ring)]', className)}
      data-testid="poll-card"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-[12px] font-bold tracking-[0.03em] text-accent-text uppercase">{t.kicker}</span>
        <span className="shrink-0 rounded-pill bg-surface px-2.5 py-1 text-[11.5px] font-semibold text-accent-text">
          {poll.mode === 'wissenscheck' ? t.wissenscheck : t.stimmungsbild}
        </span>
      </div>
      <h2 id={headingId} className="font-heading text-[16.5px] leading-[1.35] font-bold text-ink">
        {poll.question}
      </h2>
      <div className="flex flex-col gap-2" role="group" aria-labelledby={headingId}>
        {poll.options.map((o, k) => (
          <QuizOption
            key={k}
            state={optionState(fb, k)}
            picked={fb?.mode === 'wissenscheck' && fb.option === k}
            disabled={pending}
            aria-disabled={fb ? true : undefined}
            className="min-h-[46px] rounded-[16px] py-3 text-[14.5px]"
            onClick={async () => {
              if (fb || pending) return;
              const r = await onAnswer(k);
              if (r) setLocal(r);
            }}
          >
            {o}
          </QuizOption>
        ))}
      </div>
      <div aria-live="polite">
        {fb?.mode === 'wissenscheck' && (
          <p className={cn('text-[13.5px] leading-[1.45]', fb.correct ? 'text-success-text-strong' : 'text-warn-text-strong')}>
            <strong>{fb.correct ? t.right : t.wrong}</strong> {fb.explanation ? `${fb.explanation} ` : ''}
            {t.saved}
          </p>
        )}
        {fb?.mode === 'stimmungsbild' && <p className="text-[13.5px] leading-[1.45] text-accent-text-strong">{t.moodSaved}</p>}
        {error && (
          <p role="alert" className="text-[13.5px] font-medium text-danger-text">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
