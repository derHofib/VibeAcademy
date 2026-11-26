import { useState } from 'react';
import { CloudOff, TriangleAlert, UserPlus } from 'lucide-react';
import { Avatar, Button, Field, StatusChip, Textarea } from '@/components/ui';
import { cn } from '@/lib/cn';
import { tl } from '@/i18n/live';
import type { AttendanceRow, OrganizerAttendance, RunView } from '../api';
import { LiveDialog } from '../components/LiveDialog';
import { durShort, hm, liveDurationSeconds } from '../time';
import { kpiChips, methodShort, needsRelease, statusTone } from './model';
import type { useOrganizerActions } from './useOrganizerLive';

const tt = tl.org.table;

type Actions = ReturnType<typeof useOrganizerActions>;

export function KpiChips({ attendance, ended }: { attendance: OrganizerAttendance; ended: boolean }) {
  return (
    <ul aria-label={tl.org.kpi.label} className="flex flex-wrap gap-2">
      {kpiChips(attendance.kpis, ended).map((c) => (
        <li key={c.key}>
          <StatusChip tone={c.tone} size="md" className="text-[13px]">
            {c.label}
          </StatusChip>
        </li>
      ))}
    </ul>
  );
}

const GRID = 'grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,0.7fr)_minmax(0,1.25fr)] items-center gap-3';

function TimeCell({ time, label, offline }: { time: string; label: string; offline?: boolean }) {
  if (time === '–') return <span className="text-ink-2">–</span>;
  return (
    <span className="tabular-nums">
      <span className="text-[15px] text-ink">{time}</span> <span className="text-[13px] text-muted">{label}</span>
      {offline && (
        <span title={tt.offline} className="ml-1 inline-flex align-[-2px] text-muted">
          <CloudOff aria-hidden="true" className="size-3.5" />
          <span className="sr-only">, {tt.offline}</span>
        </span>
      )}
    </span>
  );
}

