import { useId, useState, type KeyboardEvent } from 'react';
import { MANUAL_CHECKOUT_REASONS, MANUAL_NOTE_MAX, type ManualCheckoutReason } from '@sn/shared';
import { Button, Sheet, Textarea } from '@/components/ui';
import { cn } from '@/lib/cn';
import { tl } from '@/i18n/live';
import { manualCheckoutValid, manualNoteRemaining } from '../scanLogic';

/** „Ohne QR-Code ausloggen“ (13d): Grund als Pillen-Radiogruppe + Vermerk (Pflicht, ≥ 10 Zeichen). */
export function ManualCheckoutSheet({
  open,
  onOpenChange,
  nowLabel,
  onSubmit,
  pending,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** „12:53“ (Serverzeit) */
  nowLabel: string;
  onSubmit: (reason: ManualCheckoutReason, note: string) => void;
  pending: boolean;
  error: string | null;
}) {
  const [reason, setReason] = useState<ManualCheckoutReason | null>(null);
  const [note, setNote] = useState('');
  const t = tl.tn.manual;
  const noteId = useId();
  const hintId = `${noteId}-hinweis`;
  const valid = manualCheckoutValid(reason, note);
  const remaining = manualNoteRemaining(note);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = MANUAL_CHECKOUT_REASONS.length;
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % n : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i - 1 + n) % n : -1;
    if (next < 0) return;
    e.preventDefault();
    setReason(MANUAL_CHECKOUT_REASONS[next]!);
    const group = e.currentTarget.parentElement;
    (group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next])?.focus();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t.title}
      footer={
        <Button size="lg" fullWidth disabled={!valid || pending} onClick={() => reason && onSubmit(reason, note.trim())}>
          {t.submit}
        </Button>
      }
    >
      <div className="flex flex-col gap-3.5">
        <p className="text-[13.5px] leading-[1.5] text-ink-2">
          {t.textBefore}
          <strong className="text-ink">{tl.tn.oclock(nowLabel)}</strong>
          {t.textAfter}
        </p>
        <div role="radiogroup" aria-label={t.reasonLabel} className="flex flex-wrap gap-2">
          {MANUAL_CHECKOUT_REASONS.map((r, i) => {
            const sel = reason === r;
            return (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={sel}
                tabIndex={sel || (reason === null && i === 0) ? 0 : -1}
                onClick={() => setReason(r)}
                onKeyDown={(e) => onKey(e, i)}
                className={cn(
                  'h-11 cursor-pointer rounded-pill px-3.5 text-[13.5px] font-semibold transition-colors',
                  sel ? 'bg-accent text-white' : 'bg-bg text-ink-2 hover:bg-neutral-soft',
                )}
              >
                {t.reasons[r]}
              </button>
            );
          })}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={noteId} className="text-[13px] text-muted">
            {t.note}
          </label>
          <Textarea
            id={noteId}
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t.placeholder}
            maxLength={MANUAL_NOTE_MAX}
            aria-describedby={hintId}
            required
            className="min-h-[96px] resize-none rounded-[18px]"
          />
          <p id={hintId} className="text-[12.5px] text-muted" aria-live="polite">
            {remaining > 0 ? t.remaining(remaining) : ' '}
          </p>
        </div>
        {error && (
          <p role="alert" className="text-[13.5px] font-medium text-danger-text">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}
