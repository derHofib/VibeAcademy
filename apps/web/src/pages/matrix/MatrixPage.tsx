import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Grid3x3, RefreshCw, Search } from 'lucide-react';
import { get, post } from '@/lib/api';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, Card, EmptyState, Input, LinearProgress, Panel, SegmentedControl, Select } from '@/components/ui';
import { qk, type OrgUnit } from '@/features/admin/api';
import { formatDateTime } from '@/features/admin/format';
import { ErrorPanel, Loading, NoticeRegion, errorMessage, useNotice } from '@/features/admin/components/common';
import { useAdminMe } from '@/features/admin/hooks';
import { canManage, hasRole } from '@/features/auth/session';
import type { ComplianceState } from '@/features/external/api';
import { mk, type Compliance, type ComplianceRow, type Qualification } from '@/features/matrix/api';
import { CellSheet } from '@/features/matrix/CellSheet';
import { ExemptionSheet, ExemptionsPanel, QualificationsPanel, RequirementsPanel } from '@/features/matrix/ManagePanels';
import { MatrixGrid } from '@/features/matrix/MatrixGrid';
import { buildGrid, STATES } from '@/features/matrix/model';
import { tx } from '@/i18n/external';

const t = tx.matrix;
type View = 'matrix' | 'requirements' | 'qualifications' | 'exemptions';

const TILE_TONE: Record<ComplianceState, string> = {
  gueltig: 'text-success',
  laeuft_ab: 'text-warn-strong',
  abgelaufen: 'text-danger-text',
  fehlt: 'text-danger-text',
  befreit: 'text-ink-2',
};

