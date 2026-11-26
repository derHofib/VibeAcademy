import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Check, Keyboard, LoaderCircle, QrCode, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { tl } from '@/i18n/live';

type CameraState = 'starting' | 'on' | 'denied' | 'missing';

const COLOR = { start: '#3D63DD', end: '#F2A93B' } as const;

/**
 * Sucher (13a/13c): dunkle Fläche, runde Eckwinkel in Blau (Start) bzw. Orange (Ende), Kamera über `qr-scanner`.
 * Ohne Kamera/Erlaubnis bleibt die manuelle Eingabe (Code oder Link aus dem QR-Code).
 */
export function ScanView({
  kind,
  onClose,
  onDetected,
  busy,
  recognized,
  error,
}: {
  kind: 'start' | 'end';
  onClose: () => void;
  /** Roher QR-Inhalt (URL oder Token) */
  onDetected: (raw: string) => void;
  busy: boolean;
  recognized: boolean;
  error: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState<CameraState>('starting');
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState('');
  const inputId = useId();
  const detectedRef = useRef(onDetected);
  detectedRef.current = onDetected;
  const pausedRef = useRef(false);
  pausedRef.current = busy || recognized;
  const color = COLOR[kind];
  const t = tl.tn.scan;

  useEffect(() => {
    let disposed = false;
    let scanner: { stop: () => void; destroy: () => void } | null = null;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('NotFoundError');
        const { default: QrScanner } = await import('qr-scanner');
        if (disposed || !videoRef.current) return;
        if (!(await QrScanner.hasCamera())) throw new Error('NotFoundError');
        const s = new QrScanner(
          videoRef.current,
          (r) => {
            if (!pausedRef.current && r.data) detectedRef.current(r.data);
          },
          { returnDetailedScanResult: true, preferredCamera: 'environment', maxScansPerSecond: 4, highlightScanRegion: false },
        );
        scanner = s;
        await s.start();
        if (!disposed) setCamera('on');
      } catch (e) {
        if (disposed) return;
        const msg = String((e as Error)?.name ?? e) + String((e as Error)?.message ?? '');
        setCamera(/NotAllowed|Permission|denied/i.test(msg) ? 'denied' : 'missing');
        setManualOpen(true);
      }
    })();
    return () => {
      disposed = true;
      scanner?.stop();
      scanner?.destroy();
    };
  }, []);

  const submitManual = (e: FormEvent) => {
    e.preventDefault();
    if (manual.trim()) onDetected(manual.trim());
  };

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-scan-bg px-5 pt-[18px] pb-[max(26px,env(safe-area-inset-bottom))] text-white" data-testid={`scan-${kind}`}>
      <div className="mx-auto flex w-full max-w-[480px] flex-1 flex-col">
        <header className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            aria-label={t.close}
            className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/12 hover:bg-white/20"
          >
            <X aria-hidden="true" className="size-[18px]" strokeWidth={2.25} />
          </button>
          <div>
            <p className="text-[12px] text-[#AAB3C5]">{kind === 'start' ? t.kickerStart : t.kickerEnd}</p>
            <h1 className="font-heading text-[18px] font-bold">{kind === 'start' ? t.titleStart : t.titleEnd}</h1>
          </div>
        </header>

        <div className="flex flex-1 items-center justify-center py-6">
          <div
            role="img"
            aria-label={t.viewfinder}
            className="relative flex size-[260px] items-center justify-center overflow-hidden rounded-[34px] bg-white/4"
          >
            <video
              ref={videoRef}
              muted
              playsInline
              aria-hidden="true"
              className={cn('absolute inset-0 size-full object-cover', camera === 'on' ? 'opacity-100' : 'opacity-0')}
            />
            {camera !== 'on' && !recognized && (
              <span aria-hidden="true" className="flex size-[164px] items-center justify-center rounded-[12px] bg-white/92 text-scan-bg">
                <QrCode className="size-[120px]" strokeWidth={1.4} />
              </span>
            )}
            {recognized && (
              <span className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-scan-bg/80">
                <span aria-hidden="true" className="flex size-16 items-center justify-center rounded-full" style={{ background: color }}>
                  <Check className="size-8 text-white" strokeWidth={3} />
                </span>
                <span className="text-[15px] font-semibold">{busy ? t.sending : t.recognized}</span>
              </span>
            )}
            {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
              <span
                key={c}
                aria-hidden="true"
                className={cn(
                  'absolute size-[46px] border-[5px]',
                  c === 'tl' && 'top-0 left-0 rounded-tl-[30px] border-r-0 border-b-0',
                  c === 'tr' && 'top-0 right-0 rounded-tr-[30px] border-b-0 border-l-0',
                  c === 'bl' && 'bottom-0 left-0 rounded-bl-[30px] border-t-0 border-r-0',
                  c === 'br' && 'right-0 bottom-0 rounded-br-[30px] border-t-0 border-l-0',
                )}
                style={{ borderColor: color }}
              />
            ))}
          </div>
        </div>

        <div aria-live="polite" className="min-h-[22px] text-center text-[14px] leading-[1.5]">
          {error ? (
            <p role="alert" className="mb-3 rounded-[16px] bg-[#FDECEA] px-4 py-3 text-left text-[14px] font-medium text-danger-text">
              {error}
            </p>
          ) : camera === 'starting' ? (
            <p className="mb-3 text-[#AAB3C5]">{t.cameraStarting}</p>
          ) : camera === 'denied' || camera === 'missing' ? (
            <p className="mb-3 text-[#D5DBE6]">{camera === 'denied' ? t.cameraDenied : t.cameraMissing}</p>
          ) : null}
        </div>

        <p className="mb-[18px] text-center text-[15px] leading-[1.5] text-[#D5DBE6]">{kind === 'start' ? t.hintStart : t.hintEnd}</p>

        {manualOpen ? (
          <form onSubmit={submitManual} className="flex flex-col gap-2.5">
            <label htmlFor={inputId} className="text-[13px] text-[#AAB3C5]">
              {t.manualLabel}
            </label>
            <div className="flex gap-2">
              <input
                id={inputId}
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder={t.manualPlaceholder}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                className="h-14 min-w-0 flex-1 rounded-[18px] bg-white/10 px-4 text-[15px] text-white outline-none placeholder:text-[#AAB3C5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              />
              <button
                type="submit"
                disabled={busy || !manual.trim()}
                className="h-14 shrink-0 cursor-pointer rounded-pill px-5 text-[15px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                style={{ background: color, color: kind === 'end' ? '#1D2433' : '#FFFFFF' }}
              >
                {busy ? <LoaderCircle aria-hidden="true" className="size-5 animate-spin" /> : t.manualSubmit}
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setManualOpen(true)}
            className="flex h-14 cursor-pointer items-center justify-center gap-2 rounded-pill text-[16px] font-semibold"
            style={{ background: color, color: kind === 'end' ? '#1D2433' : '#FFFFFF' }}
          >
            <Keyboard aria-hidden="true" className="size-5" />
            {t.manual}
          </button>
        )}
        {kind === 'end' && (
          <button
            type="button"
            onClick={onClose}
            className="mt-2.5 h-12 cursor-pointer rounded-pill bg-white/10 text-[15px] font-semibold hover:bg-white/15"
          >
            {t.cancelEnd}
          </button>
        )}
      </div>
    </div>
  );
}
