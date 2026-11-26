import { useState } from 'react';
import { Triangle } from 'lucide-react';
import { Button, CheckboxField, Sheet, Textarea } from '@/components/ui';
import { cn } from '@/lib/cn';
import { tl } from '@/i18n/live';
import type { ParticipantQuestion } from '../api';

const t = tl.tn.questions;

function statusOf(q: ParticipantQuestion) {
  if (q.status === 'beantwortet') return { label: t.answered, cls: 'text-success-text' };
  if (q.status === 'per_mail') return { label: t.perMail, cls: 'text-success-text' };
  return { label: q.mine ? t.sent : t.open, cls: 'text-accent-text' };
}

/** „Fragen an den Trainer“ (13b/13i): sortiert nach Stimmen, „Ich auch“ je Person einmal. */
export function QuestionsCard({
  questions,
  onAsk,
  onVote,
  votingId,
  canInteract,
}: {
  questions: ParticipantQuestion[];
  onAsk: () => void;
  onVote: (q: ParticipantQuestion) => void;
  votingId: string | null;
  canInteract: boolean;
}) {
  return (
    <section
      aria-labelledby="fragen-titel"
      className="flex flex-col gap-1 rounded-[24px] bg-surface px-4 py-3.5 shadow-[0_1px_2px_rgba(29,36,51,0.04),0_8px_24px_rgba(29,36,51,0.05)]"
    >
      <div className="flex items-center justify-between gap-3 pb-1">
        <h2 id="fragen-titel" className="font-heading text-[15.5px] font-bold text-ink">
          {t.title}
        </h2>
        {canInteract && (
          <Button size="sm" className="h-11 px-4 text-[13px]" onClick={onAsk} aria-label={t.addAria}>
            {t.add}
          </Button>
        )}
      </div>
      {questions.length === 0 ? (
        <p className="border-t border-[#EEF1F6] py-3 text-[14px] text-muted">{t.empty}</p>
      ) : (
        <ul aria-label={t.listLabel}>
          {questions.map((q) => {
            const st = statusOf(q);
            const canVote = canInteract && !q.mine && q.status === 'offen';
            return (
              <li key={q.id} className="flex items-start gap-2.5 border-t border-[#EEF1F6] py-2.5">
                <button
                  type="button"
                  onClick={() => canVote && onVote(q)}
                  disabled={!canVote || votingId === q.id}
                  aria-pressed={q.mine ? undefined : q.voted}
                  aria-label={q.mine ? t.ownAria(q.votes) : t.voteAria(q.votes, q.voted)}
                  className={cn(
                    'flex size-11 shrink-0 flex-col items-center justify-center rounded-[14px] text-[12px] leading-[1.1] font-bold tabular-nums',
                    'disabled:cursor-default',
                    canVote && 'cursor-pointer',
                    q.voted ? 'bg-accent text-white' : 'bg-bg text-ink-2',
                    canVote && !q.voted && 'hover:bg-neutral-soft',
                  )}
                >
                  <Triangle aria-hidden="true" className="size-2.5 fill-current" strokeWidth={0} />
                  {q.votes}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] leading-[1.4] break-words text-ink">{q.text}</p>
                  <p className="mt-0.5 text-[12px] text-muted">
                    {q.mine ? t.you : q.author} · <span className={cn('font-semibold', st.cls)}>{st.label}</span>
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Bottom-Sheet „Frage an den Trainer“ (13i) mit „Anonym stellen“. */
export function AskSheet({
  open,
  onOpenChange,
  onSend,
  pending,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSend: (text: string, anonymous: boolean) => Promise<boolean>;
  pending: boolean;
  error: string | null;
}) {
  const [text, setText] = useState('');
  const [anon, setAnon] = useState(false);
  const a = tl.tn.ask;
  const ok = text.trim().length >= 3;
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setText('');
      }}
      title={a.title}
      footer={
        <Button
          size="lg"
          fullWidth
          disabled={!ok || pending}
          onClick={async () => {
            if (await onSend(text.trim(), anon)) {
              setText('');
              setAnon(false);
            }
          }}
        >
          {a.send}
        </Button>
      }
    >
      <div className="flex flex-col gap-3.5">
        <Textarea
          aria-label={a.label}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={a.placeholder}
          maxLength={1000}
          className="min-h-[96px] resize-none rounded-[18px]"
        />
        <CheckboxField
          checked={anon}
          onCheckedChange={(c) => setAnon(c === true)}
          label={
            <>
              {a.anonymous} <span className="text-[12.5px] text-muted">{a.anonymousHint}</span>
            </>
          }
        />
        {error && (
          <p role="alert" className="text-[13.5px] font-medium text-danger-text">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}
