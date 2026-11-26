import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Search, Users } from 'lucide-react';
import { adm } from '@/i18n/admin';
import {
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  EmptyState,
  Input,
  Panel,
  StatusChip,
} from '@/components/ui';
import type { OrgUnit, Person } from '../api';
import { audiencePreview } from '../wizard';

const a = adm.wizard.audience;

export interface AudienceSelection {
  personIds: string[];
  orgUnitIds: string[];
}

function toggle(list: string[], id: string, on: boolean) {
  return on ? [...new Set([...list, id])] : list.filter((x) => x !== id);
}

/** Schritt 3: Personen und/oder Org-Einheiten wählen, Vorschau der Anzahl. */
export function AudienceStep({
  persons,
  units,
  value,
  onChange,
  footer,
}: {
  persons: Person[];
  units: OrgUnit[];
  value: AudienceSelection;
  onChange: (v: AudienceSelection) => void;
  footer: ReactNode;
}) {
  const [q, setQ] = useState('');
  const preview = useMemo(
    () => audiencePreview(persons, units, value.personIds, value.orgUnitIds),
    [persons, units, value],
  );
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of persons) if (p.org_unit_id) m.set(p.org_unit_id, (m.get(p.org_unit_id) ?? 0) + 1);
    return m;
  }, [persons]);
  const unitName = useMemo(() => new Map(units.map((u) => [u.id, u.name])), [units]);
  const filtered = useMemo(() => {
    const s = q.trim().toLocaleLowerCase('de-DE');
    if (!s) return persons;
    return persons.filter((p) =>
      [p.name, p.email, p.personalnr, p.org_unit_name].some((x) => x?.toLocaleLowerCase('de-DE').includes(s)),
    );
  }, [persons, q]);
  const viaUnit = new Set(preview.ids);

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-5">
        <Card radius="lg" padding="lg">
          <CardHeader>
            <div>
              <CardTitle>{a.units}</CardTitle>
              <CardDescription>{a.unitsHint}</CardDescription>
            </div>
          </CardHeader>
          {units.length === 0 ? (
            <p className="text-[14px] text-muted">{a.unitsEmpty}</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {units.map((u) => {
                const id = `ou-${u.id}`;
                return (
                  <li key={u.id} className="flex min-h-14 items-center gap-3.5 rounded-box bg-bg px-4 py-2.5">
                    <Checkbox
                      id={id}
                      checked={value.orgUnitIds.includes(u.id)}
                      onCheckedChange={(c) =>
                        onChange({ ...value, orgUnitIds: toggle(value.orgUnitIds, u.id, c === true) })
                      }
                    />
                    <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                      <span className="block truncate text-[15px] font-semibold text-ink">{u.name}</span>
                      <span className="block text-[13px] text-muted">
                        {a.unitCount(counts.get(u.id) ?? 0)}
                        {u.parent_id && unitName.get(u.parent_id)
                          ? ` · ${adm.persons.units.parentValue(unitName.get(u.parent_id)!)}`
                          : ''}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card radius="lg" padding="lg">
          <CardHeader>
            <CardTitle>{a.persons}</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link to="/verwaltung/personen">{a.managePersons}</Link>
            </Button>
          </CardHeader>
          {persons.length === 0 ? (
            <EmptyState
              icon={<Users />}
              title={a.personsEmpty}
              action={
                <Button asChild variant="secondary">
                  <Link to="/verwaltung/personen">{a.managePersons}</Link>
                </Button>
              }
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-0 flex-1 basis-56">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted"
                  />
                  <Input
                    aria-label={a.search}
                    placeholder={a.search}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    className="pl-10"
                    type="search"
                  />
                </div>
                <Button
                  variant="tonal"
                  size="sm"
                  onClick={() =>
                    onChange({
                      ...value,
                      personIds: [...new Set([...value.personIds, ...filtered.map((p) => p.id)])],
                    })
                  }
                >
                  {a.selectAll}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onChange({ personIds: [], orgUnitIds: [] })}>
                  {a.clear}
                </Button>
              </div>
              <ul className="mt-3 flex max-h-[480px] flex-col gap-1.5 overflow-y-auto pr-1">
                {filtered.map((p) => {
                  const id = `p-${p.id}`;
                  const direct = value.personIds.includes(p.id);
                  return (
                    <li key={p.id} className="flex min-h-14 items-center gap-3.5 rounded-box bg-bg px-4 py-2">
                      <Checkbox
                        id={id}
                        checked={direct || viaUnit.has(p.id)}
                        disabled={!direct && viaUnit.has(p.id)}
                        onCheckedChange={(c) =>
                          onChange({ ...value, personIds: toggle(value.personIds, p.id, c === true) })
                        }
                      />
                      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                        <span className="block truncate text-[15px] font-medium text-ink">{p.name}</span>
                        <span className="block truncate text-[13px] text-muted">
                          {[p.org_unit_name, p.personalnr].filter(Boolean).join(' · ') || '—'}
                        </span>
                      </label>
                      {!p.email && <StatusChip tone="warn">{a.noEmail}</StatusChip>}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Card>
      </div>

      <div className="flex flex-col gap-4 xl:sticky xl:top-7 xl:self-start">
        <Card radius="lg" padding="lg" className="flex flex-col gap-3">
          <CardTitle>{a.preview}</CardTitle>
          <p
            className="font-heading text-[32px] leading-none font-bold text-ink tabular-nums"
            aria-live="polite"
          >
            <span className="sr-only">{a.previewCount(preview.total)}</span>
            <span aria-hidden="true">{preview.total}</span>
          </p>
          <p aria-hidden="true" className="text-[14px] text-muted">
            {a.previewCount(preview.total)}
          </p>
          {preview.withoutEmail > 0 && <Panel tone="warn">{a.previewNoEmail(preview.withoutEmail)}</Panel>}
        </Card>
        {footer}
      </div>
    </div>
  );
}
