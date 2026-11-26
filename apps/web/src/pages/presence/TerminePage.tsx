import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { CalendarDays, Plus } from 'lucide-react';
import { get } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, Card, EmptyState, StatusChip, type StatusTone } from '@/components/ui';
import { DataTable } from '@/features/admin/components/DataTable';
import { ErrorPanel, Loading } from '@/features/admin/components/common';
import { canManage } from '@/features/auth/session';
import { useAdminMe } from '@/features/admin/hooks';
import { tl } from '@/i18n/live';
import { livePath, liveKeys, type TerminListItem } from '@/features/live/api';
import { dateDe, hm, weekdayDe } from '@/features/live/time';
import { TerminCreateSheet } from '@/features/presence/TerminCreateSheet';

const t = tl.list;

const statusTone: Record<TerminListItem['status'], StatusTone> = { geplant: 'neutral', laeuft: 'success', beendet: 'info' };

function TerminTitle({ r }: { r: TerminListItem }) {
  return (
    <div className="min-w-0">
      <Link
        to={livePath.organizer(r.id)}
        className="text-[15px] font-semibold text-ink underline-offset-4 hover:text-accent-text hover:underline"
      >
        {r.titel}
      </Link>
      <p className="text-[13px] text-muted">
        {[r.typ === 'termin' ? tl.typ.terminShort : tl.typ.liveShort, r.provider, r.trainer_name].filter(Boolean).join(' · ')}
      </p>
    </div>
  );
}

function StatusCell({ r }: { r: TerminListItem }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <StatusChip tone={statusTone[r.status]}>{tl.runStatus[r.status]}</StatusChip>
      {r.status === 'laeuft' && r.present > 0 && <StatusChip tone="success">{t.present(r.present)}</StatusChip>}
      {r.notes_to_review > 0 && <StatusChip tone="warn">{t.notes(r.notes_to_review)}</StatusChip>}
      {r.countersigned_at && <StatusChip tone="success">{t.countersigned}</StatusChip>}
    </div>
  );
}

const when = (r: TerminListItem) => `${weekdayDe(r.start_at)} ${dateDe(r.start_at)} · ${hm(r.start_at)}–${hm(r.end_at)}`;

const columns: ColumnDef<TerminListItem, unknown>[] = [
  { id: 'titel', header: t.colTermin, cell: ({ row }) => <TerminTitle r={row.original} />, meta: { className: 'w-[34%]' } },
  { id: 'when', header: t.colWhen, cell: ({ row }) => <span className="tabular-nums">{when(row.original)}</span> },
  { id: 'ort', header: t.colPlace, cell: ({ row }) => row.original.ort ?? <span className="text-muted">—</span> },
  {
    id: 'teilnahme',
    header: t.colAttendance,
    cell: ({ row }) => <span className="tabular-nums">{t.attendance(row.original.participated, row.original.invited)}</span>,
  },
  { id: 'status', header: t.colStatus, cell: ({ row }) => <StatusCell r={row.original} /> },
];

/** `/verwaltung/termine` – Präsenztermine und externe Live-Schulungen. */
export default function TerminePage() {
  const me = useAdminMe();
  const [createOpen, setCreateOpen] = useState(false);
  const list = useQuery({ queryKey: liveKeys.termine, queryFn: () => get<TerminListItem[]>('/termine') });
  const manage = canManage(me);

  return (
    <>
      <PageHeader
        title={t.title}
        description={t.description}
        actions={
          manage && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden="true" className="size-4" />
              {t.create}
            </Button>
          )
        }
      />
      <Card radius="lg" padding="lg">
        {list.isError ? (
          <ErrorPanel error={list.error} onRetry={() => list.refetch()} />
        ) : !list.data ? (
          <Loading />
        ) : (
          <DataTable
            data={list.data}
            columns={columns}
            label={t.tableLabel}
            getRowId={(r) => r.id}
            empty={
              <EmptyState
                icon={<CalendarDays />}
                title={t.empty}
                description={t.emptyText}
                action={
                  manage ? (
                    <Button onClick={() => setCreateOpen(true)}>
                      <Plus aria-hidden="true" className="size-4" />
                      {t.create}
                    </Button>
                  ) : undefined
                }
              />
            }
            renderCard={(r) => (
              <div className="flex flex-col gap-1.5">
                <TerminTitle r={r} />
                <p className="text-[13px] text-ink-2 tabular-nums">
                  {when(r)}
                  {r.ort ? ` · ${r.ort}` : ''}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusCell r={r} />
                  <span className="text-[13px] text-muted">{t.attendance(r.participated, r.invited)}</span>
                </div>
              </div>
            )}
          />
        )}
      </Card>
      {manage && <TerminCreateSheet open={createOpen} onOpenChange={setCreateOpen} />}
    </>
  );
}
