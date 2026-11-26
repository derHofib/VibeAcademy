import { useEffect, useImperativeHandle, useState, type ComponentProps, type Ref } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { patch } from '@/lib/api';
import { adm } from '@/i18n/admin';
import { Button, Card, CardTitle, CheckboxField, Field, Input, Select } from '@/components/ui';
import { qk, type Training, type TrainingSettings } from '../api';
import { formatDecimal, parseDecimal } from '../format';
import { errorMessage } from '../components/common';

const r = adm.wizard.rules;

export const DEADLINE_OPTIONS = [7, 14, 21, 30, 60, 90];
export const INTERVAL_OPTIONS = [6, 12, 24, 36, 60];

interface Draft {
  wordsPerMinute: string;
  factor: string;
  floorSeconds: string;
  capSeconds: string;
  strictMode: boolean;
  quizRequired: boolean;
  quizQuestionCount: string;
  passPct: string;
  maxAttempts: string;
  requireStepUp: boolean;
  allowDownload: boolean;
  deadlineDays: number;
  intervalMonths: number;
}

const numericFields: Array<{ key: keyof Draft; min: number; max: number; decimal?: boolean }> = [
  { key: 'wordsPerMinute', min: 50, max: 600 },
  { key: 'factor', min: 0.1, max: 1, decimal: true },
  { key: 'floorSeconds', min: 1, max: 600 },
  { key: 'capSeconds', min: 1, max: 1800 },
  { key: 'quizQuestionCount', min: 1, max: 50 },
  { key: 'passPct', min: 1, max: 100 },
  { key: 'maxAttempts', min: 1, max: 10 },
];

function toDraft(t: Training): Draft {
  const s = t.settings;
  return {
    wordsPerMinute: String(s.wordsPerMinute),
    factor: formatDecimal(s.factor),
    floorSeconds: String(s.floorSeconds),
    capSeconds: String(s.capSeconds),
    strictMode: s.strictMode,
    quizRequired: t.quizRequired,
    quizQuestionCount: String(s.quizQuestionCount),
    passPct: String(s.passPct),
    maxAttempts: String(s.maxAttempts),
    requireStepUp: s.requireStepUp,
    allowDownload: s.allowDownload,
    deadlineDays: s.deadlineDays,
    intervalMonths: s.intervalMonths,
  };
}

/** Prüft den Entwurf; liefert Einstellungen oder Feldfehler. */
export function validateRules(d: Draft): {
  settings?: Partial<TrainingSettings>;
  errors: Partial<Record<keyof Draft, string>>;
} {
  const errors: Partial<Record<keyof Draft, string>> = {};
  const nums: Record<string, number> = {};
  for (const f of numericFields) {
    const n = parseDecimal(String(d[f.key]));
    if (Number.isNaN(n)) errors[f.key] = r.invalidNumber;
    else if (n < f.min || n > f.max || (!f.decimal && !Number.isInteger(n)))
      errors[f.key] = r.range(f.min, f.max);
    else nums[f.key] = n;
  }
  if (!errors.floorSeconds && !errors.capSeconds && nums.floorSeconds! > nums.capSeconds!)
    errors.floorSeconds = r.floorAboveCap;
  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    settings: {
      wordsPerMinute: nums.wordsPerMinute!,
      factor: nums.factor!,
      floorSeconds: nums.floorSeconds!,
      capSeconds: nums.capSeconds!,
      strictMode: d.strictMode,
      quizQuestionCount: nums.quizQuestionCount!,
      passPct: nums.passPct!,
      maxAttempts: nums.maxAttempts!,
      requireStepUp: d.requireStepUp,
      allowDownload: d.allowDownload,
      deadlineDays: d.deadlineDays,
      intervalMonths: d.intervalMonths,
    },
  };
}

/** Zahlenfeld mit Einheit rechts im Feld (wie „200 Wörter/min“ in Screen 2). */
function UnitInput({ unit, ...props }: ComponentProps<typeof Input> & { unit: string }) {
  return (
    <div className="relative">
      <Input {...props} className={unit.length > 2 ? 'pr-[5.75rem]' : 'pr-9'} />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-[14px] text-muted"
      >
        {unit}
      </span>
    </div>
  );
}

export interface RulesPanelHandle {
  /** Speichert ungesicherte Änderungen; false bei Fehlern. */
  flush: () => Promise<boolean>;
}

