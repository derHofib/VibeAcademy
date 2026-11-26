import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronLeft } from 'lucide-react';
import { Button, IconButton, Panel, Sheet, StatusPill } from '@/components/ui';
import { tl } from '@/i18n/live';
import { livePath, type OrganizerSnapshot, type RunView } from '../api';
import { LiveDialog } from '../components/LiveDialog';
import { dateDe, hm } from '../time';
import { PersonPicker, usePersonsAndUnits, type PersonSelection } from '@/features/presence/PersonPicker';
import type { useOrganizerActions } from './useOrganizerLive';

type Actions = ReturnType<typeof useOrganizerActions>;

/** Statuspille oben rechts: „Läuft · 15:28 Uhr“ / „Beendet um 15:30“ / „Geplant · Beginn 08:00 Uhr“. */
export function RunStatusPill({ run, nowMs }: { run: RunView; nowMs: number }) {
  if (run.status === 'beendet')
    return (
      <StatusPill tone="muted" appearance="soft" className="bg-transparent text-ink-2" data-testid="run-status">
        {tl.org.statusEnded(hm(run.endedAt))}
      </StatusPill>
    );
  if (run.status === 'laeuft')
    return (
      <StatusPill tone="success" appearance="soft" pulse data-testid="run-status">
        {tl.org.statusRunning(hm(nowMs))}
      </StatusPill>
    );
  return (
    <StatusPill tone="accent" appearance="soft" data-testid="run-status">
      {tl.org.statusPlanned(hm(run.startAt))}
    </StatusPill>
  );
}

/** Kopf der Live-Ansicht (12a): Zurück-Kreis, „Anbieter · Datum · Zeit · Ort“, Titel, Status rechts. */
export function OrganizerHeader({
  run,
  nowMs,
  title,
  actions,
  mode,
}: {
  run: RunView;
  nowMs: number;
  title: ReactNode;
  actions: Actions;
  mode: string;
}) {
  const eyebrow = [run.provider ?? run.tenantName, dateDe(run.startAt), `${hm(run.startAt)}–${hm(run.endAt)}`, run.ort].filter(Boolean).join(' · ');
  return (
    <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        <IconButton asChild aria-label={tl.org.backToList} size="md">
          <Link to={livePath.list}>
            <ChevronLeft aria-hidden="true" />
          </Link>
        </IconButton>
        <div className="min-w-0">
          <p className="truncate text-[13px] text-muted">{eyebrow}</p>
          <h1 className="font-heading text-[26px] leading-tight font-bold text-ink md:text-[30px]">{title}</h1>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3" data-live-mode={mode}>
        {mode === 'polling' && <span className="text-[12.5px] text-muted">{tl.org.liveConnection.polling}</span>}
        <RunStatusPill run={run} nowMs={nowMs} />
        {run.status === 'geplant' && (
          <Button disabled={actions.start.isPending} onClick={() => actions.start.mutate(undefined)}>
            {actions.start.isPending ? tl.org.starting : tl.org.start}
          </Button>
        )}
      </div>
    </header>
  );
}

/** Bestätigungsdialog „Schulung jetzt offiziell beenden?“ (12c). */
export function EndDialog({
  open,
  onOpenChange,
  stillIn,
  nowLabel,
  onConfirm,
  pending,
  title = tl.org.endDialog.title,
  text,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  stillIn: number;
  nowLabel: string;
  onConfirm: () => void;
  pending: boolean;
  title?: string;
  text?: ReactNode;
}) {
  const d = tl.org.endDialog;
  return (
    <LiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={
        text ??
        (stillIn > 0 ? (
          <>
            <strong className="text-ink">{d.textBefore(stillIn)}</strong>
            {d.textMid}
            <strong className="text-ink">{nowLabel}</strong>
            {d.textAfter}
          </>
        ) : (
          d.none
        ))
      }
      actions={
        <>
          <Button variant="tonal" size="lg" onClick={() => onOpenChange(false)}>
            {tl.common.cancel}
          </Button>
          <Button size="lg" disabled={pending} onClick={onConfirm}>
            {pending ? d.pending : d.confirm}
          </Button>
        </>
      }
    />
  );
}

/** Teilnehmende nachträglich einladen. */
export function AddParticipantsSheet({
  open,
  onOpenChange,
  snapshot,
  actions,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  snapshot: OrganizerSnapshot;
  actions: Actions;
  onDone: (text: string) => void;
}) {
  const [sel, setSel] = useState<PersonSelection>({ personIds: [], orgUnitIds: [] });
  const [error, setError] = useState<string | null>(null);
  const { persons, units } = usePersonsAndUnits();
  const n = sel.personIds.length;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={tl.org.addSheet.title}
      className="md:w-[min(560px,calc(100vw-48px))]"
      footer={
        <Button
          disabled={(!n && !sel.orgUnitIds.length) || actions.addParticipants.isPending}
          onClick={async () => {
            try {
              const r = await actions.addParticipants.mutateAsync({ ...sel, sendMail: true });
              onDone(tl.org.addSheet.done(r.created));
              setSel({ personIds: [], orgUnitIds: [] });
              onOpenChange(false);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          {tl.org.addSheet.submit(n)}
        </Button>
      }
    >
      <PersonPicker value={sel} onChange={setSel} persons={persons} units={units} exclude={snapshot.attendance.rows.map((r) => r.personId)} />
      {error && (
        <Panel tone="danger" role="alert" className="mt-3">
          {error}
        </Panel>
      )}
    </Sheet>
  );
}
