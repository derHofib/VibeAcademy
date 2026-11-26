import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Check, LogOut, Search } from 'lucide-react';
import { Avatar, Button, Card, Input, Panel } from '@/components/ui';
import { cn } from '@/lib/cn';
import { tl } from '@/i18n/live';
import { SignatureField, MIN_SIGNATURE_POINTS, type SignatureFieldHandle } from '@/features/participant/SignatureField';
import { livePath, type AttendanceRow, type OrganizerSnapshot } from '@/features/live/api';
import { useServerNow } from '@/features/live/hooks';
import { durLong, hm } from '@/features/live/time';
import { LiveDialog } from '@/features/live/components/LiveDialog';
import { QrCountdown, QrFrame } from '@/features/live/organizer/QrCard';
import { useOrganizerActions, useRotatingQr } from '@/features/live/organizer/useOrganizerLive';
import { secondsLeft } from '@/features/live/qrSchedule';

const tk = tl.kiosk;

type Pending = { row: AttendanceRow; action: 'in' | 'out' | 'sign' } | null;

/** Was passiert beim Antippen? Einchecken (läuft), Auschecken (eingecheckt), Unterschreiben (kann bestätigen). */
export function kioskAction(r: AttendanceRow, ended: boolean): 'in' | 'out' | 'sign' | null {
  if (r.confirmedAt) return null;
  if (r.canConfirm) return 'sign';
  if (ended) return null;
  return r.checkedIn ? 'out' : 'in';
}

