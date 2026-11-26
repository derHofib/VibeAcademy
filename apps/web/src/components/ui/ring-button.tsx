import type { ButtonHTMLAttributes, MouseEvent } from 'react';
import { ArrowRight, Signature } from 'lucide-react';
import { cn } from '@/lib/cn';
import { de } from '@/i18n/de';
import { ProgressRing } from './progress';

export type RingButtonState = 'counting' | 'ready' | 'quiz' | 'done';

export interface RingButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  state: RingButtonState;
  /** Erfassung der Seite 0–1 (nur `counting`) */
  progress?: number;
  /** Restsekunden (nur `counting`) */
  seconds?: number;
  /** mobil 72 px, Desktop 84 px */
  size?: 'mobile' | 'desktop';
}

/**
 * Runder Weiter-Button des Lese-Docks. Ring füllt sich mit der Erfassung, innen Countdown.
 * Bei Erfüllung blau mit Pfeil; Quiz: „?“ bis eine Antwort gewählt ist; danach grün mit Unterschrifts-Icon.
 */
export function RingButton({
  state,
  progress = 0,
  seconds = 0,
  size = 'mobile',
  className,
  onClick,
  ...props
}: RingButtonProps) {
  const px = size === 'desktop' ? 84 : 72;
  const inner = px - 10; // 5 px heller Rand
  const blocked = state === 'counting' || state === 'quiz';
  const label =
    state === 'counting'
      ? de.ringButton.counting(seconds)
      : state === 'quiz'
        ? de.ringButton.quiz
        : state === 'done'
          ? de.ringButton.sign
          : de.ringButton.next;

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (blocked) {
      e.preventDefault();
      return;
    }
    onClick?.(e);
  };

  return (
    <button
      type="button"
      aria-disabled={blocked || undefined}
      onClick={handleClick}
      style={{ width: px, height: px }}
      className={cn(
        'relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full border-[5px] border-bg',
        'transition-[background-color,color,box-shadow] duration-300 aria-disabled:cursor-default',
        state === 'ready' && 'bg-accent text-white shadow-[0_10px_24px_rgba(61,99,221,0.35)]',
        state === 'done' && 'bg-success text-white shadow-success',
        blocked && 'bg-surface text-ink shadow-[0_10px_24px_rgba(61,99,221,0.12)]',
        className,
      )}
      {...props}
    >
      {/* Name über sr-only-Text statt aria-label, damit sichtbarer Countdown und Name nicht kollidieren */}
      <span className="sr-only">{label}</span>
      {state === 'counting' && (
        <ProgressRing value={progress} size={inner} stroke={4} trackColor="var(--color-bg)">
          <span className="font-heading text-[26px] leading-none font-bold" aria-hidden="true">
            {seconds}
            <span className="text-[12px] font-semibold">{de.ringButton.secondsUnit}</span>
          </span>
        </ProgressRing>
      )}
      {state === 'quiz' && (
        <span aria-hidden="true" className="font-heading text-[26px] font-bold text-muted">
          ?
        </span>
      )}
      {state === 'ready' && <ArrowRight aria-hidden="true" className="size-7" strokeWidth={2.25} />}
      {state === 'done' && <Signature aria-hidden="true" className="size-7" strokeWidth={2} />}
    </button>
  );
}
