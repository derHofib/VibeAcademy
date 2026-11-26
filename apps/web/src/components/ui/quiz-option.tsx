import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Check, X } from 'lucide-react';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/cn';
import { de } from '@/i18n/de';

export type QuizOptionState = 'idle' | 'selected' | 'correct' | 'wrong' | 'dimmed';

const quizOptionVariants = cva(
  [
    'flex min-h-[52px] w-full items-center gap-2.5 rounded-[18px] px-4 py-3.5 text-left text-[15px] leading-[1.4]',
    'transition-[background-color,box-shadow,color] duration-150',
  ],
  {
    variants: {
      state: {
        idle: 'cursor-pointer bg-surface text-ink shadow-[inset_0_0_0_2px_var(--color-line)] hover:bg-surface-hover hover:shadow-[inset_0_0_0_2px_var(--color-accent-ring)]',
        selected: 'cursor-pointer bg-accent-soft text-ink shadow-[inset_0_0_0_2px_var(--color-accent)]',
        correct: 'bg-success-soft text-ink shadow-[inset_0_0_0_2px_var(--color-success-line)]',
        wrong: 'bg-warn-soft text-ink shadow-[inset_0_0_0_2px_var(--color-warn-line)]',
        /** Gedimmt über Textfarbe statt Deckkraft – Kontrast bleibt >= 4,5:1 */
        dimmed: 'bg-surface text-muted shadow-[inset_0_0_0_2px_var(--color-bg)]',
      },
    },
    defaultVariants: { state: 'idle' },
  },
);

export interface QuizOptionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  state?: QuizOptionState;
  /** Nach der Auswertung: war diese (richtige) Option die gewählte? */
  picked?: boolean;
}

/**
 * Großer Antwort-Button. Nach Auswertung: richtig grün + ✓, falsch gelb + ✕, Rest gedimmt.
 * Nach der Auswertung ist die Option gesperrt (aria-disabled), bleibt aber vorlesbar.
 */
export const QuizOption = forwardRef<HTMLButtonElement, QuizOptionProps>(
  ({ state = 'idle', picked = false, className, children, onClick, ...props }, ref) => {
    const evaluated = state === 'correct' || state === 'wrong' || state === 'dimmed';
    return (
      <button
        ref={ref}
        type="button"
        aria-pressed={state === 'selected' || state === 'wrong' || (state === 'correct' && picked)}
        aria-disabled={evaluated || undefined}
        onClick={evaluated ? undefined : onClick}
        className={cn(quizOptionVariants({ state }), className)}
        data-state={state}
        {...props}
      >
        <span className="flex-1">{children}</span>
        {state === 'correct' && (
          <>
            <Check aria-hidden="true" className="size-5 shrink-0 text-success" strokeWidth={2.75} />
            <span className="sr-only">{', '}{de.quiz.correct}</span>
          </>
        )}
        {state === 'wrong' && (
          <>
            <X aria-hidden="true" className="size-5 shrink-0 text-warn-strong" strokeWidth={2.75} />
            <span className="sr-only">{', '}{de.quiz.wrong}</span>
          </>
        )}
      </button>
    );
  },
);
QuizOption.displayName = 'QuizOption';
