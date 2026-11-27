import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Building2, Plus, Search } from 'lucide-react';
import { BOOKING_STATUS_LABELS, formatEuro } from '@sn/shared';
import { get } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, Card, CardTitle, EmptyState, Input, KpiTile, SegmentedControl, Select, StatusChip } from '@/components/ui';
import { DataTable } from '@/features/admin/components/DataTable';
import { ErrorPanel, Loading } from '@/features/admin/components/common';
import {
  bookingKeys, matchesFilter, overallStatus, statusTone, type BookingFilter, type BookingReport, type BookingView,
} from '@/features/external-bookings/api';
import { teb } from '@/i18n/external-bookings';

const t = teb.list;
const when = (b: BookingView) =>
  b.days.length ? (b.days.length === 1 ? b.days[0]!.label.split(',')[0]! : `${b.days[0]!.label.split(',')[0]} – ${b.days.at(-1)!.label.split(',')[0]}`) : '—';

const columns: ColumnDef<BookingView, unknown>[] = [
  {
    id: 'titel',
    header: t.colTraining,
    meta: { className: 'w-[34%]' },
    cell: ({ row }) => (
      <div className="min-w-0">
        <Link to={`/verwaltung/externe-schulungen/${row.original.id}`} className="text-[15px] font-semibold text-ink underline-offset-4 hover:text-accent-text hover:underline">
          {row.original.titel}
        </Link>
        <p className="text-[13px] text-muted">{row.original.provider.name}</p>
      </div>
    ),
  },
  { id: 'when', header: t.colWhen, cell: ({ row }) => <span className="tabular-nums">{when(row.original)}</span> },
  { id: 'persons', header: t.colPersons, cell: ({ row }) => row.original.participants.map((p) => p.name).join(', ') || '—' },
  {
    id: 'status',
    header: t.colStatus,
    cell: ({ row }) => {
      const s = overallStatus(row.original);
      return <StatusChip tone={statusTone(s)}>{BOOKING_STATUS_LABELS[s]}</StatusChip>;
    },
  },
  {
    id: 'costs',
    header: t.colCosts,
    meta: { className: 'text-right' },
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.cancelled ? formatEuro(row.original.costs.cancelCostCents ?? 0) : formatEuro(row.original.costs.totalCents)}</span>
    ),
  },
];

/** `/verwaltung/externe-schulungen` – Übersicht mit Kennzahlen, Filtern und Auswertung (E-55). */
export default function ExternalBookingsPage() {
  const list = useQuery({ queryKey: bookingKeys.list, queryFn: () => get<BookingView[]>('/external-bookings') });
  const report = useQuery({ queryKey: bookingKeys.report, queryFn: () => get<BookingReport>('/external-bookings/report') });
  const [filter, setFilter] = useState<BookingFilter>('alle');
  const [q, setQ] = useState('');
  const [center, setCenter] = useState('');
  const data = list.data ?? [];
  const centers = useMemo(() => [...new Set(data.map((b) => b.costs.costCenter).filter(Boolean) as string[])].sort(), [data]);
  const rows = data.filter((b) => {
    const text = `${b.titel} ${b.provider.name} ${b.participants.map((p) => p.name).join(' ')}`.toLowerCase();
    return matchesFilter(b, filter) && (!q.trim() || text.includes(q.trim().toLowerCase())) && (!center || b.costs.costCenter === center);
  });
  const count = (f: BookingFilter) => data.filter((b) => matchesFilter(b, f)).length;

  return (
    <>
      <PageHeader
        title={t.title}
        description={t.description}
        actions={
          <Button asChild>
            <Link to="/verwaltung/externe-schulungen/neu">
              <Plus aria-hidden="true" className="size-4" />
              {t.create}
            </Link>
          </Button>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile value={count('geplant')} label={t.kpiPlanned} />
        <KpiTile value={count('gebucht')} label={t.kpiBooked} />
        <KpiTile value={report.data?.openCertificates ?? '–'} label={t.kpiOpen} tone={report.data?.openCertificates ? 'warn' : undefined} />
        <KpiTile value={report.data ? formatEuro(report.data.totalCents) : '–'} label={t.kpiCosts} />
      </div>
      <Card radius="lg" padding="lg" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            aria-label={t.filterLabel}
            value={filter}
            onValueChange={(v) => setFilter(v as BookingFilter)}
            options={(Object.keys(t.filters) as BookingFilter[]).map((f) => ({ value: f, label: t.filters[f] }))}
          />
          <div className="relative ml-auto min-w-56">
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" />
            <Input aria-label={t.search} placeholder={t.search} value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
          </div>
          <Select aria-label={t.costCenter} value={center} onChange={(e) => setCenter(e.target.value)} className="min-w-44">
            <option value="">{`${t.costCenter}: ${t.allCenters}`}</option>
            {centers.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </div>
        {list.isError ? (
          <ErrorPanel error={list.error} onRetry={() => void list.refetch()} />
        ) : !list.data ? (
          <Loading />
        ) : (
          <DataTable
            data={rows}
            columns={columns}
            label={t.tableLabel}
            getRowId={(r) => r.id}
            empty={<EmptyState icon={<Building2 />} title={t.empty} description={t.emptyText} />}
            renderCard={(b) => {
              const s = overallStatus(b);
              return (
                <div className="flex flex-col gap-1.5">
                  <Link to={`/verwaltung/externe-schulungen/${b.id}`} className="font-semibold text-ink">{b.titel}</Link>
                  <p className="text-[13px] text-muted">{b.provider.name} · {when(b)}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip tone={statusTone(s)}>{BOOKING_STATUS_LABELS[s]}</StatusChip>
                    <span className="text-[13px] tabular-nums">{formatEuro(b.costs.totalCents)}</span>
                  </div>
                </div>
              );
            }}
          />
        )}
      </Card>
      {report.data && report.data.byCostCenter.length > 0 && (
        <Card radius="lg" padding="lg" className="mt-5">
          <CardTitle>{teb.report.title}</CardTitle>
          <div className="mt-3 grid grid-cols-1 gap-6 md:grid-cols-2">
            <div>
              <p className="mb-2 text-[13px] font-semibold text-ink-2">{teb.report.byCenter}</p>
              <ul className="flex flex-col gap-1.5 text-[14px]" data-testid="kosten-kostenstelle">
                {report.data.byCostCenter.map((r) => (
                  <li key={r.costCenter} className="flex justify-between gap-3 border-b border-line pb-1.5">
                    <span>{r.costCenter}</span>
                    <span className="tabular-nums">{formatEuro(r.cents)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-2 text-[13px] font-semibold text-ink-2">{teb.report.byPerson}</p>
              <ul className="flex flex-col gap-1.5 text-[14px]">
                {report.data.perPerson.map((r) => (
                  <li key={r.name} className="flex justify-between gap-3 border-b border-line pb-1.5">
                    <span>{r.name}</span>
                    <span className="tabular-nums">{formatEuro(r.cents)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}
