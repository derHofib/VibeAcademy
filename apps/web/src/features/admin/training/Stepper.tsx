import { Link } from 'react-router';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { adm } from '@/i18n/admin';
import { WIZARD_STEPS, type WizardStep } from '../wizard';

const w = adm.wizard;

/** Stepper „Grunddaten · Dokument & Regeln · Zielgruppe · Prüfen & einladen“ als Pillen (Screen 2, weicher Stil). */
export function Stepper({
  current,
  maxReachable,
  hrefFor,
}: {
  current: WizardStep;
  maxReachable: WizardStep;
  hrefFor: (step: WizardStep) => string;
}) {
  return (
    <nav aria-label={w.stepperLabel}>
      <ol className="flex flex-wrap items-center gap-2">
        {WIZARD_STEPS.map((step) => {
          const label = w.steps[step - 1]!;
          const isCurrent = step === current;
          const done = step < current;
          const reachable = step <= maxReachable;
          const content = (
            <>
              {done && !isCurrent ? (
                <Check aria-hidden="true" className="size-4" strokeWidth={2.75} />
              ) : (
                <span aria-hidden="true" className="tabular-nums">
                  {step}
                </span>
              )}
              <span className={cn(!isCurrent && 'sr-only sm:not-sr-only')}>{label}</span>
              <span className="sr-only">
                {' – '}
                {isCurrent ? w.stepCurrent : done ? w.stepDone : !reachable ? w.stepLocked : ''}
              </span>
            </>
          );
          const cls = cn(
            'inline-flex h-11 items-center gap-2 rounded-pill px-4 text-[14px] font-semibold whitespace-nowrap transition-colors',
            isCurrent
              ? 'bg-accent text-white shadow-primary'
              : done
                ? 'bg-success-soft text-success-text'
                : reachable
                  ? 'bg-surface text-ink-2 shadow-soft'
                  : 'bg-surface/60 text-muted',
          );
          return (
            <li key={step}>
              {reachable && !isCurrent ? (
                <Link to={hrefFor(step)} className={cn(cls, 'hover:brightness-[0.98]')}>
                  {content}
                </Link>
              ) : (
                <span
                  className={cls}
                  aria-current={isCurrent ? 'step' : undefined}
                  aria-disabled={!reachable || undefined}
                >
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
