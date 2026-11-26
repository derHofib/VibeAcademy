import { useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { IconButton } from '@/components/ui';
import { tl } from '@/i18n/live';
import type { RunView } from '../api';
import { formatCountdown, secondsLeft } from '../qrSchedule';
import { hm } from '../time';
import { QrFrame } from './QrCard';
import { useRotatingQr } from './useOrganizerLive';

const q = tl.org.qr;

/** „Vollbild für Beamer“: großer rotierender Code, Browser-Vollbild (falls erlaubt), Escape schließt. */
export function BeamerView({ run, kind, open, onOpenChange }: { run: RunView; kind: 'start' | 'end'; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qr = useRotatingQr(run.id, kind, open && run.status !== 'beendet');

  useEffect(() => {
    if (!open) return;
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => undefined);
    const onFs = () => {
      if (!document.fullscreenElement) onOpenChange(false);
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    };
  }, [open, onOpenChange]);

  const left = qr.data ? secondsLeft(qr.dataUpdatedAt, qr.data.expiresInSeconds, Date.now()) : 0;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-surface p-8 text-ink outline-none"
        >
          <Dialog.Close asChild>
            <IconButton aria-label={q.closeBeamer} variant="tonal" size="md" className="absolute top-6 right-6">
              <X aria-hidden="true" />
            </IconButton>
          </Dialog.Close>
          <Dialog.Title className="text-center font-heading text-[clamp(24px,3.2vw,44px)] leading-tight font-bold">{run.titel}</Dialog.Title>
          <div className="w-[min(68vh,80vw)]">
            <QrFrame data={qr.data} kind={kind} loading={qr.isPending} error={qr.isError} className="rounded-[40px] p-6" />
          </div>
          <p className="text-center font-heading text-[clamp(20px,2.4vw,32px)] font-bold">
            {kind === 'start' ? q.beamerHintStart : q.beamerHintEnd}
          </p>
          <p className="text-center text-[clamp(15px,1.4vw,20px)] text-muted tabular-nums">
            {q.changesIn} {formatCountdown(left)} · {hm(run.startAt)}–{hm(run.endAt)}
            {run.ort ? ` · ${run.ort}` : ''}
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
