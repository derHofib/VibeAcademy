import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { patch, post } from '@/lib/api';
import { adm } from '@/i18n/admin';
import { cn } from '@/lib/cn';
import {
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  IconButton,
  Input,
  Panel,
  Sheet,
  StatusChip,
  Textarea,
} from '@/components/ui';
import { fieldErrors } from '@/features/auth/session';
import { qk, type Question } from '../api';
import { errorMessage } from '../components/common';

const q = adm.wizard.questions;

interface Draft {
  text: string;
  options: string[];
  correct: number;
  explanation: string;
  active: boolean;
}

const empty: Draft = { text: '', options: ['', '', ''], correct: 0, explanation: '', active: true };

function QuestionSheet({
  trainingId,
  question,
  open,
  onOpenChange,
  onSaved,
}: {
  trainingId: string;
  question: Question | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(() =>
    question
      ? {
          text: question.text,
          options: [...question.options],
          correct: question.correct,
          explanation: question.explanation ?? '',
          active: question.active,
        }
      : empty,
  );
  const [local, setLocal] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (draft: Draft) => {
      const options = draft.options.map((o) => o.trim());
      const keep = options.map((o, i) => ({ o, i })).filter((x) => x.o);
      const correct = Math.max(
        0,
        keep.findIndex((x) => x.i === draft.correct),
      );
      const body = {
        text: draft.text,
        options: keep.map((x) => x.o),
        correct,
        explanation: draft.explanation || null,
        active: draft.active,
      };
      return question
        ? patch(`/trainings/${trainingId}/questions/${question.id}`, body)
        : post(`/trainings/${trainingId}/questions`, body);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.questions(trainingId) });
      onSaved();
      onOpenChange(false);
    },
  });
  const fe = fieldErrors(save.error);

  const submit = () => {
    const filled = d.options.filter((o) => o.trim()).length;
    if (filled < 2) return setLocal(q.minOptions);
    if (!d.options[d.correct]?.trim()) return setLocal(q.correct);
    setLocal(null);
    save.mutate(d);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={question ? q.sheetEdit : q.sheetNew}
      desktopPlacement="right"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {adm.common.cancel}
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? adm.common.saving : adm.common.save}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={q.text} required error={fe.text}>
          <Textarea rows={3} value={d.text} onChange={(e) => setD({ ...d, text: e.target.value })} />
        </Field>
        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-1.5 text-[13px] font-medium text-muted">{q.options}</legend>
          {d.options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <label className="relative flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-bg">
                <input
                  type="radio"
                  name="correct"
                  className="peer sr-only"
                  checked={d.correct === i}
                  onChange={() => setD({ ...d, correct: i })}
                  aria-label={q.correctLabel(i + 1)}
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-6 items-center justify-center rounded-full shadow-[inset_0_0_0_2px_var(--color-control)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
                    d.correct === i && 'bg-success shadow-none text-white',
                  )}
                >
                  {d.correct === i && <Check className="size-4" strokeWidth={3} />}
                </span>
              </label>
              <Input
                aria-label={q.option(i + 1)}
                value={opt}
                onChange={(e) =>
                  setD({ ...d, options: d.options.map((o, j) => (j === i ? e.target.value : o)) })
                }
              />
              {d.options.length > 2 && (
                <IconButton
                  variant="ghost"
                  aria-label={q.removeOption(i + 1)}
                  onClick={() =>
                    setD({
                      ...d,
                      options: d.options.filter((_, j) => j !== i),
                      correct: d.correct === i ? 0 : d.correct > i ? d.correct - 1 : d.correct,
                    })
                  }
                >
                  <Trash2 aria-hidden="true" />
                </IconButton>
              )}
            </div>
          ))}
          {d.options.length < 6 && (
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => setD({ ...d, options: [...d.options, ''] })}
            >
              <Plus aria-hidden="true" className="size-4" />
              {q.addOption}
            </Button>
          )}
          <p className="text-[12.5px] text-muted">
            {q.correct}: {q.correctLabel(d.correct + 1)}
          </p>
        </fieldset>
        <Field label={q.explanation} hint={q.explanationHint}>
          <Textarea
            rows={3}
            value={d.explanation}
            onChange={(e) => setD({ ...d, explanation: e.target.value })}
          />
        </Field>
        {(local || (save.error && !fe.text)) && (
          <p role="alert" className="text-[13px] font-medium text-danger-text">
            {local ?? errorMessage(save.error)}
          </p>
        )}
      </div>
    </Sheet>
  );
}

