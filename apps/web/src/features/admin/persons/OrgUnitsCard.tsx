import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { del, patch, post } from '@/lib/api';
import { adm } from '@/i18n/admin';
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
  Select,
  Sheet,
} from '@/components/ui';
import { qk, type OrgUnit, type Person } from '../api';
import { ConfirmSheet, errorMessage } from '../components/common';

const u = adm.persons.units;

function UnitSheet({
  unit,
  units,
  persons,
  open,
  onOpenChange,
  onSaved,
}: {
  unit: OrgUnit | null;
  units: OrgUnit[];
  persons: Person[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: (m: string) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(unit?.name ?? '');
  const [parentId, setParentId] = useState(unit?.parent_id ?? '');
  const [leiterId, setLeiterId] = useState(unit?.leiter_person_id ?? '');
  const [local, setLocal] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = { name, parentId: parentId || null, leiterPersonId: leiterId || null };
      return unit ? patch(`/org-units/${unit.id}`, body) : post('/org-units', body);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.orgUnits });
      void qc.invalidateQueries({ queryKey: qk.personsAll });
      onSaved(u.saved);
      onOpenChange(false);
    },
  });
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={unit ? u.sheetEdit : u.sheetNew}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {adm.common.cancel}
          </Button>
          <Button
            disabled={save.isPending}
            onClick={() => {
              if (!name.trim()) return setLocal(adm.auth.required);
              setLocal(null);
              save.mutate();
            }}
          >
            {save.isPending ? adm.common.saving : adm.common.save}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && (
          <Panel tone="danger" role="alert">
            {errorMessage(save.error)}
          </Panel>
        )}
        <Field label={u.name} required error={local ?? undefined}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={u.parent}>
          <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">{u.parentNone}</option>
            {units
              .filter((x) => x.id !== unit?.id)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={u.leiter}>
          <Select value={leiterId} onChange={(e) => setLeiterId(e.target.value)}>
            <option value="">{u.leiterNone}</option>
            {persons.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Sheet>
  );
}

/** Org-Einheiten: einfache Liste mit übergeordneter Einheit und Leitung. */
export function OrgUnitsCard({
  units,
  persons,
  manage,
  onNotice,
}: {
  units: OrgUnit[];
  persons: Person[];
  manage: boolean;
  onNotice: (m: string, tone?: 'success' | 'danger') => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<OrgUnit | null>(null);
  const [open, setOpen] = useState(false);
  const [sheetKey, setSheetKey] = useState(0);
  const [deleting, setDeleting] = useState<OrgUnit | null>(null);
  const names = useMemo(() => new Map(units.map((x) => [x.id, x.name])), [units]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of persons) if (p.org_unit_id) m.set(p.org_unit_id, (m.get(p.org_unit_id) ?? 0) + 1);
    return m;
  }, [persons]);
  const remove = useMutation({
    mutationFn: (x: OrgUnit) => del(`/org-units/${x.id}`),
    onSuccess: () => {
      setDeleting(null);
      onNotice(u.deleted);
      void qc.invalidateQueries({ queryKey: qk.orgUnits });
      void qc.invalidateQueries({ queryKey: qk.personsAll });
    },
    onError: (e) => onNotice(errorMessage(e), 'danger'),
  });
  const openSheet = (x: OrgUnit | null) => {
    setEditing(x);
    setSheetKey((k) => k + 1);
    setOpen(true);
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{u.title}</CardTitle>
          <CardDescription>{u.subtitle}</CardDescription>
        </div>
        {manage && (
          <Button variant="secondary" size="sm" onClick={() => openSheet(null)}>
            <Plus aria-hidden="true" className="size-4" />
            {u.add}
          </Button>
        )}
      </CardHeader>
      {units.length === 0 ? (
        <p className="text-[14px] text-muted">{u.empty}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-1">
          {units.map((x) => (
            <li key={x.id} className="flex items-center gap-3 rounded-box bg-bg py-2 pr-2 pl-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-ink">{x.name}</p>
                <p className="truncate text-[13px] text-muted">
                  {[
                    u.count(counts.get(x.id) ?? 0),
                    x.parent_id && names.get(x.parent_id) ? u.parentValue(names.get(x.parent_id)!) : null,
                    x.leiter_name ? u.leiterValue(x.leiter_name) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              {manage && (
                <>
                  <IconButton variant="ghost" aria-label={u.editNamed(x.name)} onClick={() => openSheet(x)}>
                    <Pencil aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    variant="ghost"
                    aria-label={u.deleteNamed(x.name)}
                    onClick={() => setDeleting(x)}
                  >
                    <Trash2 aria-hidden="true" />
                  </IconButton>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {open && (
        <UnitSheet
          key={sheetKey}
          unit={editing}
          units={units}
          persons={persons}
          open={open}
          onOpenChange={setOpen}
          onSaved={(m) => onNotice(m)}
        />
      )}
      <ConfirmSheet
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting ? u.deleteTitle(deleting.name) : ''}
        description={u.deleteText}
        confirmLabel={adm.common.delete}
        tone="danger-soft"
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </Card>
  );
}
