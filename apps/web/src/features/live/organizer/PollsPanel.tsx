import { useState } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { Button, Field, IconButton, Input, Panel, SegmentedControl, Textarea } from '@/components/ui';
import { cn } from '@/lib/cn';
import { tl } from '@/i18n/live';
import type { OrganizerPolls, PollMode, PollResult, PoolQuestion } from '../api';
import { barPct, poolState } from './model';
import type { useOrganizerActions } from './useOrganizerLive';

const tp = tl.org.polls;
type Actions = ReturnType<typeof useOrganizerActions>;

const modeLabel = (m: PollMode) => (m === 'wissenscheck' ? tp.wissenscheck : tp.stimmungsbild);

/** Laufende Kontrollfrage mit Live-Balken, „x von y haben geantwortet“, % richtig, „Frage schließen“ (12f). */
function ActivePoll({ poll, onClose, closing }: { poll: PollResult; onClose: () => void; closing: boolean }) {
  const total = poll.distribution.reduce((a, b) => a + b, 0);
  return (
    <section aria-label={tp.running(modeLabel(poll.mode))} className="flex flex-col gap-3 rounded-[24px] bg-accent-soft px-6 pt-5 pb-5" data-testid="active-poll">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13px] font-bold tracking-[0.04em] text-accent-text uppercase">{tp.running(modeLabel(poll.mode))}</span>
        <span className="text-[13.5px] font-semibold text-accent-text-strong tabular-nums" aria-live="polite">
          {tp.answered(poll.answered, poll.eligible)}
        </span>
      </div>
      <h3 className="font-heading text-[19px] leading-snug font-bold text-ink">{poll.question}</h3>
      <ul className="flex flex-col gap-3">
        {poll.options.map((o, k) => {
          const n = poll.distribution[k] ?? 0;
          const isCorrect = poll.mode === 'wissenscheck' && poll.correct === k;
          const pct = barPct(n, total);
          return (
            <li key={k} aria-label={tp.barLabel(o, n, pct)}>
              <div aria-hidden="true" className="flex items-baseline justify-between gap-3 text-[14.5px] text-ink">
                <span>
                  {o}
                  {isCorrect && <Check className="ml-1.5 inline size-4 align-[-2px] text-success" strokeWidth={3} />}
                </span>
                <span className="font-semibold tabular-nums">{n}</span>
              </div>
              <div aria-hidden="true" className="mt-1.5 h-2.5 overflow-hidden rounded-pill bg-surface">
                <div
                  className={cn('h-full rounded-pill transition-[width] duration-500', isCorrect ? 'bg-success' : 'bg-[#AFC0EE]')}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {isCorrect && <span className="sr-only">{tp.correctMark}</span>}
            </li>
          );
        })}
      </ul>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <span className="text-[14px] text-accent-text-strong">
          {poll.mode === 'wissenscheck' ? (
            <>
              <strong>{tp.rightPct(poll.rightPct ?? 0)}</strong> · {tp.evidenceNote}
            </>
          ) : (
            tp.moodNote
          )}
        </span>
        <Button variant="secondary" disabled={closing} onClick={onClose}>
          {tp.close}
        </Button>
      </div>
    </section>
  );
}

/** Spontane Kontrollfrage anlegen (Frage, 2–6 Antworten, richtige Antwort, Erklärung). */
function SpontaneousForm({
  mode,
  onSend,
  onCancel,
  pending,
}: {
  mode: PollMode;
  onSend: (v: { question: string; options: string[]; correct: number | null; explanation: string | null }) => Promise<boolean>;
  onCancel: () => void;
  pending: boolean;
}) {
  const f = tp.form;
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '', '']);
  const [correct, setCorrect] = useState<number | null>(null);
  const [explanation, setExplanation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const filled = options.map((o) => o.trim()).filter(Boolean);
  const submit = async () => {
    if (question.trim().length < 3 || filled.length < 2) return setError(f.needOptions);
    // Index der richtigen Antwort auf die ausgefüllten Antworten umrechnen
    const map = options.map((o, i) => (o.trim() ? i : -1)).filter((i) => i >= 0);
    const c = correct !== null ? map.indexOf(correct) : -1;
    if (mode === 'wissenscheck' && c < 0) return setError(f.needCorrect);
    setError(null);
    if (await onSend({ question: question.trim(), options: filled, correct: c >= 0 ? c : null, explanation: explanation.trim() || null })) onCancel();
  };
  return (
    <section aria-label={f.title} className="flex flex-col gap-3.5 rounded-[22px] bg-bg p-4">
      <h3 className="font-heading text-[16px] font-bold text-ink">{f.title}</h3>
      <Field label={f.question}>
        <Input tone="surface" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={1000} />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-[13px] font-medium text-muted">
          {mode === 'wissenscheck' ? f.optionsCorrect : f.options}
        </legend>
        {options.map((o, i) => (
          <div key={i} className="flex items-center gap-2">
            {mode === 'wissenscheck' && (
              <input
                type="radio"
                name="richtig"
                checked={correct === i}
                onChange={() => setCorrect(i)}
                aria-label={f.correctAria(i + 1)}
                className="size-5 shrink-0 cursor-pointer accent-[var(--color-success)]"
              />
            )}
            <Input
              tone="surface"
              aria-label={f.option(i + 1)}
              value={o}
              onChange={(e) => setOptions(options.map((x, k) => (k === i ? e.target.value : x)))}
              maxLength={300}
            />
            {options.length > 2 && (
              <IconButton
                aria-label={f.removeOption(i + 1)}
                variant="ghost"
                onClick={() => {
                  setOptions(options.filter((_, k) => k !== i));
                  setCorrect((c) => (c === null ? null : c === i ? null : c > i ? c - 1 : c));
                }}
              >
                <Trash2 aria-hidden="true" />
              </IconButton>
            )}
          </div>
        ))}
        {options.length < 6 && (
          <Button variant="ghost" size="sm" className="self-start" onClick={() => setOptions([...options, ''])}>
            {f.addOption}
          </Button>
        )}
      </fieldset>
      {mode === 'wissenscheck' && (
        <Field label={f.explanation}>
          <Textarea tone="surface" rows={2} value={explanation} onChange={(e) => setExplanation(e.target.value)} maxLength={1000} className="min-h-16" />
        </Field>
      )}
      {error && (
        <Panel tone="danger" role="alert" className="py-2.5">
          {error}
        </Panel>
      )}
      <div className="flex justify-end gap-2.5">
        <Button variant="ghost" onClick={onCancel}>
          {tl.common.cancel}
        </Button>
        <Button disabled={pending} onClick={() => void submit()}>
          {f.send}
        </Button>
      </div>
    </section>
  );
}

