import type { ReactNode } from 'react';
import { Check, CircleCheck } from 'lucide-react';
import { cn } from '@/lib/cn';
import { tx } from '@/i18n/external';
import type { TimelineStep } from './api';
import { relativeDay } from './model';

/** Dunkler Sucher mit weißen Eckwinkeln (Screens 10a/13). */
export function Finder({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  const corner = 'pointer-events-none absolute size-[22px] border-white';
  return (
    <div
      role={label ? 'group' : undefined}
      aria-label={label}
      className={cn('relative flex justify-center rounded-[26px] bg-scan-bg-2 px-[26px] pt-[22px] pb-[26px]', className)}
    >
      <span aria-hidden="true" className={cn(corner, 'top-3 left-3 rounded-tl-[8px] border-t-[3px] border-l-[3px]')} />
      <span aria-hidden="true" className={cn(corner, 'top-3 right-3 rounded-tr-[8px] border-t-[3px] border-r-[3px]')} />
      <span aria-hidden="true" className={cn(corner, 'bottom-3 left-3 rounded-bl-[8px] border-b-[3px] border-l-[3px]')} />
      <span aria-hidden="true" className={cn(corner, 'right-3 bottom-3 rounded-br-[8px] border-r-[3px] border-b-[3px]')} />
      {children}
    </div>
  );
}

/** „Wird angerechnet auf Ersthelfer – gültig bis 04.12.2028“ (blaue Info-Box mit Haken). */
export function CreditHint({ children, tone = 'accent' }: { children: ReactNode; tone?: 'accent' | 'neutral' }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-[16px] px-3.5 py-3 text-[13.5px]',
        tone === 'accent' ? 'bg-accent-soft text-accent-text-strong' : 'bg-bg text-ink-2',
      )}
      data-testid="anrechnung"
    >
      {tone === 'accent' && <CircleCheck aria-hidden="true" className="size-[18px] shrink-0 fill-accent text-white" strokeWidth={2.2} />}
      <span>{children}</span>
    </div>
  );
}

/** Status-Zeitleiste eingereicht → in Prüfung → freigegeben (Screen 10b). */
export function Timeline({ steps, now }: { steps: TimelineStep[]; now?: Date }) {
  return (
    <ol className="flex flex-col" aria-label={tx.submit.timelineLabel} data-testid="zeitleiste">
      {steps.map((s, i) => {
        const state = s.done ? 'done' : s.current ? 'current' : 'open';
        const note = s.step === 'eingereicht' && s.at ? [relativeDay(s.at, now, true), s.note].filter(Boolean).join(' · ') : s.note;
        return (
          <li key={s.step} className={cn('flex items-start gap-3.5', i < steps.length - 1 && 'pb-4')} data-state={state}>
            <span
              aria-hidden="true"
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full',
                state === 'done' && 'bg-success text-white',
                state === 'current' && 'border-2 border-accent bg-accent-soft',
                state === 'open' && 'border-2 border-[#D9DFEA] bg-bg',
              )}
            >
              {state === 'done' && <Check className="size-3.5" strokeWidth={3} />}
            </span>
            <div className={cn('min-w-0 text-[14.5px]', state === 'open' ? 'text-muted' : 'text-ink')}>
              <p className="font-bold">
                {tx.submit.steps[s.step] ?? s.step}
                <span className="sr-only">
                  {' '}
                  ({state === 'done' ? tx.submit.stepDone : state === 'current' ? tx.submit.stepCurrent : tx.submit.stepOpen})
                </span>
              </p>
              {note && <p className="text-[12.5px] text-muted">{note}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Kopf wie 10a/10b: Zurück-Kreis, „Meine Nachweise“, Titel. */
export function MobileHeader({ onBack, eyebrow, title, backLabel }: { onBack: () => void; eyebrow: string; title: string; backLabel: string }) {
  return (
    <header className="mb-3.5 flex items-center gap-2.5">
      <button
        type="button"
        onClick={onBack}
        aria-label={backLabel}
        className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-surface text-ink shadow-soft"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path d="M11 3.5L5.5 9l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div className="min-w-0">
        <p className="text-[12px] text-muted">{eyebrow}</p>
        <h1 className="font-heading text-[19px] leading-tight font-bold text-ink">{title}</h1>
      </div>
    </header>
  );
}

/** Rahmen der mobilen Seiten (390 px Referenz), unten fixierter Aktionsbereich. */
export function MobileShell({ header, children, footer }: { header: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg">
      <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-4 pt-3.5 md:max-w-[560px] md:pt-8">
        {header}
        <main className="flex flex-1 flex-col gap-3.5">{children}</main>
        {footer && (
          <div className="sticky bottom-0 z-10 mt-3 flex flex-col gap-2.5 bg-bg pt-3 pb-[max(22px,env(safe-area-inset-bottom))]">{footer}</div>
        )}
        {!footer && <div className="h-6" />}
      </div>
    </div>
  );
}
