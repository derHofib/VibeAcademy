import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { BellRing, FileSearch, Link2 } from 'lucide-react';
import { get, post } from '@/lib/api';
import { adm } from '@/i18n/admin';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  Card,
  CardHeader,
  CardTitle,
  IconButton,
  KpiTile,
  Panel,
  SegmentedControl,
  StatusChip,
} from '@/components/ui';
import { qk, type RunDetail, type RunInvitation } from '@/features/admin/api';
import { formatDate, formatShortDateTime, invitationChip } from '@/features/admin/format';
import { DataTable } from '@/features/admin/components/DataTable';
import {
  ConfirmSheet,
  CopyButton,
  ErrorPanel,
  Loading,
  NoticeRegion,
  errorMessage,
  useNotice,
} from '@/features/admin/components/common';
import { LinksPanel } from '@/features/admin/LinksPanel';
import { canManage } from '@/features/auth/session';
import { useAdminMe } from '@/features/admin/hooks';

const t = adm.run;
type Filter = 'alle' | 'offen' | 'ueberfaellig' | 'erledigt';

function matches(i: RunInvitation, f: Filter) {
  if (f === 'alle') return true;
  if (f === 'erledigt') return i.status === 'bestaetigt' || i.status === 'befreit';
  if (f === 'ueberfaellig') return i.overdue;
  return i.status !== 'bestaetigt' && i.status !== 'befreit';
}

function Actions({
  inv,
  manage,
  onRemind,
  onLink,
  busy,
}: {
  inv: RunInvitation;
  manage: boolean;
  onRemind: (i: RunInvitation) => void;
  onLink: (i: RunInvitation) => void;
  busy: boolean;
}) {
  const done = inv.status === 'bestaetigt' || inv.status === 'befreit';
  return (
    <div className="flex items-center justify-end gap-1">
      {manage && (
        <IconButton
          variant="ghost"
          className="disabled:bg-transparent disabled:opacity-40"
          aria-label={
            inv.has_email
              ? t.remindNamed(inv.person_name)
              : `${t.remindNamed(inv.person_name)} – ${t.noEmail}`
          }
          title={inv.has_email ? t.remind : t.noEmail}
          disabled={done || !inv.has_email || busy}
          onClick={() => onRemind(inv)}
        >
          <BellRing aria-hidden="true" />
        </IconButton>
      )}
      {manage && (
        <IconButton
          variant="ghost"
          className="disabled:bg-transparent disabled:opacity-40"
          aria-label={t.newLinkNamed(inv.person_name)}
          title={t.newLink}
          disabled={done}
          onClick={() => onLink(inv)}
        >
          <Link2 aria-hidden="true" />
        </IconButton>
      )}
      <IconButton asChild variant="ghost" aria-label={t.reportNamed(inv.person_name)} title={t.report}>
        <Link to={`/verwaltung/nachweise/${inv.id}`}>
          <FileSearch aria-hidden="true" />
        </Link>
      </IconButton>
    </div>
  );
}

