import { Settings2 } from 'lucide-react';
import { ts } from '@/i18n/training-settings';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { GraduationCap, Plus } from 'lucide-react';
import { get } from '@/lib/api';
import { adm } from '@/i18n/admin';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  LinearProgress,
  StatusChip,
  type StatusTone,
} from '@/components/ui';
import { qk, type RunListItem, type TrainingListItem } from '@/features/admin/api';
import { formatDate } from '@/features/admin/format';
import { DataTable } from '@/features/admin/components/DataTable';
import { ErrorPanel, Loading } from '@/features/admin/components/common';
import { canManage } from '@/features/auth/session';
import { useAdminMe } from '@/features/admin/hooks';

const t = adm.trainings;

function versionChip(tr: TrainingListItem): { label: string; tone: StatusTone } {
  if (!tr.latest_version_status) return { label: t.noVersion, tone: 'neutral' };
  if (tr.latest_version_status === 'veroeffentlicht')
    return { label: adm.status.version.veroeffentlicht!, tone: 'success' };
  if (tr.latest_version_status === 'fehler') return { label: adm.status.version.fehler!, tone: 'danger' };
  if (tr.latest_version_status === 'bereit') {
    return tr.published_version_no
      ? { label: `${adm.status.version.bereit} v${tr.latest_version_no}`, tone: 'warn' }
      : { label: adm.status.version.bereit!, tone: 'warn' };
  }
  return { label: adm.status.version[tr.latest_version_status] ?? tr.latest_version_status, tone: 'info' };
}

function TrainingTitle({ tr }: { tr: TrainingListItem }) {
  return (
    <div className="min-w-0">
      <Link
        to={`/verwaltung/schulungen/${tr.id}`}
        className="text-[15px] font-semibold text-ink underline-offset-4 hover:text-accent-text hover:underline"
      >
        {tr.titel}
      </Link>
      <p className="text-[13px] text-muted">
        {[
          tr.kategorie,
          tr.latest_version_no ? t.versionLabel(tr.latest_version_no) : null,
          tr.page_count ? adm.common.pages(tr.page_count) : null,
        ]
          .filter(Boolean)
          .join(' · ') || '—'}
      </p>
    </div>
  );
}

const trainingColumns: ColumnDef<TrainingListItem, unknown>[] = [
  {
    id: 'titel',
    header: t.colTitle,
    cell: ({ row }) => <TrainingTitle tr={row.original} />,
    meta: { className: 'w-[55%]' },
  },
  {
    id: 'status',
    header: t.colStatus,
    cell: ({ row }) => {
      const c = versionChip(row.original);
      return <StatusChip tone={c.tone}>{c.label}</StatusChip>;
    },
  },
  {
    id: 'created',
    header: t.colCreated,
    cell: ({ row }) => <span className="tabular-nums">{formatDate(row.original.created_at)}</span>,
  },
  {
    id: 'settings',
    header: () => <span className="sr-only">{ts.open}</span>,
    cell: ({ row }) => (
      <Link
        to={`/verwaltung/schulungen/${row.original.id}/einstellungen`}
        aria-label={`${ts.open}: ${row.original.titel}`}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-pill px-3 text-[13px] font-semibold text-accent-text hover:bg-accent-soft"
      >
        <Settings2 aria-hidden="true" className="size-4" />
        {ts.open}
      </Link>
    ),
  },
];

function RunTitle({ r }: { r: RunListItem }) {
  return (
    <div className="min-w-0">
      <Link
        to={`/verwaltung/durchfuehrungen/${r.id}`}
        className="text-[15px] font-semibold text-ink underline-offset-4 hover:text-accent-text hover:underline"
      >
        {r.titel}
      </Link>
      <p className="text-[13px] text-muted">
        {t.versionLabel(r.version_no)} · {formatDate(r.created_at)}
      </p>
    </div>
  );
}

const runColumns: ColumnDef<RunListItem, unknown>[] = [
  {
    id: 'titel',
    header: t.colRun,
    cell: ({ row }) => <RunTitle r={row.original} />,
    meta: { className: 'w-[45%]' },
  },
  {
    id: 'done',
    header: t.colInvited,
    cell: ({ row }) => (
      <div className="flex min-w-[140px] items-center gap-3">
        <LinearProgress
          value={row.original.invited ? row.original.done / row.original.invited : 0}
          tone={row.original.overdue ? 'danger' : 'accent'}
          label={adm.dashboard.progressOf(row.original.titel)}
        />
        <span className="shrink-0 text-[13px] tabular-nums">
          {row.original.done} / {row.original.invited}
        </span>
      </div>
    ),
  },
  {
    id: 'deadline',
    header: t.colDeadline,
    cell: ({ row }) => <span className="tabular-nums">{formatDate(row.original.deadline)}</span>,
  },
  {
    id: 'overdue',
    header: adm.run.kpiOverdue,
    cell: ({ row }) =>
      row.original.overdue ? (
        <StatusChip tone="danger">{adm.status.run.overdue(row.original.overdue)}</StatusChip>
      ) : (
        <span className="text-muted">—</span>
      ),
  },
];

export default function TrainingsPage() {
  const me = useAdminMe();
  const manage = canManage(me);
  const trainings = useQuery({
    queryKey: qk.trainings,
    queryFn: () => get<TrainingListItem[]>('/trainings'),
  });
  const runs = useQuery({ queryKey: qk.runs, queryFn: () => get<RunListItem[]>('/runs') });

  return (
    <>
      <PageHeader
        title={t.title}
        description={t.subtitle}
        actions={
          manage && (
            <Button asChild>
              <Link to="/verwaltung/schulungen/neu">
                <Plus aria-hidden="true" className="size-[18px]" />
                {t.new}
              </Link>
            </Button>
          )
        }
      />
      <div className="flex flex-col gap-5">
        <Card>
          {trainings.isPending ? (
            <Loading />
          ) : trainings.isError ? (
            <ErrorPanel error={trainings.error} onRetry={() => trainings.refetch()} />
          ) : (
            <DataTable
              data={trainings.data}
              columns={trainingColumns}
              label={t.title}
              getRowId={(r) => r.id}
              empty={<EmptyState icon={<GraduationCap />} title={t.emptyTitle} description={t.emptyText} />}
              renderCard={(tr) => {
                const c = versionChip(tr);
                return (
                  <div className="flex items-start justify-between gap-3">
                    <TrainingTitle tr={tr} />
                    <StatusChip tone={c.tone}>{c.label}</StatusChip>
                  </div>
                );
              }}
            />
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.runs}</CardTitle>
          </CardHeader>
          {runs.isPending ? (
            <Loading />
          ) : runs.isError ? (
            <ErrorPanel error={runs.error} onRetry={() => runs.refetch()} />
          ) : (
            <DataTable
              data={runs.data}
              columns={runColumns}
              label={t.runs}
              getRowId={(r) => r.id}
              empty={<p className="text-[14px] text-muted">{t.runsEmpty}</p>}
              renderCard={(r) => (
                <div className="flex flex-col gap-2">
                  <RunTitle r={r} />
                  <div className="flex items-center gap-3">
                    <LinearProgress
                      value={r.invited ? r.done / r.invited : 0}
                      label={adm.dashboard.progressOf(r.titel)}
                    />
                    <span className="shrink-0 text-[13px] tabular-nums">
                      {r.done} / {r.invited}
                    </span>
                  </div>
                  <p className="text-[13px] text-muted">
                    {t.colDeadline} {formatDate(r.deadline)}
                  </p>
                </div>
              )}
            />
          )}
        </Card>
      </div>
    </>
  );
}
