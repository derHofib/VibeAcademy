import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '@/lib/api';
import { Button, CheckboxField, Field, Input, Panel, SegmentedControl, Select, Sheet } from '@/components/ui';
import { tl } from '@/i18n/live';
import { qk, type TrainingListItem } from '@/features/admin/api';
import { errorMessage } from '@/features/admin/components/common';
import { fieldErrors } from '@/features/auth/session';
import { livePath, liveKeys, type RunTyp } from '@/features/live/api';
import { PersonPicker, usePersonsAndUnits } from './PersonPicker';
import { buildTerminPayload, defaultTerminValues, type TerminErrors, type TerminFormValues } from './terminForm';

const f = tl.form;

/** „Termin anlegen“: Art, Schulung oder freier Titel + Anbieter, Datum/Zeit, Ort, Trainer, Teilnehmende, Vollständigkeit. */
export function TerminCreateSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [v, setV] = useState<TerminFormValues>(() => defaultTerminValues());
  const [errors, setErrors] = useState<TerminErrors & Record<string, string | undefined>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const trainings = useQuery({ queryKey: qk.trainings, queryFn: () => get<TrainingListItem[]>('/trainings'), enabled: open });
  const { persons, units } = usePersonsAndUnits();
  const set = <K extends keyof TerminFormValues>(k: K, val: TerminFormValues[K]) => setV((x) => ({ ...x, [k]: val }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = buildTerminPayload(v);
    if ('errors' in r) {
      setErrors(r.errors);
      return;
    }
    setErrors({});
    setApiError(null);
    setPending(true);
    try {
      const res = await post<{ id: string }>('/runs/termin', r.payload);
      await qc.invalidateQueries({ queryKey: liveKeys.termine });
      onOpenChange(false);
      setV(defaultTerminValues());
      navigate(livePath.organizer(res.id));
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors({ ...fe, end: fe.endAt, date: fe.startAt });
      setApiError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const activeTrainings = (trainings.data ?? []).filter((t) => !t.archived_at);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={f.title}
      description={f.description}
      desktopPlacement="right"
      className="md:w-[min(560px,calc(100vw-32px))]"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {tl.common.cancel}
          </Button>
          <Button type="submit" form="termin-anlegen" disabled={pending}>
            {pending ? f.submitting : f.submit}
          </Button>
        </>
      }
    >
      <form id="termin-anlegen" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <span aria-hidden="true" className="text-[13px] font-medium text-muted">
            {f.typ}
          </span>
          <SegmentedControl<RunTyp>
            aria-label={f.typ}
            fullWidth
            value={v.typ}
            onValueChange={(t) => set('typ', t)}
            options={[
              { value: 'live_extern', label: tl.typ.live_extern },
              { value: 'termin', label: tl.typ.termin },
            ]}
          />
        </div>
        <Field label={f.training} hint={f.trainingHint} error={errors.trainingId} required={v.typ === 'termin'}>
          <Select value={v.trainingId} onChange={(e) => set('trainingId', e.target.value)}>
            <option value="">{v.typ === 'termin' ? '–' : f.trainingNone}</option>
            {activeTrainings.map((t) => (
              <option key={t.id} value={t.id}>
                {t.titel}
              </option>
            ))}
          </Select>
        </Field>
        {(v.typ === 'live_extern' || !v.trainingId) && (
          <Field label={f.titel} error={errors.titel}>
            <Input value={v.titel} onChange={(e) => set('titel', e.target.value)} placeholder={f.titelPlaceholder} maxLength={300} />
          </Field>
        )}
        {v.typ === 'live_extern' && (
          <Field label={f.provider}>
            <Input value={v.provider} onChange={(e) => set('provider', e.target.value)} placeholder={f.providerPlaceholder} maxLength={300} />
          </Field>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
          <Field label={f.date} error={errors.date} required>
            <Input type="date" value={v.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <Field label={f.start} required>
            <Input type="time" value={v.start} onChange={(e) => set('start', e.target.value)} />
          </Field>
          <Field label={f.end} error={errors.end} required>
            <Input type="time" value={v.end} onChange={(e) => set('end', e.target.value)} />
          </Field>
        </div>
        <Field label={f.ort}>
          <Input value={v.ort} onChange={(e) => set('ort', e.target.value)} placeholder={f.ortPlaceholder} maxLength={300} />
        </Field>
        <Field label={f.trainer}>
          <Select value={v.trainerPersonId} onChange={(e) => set('trainerPersonId', e.target.value)}>
            <option value="">{f.trainerNone}</option>
            {persons.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={f.completeness} hint={f.completenessHint} error={errors.completenessPct}>
          <Input type="number" inputMode="numeric" min={1} max={100} value={v.completenessPct} onChange={(e) => set('completenessPct', e.target.value)} />
        </Field>
        <CheckboxField checked={v.allowWalkIn} onCheckedChange={(c) => set('allowWalkIn', c === true)} label={f.walkIn} />
        <div className="flex flex-col gap-2 pt-1">
          <h3 className="font-heading text-[15.5px] font-bold text-ink">{f.participants}</h3>
          <p className="text-[13px] text-muted">{f.participantsHint}</p>
          <PersonPicker
            value={{ personIds: v.personIds, orgUnitIds: v.orgUnitIds }}
            onChange={(sel) => setV((x) => ({ ...x, ...sel }))}
            persons={persons}
            units={units}
          />
          <CheckboxField checked={v.sendMail} onCheckedChange={(c) => set('sendMail', c === true)} label={f.sendMail} />
        </div>
        {apiError && (
          <Panel tone="danger" role="alert">
            {apiError}
          </Panel>
        )}
      </form>
    </Sheet>
  );
}
