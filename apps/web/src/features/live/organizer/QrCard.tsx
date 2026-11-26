import { Link } from 'react-router';
import { LoaderCircle, Lock, Maximize2, Printer, TabletSmartphone } from 'lucide-react';
import { Button, SegmentedControl } from '@/components/ui';
import { cn } from '@/lib/cn';
import { tl } from '@/i18n/live';
import { livePath, type QrCodeResponse, type RunView } from '../api';
import { formatCountdown, secondsLeft, validWindowLabel } from '../qrSchedule';
import { hm } from '../time';
import { useRotatingQr } from './useOrganizerLive';

const q = tl.org.qr;

export const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** QR-Bild im farbigen Rahmen (blau = Start, orange = Ende). */
export function QrFrame({
  data,
  kind,
  loading,
  error,
  className,
  imgClassName,
}: {
  data: QrCodeResponse | undefined;
  kind: 'start' | 'end';
  loading: boolean;
  error: boolean;
  className?: string;
  imgClassName?: string;
}) {
  return (
    <div
      className={cn(
        'flex aspect-square w-full items-center justify-center rounded-[30px] p-4',
        kind === 'start' ? 'bg-[#DCE5FC]' : 'bg-[#FDE7C2]',
        className,
      )}
    >
      <div className="flex size-full items-center justify-center rounded-[22px] bg-surface p-3">
        {data ? (
          <img
            src={svgDataUrl(data.svg)}
            alt={kind === 'start' ? q.altStart : q.altEnd}
            data-qr-url={data.url}
            data-testid={`qr-${kind}`}
            className={cn('size-full [image-rendering:pixelated]', imgClassName)}
          />
        ) : error ? (
          <p role="alert" className="px-4 text-center text-[14px] text-danger-text">
            {q.error}
          </p>
        ) : loading ? (
          <span role="status" className="flex items-center gap-2 text-[14px] text-muted">
            <LoaderCircle aria-hidden="true" className="size-5 animate-spin text-accent" />
            {q.loading}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Countdown-Ring „Code wechselt in 0:21 · Foto weiterleiten zwecklos“ (Screen 7). */
export function QrCountdown({ seconds, className }: { seconds: number; className?: string }) {
  const r = 14;
  const c = 2 * Math.PI * r;
  const frac = Math.min(1, Math.max(0, seconds / 30));
  return (
    <div className={cn('flex items-center justify-center gap-3 text-[14.5px] text-ink-2', className)}>
      <svg width="30" height="30" viewBox="0 0 34 34" aria-hidden="true" className="shrink-0">
        <circle cx="17" cy="17" r={r} fill="none" stroke="var(--color-line)" strokeWidth="4" />
        <circle
          cx="17"
          cy="17"
          r={r}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="4"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          transform="rotate(-90 17 17)"
          strokeLinecap="round"
        />
      </svg>
      <span>
        {q.changesIn} <strong className="text-ink tabular-nums">{formatCountdown(seconds)}</strong> · {q.forwardUseless}
      </span>
    </div>
  );
}

/** Gesperrt nach dem offiziellen Ende (12d). */
export function QrLocked({ run }: { run: RunView }) {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center gap-2.5 rounded-[26px] bg-bg px-8 py-10 text-center">
      <Lock aria-hidden="true" className="size-11 text-ink-2" strokeWidth={1.8} />
      <p className="font-heading text-[16px] font-bold text-ink">{q.lockedTitle}</p>
      <p className="text-[13.5px] leading-[1.5] text-muted">{q.lockedText(hm(run.endedAt))}</p>
    </div>
  );
}

/**
 * Linke QR-Karte (12a/12b): Umschalter Start/Ende, rotierender Code, Gültigkeit, „Vollbild für Beamer“,
 * „Aushang drucken“ und Tablet-Modus. `variant="presence"` zeigt zusätzlich den Countdown (Screen 7).
 */
export function QrCard({
  run,
  kind,
  onKindChange,
  onBeamer,
  nowMs,
  variant = 'live',
}: {
  run: RunView;
  kind: 'start' | 'end';
  onKindChange: (k: 'start' | 'end') => void;
  onBeamer: () => void;
  nowMs: number;
  variant?: 'live' | 'presence';
}) {
  const ended = run.status === 'beendet';
  const qr = useRotatingQr(run.id, kind, !ended);
  const left = qr.data ? secondsLeft(qr.dataUpdatedAt, qr.data.expiresInSeconds, Date.now()) : 0;
  return (
    <section aria-label={q.label} className="flex flex-col gap-5">
      <SegmentedControl
        aria-label={q.segLabel}
        fullWidth
        size="sm"
        value={kind}
        onValueChange={onKindChange}
        options={[
          { value: 'start', label: q.start },
          { value: 'end', label: q.end },
        ]}
      />
      {ended ? (
        <QrLocked run={run} />
      ) : (
        <>
          <div className={cn('w-full px-3', variant === 'presence' && 'mx-auto max-w-[400px]')}>
            <QrFrame data={qr.data} kind={kind} loading={qr.isPending} error={qr.isError} />
          </div>
          <div className="text-center">
            <p className="font-heading text-[18px] font-bold text-ink">{kind === 'start' ? q.titleStart : q.titleEnd}</p>
            {qr.data && (
              <p className="mt-0.5 text-[13.5px] text-muted">
                {q.hint(validWindowLabel(qr.data.validWindow.from, qr.data.validWindow.until, nowMs))}
              </p>
            )}
          </div>
          {variant === 'presence' && qr.data && <QrCountdown seconds={left} />}
          <div className="grid grid-cols-2 gap-2.5">
            <Button variant="tonal" onClick={onBeamer} className="px-3">
              <Maximize2 aria-hidden="true" className="size-4" />
              {q.beamer}
            </Button>
            <Button asChild variant="tonal" className="px-3">
              <a href={livePath.print(run.id, kind)} target="_blank" rel="noopener noreferrer">
                <Printer aria-hidden="true" className="size-4" />
                {q.print}
              </a>
            </Button>
          </div>
          <Button asChild variant="ghost" size="sm" className="-mt-2 self-center">
            <Link to={livePath.kiosk(run.id)}>
              <TabletSmartphone aria-hidden="true" className="size-4" />
              {q.kiosk}
            </Link>
          </Button>
        </>
      )}
    </section>
  );
}
