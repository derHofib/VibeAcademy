import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Check, CloudOff, Download, ShieldCheck } from 'lucide-react';
import { Button, Card, CheckboxField, Panel, StatusChip } from '@/components/ui';
import { ApiError, get } from '@/lib/api';
import { cn } from '@/lib/cn';
import { tl } from '@/i18n/live';
import { LanguageSwitch } from '@/features/participant/LanguageSwitch';
import { livePath, liveKeys, type AttendanceEvidence, type AttendanceRow, type ParticipantPolls, type RunView } from '../api';
import { durLong, formatClock, hm, pctOf } from '../time';
import { PollCard, type AnswerFeedback } from './PollCard';

const t = tl.tn;

/** Kopf der Teilnehmersicht: „Externe Schulung · 08:00–15:30 · Schulungsraum Lager“ + Titel. */
export function LiveHeader({ run, kicker }: { run: RunView; kicker?: string }) {
  const kind = run.typ === 'live_extern' ? t.externalTraining : t.presenceTraining;
  return (
    <header className="flex items-start gap-3 px-0.5 pt-0.5 pb-1.5">
      <div className="min-w-0 flex-1">
        <p className="text-[12px] text-muted">{kicker ?? t.eyebrow(kind, `${hm(run.startAt)}–${hm(run.endAt)}`, run.ort)}</p>
        <h1 className="mt-0.5 font-heading text-[20px] leading-tight font-bold text-ink">{run.titel}</h1>
      </div>
      <LanguageSwitch />
    </header>
  );
}

