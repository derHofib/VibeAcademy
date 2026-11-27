import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Building2, ChevronLeft, Combine, Info, MapPin, MonitorPlay } from 'lucide-react';
import { ANLASS_LABELS, ANLASS_TYPES, DELIVERY_LABELS, DELIVERY_TYPES, PLATFORM_LABELS, PLATFORMS, anlassLine, type DeliveryType } from '@sn/shared';
import { get, patch, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button, Card, CardDescription, CardTitle, CheckboxField, Field, Input, Panel, SegmentedControl, Select, Textarea } from '@/components/ui';
import { qk, type OrgUnit, type Training } from '@/features/admin/api';
import type { Requirement } from '@/features/external/api';
import { ErrorPanel, Loading, NoticeRegion, useNotice } from '@/features/admin/components/common';
import { DEADLINE_OPTIONS, INTERVAL_OPTIONS } from '@/features/admin/training/RulesPanel';
import {
  REMINDER_AFTER_OPTIONS, REMINDER_BEFORE_OPTIONS, changedOnly, toSettingsDraft, validateSettingsDraft,
  type DraftErrors, type SettingsDraft,
} from '@/features/admin/training/settingsDraft';
import { ts } from '@/i18n/training-settings';

const DELIVERY_ICONS: Record<DeliveryType, typeof BookOpen> = {
  online: BookOpen, praesenz: MapPin, live_online: MonitorPlay, extern: Building2, kombiniert: Combine,
};

function UnitInput({ unit, ...props }: ComponentProps<typeof Input> & { unit: string }) {
  return (
    <div className="relative">
      <Input {...props} className={unit.length > 2 ? 'pr-[5.75rem]' : 'pr-9'} />
      <span aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-[14px] text-muted">
        {unit}
      </span>
    </div>
  );
}

function ToggleChip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'min-h-10 rounded-pill px-3.5 text-[13.5px] font-medium transition-colors',
        pressed ? 'bg-accent-soft font-semibold text-accent-text-strong ring-2 ring-accent ring-inset' : 'bg-bg text-ink-2 hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