/** Durchführung: Einladungen mit Status, Erinnern, Link neu erzeugen, Lesenachweis. */
export default function RunDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const me = useAdminMe();
  const manage = canManage(me);
  const qc = useQueryClient();
  const { notice, show } = useNotice();
  const [filter, setFilter] = useState<Filter>('alle');
  const [linkFor, setLinkFor] = useState<RunInvitation | null>(null);
  const [issued, setIssued] = useState<{ name: string; link: string } | null>(null);
  const run = useQuery({ queryKey: qk.run(id), queryFn: () => get<RunDetail>(`/runs/${id}`) });

  const remind = useMutation({
    mutationFn: (i: RunInvitation) => post(`/invitations/${i.id}/remind`),
    onSuccess: (_r, i) => {
      show(t.reminded(i.person_name));
      void qc.invalidateQueries({ queryKey: qk.run(id) });
    },
    onError: (e) => show(errorMessage(e), 'danger'),
  });
  const newLink = useMutation({
    mutationFn: (i: RunInvitation) => post<{ link: string }>(`/invitations/${i.id}/link`),
    onSuccess: (r, i) => {
      setLinkFor(null);
      setIssued({ name: i.person_name, link: r.link });
    },
    onError: (e) => show(errorMessage(e), 'danger'),
  });

  const rows = useMemo(
    () => (run.data?.invitations ?? []).filter((i) => matches(i, filter)),
    [run.data, filter],
  );
  const columns = useMemo<ColumnDef<RunInvitation, unknown>[]>(
    () => [
      {
        id: 'person',
        header: t.colPerson,
        cell: ({ row }) => (
          <Link
            to={`/verwaltung/nachweise/${row.original.id}`}
            className="font-semibold text-ink underline-offset-4 hover:text-accent-text hover:underline"
          >
            {row.original.person_name}
          </Link>
        ),
      },
      { id: 'unit', header: t.colUnit, cell: ({ row }) => row.original.org_unit_name ?? '—' },
      {
        id: 'status',
        header: t.colStatus,
        cell: ({ row }) => {
          const c = invitationChip(row.original.status, row.original.overdue);
          return <StatusChip tone={c.tone}>{c.label}</StatusChip>;
        },
      },
      {
        id: 'opened',
        header: t.colOpened,
        cell: ({ row }) => (
          <span className="tabular-nums">{formatShortDateTime(row.original.opened_at)}</span>
        ),
      },
      {
        id: 'done',
        header: t.colDone,
        cell: ({ row }) => (
          <span className="tabular-nums">{formatShortDateTime(row.original.completed_at)}</span>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{t.colActions}</span>,
        cell: ({ row }) => (
          <Actions
            inv={row.original}
            manage={manage}
            onRemind={(i) => remind.mutate(i)}
            onLink={setLinkFor}
            busy={remind.isPending}
          />
        ),
        meta: { className: 'w-[150px] text-right' },
      },
    ],
    [manage, remind],
  );

  if (run.isPending) return <Loading />;
  if (run.isError) return <ErrorPanel error={run.error} onRetry={() => run.refetch()} />;
  const r = run.data;
  const inv = r.invitations;
  const opened = inv.filter((i) => i.status !== 'offen').length;
  const done = inv.filter((i) => i.status === 'bestaetigt').length;
  const overdue = inv.filter((i) => i.overdue).length;

  return (
    <>
      <PageHeader
        eyebrow={t.eyebrow}
        title={r.titel_effektiv}
        description={t.meta(r.version_no, r.page_count, formatDate(r.deadline))}
        onBack={() => navigate(-1)}
        backLabel={t.backLabel}
      />
      <NoticeRegion notice={notice} className="mb-4 empty:hidden" />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiTile label={t.kpiInvited} value={inv.length} />
        <KpiTile label={t.kpiOpened} value={opened} tone="accent" />
        <KpiTile label={t.kpiDone} value={done} tone="success" />
        <KpiTile label={t.kpiOverdue} value={overdue} tone={overdue ? 'danger' : 'default'} />
      </div>

      {issued && (
        <Panel tone="accent" className="mt-5 flex flex-wrap items-center gap-3" role="status">
          <div className="min-w-0 flex-1 basis-64">
            <p className="font-semibold">
              {t.newLinkResult} · {issued.name}
            </p>
            <p className="font-mono text-[12.5px] break-all" data-testid="neuer-link">
              {issued.link}
            </p>
          </div>
          <CopyButton text={issued.link} variant="secondary" ariaLabel={adm.links.copyOne(issued.name)} />
        </Panel>
      )}

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>{t.table}</CardTitle>
          <SegmentedControl
            aria-label={t.filterLabel}
            size="sm"
            value={filter}
            onValueChange={setFilter}
            options={[
              { value: 'alle', label: t.filterAll, count: inv.length },
              { value: 'offen', label: t.filterOpen },
              { value: 'ueberfaellig', label: t.filterOverdue, count: overdue || undefined },
              { value: 'erledigt', label: t.filterDone },
            ]}
          />
        </CardHeader>
        <DataTable
          data={rows}
          columns={columns}
          label={t.table}
          getRowId={(x) => x.id}
          empty={<p className="text-[14px] text-muted">{t.empty}</p>}
          renderCard={(i) => {
            const c = invitationChip(i.status, i.overdue);
            return (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      to={`/verwaltung/nachweise/${i.id}`}
                      className="font-semibold text-ink underline-offset-4 hover:underline"
                    >
                      {i.person_name}
                    </Link>
                    <p className="text-[13px] text-muted">{i.org_unit_name ?? '—'}</p>
                  </div>
                  <StatusChip tone={c.tone}>{c.label}</StatusChip>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] text-muted tabular-nums">
                    {t.colOpened} {formatShortDateTime(i.opened_at)}
                  </p>
                  <Actions
                    inv={i}
                    manage={manage}
                    onRemind={(x) => remind.mutate(x)}
                    onLink={setLinkFor}
                    busy={remind.isPending}
                  />
                </div>
              </div>
            );
          }}
        />
      </Card>

      {manage && inv.length > 0 && (
        <div className="mt-5">
          <LinksPanel title={r.titel_effektiv} deadline={r.deadline} invitations={inv} />
        </div>
      )}

      <ConfirmSheet
        open={!!linkFor}
        onOpenChange={(o) => !o && setLinkFor(null)}
        title={linkFor ? t.newLinkTitle(linkFor.person_name) : ''}
        description={t.newLinkText}
        confirmLabel={t.newLinkConfirm}
        pending={newLink.isPending}
        onConfirm={() => linkFor && newLink.mutate(linkFor)}
      />
    </>
  );
}
