import { useDeferredValue, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Award, FileUp, Pencil, Search, UserPlus, Users } from 'lucide-react';
import { PersonQualificationsSheet } from '@/features/matrix/PersonQualificationsSheet';
import { tx } from '@/i18n/external';
import { get } from '@/lib/api';
import { adm } from '@/i18n/admin';
import { PageHeader } from '@/components/layout/PageHeader';
import { Avatar, Button, Card, EmptyState, IconButton, Input, Select, StatusChip } from '@/components/ui';
import { personsQueryFn, qk, type OrgUnit, type Person } from '@/features/admin/api';
import { DataTable } from '@/features/admin/components/DataTable';
import { ErrorPanel, Loading, NoticeRegion, useNotice } from '@/features/admin/components/common';
import { PersonSheet } from '@/features/admin/persons/PersonSheet';
import { ImportSheet } from '@/features/admin/persons/ImportSheet';
import { OrgUnitsCard } from '@/features/admin/persons/OrgUnitsCard';
import { canManage } from '@/features/auth/session';
import { useAdminMe } from '@/features/admin/hooks';

const p = adm.persons;

function Badges({ person }: { person: Person }) {
  return (
    <>
      {person.extern && <StatusChip tone="neutral">{p.extern}</StatusChip>}
      {person.birthdate_under18 && <StatusChip tone="warn">{p.under18}</StatusChip>}
    </>
  );
}

export default function PersonsPage() {
  const me = useAdminMe();
  const manage = canManage(me);
  const { notice, show } = useNotice();
  const [q, setQ] = useState('');
  const [org, setOrg] = useState('');
  const dq = useDeferredValue(q);
  const [editing, setEditing] = useState<Person | null>(null);
  const [open, setOpen] = useState(false);
  const [sheetKey, setSheetKey] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [qualFor, setQualFor] = useState<Person | null>(null);

  const all = useQuery({ queryKey: qk.persons(), queryFn: () => get<Person[]>('/persons') });
  const filtered = useQuery({
    queryKey: qk.persons(dq, org),
    queryFn: personsQueryFn(dq, org),
    enabled: !!(dq.trim() || org),
    placeholderData: keepPreviousData,
  });
  const units = useQuery({ queryKey: qk.orgUnits, queryFn: () => get<OrgUnit[]>('/org-units') });
  const rows = dq.trim() || org ? (filtered.data ?? []) : (all.data ?? []);

  const openSheet = (x: Person | null) => {
    setEditing(x);
    setSheetKey((k) => k + 1);
    setOpen(true);
  };

  const columns = useMemo<ColumnDef<Person, unknown>[]>(
    () => [
      {
        id: 'name',
        header: p.colName,
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <Avatar name={row.original.name} />
            <span className="font-semibold whitespace-nowrap text-ink">{row.original.name}</span>
            <Badges person={row.original} />
          </div>
        ),
      },
      {
        id: 'nr',
        header: p.colNr,
        cell: ({ row }) => <span className="tabular-nums">{row.original.personalnr ?? '—'}</span>,
      },
      {
        id: 'email',
        header: p.colEmail,
        cell: ({ row }) =>
          row.original.email ?? <StatusChip tone="warn">{adm.wizard.audience.noEmail}</StatusChip>,
      },
      {
        id: 'unit',
        header: p.colUnit,
        cell: ({ row }) => <span className="whitespace-nowrap">{row.original.org_unit_name ?? '—'}</span>,
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{p.colActions}</span>,
        cell: ({ row }) => (
          <span className="flex justify-end gap-1">
            <IconButton
              variant="ghost"
              aria-label={tx.matrix.personSheet.actionNamed(row.original.name)}
              onClick={() => setQualFor(row.original)}
            >
              <Award aria-hidden="true" />
            </IconButton>
            {manage && (
              <IconButton
                variant="ghost"
                aria-label={p.editNamed(row.original.name)}
                onClick={() => openSheet(row.original)}
              >
                <Pencil aria-hidden="true" />
              </IconButton>
            )}
          </span>
        ),
        meta: { className: 'w-[112px] text-right' },
      },
    ],
    [manage],
  );

  return (
    <>
      <PageHeader
        title={p.title}
        description={all.data ? p.subtitle(all.data.length) : undefined}
        actions={
          manage && (
            <>
              <Button variant="secondary" onClick={() => setImportOpen(true)}>
                <FileUp aria-hidden="true" className="size-[18px]" />
                {p.importAction}
              </Button>
              <Button onClick={() => openSheet(null)}>
                <UserPlus aria-hidden="true" className="size-[18px]" />
                {p.add}
              </Button>
            </>
          )
        }
      />
      <NoticeRegion notice={notice} className="mb-4 empty:hidden" />

      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="min-w-0">
          <div className="mb-3 flex flex-wrap gap-2.5">
            <div className="relative min-w-0 flex-1 basis-60">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted"
              />
              <Input
                type="search"
                aria-label={p.searchLabel}
                placeholder={p.search}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="w-full sm:w-60">
              <Select aria-label={p.orgFilter} value={org} onChange={(e) => setOrg(e.target.value)}>
                <option value="">{p.orgAll}</option>
                {units.data?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {all.isPending ? (
            <Loading />
          ) : all.isError ? (
            <ErrorPanel error={all.error} onRetry={() => all.refetch()} />
          ) : (
            <DataTable
              data={rows}
              columns={columns}
              label={p.title}
              getRowId={(x) => x.id}
              query="(min-width: 1024px)"
              empty={
                <EmptyState
                  icon={<Users />}
                  title={all.data.length ? p.noHits : p.empty}
                  action={
                    manage &&
                    !all.data.length && (
                      <Button onClick={() => openSheet(null)}>
                        <UserPlus aria-hidden="true" className="size-[18px]" />
                        {p.add}
                      </Button>
                    )
                  }
                />
              }
              renderCard={(x) => (
                <div className="flex items-center gap-3">
                  <Avatar name={x.name} size="lg" tone="surface" />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-[15px] font-semibold text-ink">
                      {x.name} <Badges person={x} />
                    </p>
                    <p className="truncate text-[13px] text-muted">
                      {[x.org_unit_name, x.personalnr, x.email ?? adm.wizard.audience.noEmail]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <IconButton variant="ghost" aria-label={tx.matrix.personSheet.actionNamed(x.name)} onClick={() => setQualFor(x)}>
                    <Award aria-hidden="true" />
                  </IconButton>
                  {manage && (
                    <IconButton variant="ghost" aria-label={p.editNamed(x.name)} onClick={() => openSheet(x)}>
                      <Pencil aria-hidden="true" />
                    </IconButton>
                  )}
                </div>
              )}
            />
          )}
        </Card>

        {units.isSuccess && (
          <OrgUnitsCard
            units={units.data}
            persons={all.data ?? []}
            manage={manage}
            onNotice={(m, tone) => show(m, tone)}
          />
        )}
      </div>

      {open && (
        <PersonSheet
          key={sheetKey}
          person={editing}
          units={units.data ?? []}
          open={open}
          onOpenChange={setOpen}
          onSaved={() => show(p.saved)}
        />
      )}
      {importOpen && <ImportSheet open={importOpen} onOpenChange={setImportOpen} />}
      {qualFor && (
        <PersonQualificationsSheet
          person={qualFor}
          manage={manage}
          onClose={() => setQualFor(null)}
          onSaved={() => {
            setQualFor(null);
            show(tx.matrix.personSheet.saved);
          }}
        />
      )}
    </>
  );
}