/** Reiter „Kontrollfragen“ (12f): laufende Frage, Fragenpool, spontane Frage, ausgewertete Fragen. */
export function PollsPanel({
  polls,
  pool,
  trainingTitle,
  ended,
  actions,
  onNotice,
}: {
  polls: OrganizerPolls;
  pool: PoolQuestion[];
  trainingTitle: string | null;
  ended: boolean;
  actions: Actions;
  onNotice: (text: string, tone?: 'success' | 'danger') => void;
}) {
  const [mode, setMode] = useState<PollMode>('wissenscheck');
  const [formOpen, setFormOpen] = useState(false);
  const active = polls.active;
  const send = async (body: Parameters<Actions['createPoll']['mutateAsync']>[0]) => {
    try {
      await actions.createPoll.mutateAsync(body);
      return true;
    } catch (e) {
      onNotice((e as Error).message, 'danger');
      return false;
    }
  };
  const closed = polls.list.filter((p) => !p.open && !p.sourceQuestionId);

  return (
    <div className="flex flex-col gap-3.5">
      {active && (
        <ActivePoll
          poll={active}
          closing={actions.closePoll.isPending}
          onClose={() => void actions.closePoll.mutateAsync(active.id).catch((e: Error) => onNotice(e.message, 'danger'))}
        />
      )}
      {ended ? (
        <Panel tone="neutral">{tp.endedHint}</Panel>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[14px] text-muted">{tp.poolIntro(pool.length ? trainingTitle : null)}</p>
          <SegmentedControl
            aria-label={tp.modeLabel}
            size="sm"
            value={mode}
            onValueChange={setMode}
            options={[
              { value: 'wissenscheck', label: tp.wissenscheck },
              { value: 'stimmungsbild', label: tp.stimmungsbild },
            ]}
          />
        </div>
      )}
      <ul className="flex flex-col gap-2.5">
        {pool.map((p) => {
          const s = poolState(p, polls.list);
          return (
            <li key={p.id} className="flex items-center gap-4 rounded-[20px] bg-[#F8F9FC] px-5 py-3.5" data-testid="pool-question">
              <div className="min-w-0 flex-1">
                <p className="text-[15.5px] leading-snug text-ink">{p.text}</p>
                <p className="mt-0.5 text-[13px] text-muted">
                  {s.last && s.state === 'done'
                    ? `${tp.done} · ${tp.doneMeta(s.last.answered, s.last.rightPct)}`
                    : tp.meta(p.options.length, modeLabel(s.last?.mode ?? mode))}
                </p>
              </div>
              {s.state === 'running' ? (
                <span className="rounded-pill bg-surface px-4 py-2.5 text-[14px] font-semibold text-accent-text">{tp.runningChip}</span>
              ) : (
                !ended && (
                  <Button
                    variant={active ? 'tonal' : s.state === 'done' ? 'secondary' : 'primary'}
                    size="sm"
                    disabled={!!active || actions.createPoll.isPending}
                    onClick={() => void send({ mode, sourceQuestionId: p.id })}
                  >
                    {s.state === 'done' ? tp.sendAgain : tp.send}
                  </Button>
                )
              )}
            </li>
          );
        })}
        {closed.map((p) => (
          <li key={p.id} className="flex items-center gap-4 rounded-[20px] bg-[#F8F9FC] px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-[15.5px] leading-snug text-ink">{p.question}</p>
              <p className="mt-0.5 text-[13px] text-muted">
                {modeLabel(p.mode)} · {tp.done} · {tp.doneMeta(p.answered, p.rightPct)}
              </p>
            </div>
          </li>
        ))}
      </ul>
      {!ended &&
        (formOpen ? (
          <SpontaneousForm mode={mode} pending={actions.createPoll.isPending} onCancel={() => setFormOpen(false)} onSend={(v) => send({ mode, ...v })} />
        ) : (
          <button
            type="button"
            disabled={!!active}
            onClick={() => setFormOpen(true)}
            className="flex h-14 cursor-pointer items-center justify-center gap-1.5 rounded-[22px] border-2 border-dashed border-accent-ring text-[15px] font-semibold text-accent-text hover:bg-accent-soft/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus aria-hidden="true" className="size-4" strokeWidth={2.5} />
            {tp.spontaneous.replace('+ ', '')}
          </button>
        ))}
    </div>
  );
}
