import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Inbox, Plus } from 'lucide-react';
import { get, patch, post } from '@/lib/api';
import { Button, Card, EmptyState, IconButton } from '@/components/ui';
import { qk } from '@/features/admin/api';
import { ErrorPanel, Loading } from '@/features/admin/components/common';
import { useAdminMe } from '@/features/admin/hooks';
import { canManage } from '@/features/auth/session';
import {
  fetchRequirements,
  xk,
  type ApproveResult,
  type CaseItem,
  type CaseList,
  type ExtStatus,
  type GroupMember,
  type RecordDetail,
  type UndoResult,
} from '@/features/external/api';
import { fieldBoxes, TAB_STATUSES } from '@/features/external/model';
import { CaseCard, PaperList, QueueTabs, type QueueTab } from '@/features/external/QueueParts';
import { ReceiptViewer, toOverlay } from '@/features/external/ReceiptViewer';
import { ReviewPanel, type ReviewActions } from '@/features/external/ReviewPanel';
import { tx } from '@/i18n/external';

const TABS: QueueTab[] = ['open', 'approved', 'returned', 'drafts'];

/** In dieser Sitzung entschiedene Vorgänge bleiben mit Ergebnis-Chip in der Liste stehen (wie 11c). */
interface Pinned {
  item: CaseItem;
  index: number;
  status: ExtStatus;
}

