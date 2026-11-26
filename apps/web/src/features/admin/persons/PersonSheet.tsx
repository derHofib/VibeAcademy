import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { patch, post } from '@/lib/api';
import { adm } from '@/i18n/admin';
import { Button, CheckboxField, Field, Input, Panel, Select, Sheet } from '@/components/ui';
import { fieldErrors } from '@/features/auth/session';
import { type OrgUnit, type Person } from '../api';
import { formatDecimal, parseDecimal } from '../format';
import { errorMessage } from '../components/common';

const p = adm.persons;

interface Draft {
  name: string;
  personalnr: string;
  email: string;
  mobil: string;
  orgUnitId: string;
  extern: boolean;
  birthdateUnder18: boolean;
  readingTimeFactor: string;
  austrittAm: string;
}

export function PersonSheet({
  person,
  units,
  open,
  onOpenChange,
  onSaved,
}: {
  person: Person | null;
  units: OrgUnit[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(() => ({
    name: person?.name ?? '',
    personalnr: person?.personalnr ?? '',
    email: person?.email ?? '',
    mobil: person?.mobil ?? '',
    orgUnitId: person?.org_unit_id ?? '',
    extern: person?.extern ?? false,
    birthdateUnder18: person?.birthdate_under18 ?? false,
    readingTimeFactor: formatDecimal(Number(person?.reading_time_factor ?? 1)),
    austrittAm: person?.austritt_am?.slice(0, 10) ?? '',
  }));
  const [local, setLocal] = useState<Partial<Record<keyof Draft, string>>>({});
  const save = useMutation({
    mutationFn: (x: Draft) => {
      const body = {
        name: x.name,
        personalnr: x.personalnr || null,
        email: x.email || null,
        mobil: x.mobil || null,
        orgUnitId: x.orgUnitId || null,
        extern: x.extern,
        birthdateUnder18: x.birthdateUnder18,
        readingTimeFactor: parseDecimal(x.readingTimeFactor),
        austrittAm: x.austrittAm || null,
      };
      return person ? patch(`/persons/${person.id}`, body) : post('/persons', body);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin', 'persons'] });
      onSaved();
      onOpenChange(false);
    },
  });
  const fe = { ...(fieldErrors(save.error) as Partial<Record<keyof Draft, string>>), ...local };
  const general =
    save.error && !Object.keys(fieldErrors(save.error)).length ? errorMessage(save.error) : null;
  const set = (k: keyof Draft) => (e: { target: { value: string } }) =>
    setD((x) => ({ ...x, [k]: e.target.value }));

  const submit = () => {
    const errs: typeof local = {};
    if (!d.name.trim()) errs.name = adm.auth.required;
    if (d.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim()))
      errs.email = adm.auth.invalidEmail;
    const f = parseDecimal(d.readingTimeFactor);
    if (Number.isNaN(f) || f < 1 || f > 5) errs.readingTimeFactor = adm.wizard.rules.range(1, 5);
    setLocal(errs);
    if (!Object.keys(errs).length) save.mutate(d);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={person ? p.sheetEdit : p.sheetNew}
      desktopPlacement="right"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {adm.common.cancel}
          </Button>
          <Button type="submit" form="person-form" disabled={save.isPending}>
            {save.isPending ? adm.common.saving : adm.common.save}
          </Button>
        </>
      }
    >
      <form
        id="person-form"
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {general && (
          <Panel tone="danger" role="alert">
            {general}
          </Panel>
        )}
        <Field label={p.name} required error={fe.name}>
          <Input value={d.name} onChange={set('name')} autoComplete="off" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={p.personalnr} error={fe.personalnr}>
            <Input value={d.personalnr} onChange={set('personalnr')} />
          </Field>
          <Field label={p.orgUnit} error={fe.orgUnitId}>
            <Select value={d.orgUnitId} onChange={set('orgUnitId')}>
              <option value="">{p.orgNone}</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={p.email} hint={p.emailHint} error={fe.email}>
          <Input type="email" inputMode="email" value={d.email} onChange={set('email')} />
        </Field>
        <Field label={p.mobil} error={fe.mobil}>
          <Input type="tel" value={d.mobil} onChange={set('mobil')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={p.factor} hint={p.factorHint} error={fe.readingTimeFactor}>
            <Input inputMode="decimal" value={d.readingTimeFactor} onChange={set('readingTimeFactor')} />
          </Field>
          <Field label={p.exitDate} error={fe.austrittAm}>
            <Input type="date" value={d.austrittAm} onChange={set('austrittAm')} />
          </Field>
        </div>
        <CheckboxField
          label={p.externLabel}
          checked={d.extern}
          onCheckedChange={(c) => setD((x) => ({ ...x, extern: c === true }))}
        />
        <CheckboxField
          label={p.under18Label}
          checked={d.birthdateUnder18}
          onCheckedChange={(c) => setD((x) => ({ ...x, birthdateUnder18: c === true }))}
        />
      </form>
    </Sheet>
  );
}
