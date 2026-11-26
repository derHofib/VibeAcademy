import { useMemo, useState } from 'react';
import { FolderDown } from 'lucide-react';
import { hasRole } from '@/features/auth/session';
import type { DashboardCompliance } from '@/features/matrix/api';
import { NachweismappeSheet } from '@/features/matrix/NachweismappeSheet';
import { tx } from '@/i18n/external';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { CalendarDays, FileUp, GraduationCap, Plus, Send, Users } from 'lucide-react';
import { get, post } from '@/lib/api';
import { adm } from '@/i18n/admin';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  KpiTile,
  LinearProgress,
  StatusChip,
} from '@/components/ui';
import { qk, type Dashboard, type DashboardRun, type OrgUnit, type Person } from '@/features/admin/api';
import { formatDate, runProgressTone, runStatusChip } from '@/features/admin/format';
import { DataTable } from '@/features/admin/components/DataTable';
import {
  ErrorPanel,
  Loading,
  NoticeRegion,
  errorMessage,
  useNotice,
} from '@/features/admin/components/common';
import { canManage } from '@/features/auth/session';
import { useAdminMe } from '@/features/admin/hooks';

const t = adm.dashboard;

function RunTitle({ run }: { run: DashboardRun }) {
  return (
    <div className="min-w-0">
      <Link
        to={`/verwaltung/durchfuehrungen/${run.id}`}
        className="text-[15px] leading-snug font-semibold text-ink underline-offset-4 hover:text-accent-text hover:underline"
      >
        {run.titel}
      </Link>
      <p className="text-[13px] text-muted">{t.runMeta(run.version_no, run.page_count, run.quiz_required)}</p>
    </div>
  );
}

function RunProgress({ run }: { run: DashboardRun }) {
  const chip = runStatusChip(run);
  return (
    <div className="flex min-w-[140px] items-center gap-3">
      <LinearProgress
        value={run.eingeladen ? run.erledigt / run.eingeladen : 0}
        tone={runProgressTone(chip)}
        label={t.progressOf(run.titel)}
      />
      <span className="shrink-0 text-[13px] text-ink-2 tabular-nums">
        {run.erledigt} / {run.eingeladen}
      </span>
    </div>
  );
}

function RunChip({ run }: { run: DashboardRun }) {
  const chip = runStatusChip(run);
  return <StatusChip tone={chip.tone}>{chip.label}</StatusChip>;
}

const columns: ColumnDef<DashboardRun, unknown>[] = [
  {
    id: 'titel',
    header: t.colTraining,
    cell: ({ row }) => <RunTitle run={row.original} />,
    meta: { className: 'w-[46%]' },
  },
  { id: 'fortschritt', header: t.colProgress, cell: ({ row }) => <RunProgress run={row.original} /> },
  {
    id: 'frist',
    header: t.colDue,
    cell: ({ row }) => (
      <span className="whitespace-nowrap tabular-nums">{formatDate(row.original.deadline)}</span>
    ),
  },
  { id: 'status', header: t.colStatus, cell: ({ row }) => <RunChip run={row.original} /> },
];