/** Anwesenheitsliste (12a/12d): Person, Ein/Aus mit Methode, Dauer (live), Status; Vermerk mit „Nachfragen“/„akzeptieren“. */
export function AttendancePanel({
  run,
  attendance,
  nowMs,
  actions,
  onAdd,
  onNotice,
}: {
  run: RunView;
  attendance: OrganizerAttendance;
  nowMs: number;
  actions: Actions;
  onAdd: () => void;
  onNotice: (text: string, tone?: 'success' | 'danger') => void;
}) {
  const ended = run.status === 'beendet';
  const [askRow, setAskRow] = useState<AttendanceRow | null>(null);
  const [askText, setAskText] = useState('');
  const busy = actions.review.isPending || actions.release.isPending || actions.staffScan.isPending;

  const run_ = async <T,>(p: Promise<T>) => {
    try {
      await p;
    } catch (e) {
      onNotice((e as Error).message, 'danger');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <KpiChips attendance={attendance} ended={ended} />
        {!ended && (
          <Button variant="ghost" size="sm" onClick={onAdd}>
            <UserPlus aria-hidden="true" className="size-4" />
            {tt.addParticipants}
          </Button>
        )}
      </div>

      {attendance.rows.length === 0 ? (
        <p className="rounded-box bg-bg px-4 py-6 text-center text-[14px] text-muted">{tt.empty}</p>
      ) : (
        <div role="table" aria-label={tt.label} className="flex flex-col gap-2">
          <div role="rowgroup">
            <div role="row" className={cn(GRID, 'px-4 pb-1 text-[13px] font-medium text-muted')}>
              <span role="columnheader">{tt.person}</span>
              <span role="columnheader">{tt.in}</span>
              <span role="columnheader">{tt.out}</span>
              <span role="columnheader">{tt.duration}</span>
              <span role="columnheader">{tt.status}</span>
            </div>
          </div>
          <div role="rowgroup" className="flex flex-col gap-2">
            {attendance.rows.map((r) => {
              const dur = r.intervals.length ? liveDurationSeconds(r.intervals, run, nowMs) : null;
              const hasNote = !!r.manual || r.autoClosed;
              const release = needsRelease(r);
              const lastIv = r.intervals[r.intervals.length - 1];
              return (
                <div
                  key={r.personId}
                  role="none"
                  className={cn('rounded-[20px] px-4 py-3', hasNote ? 'bg-[#FFFAF0]' : 'bg-[#F8F9FC]')}
                  data-testid="attendance-row"
                  data-person={r.personName}
                  data-status={r.status}
                >
                  <div role="row" className={GRID}>
                    <span role="cell" className="flex min-w-0 items-center gap-3">
                      <Avatar name={r.personName} size="lg" />
                      <span className="truncate text-[15px] font-semibold text-ink">{r.personName}</span>
                    </span>
                    <span role="cell">
                      {!ended && r.status === 'nicht_eingecheckt' ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="h-9 px-3.5 text-[13px]"
                          aria-label={tt.checkInAria(r.personName)}
                          disabled={busy}
                          onClick={() => void run_(actions.staffScan.mutateAsync({ personId: r.personId, direction: 'in', method: 'trainer' }))}
                        >
                          {tt.checkIn}
                        </Button>
                      ) : (
                        <TimeCell time={hm(r.firstIn)} label={methodShort(r.inMethod)} offline={r.intervals[0]?.inOffline} />
                      )}
                    </span>
                    <span role="cell">
                      <TimeCell time={r.checkedIn ? '–' : hm(r.lastOut)} label={methodShort(r.outMethod)} offline={!r.checkedIn && lastIv?.outOffline} />
                    </span>
                    <span role="cell" className="text-[15px] text-ink tabular-nums">
                      {dur === null ? '–' : durShort(dur)}
                      {r.belowThreshold && !r.checkedIn && dur !== null && (
                        <>
                          {' '}
                          <TriangleAlert aria-hidden="true" className="inline size-4 align-[-2px] text-ink" />
                          <span className="sr-only">({tt.belowThreshold})</span>
                        </>
                      )}
                    </span>
                    <span role="cell">
                      <StatusChip tone={statusTone(r.status)}>{r.statusLabel}</StatusChip>
                    </span>
                  </div>
                  {hasNote && (
                    <div role="row" className="mt-2 flex flex-wrap items-center gap-3 md:pl-[52px]">
                      <span role="cell" className="min-w-0 flex-1 text-[14.5px] text-warn-text-strong">
                        {r.manual ? (
                          <>
                            <strong className="font-semibold">{r.manual.reasonLabel}:</strong> „{r.manual.note}“
                          </>
                        ) : (
                          tt.autoClosed
                        )}
                        {r.noteReview === 'rueckfrage' && (
                          <span className="block text-[13px] text-muted">{tt.reviewMessage(r.noteReviewMessage ?? '')}</span>
                        )}
                      </span>
                      {r.noteReview === 'offen' && r.attendanceId && (
                        <span role="cell" className="flex gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() => {
                              setAskText('');
                              setAskRow(r);
                            }}
                          >
                            {tt.ask}
                          </Button>
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => void run_(actions.review.mutateAsync({ attendanceId: r.attendanceId!, decision: 'akzeptiert' }))}
                          >
                            {tt.accept}
                          </Button>
                        </span>
                      )}
                    </div>
                  )}
                  {(release || r.release) && (
                    <div role="row" className="mt-2 flex flex-wrap items-center gap-3 md:pl-[52px]">
                      <span role="cell" className="min-w-0 flex-1 text-[13.5px] text-muted">
                        {r.release === 'freigegeben' ? tt.released : r.release === 'abgelehnt' ? tt.rejected : tt.releaseHint(r.completenessPct)}
                      </span>
                      {release && (
                        <span role="cell" className="flex gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() => void run_(actions.release.mutateAsync({ attendanceId: r.attendanceId!, decision: 'abgelehnt' }))}
                          >
                            {tt.reject}
                          </Button>
                          <Button
                            variant="soft"
                            size="sm"
                            disabled={busy}
                            onClick={() => void run_(actions.release.mutateAsync({ attendanceId: r.attendanceId!, decision: 'freigegeben' }))}
                          >
                            {tt.release}
                          </Button>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <LiveDialog
        open={!!askRow}
        onOpenChange={(o) => !o && setAskRow(null)}
        title={tl.org.askSheet.title}
        description={askRow ? tl.org.askSheet.description(askRow.personName) : undefined}
        actions={
          <>
            <Button variant="tonal" size="lg" onClick={() => setAskRow(null)}>
              {tl.common.cancel}
            </Button>
            <Button
              size="lg"
              disabled={askText.trim().length < 3 || actions.review.isPending}
              onClick={async () => {
                if (!askRow?.attendanceId) return;
                try {
                  await actions.review.mutateAsync({ attendanceId: askRow.attendanceId, decision: 'rueckfrage', message: askText.trim() });
                  setAskRow(null);
                } catch (e) {
                  onNotice((e as Error).message, 'danger');
                }
              }}
            >
              {tl.org.askSheet.send}
            </Button>
          </>
        }
      >
        <Field label={tl.org.askSheet.label}>
          <Textarea rows={3} value={askText} onChange={(e) => setAskText(e.target.value)} placeholder={tl.org.askSheet.placeholder} maxLength={1000} />
        </Field>
      </LiveDialog>
    </div>
  );
}
