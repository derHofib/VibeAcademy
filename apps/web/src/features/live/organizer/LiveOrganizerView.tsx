import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { qk } from '@/features/admin/api';
import { Button, Card } from '@/components/ui';
import { NoticeRegion, useNotice } from '@/features/admin/components/common';
import { tl } from '@/i18n/live';
import type { OrganizerSnapshot } from '../api';
import { useServerNow } from '../hooks';
import { hm } from '../time';
import { AttendancePanel } from './AttendancePanel';
import { BeamerView } from './BeamerView';
import { AddParticipantsSheet, EndDialog, OrganizerHeader } from './common';
import { LiveTabs } from './LiveTabs';
import { openQuestionCount } from './model';
import { PollsPanel } from './PollsPanel';
import { QrCard } from './QrCard';
import { QuestionsPanel } from './QuestionsPanel';
import { useOrganizerActions, usePollPool } from './useOrganizerLive';

type Tab = 'anwesenheit' | 'fragen' | 'kontrollfragen';

/** Organisator-Live-Ansicht einer externen Live-Schulung (12a–12f). */
export function LiveOrganizerView({ snapshot, mode, initialTab = 'anwesenheit' }: { snapshot: OrganizerSnapshot; mode: string; initialTab?: Tab }) {
  const { run, attendance, questions, polls } = snapshot;
  const nowMs = useServerNow(run.serverTime);
  const actions = useOrganizerActions(run.id);
  const pool = usePollPool(run.id, !!run.trainingId);
  // Name des Fragenpools = Titel der Katalog-Schulung (der Termin kann einen eigenen Titel haben)
  const training = useQuery({
    queryKey: qk.training(run.trainingId ?? ''),
    queryFn: () => get<{ titel: string }>(`/trainings/${run.trainingId}`),
    enabled: !!run.trainingId,
    staleTime: 5 * 60_000,
  });
  const { notice, show } = useNotice();
  const [kind, setKind] = useState<'start' | 'end'>('start');
  const [tab, setTab] = useState<Tab>(initialTab);
  const [beamer, setBeamer] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const ended = run.status === 'beendet';

  return (
    <div className="min-h-dvh bg-bg px-4 py-5 md:px-7 lg:px-7 lg:py-6">
      <div className="mx-auto max-w-[1440px]">
        <OrganizerHeader run={run} nowMs={nowMs} title={tl.org.titleLive(run.titel)} actions={actions} mode={mode} />
        <NoticeRegion notice={notice} className="mb-4 empty:mb-0" />
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[400px_minmax(0,1fr)]">
          <Card radius="lg" padding="none" className="px-5 py-[22px]">
            <QrCard run={run} kind={kind} onKindChange={setKind} onBeamer={() => setBeamer(true)} nowMs={nowMs} />
          </Card>
          <Card radius="lg" padding="none" className="min-w-0 p-6">
            <LiveTabs
              label={tl.org.tabs.label}
              value={tab}
              onValueChange={setTab}
              tabs={[
                {
                  value: 'anwesenheit',
                  label: tl.org.tabs.attendance,
                  count: attendance.kpis.participated,
                  content: (
                    <div className="overflow-x-auto">
                      <div className="min-w-[720px]">
                        <AttendancePanel
                          run={run}
                          attendance={attendance}
                          nowMs={nowMs}
                          actions={actions}
                          onAdd={() => setAddOpen(true)}
                          onNotice={show}
                        />
                      </div>
                    </div>
                  ),
                },
                {
                  value: 'fragen',
                  label: tl.org.tabs.questions,
                  count: openQuestionCount(questions),
                  content: <QuestionsPanel questions={questions} actions={actions} onNotice={show} />,
                },
                {
                  value: 'kontrollfragen',
                  label: tl.org.tabs.polls,
                  count: polls.active ? tl.org.tabs.live : (pool.data?.length ?? polls.list.length),
                  countTone: polls.active ? 'live' : 'soft',
                  content: (
                    <PollsPanel
                      polls={polls}
                      pool={pool.data ?? []}
                      trainingTitle={run.trainingId ? (training.data?.titel ?? run.titel) : null}
                      ended={ended}
                      actions={actions}
                      onNotice={show}
                    />
                  ),
                },
              ]}
            />
          </Card>
        </div>
        <footer className="mt-6 flex flex-wrap items-center justify-end gap-4">
          {ended ? (
            <span className="text-[15px] text-muted">{tl.org.footer.endedHint}</span>
          ) : (
            <>
              <span className="text-[15px] text-muted">{tl.org.footer.plannedEnd(hm(run.endAt))}</span>
              <Button variant="dark" size="lg" className="h-[54px] px-8" onClick={() => setEndOpen(true)}>
                {tl.org.footer.endButton}
              </Button>
            </>
          )}
        </footer>
      </div>

      <BeamerView run={run} kind={kind} open={beamer} onOpenChange={setBeamer} />
      <EndDialog
        open={endOpen}
        onOpenChange={setEndOpen}
        stillIn={attendance.kpis.present}
        nowLabel={hm(nowMs)}
        pending={actions.end.isPending}
        onConfirm={async () => {
          try {
            const r = await actions.end.mutateAsync(undefined);
            setEndOpen(false);
            show(tl.org.endDialog.done(r.closedWithOfficialEnd));
          } catch (e) {
            setEndOpen(false);
            show((e as Error).message, 'danger');
          }
        }}
      />
      <AddParticipantsSheet open={addOpen} onOpenChange={setAddOpen} snapshot={snapshot} actions={actions} onDone={(t) => show(t)} />
    </div>
  );
}