function FirstSteps({ manage }: { manage: boolean }) {
  return (
    <Card radius="lg" padding="lg" className="mt-2">
      <EmptyState
        icon={<GraduationCap />}
        title={t.emptyTitle}
        description={t.emptyText}
        action={
          manage && (
            <div className="flex flex-wrap justify-center gap-2.5">
              <Button asChild>
                <Link to="/verwaltung/schulungen/neu">
                  <Plus aria-hidden="true" className="size-[18px]" />
                  {t.emptyTitle}
                </Link>
              </Button>
              <Button asChild variant="secondary">
                <Link to="/verwaltung/personen">
                  <Users aria-hidden="true" className="size-[18px]" />
                  {t.addPersons}
                </Link>
              </Button>
            </div>
          )
        }
      />
      <ol className="mx-auto mt-2 grid max-w-3xl gap-3 md:grid-cols-3">
        {t.emptySteps.map((s, i) => (
          <li
            key={s}
            className="flex items-center gap-3 rounded-box bg-bg px-4 py-3.5 text-[14px] text-ink-2"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft font-bold text-accent-text tabular-nums">
              {i + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** Screen 1 – Dashboard im weichen Stil. */
export default function DashboardPage() {
  const me = useAdminMe();
  const manage = canManage(me);
  const qc = useQueryClient();
  const { notice, show } = useNotice();
  const dash = useQuery({ queryKey: qk.dashboard, queryFn: () => get<Dashboard>('/dashboard') });
  const persons = useQuery({
    queryKey: qk.persons(),
    queryFn: () => get<Person[]>('/persons'),
    retry: false,
  });
  const units = useQuery({
    queryKey: qk.orgUnits,
    queryFn: () => get<OrgUnit[]>('/org-units'),
    retry: false,
  });
  const trainings = useQuery({
    queryKey: qk.trainings,
    queryFn: () => get<unknown[]>('/trainings'),
    retry: false,
  });
  const remind = useMutation({
    mutationFn: () => post<{ reminded: number }>('/dashboard/remind-overdue'),
    onSuccess: (r) => {
      show(t.reminded(r.reminded));
      void qc.invalidateQueries({ queryKey: qk.dashboard });
    },
    onError: (e) => show(errorMessage(e), 'danger'),
  });

  const today = formatDate(new Date());
  const subtitle = t.subtitle(today, persons.data?.length ?? 0, units.data?.length ?? 0);
  const isFresh = trainings.data?.length === 0 && (dash.data?.laufend.length ?? 0) === 0;
  const kpi = dash.data?.kpi;
  const phase2 = dash.data as (Dashboard & DashboardCompliance) | undefined;
  const comp = phase2?.compliance;
  const [exportOpen, setExportOpen] = useState(false);
  const canExport = hasRole(me, 'admin', 'verantwortlich', 'auditor');
  const rows = useMemo(() => dash.data?.laufend ?? [], [dash.data]);

  return (
    <>
      <PageHeader
        title={t.title}
        description={subtitle}
        actions={
          <>
            {canExport && (
              <Button variant="secondary" onClick={() => setExportOpen(true)}>
                <FolderDown aria-hidden="true" className="size-[18px]" />
                {tx.dashboard.export}
              </Button>
            )}
            {manage && (
              <Button asChild>
                <Link to="/verwaltung/schulungen/neu">
                  <Plus aria-hidden="true" className="size-[18px]" />
                  {t.newTraining}
                </Link>
              </Button>
            )}
          </>
        }
      />
      {exportOpen && <NachweismappeSheet open={exportOpen} onOpenChange={setExportOpen} />}
      <NoticeRegion notice={notice} className="mb-4 empty:hidden" />

      {dash.isPending ? (
        <Loading />
      ) : dash.isError ? (
        <ErrorPanel error={dash.error} onRetry={() => dash.refetch()} />
      ) : isFresh ? (
        <FirstSteps manage={manage} />
      ) : (
        <>
          <section aria-label={t.title} className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
            {comp && comp.gesamt > 0 ? (
              // Phase 2: Erfüllungsquote aus der Pflichtmatrix
              <KpiTile
                label={tx.dashboard.quota}
                value={comp.erfuellungsquote === null ? '—' : `${comp.erfuellungsquote} %`}
                hint={tx.dashboard.quotaHint(comp.erfuellt, comp.gesamt - comp.befreit)}
              >
                <LinearProgress value={(comp.erfuellungsquote ?? 0) / 100} label={tx.dashboard.quota} className="mt-1" />
              </KpiTile>
            ) : (
              <KpiTile
                label={t.kpiQuota}
                value={
                  kpi?.erfuellungsquote === null || kpi?.erfuellungsquote === undefined
                    ? '—'
                    : `${kpi.erfuellungsquote} %`
                }
                hint={kpi ? t.kpiQuotaHint(kpi.erledigt, kpi.gesamt) : undefined}
              >
                <LinearProgress
                  value={(kpi?.erfuellungsquote ?? 0) / 100}
                  label={t.kpiQuota}
                  className="mt-1"
                />
              </KpiTile>
            )}
            <KpiTile
              label={t.kpiOverdue}
              value={kpi?.ueberfaellig ?? 0}
              tone={kpi?.ueberfaellig ? 'danger' : 'default'}
              hint={phase2?.eskaliert !== undefined ? tx.dashboard.overdueHint(phase2.eskaliert) : t.kpiOverdueHint}
            />
            {comp && comp.gesamt > 0 ? (
              <KpiTile
                label={tx.dashboard.expiring}
                value={comp.laeuftAb30}
                tone={comp.laeuftAb30 ? 'warn' : 'default'}
                hint={tx.dashboard.expiringHint(comp.naechsteWiedereinladung ? formatDate(comp.naechsteWiedereinladung).slice(0, 6) : null)}
              />
            ) : (
              <KpiTile
                label={t.kpiExpiring}
                value={kpi?.laeuft_ab ?? 0}
                tone={kpi?.laeuft_ab ? 'warn' : 'default'}
                hint={t.kpiExpiringHint}
              />
            )}
            <KpiTile
              label={t.kpiOpen}
              value={kpi?.offen ?? 0}
              hint={kpi ? t.kpiOpenHint(kpi.geoeffnet, Math.max(0, kpi.offen - kpi.geoeffnet)) : undefined}
            />
          </section>

          <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <Card>
              <CardHeader>
                <CardTitle>{t.running}</CardTitle>
              </CardHeader>
              <DataTable
                data={rows}
                columns={columns}
                label={t.running}
                getRowId={(r) => r.id}
                empty={<EmptyState icon={<FileUp />} title={t.noRuns} description={t.noRunsText} />}
                renderCard={(run) => (
                  <div className="flex flex-col gap-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <RunTitle run={run} />
                      <RunChip run={run} />
                    </div>
                    <RunProgress run={run} />
                    <p className="text-[13px] text-muted">
                      {t.colDue} {formatDate(run.deadline)}
                    </p>
                  </div>
                )}
              />
            </Card>

            <div className="flex flex-col gap-5">
              <Card>
                <CardHeader>
                  <CardTitle>{t.overdue}</CardTitle>
                </CardHeader>
                {dash.data.ueberfaellig.length === 0 ? (
                  <p className="text-[14px] text-muted">{t.overdueEmpty}</p>
                ) : (
                  <ul className="flex flex-col gap-3.5">
                    {dash.data.ueberfaellig.slice(0, 8).map((p) => (
                      <li key={p.id} className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            to={`/verwaltung/nachweise/${p.id}`}
                            className="text-[15px] font-semibold text-ink underline-offset-4 hover:text-accent-text hover:underline"
                          >
                            {p.name}
                          </Link>
                          <p className="text-[13px] text-muted">{p.titel}</p>
                        </div>
                        <span className="shrink-0 text-[13px] font-semibold text-danger-text tabular-nums">
                          {t.overdueDays(Math.max(1, p.tage))}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {manage && dash.data.ueberfaellig.length > 0 && (
                  <Button
                    variant="tonal"
                    fullWidth
                    className="mt-5"
                    disabled={remind.isPending}
                    onClick={() => remind.mutate()}
                  >
                    <Send aria-hidden="true" className="size-4" />
                    {t.remindAll}
                  </Button>
                )}
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t.upcoming}</CardTitle>
                </CardHeader>
                <div className="flex items-center gap-3.5 text-[14px] text-muted">
                  <span
                    aria-hidden="true"
                    className="flex size-12 shrink-0 items-center justify-center rounded-input bg-accent-soft text-accent-text"
                  >
                    <CalendarDays className="size-5" />
                  </span>
                  {t.upcomingEmpty}
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  );
}