/** `/verwaltung/extern` – Prüfen und freigeben (Screens 11a–11c). */
export default function ExternalQueuePage() {
  const me = useAdminMe();
  const manage = canManage(me);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get('status') as QueueTab) ? params.get('status') : 'open') as QueueTab;
  const selectedParam = params.get('fall');
  const [pinned, setPinned] = useState<Record<string, Pinned>>({});
  const detailRef = useRef<HTMLDivElement>(null);

  const list = useQuery({
    queryKey: xk.list(tab),
    queryFn: () => get<CaseList>(`/external-records?status=${TAB_STATUSES[tab]!.join(',')}`),
    refetchInterval: (q) => (q.state.data?.items.some((i) => i.ocrStatus === 'ausstehend') ? 4000 : false),
  });
  const requirements = useQuery({ queryKey: xk.requirements, queryFn: fetchRequirements, enabled: manage, retry: false });

  // Server-Liste + angeheftete (gerade entschiedene) Vorgänge an ihrer bisherigen Position
  const items = useMemo(() => {
    const out = [...(list.data?.items ?? [])];
    const ids = new Set(out.map((i) => i.caseId));
    for (const p of Object.values(pinned).sort((a, b) => a.index - b.index)) {
      if (!ids.has(p.item.caseId)) out.splice(Math.min(p.index, out.length), 0, p.item);
    }
    return out;
  }, [list.data, pinned]);

  const selected = items.find((i) => i.recordIds.includes(selectedParam ?? '')) ?? items[0] ?? null;
  const selectedId = selectedParam && selected?.recordIds.includes(selectedParam) ? selectedParam : (selected?.primaryRecordId ?? null);

  const detail = useQuery({
    queryKey: xk.detail(selectedId ?? '-'),
    queryFn: () => get<RecordDetail>(`/external-records/${selectedId}`),
    enabled: !!selectedId,
    refetchInterval: (q) => (q.state.data?.ocr.status === 'ausstehend' ? 3000 : false),
  });

  const setTab = (t: QueueTab) => {
    setPinned({});
    setParams(t === 'open' ? {} : { status: t }, { replace: true });
  };
  const select = (item: CaseItem) => {
    const next = new URLSearchParams(params);
    next.set('fall', item.primaryRecordId);
    setParams(next, { replace: true });
    if (window.matchMedia('(max-width: 1279px)').matches) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };

  const refresh = async (id?: string) => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['admin', 'extern', 'list'] }),
      id ? qc.invalidateQueries({ queryKey: xk.detail(id) }) : Promise.resolve(),
      qc.invalidateQueries({ queryKey: qk.dashboard }),
      qc.invalidateQueries({ queryKey: ['admin', 'compliance'] }),
    ]);
  };
  const pin = (item: CaseItem, status: ExtStatus) =>
    setPinned((p) => ({ ...p, [item.caseId]: { item: { ...item, status }, index: items.findIndex((i) => i.caseId === item.caseId), status } }));

  const [pending, setPending] = useState<ReviewActions['pending']>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  useEffect(() => setActionError(null), [selectedId]);

  const run = async <T,>(kind: NonNullable<ReviewActions['pending']>, fn: () => Promise<T>): Promise<T> => {
    setPending(kind);
    setActionError(null);
    try {
      return await fn();
    } catch (e) {
      setActionError(e);
      throw e;
    } finally {
      setPending(null);
    }
  };

  const approve = useMutation({
    mutationFn: () => run('approve', () => post<ApproveResult>(`/external-records/${selectedId}/approve`, { scope: 'group' })),
    onSuccess: async () => {
      if (selected && tab !== 'approved') pin(selected, 'freigegeben');
      await refresh(selectedId!);
    },
  });
  const undo = useMutation({
    mutationFn: () => run('undo', () => post<UndoResult>(`/external-records/${selectedId}/undo`, { scope: 'group' })),
    onSuccess: async (r) => {
      const next = r.records.find((x) => x.replaces === selectedId)?.id ?? r.records[0]?.id;
      if (selected) setPinned(({ [selected.caseId]: _drop, ...rest }) => rest);
      await refresh(selectedId!);
      if (next) setParams(tab === 'open' ? { fall: next } : { status: 'open', fall: next }, { replace: true });
    },
  });
  const actions: ReviewActions = {
    approve: () => approve.mutate(),
    undo: () => undo.mutate(),
    returnWith: async (reason) => {
      await run('return', () => post(`/external-records/${selectedId}/return`, { reason, scope: 'group' }));
      if (selected && tab !== 'returned') pin(selected, 'zurueckgegeben');
      await refresh(selectedId!);
    },
    saveFields: async (fields) => {
      await run('save', () => patch(`/external-records/${selectedId}`, fields));
      await refresh(selectedId!);
    },
    pending,
    error: actionError,
  };

  const toggleFlag = useMutation({
    mutationFn: ({ m, flagged }: { m: GroupMember; flagged: boolean }) =>
      patch(`/external-records/${m.recordId}`, {
        scope: 'record',
        flags: flagged ? [...m.flags.filter((f) => f.code !== 'unterschrift_unleserlich'), { code: 'unterschrift_unleserlich' }] : m.flags.filter((f) => f.code !== 'unterschrift_unleserlich'),
      }),
    onSuccess: () => refresh(selectedId!),
    onError: (e) => setActionError(e),
  });

  const d = detail.data;
  const boxes = (fileIndex: number) => {
    if (!d || fileIndex !== 0) return [];
    const isGroup = d.group.length > 1;
    const keys = isGroup ? (['date'] as const) : (['name', 'date', 'course'] as const);
    const warn = d.checks.filter((c) => c.state === 'warn').map((c) => (c.key === 'datum' ? 'date' : c.key === 'person' ? 'name' : c.key));
    return toOverlay(fieldBoxes(d.ocr.fields, 1, [...keys]), warn);
  };

  return (
    <>
      <header className="mb-5 flex flex-wrap items-center justify-between gap-4 md:mb-6">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3">
          <IconButton aria-label={tx.queue.back} onClick={() => navigate('/verwaltung')}>
            <ChevronLeft aria-hidden="true" />
          </IconButton>
          <h1 className="font-heading text-[24px] leading-tight font-bold text-ink md:text-[28px]">{tx.queue.title}</h1>
          <QueueTabs value={tab} onChange={setTab} counts={list.data?.counts} />
        </div>
        {manage && (
          <Button asChild>
            <Link to="/verwaltung/extern/neu">
              <Plus aria-hidden="true" className="size-[18px]" />
              {tx.queue.create}
            </Link>
          </Button>
        )}
      </header>

      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <ErrorPanel error={list.error} onRetry={() => list.refetch()} />
      ) : items.length === 0 ? (
        <Card radius="lg">
          <EmptyState
            icon={<Inbox />}
            title={tab === 'open' ? tx.queue.emptyOpen : tx.queue.emptyOther}
            description={tab === 'open' ? tx.queue.emptyOpenText : tx.queue.emptyOtherText}
            action={
              manage && (
                <Button asChild variant="secondary">
                  <Link to="/verwaltung/extern/neu">
                    <Plus aria-hidden="true" className="size-[18px]" />
                    {tx.queue.create}
                  </Link>
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[250px_minmax(0,1fr)_340px] 2xl:grid-cols-[290px_minmax(0,1fr)_360px]">
          <nav aria-label={tx.queue.listLabel}>
            <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-1">
              {items.map((item) => (
                <li key={item.caseId}>
                  <CaseCard
                    item={item}
                    selected={item.caseId === selected?.caseId}
                    decided={pinned[item.caseId]?.status}
                    onSelect={() => select(item)}
                  />
                </li>
              ))}
            </ul>
          </nav>

          <div ref={detailRef} aria-hidden="true" className="-mb-5 scroll-mt-20 xl:hidden" />
          <>
            {detail.isPending ? (
              <Loading className="xl:col-span-2" />
            ) : detail.isError ? (
              <ErrorPanel className="xl:col-span-2" error={detail.error} onRetry={() => detail.refetch()} />
            ) : d ? (
              <>
                <ReceiptViewer key={d.record.id} files={d.files} boxes={boxes}>
                  {d.ocr.status === 'ausstehend' && <p className="text-[13px] text-[#CBD5E1]" role="status">{tx.receipt.ocrRunning}</p>}
                  {d.ocr.status === 'fehler' && <p className="text-[13px] text-[#CBD5E1]">{tx.receipt.ocrFailed}</p>}
                  {d.record.isMedical && <p className="text-[13px] text-[#CBD5E1]">{tx.receipt.ocrMedical}</p>}
                  {d.group.length > 1 && (
                    <PaperList
                      members={[...d.group].sort((a, b) => a.name.localeCompare(b.name, 'de'))}
                      canEdit={d.permissions.edit}
                      pending={toggleFlag.isPending}
                      onToggle={(m, flagged) => toggleFlag.mutate({ m, flagged })}
                    />
                  )}
                </ReceiptViewer>
                <ReviewPanel detail={d} requirements={requirements.data ?? []} actions={actions} />
              </>
            ) : (
              <p className="text-[14px] text-muted">{tx.queue.pickCase}</p>
            )}
          </>
        </div>
      )}
    </>
  );
}
