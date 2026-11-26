import { useState } from 'react';
import { Link } from 'react-router';
import { ChevronLeft, ListChecks, ShieldCheck, UserPlus } from 'lucide-react';
import { Button, Card, Field, IconButton, Input, Panel, Sheet } from '@/components/ui';
import { cn } from '@/lib/cn';
import { NoticeRegion, useNotice } from '@/features/admin/components/common';
import { tl } from '@/i18n/live';
import { livePath, type AttendanceRow, type OrganizerSnapshot } from '@/features/live/api';
import { useServerNow } from '@/features/live/hooks';
import { dateDe, hm, weekdayDe } from '@/features/live/time';
import { LiveDialog } from '@/features/live/components/LiveDialog';
import { BeamerView } from '@/features/live/organizer/BeamerView';
import { AddParticipantsSheet, EndDialog, RunStatusPill } from '@/features/live/organizer/common';
import { methodShort, needsRelease } from '@/features/live/organizer/model';
import { QrCard } from '@/features/live/organizer/QrCard';
import { useOrganizerActions } from '@/features/live/organizer/useOrganizerLive';

const tp = tl.presence;

/** Zustandszeile je Person (Screen 7): „eingecheckt · QR 07:48“ / „offen · am Tablet unterschreiben“. */
export function presenceLine(r: AttendanceRow, ended: boolean): { text: string; tone: 'in' | 'done' | 'open' } {
  if (r.confirmedAt) return { text: tp.confirmed(r.confirmedVia === 'kiosk' ? tp.confirmedKiosk : tp.confirmedSelf), tone: 'done' };
  const open = [...r.intervals].reverse().find((iv) => !iv.out);
  if (open) return { text: tp.checkedIn(methodShort(open.inMethod), hm(open.in)), tone: 'in' };
  if (r.intervals.length) {
    const base = tp.checkedOut(methodShort(r.outMethod), hm(r.lastOut));
    return { text: r.canConfirm && ended ? `${base} · ${tp.signOnTablet}` : base, tone: 'in' };
  }
  return { text: ended ? r.statusLabel : tp.openKiosk, tone: 'open' };
}

