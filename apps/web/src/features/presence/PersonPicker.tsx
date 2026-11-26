import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { get } from '@/lib/api';
import { Checkbox, Input } from '@/components/ui';
import { tl } from '@/i18n/live';
import { qk, personsQueryFn, type OrgUnit, type Person } from '@/features/admin/api';

export interface PersonSelection {
  personIds: string[];
  orgUnitIds: string[];
}

const toggle = (list: string[], id: string, on: boolean) => (on ? [...new Set([...list, id])] : list.filter((x) => x !== id));

export function usePersonsAndUnits() {
  const persons = useQuery({ queryKey: qk.persons('', ''), queryFn: personsQueryFn('', '') });
  const units = useQuery({ queryKey: qk.orgUnits, queryFn: () => get<OrgUnit[]>('/org-units') });
  return { persons: persons.data ?? [], units: units.data ?? [], loading: persons.isPending || units.isPending };
}

/** Kompakte Auswahl von Personen und Org-Einheiten (Termin anlegen, Teilnehmende hinzufügen). */
export function PersonPicker({
  value,
  onChange,
  exclude = [],
  persons,
  units,
}: {
  value: PersonSelection;
  onChange: (v: PersonSelection) => void;
  /** bereits eingeladene Personen */
  exclude?: string[];
  persons: Person[];
  units: OrgUnit[];
}) {
  const [q, setQ] = useState('');
  const f = tl.form;
  const excluded = useMemo(() => new Set(exclude), [exclude]);
  const filtered = useMemo(() => {
    const s = q.trim().toLocaleLowerCase('de-DE');
    return persons
      .filter((p) => !excluded.has(p.id))
      .filter((p) => !s || [p.name, p.email, p.personalnr, p.org_unit_name].some((x) => x?.toLocaleLowerCase('de-DE').includes(s)));
  }, [persons, q, excluded]);

  return (
    <div className="flex flex-col gap-3">
      {units.length > 0 && (
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-muted">{f.units}</legend>
          <ul className="flex flex-wrap gap-2">
            {units.map((u) => {
              const id = `pp-ou-${u.id}`;
              return (
                <li key={u.id} className="flex min-h-11 items-center gap-2.5 rounded-pill bg-bg py-1.5 pr-4 pl-3">
                  <Checkbox
                    id={id}
                    checked={value.orgUnitIds.includes(u.id)}
                    onCheckedChange={(c) => onChange({ ...value, orgUnitIds: toggle(value.orgUnitIds, u.id, c === true) })}
                  />
                  <label htmlFor={id} className="cursor-pointer text-[14px] font-medium text-ink">
                    {u.name}
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted" />
        <Input type="search" aria-label={f.search} placeholder={f.search} value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
      </div>
      <ul aria-label={f.participants} className="flex max-h-[260px] flex-col gap-1.5 overflow-y-auto pr-1">
        {filtered.map((p) => {
          const id = `pp-p-${p.id}`;
          return (
            <li key={p.id} className="flex min-h-12 items-center gap-3 rounded-[16px] bg-bg px-3.5 py-1.5">
              <Checkbox
                id={id}
                checked={value.personIds.includes(p.id)}
                onCheckedChange={(c) => onChange({ ...value, personIds: toggle(value.personIds, p.id, c === true) })}
              />
              <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                <span className="block truncate text-[14.5px] font-medium text-ink">{p.name}</span>
                {(p.org_unit_name || p.email) && <span className="block truncate text-[12.5px] text-muted">{p.org_unit_name ?? p.email}</span>}
              </label>
            </li>
          );
        })}
      </ul>
      <p className="text-[13px] text-muted" aria-live="polite">
        {f.selected(value.personIds.length)}
      </p>
    </div>
  );
}