function SettingsCard({ title, sub, children, className }: { title: string; sub: string; children: ReactNode; className?: string }) {
  const id = `karte-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <Card radius="lg" padding="lg" role="region" aria-labelledby={id} className={cn('flex flex-col gap-4', className)}>
      <div>
        <CardTitle id={id}>{title}</CardTitle>
        <CardDescription>{sub}</CardDescription>
      </div>
      {children}
    </Card>
  );
}

const fmtDateTime = (iso?: string) =>
  iso ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(new Date(iso)) : '';

/** `/verwaltung/schulungen/:id/einstellungen` – Einstellungen je Schulung in sieben Karten (Phase 4.1, E-51). */
export default function TrainingSettingsPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const { notice, show } = useNotice();
  const training = useQuery({ queryKey: qk.training(id), queryFn: () => get<Training>(`/trainings/${id}`) });
  const units = useQuery({ queryKey: qk.orgUnits, queryFn: () => get<OrgUnit[]>('/org-units') });
  const requirements = useQuery({ queryKey: ['admin', 'requirements'], queryFn: () => get<Requirement[]>('/requirements') });

  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<DraftErrors>({});
  useEffect(() => {
    if (training.data && !dirty) setDraft(toSettingsDraft(training.data));
  }, [training.data, dirty]);

  const save = useMutation({
    mutationFn: async (d: SettingsDraft) => {
      const v = validateSettingsDraft(d);
      if (!v.value) throw new Error(ts.invalid);
      const changed = changedOnly(training.data!, v.value);
      if (Object.keys(changed.training).length) await patch(`/trainings/${id}`, changed.training);
      if (Object.keys(changed.settings).length) await patch(`/trainings/${id}/settings`, changed.settings);
      return Object.keys(changed.training).length + Object.keys(changed.settings).length;
    },
    onSuccess: async (n) => {
      setDirty(false);
      await qc.invalidateQueries({ queryKey: qk.training(id) });
      show(n ? ts.saved : ts.nothingChanged);
    },
    onError: (e) => {
      if (e instanceof ApiError) setErrors(Object.fromEntries(e.fields.map((f) => [f.path, f.message])) as DraftErrors);
    },
  });

  const linked = useMemo(() => (requirements.data ?? []).filter((r) => r.training_id === id && r.active), [requirements.data, id]);

  if (training.isPending || !draft) return training.error ? <ErrorPanel error={training.error} onRetry={() => void training.refetch()} /> : <Loading />;
  if (training.error) return <ErrorPanel error={training.error} onRetry={() => void training.refetch()} />;
  const t = training.data!;
  const hasEnglish = t.versions.some((v) => v.sprache === 'en');

  const set = <K extends keyof SettingsDraft>(k: K, value: SettingsDraft[K]) => {
    setDraft((p) => (p ? { ...p, [k]: value } : p));
    setDirty(true);
  };
  const num = (k: keyof SettingsDraft) => ({
    name: k,
    value: String(draft[k]),
    inputMode: k === 'factor' ? ('decimal' as const) : ('numeric' as const),
    onChange: (e: { target: { value: string } }) => set(k, e.target.value as never),
  });
  const toggle = (list: number[], v: number) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const submit = () => {
    const v = validateSettingsDraft(draft);
    setErrors(v.errors);
    if (!v.value) {
      show(ts.invalid, 'warn');
      return;
    }
    save.mutate(draft);
  };
  const preview = anlassLine(draft.anlassTyp, draft.anlassText);
  const live = draft.defaultDelivery === 'live_online';
  const scheduled = ['praesenz', 'live_online', 'kombiniert'].includes(draft.defaultDelivery);

  return (
    <>
      <div className="mb-5 md:mb-6">
        <Link
          to={`/verwaltung/schulungen/${id}`}
          className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-pill px-2 text-[14px] font-semibold text-accent-text underline-offset-4 hover:underline"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          {ts.back}
        </Link>
        <h1 className="font-heading text-[24px] leading-tight font-bold text-ink md:text-[28px]">{t.titel}</h1>
        <p className="mt-1 text-[14px] text-muted">{ts.pageTitle}</p>
      </div>
      <NoticeRegion notice={notice} className="mb-4 empty:hidden" />
      <Panel tone="accent" className="mb-5 flex items-start gap-2.5 text-[14px]">
        <Info aria-hidden="true" className="mt-0.5 size-[18px] shrink-0" />
        {ts.intro}
      </Panel>

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-5"
      >
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <SettingsCard title={ts.general.title} sub={ts.general.sub}>
            <Field label={ts.general.titel} required error={errors.titel}>
              <Input name="titel" value={draft.titel} onChange={(e) => set('titel', e.target.value)} />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={ts.general.kategorie}>
                <Input name="kategorie" value={draft.kategorie} onChange={(e) => set('kategorie', e.target.value)} />
              </Field>
              <Field label={ts.general.rechtsgrundlage}>
                <Input name="rechtsgrundlage" value={draft.rechtsgrundlage} onChange={(e) => set('rechtsgrundlage', e.target.value)} />
              </Field>
            </div>
            <Field label={ts.general.ansprechpartner}>
              <Input name="ansprechpartner" value={draft.ansprechpartner} onChange={(e) => set('ansprechpartner', e.target.value)} />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div role="group" aria-labelledby="zielgruppe-titel">
                <p id="zielgruppe-titel" className="mb-1.5 text-[13px] font-medium text-ink-2">{ts.general.audience}</p>
                <div className="flex flex-wrap gap-2">
                  {(units.data ?? []).map((u) => (
                    <ToggleChip
                      key={u.id}
                      pressed={draft.defaultOrgUnits.includes(u.id)}
                      onClick={() =>
                        set('defaultOrgUnits', draft.defaultOrgUnits.includes(u.id) ? draft.defaultOrgUnits.filter((x) => x !== u.id) : [...draft.defaultOrgUnits, u.id])
                      }
                    >
                      {u.name}
                    </ToggleChip>
                  ))}
                  {units.data?.length === 0 && <span className="text-[13px] text-muted">{ts.general.noUnits}</span>}
                </div>
                <p className="mt-1.5 text-[12.5px] text-muted">{ts.general.audienceHint}</p>
              </div>
              <div>
                <p className="mb-1.5 text-[13px] font-medium text-ink-2">{ts.general.languages}</p>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-pill bg-accent-soft px-3 py-1.5 text-[13px] font-semibold text-accent-text-strong">{ts.general.de}</span>
                  <span className={cn('rounded-pill px-3 py-1.5 text-[13px] font-semibold', hasEnglish ? 'bg-accent-soft text-accent-text-strong' : 'bg-bg text-muted')}>
                    {ts.general.en}
                  </span>
                </div>
                <p className="mt-1.5 text-[12.5px] text-muted">{ts.general.languagesHint(hasEnglish)}</p>
              </div>
            </div>
          </SettingsCard>

          <SettingsCard title={ts.anlass.title} sub={ts.anlass.sub}>
            <div role="radiogroup" aria-label={ts.anlass.label} className="flex flex-wrap gap-2">
              {ANLASS_TYPES.map((a) => (
                <button
                  key={a}
                  type="button"
                  role="radio"
                  aria-checked={draft.anlassTyp === a}
                  onClick={() => set('anlassTyp', a)}
                  className={cn(
                    'min-h-10 rounded-pill px-3.5 text-[13.5px] font-medium',
                    draft.anlassTyp === a ? 'bg-accent-soft font-semibold text-accent-text-strong ring-2 ring-accent ring-inset' : 'bg-bg text-ink-2 hover:text-ink',
                  )}
                >
                  {ANLASS_LABELS.de[a]}
                </button>
              ))}
            </div>
            <Field label={ts.anlass.text} required={draft.anlassTyp === 'anlass'} hint={ts.anlass.textHint} error={errors.anlassText}>
              <Textarea name="anlassText" rows={3} value={draft.anlassText} onChange={(e) => set('anlassText', e.target.value)} />
            </Field>
            {preview && (
              <div className="rounded-box bg-bg px-4 py-3 text-[14px]">
                <p className="text-[12.5px] text-muted">{ts.anlass.preview}</p>
                <p data-testid="anlass-vorschau">
                  <b>Anlass:</b> {preview}
                </p>
              </div>
            )}
          </SettingsCard>
        </div>

        <SettingsCard title={ts.delivery.title} sub={ts.delivery.sub}>
          <div role="radiogroup" aria-label={ts.delivery.title} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {DELIVERY_TYPES.map((d) => {
              const Icon = DELIVERY_ICONS[d];
              const on = draft.defaultDelivery === d;
              return (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => set('defaultDelivery', d)}
                  className={cn(
                    'flex min-h-28 flex-col items-start gap-1.5 rounded-box p-3.5 text-left',
                    on ? 'bg-accent-soft ring-2 ring-accent ring-inset' : 'bg-bg hover:bg-surface-hover',
                  )}
                >
                  <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-full bg-surface text-accent-text">
                    <Icon className="size-4" />
                  </span>
                  <span className={cn('text-[14px] font-semibold', on ? 'text-accent-text-strong' : 'text-ink')}>{DELIVERY_LABELS.de[d]}</span>
                  <span className="text-[12px] leading-snug text-muted">{ts.delivery.hints[d]}</span>
                </button>
              );
            })}
          </div>
          {(live || scheduled) && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {live && (
                <Field label={ts.delivery.platform}>
                  <Select name="defaultPlatform" value={draft.defaultPlatform} onChange={(e) => set('defaultPlatform', e.target.value as SettingsDraft['defaultPlatform'])}>
                    <option value="">{ts.delivery.noPlatform}</option>
                    {PLATFORMS.map((p) => (
                      <option key={p} value={p}>
                        {PLATFORM_LABELS[p]}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {live && (
                <Field label={ts.delivery.meetingUrl} hint={ts.delivery.meetingUrlHint} error={errors.defaultMeetingUrl}>
                  <Input name="defaultMeetingUrl" type="url" inputMode="url" value={draft.defaultMeetingUrl} onChange={(e) => set('defaultMeetingUrl', e.target.value)} />
                </Field>
              )}
              <Field label={ts.delivery.completeness} hint={ts.delivery.completenessHint} error={errors.completenessPct}>
                <UnitInput unit="%" {...num('completenessPct')} />
              </Field>
            </div>
          )}
        </SettingsCard>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <SettingsCard title={ts.reading.title} sub={ts.reading.sub}>
            <div className="grid grid-cols-2 gap-3">
              <Field label={ts.reading.wpm} error={errors.wordsPerMinute}>
                <UnitInput unit="Wörter/min" {...num('wordsPerMinute')} />
              </Field>
              <Field label={ts.reading.factor} error={errors.factor}>
                <Input {...num('factor')} />
              </Field>
              <Field label={ts.reading.floor} error={errors.floorSeconds}>
                <UnitInput unit="s" {...num('floorSeconds')} />
              </Field>
              <Field label={ts.reading.cap} error={errors.capSeconds}>
                <UnitInput unit="s" {...num('capSeconds')} />
              </Field>
            </div>
            <CheckboxField label={<span className="font-semibold">{ts.reading.strict}</span>} description={ts.reading.strictText} checked={draft.strictMode} onCheckedChange={(c) => set('strictMode', c === true)} />
            <CheckboxField label={<span className="font-semibold">{ts.reading.download}</span>} description={ts.reading.downloadText} checked={draft.allowDownload} onCheckedChange={(c) => set('allowDownload', c === true)} />
          </SettingsCard>

          <SettingsCard title={ts.quiz.title} sub={ts.quiz.sub}>
            <CheckboxField label={<span className="font-semibold">{ts.quiz.required}</span>} description={ts.quiz.requiredText} checked={draft.quizRequired} onCheckedChange={(c) => set('quizRequired', c === true)} />
            {draft.quizRequired && (
              <>
                <div className="grid grid-cols-3 gap-2.5">
                  <Field label={ts.quiz.count} error={errors.quizQuestionCount}>
                    <Input {...num('quizQuestionCount')} />
                  </Field>
                  <Field label={ts.quiz.passPct} error={errors.passPct}>
                    <UnitInput unit="%" {...num('passPct')} />
                  </Field>
                  <Field label={ts.quiz.attempts} error={errors.maxAttempts}>
                    <Input {...num('maxAttempts')} />
                  </Field>
                </div>
                <CheckboxField label={<span className="font-semibold">{ts.quiz.reinvite}</span>} description={ts.quiz.reinviteText} checked={draft.quizOnReinvite} onCheckedChange={(c) => set('quizOnReinvite', c === true)} />
              </>
            )}
          </SettingsCard>

          <SettingsCard title={ts.confirm.title} sub={ts.confirm.sub}>
            <Field label={ts.confirm.text}>
              <Textarea name="confirmText" rows={4} value={draft.confirmText} onChange={(e) => set('confirmText', e.target.value)} />
            </Field>
            <Field label={ts.confirm.level}>
              <Select name="signatureLevel" value={draft.signatureLevel} onChange={(e) => set('signatureLevel', e.target.value as SettingsDraft['signatureLevel'])}>
                {(['ees', 'fes', 'qes'] as const).map((l) => (
                  <option key={l} value={l}>
                    {ts.confirm.levels[l]}
                  </option>
                ))}
              </Select>
            </Field>
            <CheckboxField label={<span className="font-semibold">{ts.confirm.stepUp}</span>} description={ts.confirm.stepUpText} checked={draft.requireStepUp} onCheckedChange={(c) => set('requireStepUp', c === true)} />
            <CheckboxField label={<span className="font-semibold">{ts.confirm.countersign}</span>} description={ts.confirm.countersignText} checked={draft.countersignRequired} onCheckedChange={(c) => set('countersignRequired', c === true)} />
          </SettingsCard>
        </div>

        <SettingsCard title={ts.deadlines.title} sub={ts.deadlines.sub}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label={ts.deadlines.deadline}>
              <Select name="deadlineDays" value={draft.deadlineDays} onChange={(e) => set('deadlineDays', Number(e.target.value))}>
                {[...new Set([...DEADLINE_OPTIONS, draft.deadlineDays])].sort((a, b) => a - b).map((d) => (
                  <option key={d} value={d}>
                    {ts.deadlines.deadlineOption(d)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={ts.deadlines.interval} hint={linked[0] ? ts.deadlines.intervalFromRequirement(linked[0].interval_months) : undefined}>
              <Select name="intervalMonths" value={draft.intervalMonths} onChange={(e) => set('intervalMonths', Number(e.target.value))}>
                {[...new Set([...INTERVAL_OPTIONS, draft.intervalMonths])].sort((a, b) => a - b).map((m) => (
                  <option key={m} value={m}>
                    {ts.deadlines.intervalOption(m)}
                  </option>
                ))}
              </Select>
            </Field>
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-ink-2">{ts.deadlines.mandatory}</p>
              <p data-testid="pflicht-status" className={cn('text-[14px] font-semibold', linked.length ? 'text-success-text' : 'text-ink-2')}>
                {linked.length ? ts.deadlines.mandatoryYes(linked.map((r) => r.qualification_name).join(', ')) : ts.deadlines.mandatoryNo}
              </p>
              <Link to="/verwaltung/pflichtmatrix" className="text-[13px] font-semibold text-accent-text underline-offset-4 hover:underline">
                {ts.deadlines.toMatrix}
              </Link>
            </div>
            <div role="group" aria-labelledby="erinnerungen-titel">
              <p id="erinnerungen-titel" className="mb-1.5 text-[13px] font-medium text-ink-2">{ts.deadlines.reminders}</p>
              <div className="flex flex-wrap gap-2">
                {REMINDER_BEFORE_OPTIONS.map((d) => (
                  <ToggleChip key={`v${d}`} pressed={draft.reminderDaysBefore.includes(d)} onClick={() => set('reminderDaysBefore', toggle(draft.reminderDaysBefore, d))}>
                    {ts.deadlines.remindBefore(d)}
                  </ToggleChip>
                ))}
              </div>
              <div className="mt-2">
                <SegmentedControl
                  aria-label={ts.deadlines.reminders}
                  size="sm"
                  value={String(draft.reminderDaysAfter)}
                  onValueChange={(v) => set('reminderDaysAfter', Number(v))}
                  options={REMINDER_AFTER_OPTIONS.map((d) => ({ value: String(d), label: d === 0 ? 'keine danach' : ts.deadlines.remindAfter(d) }))}
                />
              </div>
              <p className="mt-1.5 text-[12.5px] text-muted">{ts.deadlines.remindersHint}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className="text-[13px] text-muted">
              {dirty ? <b className="text-warn-text">{ts.unsaved}</b> : t.updatedAt ? ts.lastChanged(fmtDateTime(t.updatedAt)) : null}
            </p>
            <div className="flex gap-2.5">
              <Button
                type="button"
                variant="secondary"
                disabled={!dirty || save.isPending}
                onClick={() => {
                  setDirty(false);
                  setErrors({});
                  setDraft(toSettingsDraft(t));
                }}
              >
                {ts.discard}
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? ts.saving : ts.save}
              </Button>
            </div>
          </div>
        </SettingsCard>
      </form>
    </>
  );
}