/** Trainer-Ansicht eines internen Präsenztermins (Screen 7 im weichen Stil). */
export function PresenceOrganizerView({ snapshot, mode }: { snapshot: OrganizerSnapshot; mode: string }) {
  const { run, attendance } = snapshot;
  const nowMs = useServerNow(run.serverTime);
  const actions = useOrganizerActions(run.id);
  const { notice, show } = useNotice();
  const [kind, setKind] = useState<'start' | 'end'>('start');
  const [beamer, setBeamer] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [agendaOpen, setAgendaOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [signErr, setSignErr] = useState<string | null>(null);
  const ended = run.status === 'beendet';
  const k = attendance.kpis;
  const present = ended ? k.participated : k.present;

  return (
    <div className="min-h-dvh bg-bg px-4 py-5 md:px-7 lg:py-6" data-live-mode={mode}>
      <div className="mx-auto grid max-w-[1440px] grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <Card radius="lg" padding="none" className="flex flex-col gap-5 p-6 md:p-7">
          <div className="flex items-start gap-4">
            <IconButton asChild aria-label={tl.org.backToList} size="md" variant="tonal">
              <Link to={livePath.list}>
                <ChevronLeft aria-hidden="true" />
              </Link>
            </IconButton>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] text-muted">{tp.eyebrow}</p>
              <h1 className="font-heading text-[26px] leading-tight font-bold text-ink md:text-[30px]">{run.titel}</h1>
              <p className="mt-1 text-[15px] text-ink-2">
                {[tp.when(weekdayDe(run.startAt), dateDe(run.startAt), hm(run.startAt), hm(run.endAt)), run.ort].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <RunStatusPill run={run} nowMs={nowMs} />
            {run.status === 'geplant' && (
              <Button size="sm" disabled={actions.start.isPending} onClick={() => actions.start.mutate(undefined)}>
                {tl.org.start}
              </Button>
            )}
          </div>
          <QrCard run={run} kind={kind} onKindChange={setKind} onBeamer={() => setBeamer(true)} nowMs={nowMs} variant="presence" />
          {!ended && <p className="text-center text-[14.5px] leading-[1.55] text-ink-2">{tp.hint}</p>}
        </Card>

        <section aria-labelledby="anwesenheit-titel" className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between gap-3 px-1 pt-2">
            <h2 id="anwesenheit-titel" className="font-heading text-[24px] font-bold text-ink">
              {tp.attendance}
            </h2>
            <p className="font-heading text-ink">
              <span className="sr-only">{tp.presentOfAria(present, k.invited)}</span>
              <span aria-hidden="true" className="text-[32px] font-bold tabular-nums">
                {present}
              </span>
              <span aria-hidden="true" className="ml-1.5 text-[18px] font-semibold text-muted">
                {tp.presentRest(k.invited)}
              </span>
            </p>
          </div>
          <NoticeRegion notice={notice} />
          <Card radius="lg" padding="none" className="overflow-hidden">
            {attendance.rows.length === 0 ? (
              <p className="px-6 py-8 text-center text-[14px] text-muted">{tl.org.table.empty}</p>
            ) : (
              <ul aria-label={tl.org.table.label}>
                {attendance.rows.map((r, i) => {
                  const line = presenceLine(r, ended);
                  return (
                    <li
                      key={r.personId}
                      className={cn('flex min-h-[60px] items-center gap-4 px-6 py-2.5', i > 0 && 'border-t border-[#EEF1F6]')}
                      data-testid="presence-row"
                      data-person={r.personName}
                    >
                      <span
                        aria-hidden="true"
                        className={cn('size-3 shrink-0 rounded-full', line.tone === 'open' ? 'bg-line' : 'bg-success')}
                      />
                      <span className="min-w-0 flex-1 truncate text-[16px] font-semibold text-ink">{r.personName}</span>
                      <span className={cn('text-right text-[14.5px] tabular-nums', line.tone === 'open' ? 'text-muted' : 'text-success-text')}>
                        {line.text}
                      </span>
                      {needsRelease(r) && r.attendanceId && (
                        <span className="flex shrink-0 gap-1.5">
                          <Button
                            variant="tonal"
                            size="sm"
                            className="h-9 px-3 text-[13px]"
                            aria-label={`${tl.org.table.reject}: ${r.personName}`}
                            disabled={actions.release.isPending}
                            onClick={() =>
                              void actions.release.mutateAsync({ attendanceId: r.attendanceId!, decision: 'abgelehnt' }).catch((e: Error) => show(e.message, 'danger'))
                            }
                          >
                            {tl.org.table.reject}
                          </Button>
                          <Button
                            variant="soft"
                            size="sm"
                            className="h-9 px-3 text-[13px]"
                            aria-label={`${tl.org.table.release}: ${r.personName} (${tl.org.table.releaseHint(r.completenessPct)})`}
                            disabled={actions.release.isPending}
                            onClick={() =>
                              void actions.release.mutateAsync({ attendanceId: r.attendanceId!, decision: 'freigegeben' }).catch((e: Error) => show(e.message, 'danger'))
                            }
                          >
                            {tl.org.table.release}
                          </Button>
                        </span>
                      )}
                      {!ended && !r.checkedIn && (
                        <Button
                          variant="tonal"
                          size="sm"
                          className="h-9 px-3 text-[13px]"
                          aria-label={tl.org.table.checkInAria(r.personName)}
                          disabled={actions.staffScan.isPending}
                          onClick={() =>
                            void actions.staffScan
                              .mutateAsync({ personId: r.personId, direction: 'in', method: 'trainer' })
                              .catch((e: Error) => show(e.message, 'danger'))
                          }
                        >
                          {tl.org.table.checkIn}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          {!ended && (
            <Button variant="ghost" size="sm" className="self-start" onClick={() => setAddOpen(true)}>
              <UserPlus aria-hidden="true" className="size-4" />
              {tl.org.table.addParticipants}
            </Button>
          )}
          {run.countersign && (
            <Panel tone="success" className="flex items-center gap-2.5" data-testid="countersigned">
              <ShieldCheck aria-hidden="true" className="size-5 shrink-0" />
              {tp.countersigned(run.countersign.name ?? '', `${dateDe(run.countersign.at)} ${hm(run.countersign.at)}`)}
            </Panel>
          )}
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Button variant="secondary" size="lg" onClick={() => setAgendaOpen(true)}>
              <ListChecks aria-hidden="true" className="size-5" />
              {tp.agendaTitle}
            </Button>
            {!ended ? (
              <Button variant="dark" size="lg" onClick={() => setEndOpen(true)}>
                {tp.end}
              </Button>
            ) : !run.countersign ? (
              <Button
                size="lg"
                className="h-auto min-h-14 py-2 whitespace-normal"
                onClick={() => {
                  setPassword('');
                  setSignErr(null);
                  setSignOpen(true);
                }}
              >
                {tp.countersign}
              </Button>
            ) : null}
          </div>
        </section>
      </div>

      <BeamerView run={run} kind={kind} open={beamer} onOpenChange={setBeamer} />
      <EndDialog
        open={endOpen}
        onOpenChange={setEndOpen}
        stillIn={k.present}
        nowLabel={hm(nowMs)}
        pending={actions.end.isPending}
        title={tp.endTitle}
        text={tp.endText(k.present)}
        onConfirm={async () => {
          try {
            await actions.end.mutateAsync(undefined);
            setEndOpen(false);
          } catch (e) {
            setEndOpen(false);
            show((e as Error).message, 'danger');
          }
        }}
      />
      <LiveDialog
        open={signOpen}
        onOpenChange={setSignOpen}
        title={tp.countersignTitle}
        description={tp.countersignText(k.confirmed, k.participated)}
        actions={
          <>
            <Button variant="tonal" size="lg" onClick={() => setSignOpen(false)}>
              {tl.common.cancel}
            </Button>
            <Button size="lg" type="submit" form="gegenzeichnen" disabled={!password || actions.countersign.isPending}>
              {tp.countersignSubmit}
            </Button>
          </>
        }
      >
        <form
          id="gegenzeichnen"
          onSubmit={async (e) => {
            e.preventDefault();
            setSignErr(null);
            try {
              const r = await actions.countersign.mutateAsync({ password });
              setSignOpen(false);
              show(`${tp.countersignedShort} · ${tp.evidenceQueued(r.evidenceQueued)}`);
            } catch (err) {
              setSignErr((err as Error).message);
            }
          }}
        >
          <Field label={tp.password} error={signErr ?? undefined}>
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        </form>
      </LiveDialog>
      <Sheet open={agendaOpen} onOpenChange={setAgendaOpen} title={tp.agendaTitle}>
        <p className="text-[14.5px] leading-[1.55] text-ink-2">{tp.agendaText}</p>
      </Sheet>
      <AddParticipantsSheet open={addOpen} onOpenChange={setAddOpen} snapshot={snapshot} actions={actions} onDone={(t) => show(t)} />
    </div>
  );
}