/** Uhr-Karte (13b): Eingecheckt-Pille, Serverzeit, laufende Dauer, Anteil an der geplanten Dauer. */
export function ClockCard({ run, me, elapsed, nowMs }: { run: RunView; me: AttendanceRow; elapsed: number; nowMs: number }) {
  const open = [...me.intervals].reverse().find((iv) => !iv.out);
  const pct = pctOf(elapsed, run.plannedSeconds);
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor(elapsed / 60) % 60;
  const beforeStart = nowMs < Date.parse(run.startAt);
  return (
    <section
      aria-label={tl.tn.in.checkedInAt(hm(open?.in ?? me.firstIn))}
      className="flex flex-col gap-2.5 rounded-[24px] bg-surface px-[18px] py-4 shadow-[0_1px_2px_rgba(29,36,51,0.04),0_10px_30px_rgba(29,36,51,0.07)]"
      data-testid="clock-card"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 rounded-pill bg-success-soft px-3 py-1.5 text-[12.5px] font-semibold text-success-text">
          <span aria-hidden="true" className="size-2 rounded-full bg-success shadow-[0_0_0_4px_rgba(30,122,80,0.18)]" />
          {t.in.checkedInAt(hm(open?.in ?? me.firstIn))}
        </span>
        <span className="text-[12.5px] text-muted tabular-nums">{t.in.now(hm(nowMs))}</span>
      </div>
      <div className="flex items-baseline gap-2.5">
        <span
          role="timer"
          aria-label={t.in.clockAria(h, m)}
          className="font-heading text-[40px] leading-none font-bold tracking-[-0.02em] text-ink tabular-nums"
        >
          {formatClock(elapsed)}
        </span>
        <span className="text-[13.5px] text-muted tabular-nums">{t.in.present(pct)}</span>
      </div>
      <div
        role="progressbar"
        aria-label={t.in.progressAria(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-2 overflow-hidden rounded-[4px] bg-line"
      >
        <div className="h-2 rounded-[4px] bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${pct}%` }} />
      </div>
      {beforeStart && <p className="text-[12.5px] text-muted">{t.in.beforeStart(hm(run.startAt))}</p>}
    </section>
  );
}

/** Noch nicht eingecheckt: kurzer Überblick + „Start-QR scannen“. */
export function LandingView({ onScan, pendingScans }: { onScan: () => void; pendingScans: number }) {
  return (
    <>
      <Card padding="none" className="flex flex-col gap-3 rounded-[24px] px-[18px] py-4">
        <StatusChip tone="info" size="md" className="w-fit">
          {t.landing.notYet}
        </StatusChip>
        <p className="text-[14.5px] leading-[1.55] text-ink-2">{t.landing.text}</p>
        {pendingScans > 0 && (
          <StatusChip tone="warn" size="md" icon={<CloudOff aria-hidden="true" />} className="w-fit">
            {t.scan.offlinePending(pendingScans)}
          </StatusChip>
        )}
      </Card>
      <section aria-label={t.landing.tracked} className="flex items-start gap-3 rounded-[22px] bg-success-soft px-4 py-3.5">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" />
        <p className="text-[13.5px] leading-[1.5] text-success-text-strong">
          <strong>{t.landing.tracked}</strong> {t.landing.trackedText}
        </p>
      </section>
      <div className="mt-auto pt-2">
        <Button size="lg" fullWidth onClick={onScan}>
          {t.landing.scan}
        </Button>
      </div>
    </>
  );
}

function Row({ label, children, strong = false }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-[#EEF1F6] py-[9px]">
      <dt className="text-muted">{label}</dt>
      <dd className={cn('text-right tabular-nums', strong && 'font-bold text-ink')}>{children}</dd>
    </div>
  );
}

export function CompletenessChip({ me }: { me: AttendanceRow }) {
  return me.completenessState === 'vollstaendig' ? (
    <StatusChip tone="success" icon={<Check aria-hidden="true" strokeWidth={3} />}>
      {t.confirm.full}
    </StatusChip>
  ) : (
    <StatusChip tone="warn">{t.confirm.partial(me.completenessPct)}</StatusChip>
  );
}

/** Zusammenfassung (13e/13f): Zeiten, Methode, Dauer, Vermerk; Vollständigkeit. */
export function SummaryCard({ run, me }: { run: RunView; me: AttendanceRow }) {
  const several = me.intervals.length > 1;
  const offlineAny = me.intervals.some((iv) => iv.inOffline || iv.outOffline);
  return (
    <section
      aria-labelledby="zusammenfassung-titel"
      className="flex flex-col gap-1 rounded-[26px] bg-surface p-5 text-[14.5px] shadow-[0_1px_2px_rgba(29,36,51,0.04),0_10px_30px_rgba(29,36,51,0.07)]"
      data-testid="summary-card"
    >
      <div className="flex items-start justify-between gap-3 pb-2.5">
        <h2 id="zusammenfassung-titel" className="font-heading text-[16px] leading-snug font-bold text-ink">
          {run.titel}
        </h2>
        <CompletenessChip me={me} />
      </div>
      <dl>
        <Row label={t.confirm.checkedIn}>
          {hm(me.firstIn)} · {me.inMethodLabel}
        </Row>
        <Row label={t.confirm.checkedOut}>
          {hm(me.lastOut)} · {me.outMethodLabel}
        </Row>
        {several && (
          <Row label={t.confirm.intervals}>
            {me.intervals.map((iv) => t.confirm.interval(hm(iv.in), hm(iv.out))).join(', ')}
          </Row>
        )}
        <Row label={t.confirm.duration} strong>
          {durLong(me.durationSeconds)}
        </Row>
        <Row label={t.confirm.planned}>{durLong(run.plannedSeconds)}</Row>
      </dl>
      {offlineAny && (
        <p className="flex items-center gap-1.5 pt-1 text-[12.5px] text-muted">
          <CloudOff aria-hidden="true" className="size-3.5" /> {t.confirm.offline}
        </p>
      )}
    </section>
  );
}

export function NotePanel({ me }: { me: AttendanceRow }) {
  if (me.manual) {
    return (
      <section className="rounded-[22px] bg-warn-soft px-4 py-3.5 text-[14px] leading-[1.5] text-warn-text-strong">
        <strong>{t.confirm.noteTitle(me.manual.reasonLabel)}</strong>
        <br />„{me.manual.note}“
        <br />
        <span className="text-[12.5px]">
          {me.noteReview === 'akzeptiert'
            ? t.confirm.noteAccepted
            : me.noteReview === 'rueckfrage'
              ? t.confirm.noteQuestion(me.noteReviewMessage)
              : t.confirm.noteOpen}
        </span>
      </section>
    );
  }
  if (me.autoClosed) return <Panel tone="warn">{t.confirm.autoClosed}</Panel>;
  return null;
}

/** Wissenscheck nachholen (nach dem Ende, für Anwesende) – SPEZIFIKATION 4.9. */
export function PendingPolls({
  polls,
  onAnswer,
  pendingId,
}: {
  polls: ParticipantPolls['pendingPolls'];
  onAnswer: (pollId: string, option: number) => Promise<AnswerFeedback | null>;
  pendingId: string | null;
}) {
  if (!polls.length) return null;
  return (
    <section aria-labelledby="nachholen-titel" className="flex flex-col gap-3">
      <div className="px-1">
        <h2 id="nachholen-titel" className="font-heading text-[16px] font-bold text-ink">
          {t.poll.pendingTitle}
        </h2>
        <p className="text-[13.5px] text-muted">{t.poll.pendingText}</p>
      </div>
      {polls.map((p) => (
        <PollCard
          key={p.id}
          poll={{ ...p, myAnswer: null }}
          pending={pendingId === p.id}
          onAnswer={(option) => onAnswer(p.id, option)}
        />
      ))}
    </section>
  );
}

/** Bestätigen (13e/13f): Häkchen setzen, dann „Teilnahme bestätigen“. */
export function ConfirmForm({
  confirmText,
  onConfirm,
  pending,
  error,
  footerExtra,
}: {
  confirmText: string;
  onConfirm: () => void;
  pending: boolean;
  error: string | null;
  footerExtra?: ReactNode;
}) {
  const [agree, setAgree] = useState(false);
  return (
    <>
      <Card padding="none" className="rounded-[22px] p-4">
        <CheckboxField checked={agree} onCheckedChange={(c) => setAgree(c === true)} label={confirmText} />
      </Card>
      {error && (
        <Panel tone="danger" role="alert">
          {error}
        </Panel>
      )}
      <div className="sticky bottom-0 mt-auto flex flex-col gap-2.5 bg-bg pt-3.5 pb-[max(22px,env(safe-area-inset-bottom))]">
        <Button size="lg" fullWidth disabled={!agree || pending} onClick={onConfirm}>
          {pending ? t.confirm.sending : t.confirm.submit}
        </Button>
        {footerExtra}
      </div>
    </>
  );
}

async function fetchEvidence(invitationId: string): Promise<AttendanceEvidence | null> {
  try {
    return await get<AttendanceEvidence>(`/me/invitations/${invitationId}/attendance/evidence`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** Bestätigt (13g) mit Nachweis-Status und Download. */
export function ConfirmedView({ run, me, invitationId }: { run: RunView; me: AttendanceRow; invitationId: string }) {
  const ev = useQuery({
    queryKey: liveKeys.evidence(invitationId),
    queryFn: () => fetchEvidence(invitationId),
    refetchInterval: (q) => (q.state.data?.status === 'erzeugt' ? false : 3000),
  });
  const ready = ev.data?.status === 'erzeugt';
  const text = ready
    ? t.done.full(run.titel)
    : me.noteReview === 'offen' || me.noteReview === 'rueckfrage'
      ? t.done.noteOpen
      : me.completenessState === 'teilweise' && !me.release
        ? t.done.partial
        : run.typ === 'termin' && !run.countersign
          ? t.done.countersignOpen
          : t.done.fullPending(run.titel);
  return (
    <div className="flex flex-1 flex-col justify-center gap-4 py-6">
      <section
        aria-labelledby="bestaetigt-titel"
        className="flex flex-col items-center gap-3 rounded-[30px] bg-surface px-[22px] py-8 text-center shadow-[0_10px_30px_rgba(29,36,51,0.07)]"
        data-testid="confirmed-card"
      >
        <span aria-hidden="true" className="flex size-[88px] items-center justify-center rounded-full bg-success-soft">
          <Check className="size-[42px] text-success" strokeWidth={3} />
        </span>
        <h2 id="bestaetigt-titel" className="font-heading text-[24px] font-bold text-ink">
          {t.done.title}
        </h2>
        <p className="text-[15px] leading-[1.55] text-ink-2" aria-live="polite">
          {text}
        </p>
        {ev.data && (
          <p className="text-[13px] text-muted tabular-nums">
            {ready ? t.done.number(ev.data.nachweisNr) : t.done.waiting}
          </p>
        )}
      </section>
      {ready && ev.data && (
        <div className="flex flex-col gap-2.5">
          <Button asChild size="lg" fullWidth>
            <a href={livePath.evidencePdf(invitationId)} download>
              <Download aria-hidden="true" className="size-5" />
              {t.done.download}
            </a>
          </Button>
          <Button asChild variant="secondary" size="lg" fullWidth>
            <Link to={`/verify/${ev.data.verifyCode}`}>{t.done.verify}</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