/** Rechte Karte „Regeln für den Lesenachweis“ (Screen 2). */
export function RulesPanel({
  training,
  activeQuestions,
  disabled,
  ref,
  onSaved,
}: {
  training: Training;
  activeQuestions: number;
  disabled?: boolean;
  ref?: Ref<RulesPanelHandle>;
  onSaved?: (msg: string) => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => toDraft(training));
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});

  // Nach dem Speichern neue Serverwerte übernehmen, solange nichts bearbeitet wird
  useEffect(() => {
    if (!dirty) setDraft(toDraft(training));
  }, [training, dirty]);

  const save = useMutation({
    mutationFn: async (d: Draft) => {
      const { settings } = validateRules(d);
      await patch(`/trainings/${training.id}/settings`, settings);
      if (d.quizRequired !== training.quizRequired)
        await patch(`/trainings/${training.id}`, { quizRequired: d.quizRequired });
    },
    onSuccess: async () => {
      setDirty(false);
      await qc.invalidateQueries({ queryKey: qk.training(training.id) });
      onSaved?.(r.applied);
    },
  });

  const flush = async () => {
    if (!dirty) return true;
    const v = validateRules(draft);
    setErrors(v.errors);
    if (!v.settings) return false;
    try {
      await save.mutateAsync(draft);
      return true;
    } catch {
      return false;
    }
  };
  useImperativeHandle(ref, () => ({ flush }));

  const set = <K extends keyof Draft>(k: K, value: Draft[K]) => {
    setDraft((p) => ({ ...p, [k]: value }));
    setDirty(true);
  };
  const num = (k: keyof Draft) => ({
    value: String(draft[k]),
    inputMode: k === 'factor' ? ('decimal' as const) : ('numeric' as const),
    onChange: (e: { target: { value: string } }) => set(k, e.target.value as never),
    disabled,
  });

  return (
    <Card radius="lg" padding="lg" className="flex flex-col gap-4">
      <CardTitle>{r.card}</CardTitle>
      <div className="grid grid-cols-2 gap-3">
        <Field label={r.wpm} error={errors.wordsPerMinute}>
          <UnitInput unit={r.wpmUnit} name="wordsPerMinute" {...num('wordsPerMinute')} />
        </Field>
        <Field label={r.factor} error={errors.factor}>
          <Input name="factor" {...num('factor')} />
        </Field>
        <Field label={r.floor} error={errors.floorSeconds}>
          <UnitInput unit={r.secUnit} name="floorSeconds" {...num('floorSeconds')} />
        </Field>
        <Field label={r.cap} error={errors.capSeconds}>
          <UnitInput unit={r.secUnit} name="capSeconds" {...num('capSeconds')} />
        </Field>
      </div>
      <p className="text-[12.5px] text-muted">{r.formula}</p>

      <div className="flex flex-col gap-4 border-t border-line pt-4">
        <CheckboxField
          label={<span className="font-semibold">{r.strict}</span>}
          description={r.strictText}
          checked={draft.strictMode}
          onCheckedChange={(c) => set('strictMode', c === true)}
          disabled={disabled}
        />
        <div className="flex flex-col gap-3">
          <CheckboxField
            label={<span className="font-semibold">{r.quiz}</span>}
            description={r.quizText(
              Math.min(
                Number(draft.quizQuestionCount) || 0,
                activeQuestions || Number(draft.quizQuestionCount) || 0,
              ),
              activeQuestions,
              Number(draft.passPct) || 0,
              Number(draft.maxAttempts) || 0,
            )}
            checked={draft.quizRequired}
            onCheckedChange={(c) => set('quizRequired', c === true)}
            disabled={disabled}
          />
          {draft.quizRequired && (
            <div className="grid grid-cols-3 gap-2.5 pl-[38px]">
              <Field label={r.quizCount} error={errors.quizQuestionCount}>
                <Input name="quizQuestionCount" {...num('quizQuestionCount')} />
              </Field>
              <Field label={r.passPct} error={errors.passPct}>
                <UnitInput unit={r.pctUnit} name="passPct" {...num('passPct')} />
              </Field>
              <Field label={r.attempts} error={errors.maxAttempts}>
                <Input name="maxAttempts" {...num('maxAttempts')} />
              </Field>
            </div>
          )}
        </div>
        <CheckboxField
          label={<span className="font-semibold">{r.stepUp}</span>}
          description={r.stepUpText}
          checked={draft.requireStepUp}
          onCheckedChange={(c) => set('requireStepUp', c === true)}
          disabled={disabled}
        />
        <CheckboxField
          label={<span className="font-semibold">{r.download}</span>}
          description={r.downloadText}
          checked={draft.allowDownload}
          onCheckedChange={(c) => set('allowDownload', c === true)}
          disabled={disabled}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-line pt-4">
        <Field label={r.deadline}>
          <Select
            name="deadlineDays"
            value={draft.deadlineDays}
            onChange={(e) => set('deadlineDays', Number(e.target.value))}
            disabled={disabled}
          >
            {[...new Set([...DEADLINE_OPTIONS, draft.deadlineDays])]
              .sort((a, b) => a - b)
              .map((d) => (
                <option key={d} value={d}>
                  {r.deadlineOption(d)}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={r.interval}>
          <Select
            name="intervalMonths"
            value={draft.intervalMonths}
            onChange={(e) => set('intervalMonths', Number(e.target.value))}
            disabled={disabled}
          >
            {[...new Set([...INTERVAL_OPTIONS, draft.intervalMonths])]
              .sort((a, b) => a - b)
              .map((m) => (
                <option key={m} value={m}>
                  {r.intervalOption(m)}
                </option>
              ))}
          </Select>
        </Field>
      </div>
      <p className="text-[12.5px] text-muted">{r.reminders}</p>

      {save.isError && (
        <p role="alert" className="text-[13px] font-medium text-danger-text">
          {errorMessage(save.error)}
        </p>
      )}
      {dirty && (
        <Button variant="soft" onClick={() => void flush()} disabled={save.isPending}>
          {save.isPending ? adm.common.saving : r.apply}
        </Button>
      )}
    </Card>
  );
}