/** `/verwaltung/pflichtmatrix` – Erfüllungsstand je Person × Pflichtschulung und Pflege der Matrix (Schritt 2.9). */
export default function MatrixPage() {
  const me = useAdminMe();
  const manage = canManage(me);
  const statusOnly = !hasRole(me, 'admin', 'verantwortlich', 'auditor');
  const qc = useQueryClient();
  const { notice, show } = useNotice();
  const [view, setView] = useState<View>('matrix');
  const [org, setOrg] = useState('');
  const [state, setState] = useState<ComplianceState | ''>('');
  const [qualificationId, setQualificationId] = useState('');
  const [search, setSearch] = useState('');
  const [cell, setCell] = useState<ComplianceRow | null>(null);
  const [exempt, setExempt] = useState<ComplianceRow | null>(null);

  const compliance = useQuery({
    queryKey: [...mk.compliance, org],
    queryFn: () => get<Compliance>(`/compliance${org ? `?org_unit=${org}` : ''}`),
  });
  const units = useQuery({ queryKey: qk.orgUnits, queryFn: () => get<OrgUnit[]>('/org-units'), retry: false });
  const quals = useQuery({ queryKey: mk.qualifications, queryFn: () => get<Qualification[]>('/qualifications'), retry: false });

  const grid = useMemo(
    () => (compliance.data ? buildGrid(compliance.data.rows, compliance.data.requirements, { search, state, qualificationId }) : null),
    [compliance.data, search, state, qualificationId],
  );

  const runDeadlines = useMutation({
    mutationFn: () => post<Record<string, number>>('/admin/deadlines/run'),
    onSuccess: (r) => {
      show(t.deadlinesDone(r));
      void qc.invalidateQueries({ queryKey: mk.compliance });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
    },
    onError: (e) => show(errorMessage(e), 'danger'),
  });

  const s = compliance.data?.summary;
  const personCount = grid?.total ?? 0;
  const filtersActive = !!(search || state || qualificationId || org);

  return (
    <>
      <PageHeader
        title={t.title}
        description={compliance.data ? t.subtitle(formatDateTime(compliance.data.asOf), personCount, compliance.data.requirements.length) : undefined}
        actions={
          manage && (
            <Button variant="secondary" disabled={runDeadlines.isPending} onClick={() => runDeadlines.mutate()}>
              <RefreshCw aria-hidden="true" className={cn('size-[18px]', runDeadlines.isPending && 'animate-spin')} />
              {runDeadlines.isPending ? t.runningDeadlines : t.runDeadlines}
            </Button>
          )
        }
      />
      <NoticeRegion notice={notice} className="mb-4 empty:hidden" />

      <SegmentedControl
        aria-label={t.viewsLabel}
        value={view}
        onValueChange={setView}
        className="mb-5"
        options={(statusOnly ? (['matrix'] as View[]) : (['matrix', 'requirements', 'qualifications', 'exemptions'] as View[])).map((v) => ({ value: v, label: t.views[v] }))}
      />

      {view === 'requirements' && <RequirementsPanel manage={manage} notify={show} />}
      {view === 'qualifications' && <QualificationsPanel manage={manage} notify={show} />}
      {view === 'exemptions' && <ExemptionsPanel manage={manage} notify={show} />}

      {view === 'matrix' &&
        (compliance.isPending ? (
          <Loading />
        ) : compliance.isError ? (
          <ErrorPanel error={compliance.error} onRetry={() => compliance.refetch()} />
        ) : (
          <>
            <section aria-label={t.filters.state} className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Card padding="md" className="col-span-2 flex flex-col gap-2 md:col-span-1">
                <p className="text-[13.5px] font-medium text-muted">{t.tiles.quota}</p>
                <p className="font-heading text-[30px] leading-[1.1] font-bold text-ink tabular-nums">
                  {s?.erfuellungsquote === null || s?.erfuellungsquote === undefined ? '—' : `${s.erfuellungsquote} %`}
                </p>
                <LinearProgress value={(s?.erfuellungsquote ?? 0) / 100} label={t.tiles.quota} />
                {s && <p className="text-[12.5px] text-muted">{t.tiles.quotaHint(s.gueltig + s.laeuft_ab, s.total - s.befreit)}</p>}
              </Card>
              {STATES.map((st) => (
                <button
                  key={st}
                  type="button"
                  aria-pressed={state === st}
                  onClick={() => setState((x) => (x === st ? '' : st))}
                  className={cn(
                    'flex min-w-0 cursor-pointer flex-col gap-2 rounded-card border-2 bg-surface p-5 text-left shadow-card transition-colors md:p-6',
                    state === st ? 'border-accent' : 'border-transparent hover:border-accent-ring',
                  )}
                  data-testid={`kachel-${st}`}
                >
                  <span className="text-[13.5px] font-medium text-muted">{t.tiles[st]}</span>
                  <span className={cn('font-heading text-[30px] leading-[1.1] font-bold tabular-nums', (s?.[st] ?? 0) > 0 ? TILE_TONE[st] : 'text-ink')}>
                    {s?.[st] ?? 0}
                  </span>
                  <span className="sr-only">{t.tiles.filterBy(t.tiles[st])}</span>
                </button>
              ))}
            </section>

            <Card radius="lg">
              <div className="mb-4 flex flex-wrap items-center gap-2.5" role="group" aria-label={t.filters.label}>
                <div className="relative min-w-0 flex-1 basis-56">
                  <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted" />
                  <Input type="search" aria-label={t.filters.search} placeholder={t.filters.search} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
                </div>
                <div className="w-full sm:w-52">
                  <Select aria-label={t.filters.orgUnit} value={org} onChange={(e) => setOrg(e.target.value)}>
                    <option value="">{t.filters.orgAll}</option>
                    {units.data?.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="w-full sm:w-52">
                  <Select aria-label={t.filters.qualification} value={qualificationId} onChange={(e) => setQualificationId(e.target.value)}>
                    <option value="">{t.filters.qualificationAll}</option>
                    {quals.data?.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="w-full sm:w-44">
                  <Select aria-label={t.filters.state} value={state} onChange={(e) => setState(e.target.value as ComplianceState | '')}>
                    <option value="">{t.filters.stateAll}</option>
                    {STATES.map((st) => (
                      <option key={st} value={st}>
                        {t.tiles[st]}
                      </option>
                    ))}
                  </Select>
                </div>
                {filtersActive && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSearch('');
                      setState('');
                      setQualificationId('');
                      setOrg('');
                    }}
                  >
                    {t.filters.reset}
                  </Button>
                )}
              </div>
              {statusOnly && (
                <Panel tone="accent" className="mb-3">
                  {t.statusOnly}
                </Panel>
              )}
              {!compliance.data.requirements.length ? (
                <EmptyState
                  icon={<Grid3x3 />}
                  title={t.emptyTitle}
                  description={t.emptyText}
                  action={
                    manage && (
                      <Button variant="secondary" onClick={() => setView('qualifications')}>
                        {t.qual.add}
                      </Button>
                    )
                  }
                />
              ) : grid && grid.persons.length === 0 ? (
                <p className="py-6 text-center text-[14px] text-muted">{t.noHits}</p>
              ) : grid ? (
                <>
                  <p className="mb-1 text-[13px] text-muted" aria-live="polite">
                    {t.filters.count(grid.persons.length, grid.total)}
                  </p>
                  <MatrixGrid columns={grid.columns} persons={grid.persons} highlight={state} onOpen={statusOnly ? undefined : setCell} />
                </>
              ) : null}
            </Card>
          </>
        ))}

      {cell && (
        <CellSheet
          row={cell}
          manage={manage}
          onClose={() => setCell(null)}
          onExempt={(r) => {
            setCell(null);
            setExempt(r);
          }}
        />
      )}
      {exempt && (
        <ExemptionSheet
          preset={{ personId: exempt.personId, requirementId: exempt.requirementId }}
          onClose={() => setExempt(null)}
          onSaved={() => {
            setExempt(null);
            show(t.ex.saved);
            void qc.invalidateQueries({ queryKey: mk.compliance });
            void qc.invalidateQueries({ queryKey: qk.dashboard });
          }}
        />
      )}
    </>
  );
}