/** Fragenpool je Schulung: anlegen, bearbeiten, deaktivieren (Fragen werden nie gelöscht). */
export function QuestionPool({
  trainingId,
  questions,
  quizCount,
  quizRequired,
  onNotice,
}: {
  trainingId: string;
  questions: Question[];
  quizCount: number;
  quizRequired: boolean;
  onNotice: (msg: string) => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Question | null>(null);
  const [open, setOpen] = useState(false);
  const [sheetKey, setSheetKey] = useState(0);
  const active = questions.filter((x) => x.active).length;
  const toggle = useMutation({
    mutationFn: (x: Question) =>
      patch(`/trainings/${trainingId}/questions/${x.id}`, {
        text: x.text,
        options: x.options,
        correct: x.correct,
        explanation: x.explanation,
        active: !x.active,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.questions(trainingId) }),
    onError: (e) => onNotice(errorMessage(e)),
  });

  const openSheet = (x: Question | null) => {
    setEditing(x);
    setSheetKey((k) => k + 1);
    setOpen(true);
  };

  return (
    <Card radius="lg" padding="lg">
      <CardHeader>
        <div>
          <CardTitle>{q.card}</CardTitle>
          <CardDescription>{q.subtitle(active, quizCount)}</CardDescription>
        </div>
        <Button variant="secondary" onClick={() => openSheet(null)}>
          <Plus aria-hidden="true" className="size-[18px]" />
          {q.add}
        </Button>
      </CardHeader>
      {quizRequired && active > 0 && active < quizCount && (
        <Panel tone="warn" className="mb-3">
          {q.poolSmall(active, quizCount)}
        </Panel>
      )}
      {questions.length === 0 ? (
        <Panel tone={quizRequired ? 'warn' : 'neutral'}>{q.empty}</Panel>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {questions.map((x, i) => (
            <li key={x.id} className={cn('rounded-box bg-bg px-4 py-3.5', !x.active && 'opacity-70')}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-ink">
                    <span className="text-muted tabular-nums">{i + 1}. </span>
                    {x.text}
                    {!x.active && (
                      <StatusChip className="ml-2 align-middle" tone="neutral">
                        {q.inactive}
                      </StatusChip>
                    )}
                  </p>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {x.options.map((o, j) => (
                      <li
                        key={j}
                        className={cn(
                          'rounded-pill px-3 py-1 text-[13px]',
                          j === x.correct
                            ? 'bg-success-soft font-semibold text-success-text'
                            : 'bg-surface text-ink-2',
                        )}
                      >
                        {j === x.correct && <span className="sr-only">{q.correctMark}: </span>}
                        {o}
                      </li>
                    ))}
                  </ul>
                  {x.explanation && <p className="mt-1.5 text-[13px] text-muted">{x.explanation}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <IconButton
                    variant="ghost"
                    aria-label={`${adm.common.edit}: ${x.text}`}
                    onClick={() => openSheet(x)}
                  >
                    <Pencil aria-hidden="true" />
                  </IconButton>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggle.mutate(x)}
                    disabled={toggle.isPending}
                  >
                    {x.active ? q.deactivate : q.activate}
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      {open && (
        <QuestionSheet
          key={sheetKey}
          trainingId={trainingId}
          question={editing}
          open={open}
          onOpenChange={setOpen}
          onSaved={() => onNotice(q.saved)}
        />
      )}
    </Card>
  );
}