/** Tablet-Kiosk (SPEZIFIKATION 4.6): großer Start-QR + „Ohne Smartphone einchecken“ + Unterschrift zur Bestätigung. */
export function KioskView({ snapshot }: { snapshot: OrganizerSnapshot }) {
  const { run, attendance } = snapshot;
  const ended = run.status === 'beendet';
  // tickt jede Sekunde (Countdown des Codes)
  useServerNow(run.serverTime);
  const actions = useOrganizerActions(run.id);
  const qr = useRotatingQr(run.id, 'start', !ended);
  const [q, setQ] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'danger' } | null>(null);
  const [points, setPoints] = useState(0);
  const sigRef = useRef<SignatureFieldHandle>(null);

  const rows = useMemo(() => {
    const s = q.trim().toLocaleLowerCase('de-DE');
    return attendance.rows.filter((r) => !s || r.personName.toLocaleLowerCase('de-DE').includes(s));
  }, [attendance.rows, q]);

  const close = () => {
    setPending(null);
    setPoints(0);
  };

  const submit = async () => {
    if (!pending) return;
    const { row, action } = pending;
    try {
      if (action === 'sign') {
        const png = sigRef.current?.png() ?? '';
        if (points < MIN_SIGNATURE_POINTS || !png) {
          setMessage({ text: tk.signMissing, tone: 'danger' });
          return;
        }
        await actions.kioskConfirm.mutateAsync({ attendanceId: row.attendanceId!, signaturePng: png });
        setMessage({ text: tk.signed(row.personName), tone: 'success' });
      } else {
        await actions.staffScan.mutateAsync({ personId: row.personId, direction: action, method: 'kiosk' });
        setMessage({ text: action === 'in' ? tk.checkedIn(row.personName) : tk.checkedOut(row.personName), tone: 'success' });
      }
      close();
      setQ('');
    } catch (e) {
      setMessage({ text: (e as Error).message, tone: 'danger' });
      close();
    }
  };

  const left = qr.data ? secondsLeft(qr.dataUpdatedAt, qr.data.expiresInSeconds, Date.now()) : 0;
  const busy = actions.staffScan.isPending || actions.kioskConfirm.isPending;

  return (
    <div className="min-h-dvh bg-bg px-4 py-5 md:px-7">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[13.5px] text-muted">
              {tk.title} · {hm(run.startAt)}–{hm(run.endAt)}
              {run.ort ? ` · ${run.ort}` : ''}
            </p>
            <h1 className="font-heading text-[26px] leading-tight font-bold text-ink">{run.titel}</h1>
          </div>
          <Button asChild variant="secondary">
            <Link to={livePath.organizer(run.id)}>
              <LogOut aria-hidden="true" className="size-4" />
              {tk.exit}
            </Link>
          </Button>
        </header>
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <Card radius="lg" padding="none" className="flex flex-col items-center gap-4 p-7">
            <h2 className="font-heading text-[20px] font-bold text-ink">{tk.scanTitle}</h2>
            {ended ? (
              <Panel tone="neutral" className="w-full text-center">
                {tk.ended}
              </Panel>
            ) : (
              <>
                <div className="w-full max-w-[440px]">
                  <QrFrame data={qr.data} kind="start" loading={qr.isPending} error={qr.isError} />
                </div>
                {qr.data && <QrCountdown seconds={left} />}
              </>
            )}
          </Card>

          <Card radius="lg" padding="none" className="flex flex-col gap-4 p-6 md:p-7">
            <div>
              <h2 className="font-heading text-[22px] font-bold text-ink">{tk.noPhone}</h2>
              <p className="mt-1 text-[14.5px] text-muted">{tk.noPhoneHint}</p>
            </div>
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted" />
              <Input size="lg" type="search" aria-label={tk.search} placeholder={tk.search} value={q} onChange={(e) => setQ(e.target.value)} className="pl-12" />
            </div>
            <div role="status" aria-live="polite">
              {message && (
                <Panel tone={message.tone} className="font-medium">
                  {message.text}
                </Panel>
              )}
            </div>
            {rows.length === 0 ? (
              <p className="py-6 text-center text-[15px] text-muted">{tk.nobody}</p>
            ) : (
              <ul aria-label={tk.listLabel} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {rows.map((r) => {
                  const action = kioskAction(r, ended);
                  const open = [...r.intervals].reverse().find((iv) => !iv.out);
                  const sub = r.confirmedAt
                    ? tk.confirmedAt(hm(r.confirmedAt))
                    : action === 'sign'
                      ? tk.tapToSign
                      : open
                        ? tk.checkedInAt(hm(open.in))
                        : action === 'in'
                          ? tk.tapToCheckIn
                          : r.statusLabel;
                  return (
                    <li key={r.personId}>
                      <button
                        type="button"
                        disabled={!action || busy}
                        onClick={() => {
                          setMessage(null);
                          setPending({ row: r, action: action! });
                        }}
                        className={cn(
                          'flex min-h-[68px] w-full cursor-pointer items-center gap-3.5 rounded-[20px] px-4 py-2.5 text-left transition-colors',
                          'disabled:cursor-default',
                          r.confirmedAt || open ? 'bg-success-soft' : 'bg-bg hover:bg-neutral-soft',
                        )}
                        data-testid="kiosk-person"
                      >
                        <Avatar name={r.personName} size="xl" tone={r.confirmedAt || open ? 'success' : 'surface'} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[17px] font-semibold text-ink">{r.personName}</span>
                          <span className={cn('block text-[13.5px]', r.confirmedAt || open ? 'text-success-text' : 'text-muted')}>{sub}</span>
                        </span>
                        {r.confirmedAt && <Check aria-hidden="true" className="size-6 shrink-0 text-success" strokeWidth={3} />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <LiveDialog
        open={!!pending && pending.action !== 'sign'}
        onOpenChange={(o) => !o && close()}
        title={pending ? (pending.action === 'out' ? tk.checkOutTitle(pending.row.personName) : tk.checkInTitle(pending.row.personName)) : ''}
        description={tk.checkInText}
        actions={
          <>
            <Button variant="tonal" size="lg" onClick={close}>
              {tl.common.cancel}
            </Button>
            <Button size="lg" disabled={busy} onClick={() => void submit()}>
              {pending?.action === 'out' ? tk.checkOutConfirm : tk.checkInConfirm}
            </Button>
          </>
        }
      />
      <LiveDialog
        open={!!pending && pending.action === 'sign'}
        onOpenChange={(o) => !o && close()}
        title={pending ? tk.signTitle(pending.row.personName) : ''}
        description={
          pending
            ? tk.signSummary(
                durLong(pending.row.durationSeconds),
                pending.row.completenessState === 'vollstaendig' ? tl.tn.confirm.full : tl.tn.confirm.partial(pending.row.completenessPct),
              )
            : undefined
        }
        className="w-[min(640px,calc(100vw-24px))]"
        actions={
          <>
            <Button variant="tonal" size="lg" onClick={close}>
              {tl.common.cancel}
            </Button>
            <Button size="lg" disabled={busy || points < MIN_SIGNATURE_POINTS} onClick={() => void submit()}>
              {tk.signSubmit}
            </Button>
          </>
        }
      >
        {pending?.action === 'sign' && (
          <>
            <p className="text-[14.5px] leading-[1.55] text-ink">{run.confirmText}</p>
            <SignatureField ref={sigRef} caption={tk.signCaption(pending.row.personName)} onChange={setPoints} />
          </>
        )}
      </LiveDialog>
    </div>
  );
}
