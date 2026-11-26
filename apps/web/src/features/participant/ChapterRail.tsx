import type { ReactNode } from 'react';
import { Check, Signature } from 'lucide-react';
import { ProgressRing } from '@/components/ui/progress';
import { cn } from '@/lib/cn';
import { tp } from '@/i18n/participant';
import type { InvitationStart, PageProgress } from './api';
import { chapterLabel, pageFraction } from './viewerModel';

export type RailStep = 'locked' | 'unlocked' | 'passed';

export interface ChapterRailProps {
  start: InvitationStart;
  pages: PageProgress[];
  /** Aktuelle Seite (null im Wissenscheck) */
  currentPage: number | null;
  quiz: RailStep | null;
  sign: RailStep;
  active: 'read' | 'quiz' | 'sign';
  onGoPage: (pageNo: number) => void;
  onQuiz: () => void;
  onSign: () => void;
}

/** Kapitel-Leiste (Desktop, 5c): Ring je Kapitel mit Kurzname, darunter Quiz und Abschluss. */
export function ChapterRail({ start, pages, currentPage, quiz, sign, active, onGoPage, onQuiz, onSign }: ChapterRailProps) {
  const byNo = new Map(pages.map((p) => [p.pageNo, p]));
  return (
    <nav
      aria-label={tp.reader.rail.label}
      className="sticky top-5 flex w-[88px] shrink-0 flex-col items-center gap-1.5 rounded-[44px] bg-surface py-4 shadow-[0_1px_2px_rgba(29,36,51,0.04),0_10px_28px_rgba(29,36,51,0.07)]"
    >
      {start.chapters.map((c) => {
        const l = chapterLabel(c);
        const ps = start.pages.filter((p) => p.pageNo >= c.from_page && p.pageNo <= c.to_page).map((p) => byNo.get(p.pageNo)).filter(Boolean) as PageProgress[];
        const frac = ps.length ? ps.reduce((s, p) => s + pageFraction(p), 0) / ps.length : 0;
        const complete = ps.length > 0 && ps.every((p) => p.fulfilled);
        const target = ps.find((p) => !p.fulfilled && p.allowed) ?? ps.find((p) => p.allowed);
        const reachable = !!target;
        const isActive = active === 'read' && currentPage !== null && currentPage >= c.from_page && currentPage <= c.to_page;
        return (
          <button
            key={c.idx}
            type="button"
            disabled={!reachable}
            aria-current={isActive ? 'true' : undefined}
            onClick={() => target && onGoPage(target.pageNo)}
            className={cn(
              'flex w-[76px] cursor-pointer flex-col items-center gap-1 rounded-[26px] pt-2 pb-1.5 disabled:cursor-not-allowed',
              isActive ? 'bg-accent-soft text-accent-text' : complete ? 'text-success-text hover:bg-bg' : reachable ? 'text-ink hover:bg-bg' : 'text-muted',
            )}
          >
            <ProgressRing value={frac} size={48} stroke={4} tone={complete ? 'success' : 'accent'} fill="#fff">
              {complete ? (
                <Check aria-hidden="true" className="size-4 text-success" strokeWidth={3} />
              ) : (
                <span className="font-heading text-[16px] font-bold">{l.no}</span>
              )}
            </ProgressRing>
            <span className="max-w-[72px] truncate text-[11px] font-semibold">
              {l.short}
              <span className="sr-only">{` – ${tp.reader.rail.chapterAria(l.no, l.title, complete)}`}</span>
            </span>
          </button>
        );
      })}
      {start.chapters.length > 0 && <span aria-hidden="true" className="my-1.5 h-px w-10 bg-line" />}
      {quiz && (
        <RailStepButton
          label={tp.reader.rail.quiz}
          aria={tp.reader.rail.quizAria(tp.reader.rail[quiz])}
          state={quiz}
          active={active === 'quiz'}
          onClick={onQuiz}
          mark={quiz === 'passed' ? <Check aria-hidden="true" className="size-4" strokeWidth={3} /> : quiz === 'unlocked' ? '?' : '–'}
        />
      )}
      <RailStepButton
        label={tp.reader.rail.sign}
        aria={tp.reader.rail.signAria(tp.reader.rail[sign])}
        state={sign}
        active={active === 'sign'}
        onClick={onSign}
        mark={<Signature aria-hidden="true" className="size-5" />}
      />
    </nav>
  );
}

function RailStepButton({
  label,
  aria,
  state,
  active,
  onClick,
  mark,
}: {
  label: string;
  aria: string;
  state: RailStep;
  active: boolean;
  onClick: () => void;
  mark: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={state === 'locked'}
      aria-current={active ? 'step' : undefined}
      onClick={onClick}
      className={cn(
        'flex w-[76px] cursor-pointer flex-col items-center gap-1 rounded-[26px] py-1.5 disabled:cursor-not-allowed',
        state === 'passed' ? 'text-success-text' : state === 'unlocked' ? 'text-accent-text' : 'text-muted',
        state !== 'locked' && 'hover:bg-bg',
      )}
    >
      <span
        className={cn(
          'flex size-11 items-center justify-center rounded-full text-[16px] font-bold',
          state === 'passed' ? 'bg-success-soft' : state === 'unlocked' ? 'bg-accent-soft' : 'bg-bg',
        )}
      >
        {mark}
      </span>
      <span className="text-[11px] font-semibold">
        {label}
        <span className="sr-only">{` – ${aria}`}</span>
      </span>
    </button>
  );
}
