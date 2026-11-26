import { useEffect, useRef, useState, type ReactNode } from 'react';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ChevronLeft, ChevronRight, ExternalLink, FileX2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { tx } from '@/i18n/external';
import type { OcrBox, ReceiptFileInfo } from './api';
import { boxStyle, type FieldBox } from './model';

/** PDF.js erst laden, wenn ein PDF-Beleg angezeigt wird (eigener Chunk, wie im Lese-Viewer). */
let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;
function loadPdfjs() {
  pdfjsPromise ??= import('pdfjs-dist').then((m) => {
    m.GlobalWorkerOptions.workerSrc = workerUrl;
    return m;
  });
  return pdfjsPromise;
}

export interface OverlayBox {
  key: string;
  box: OcrBox;
  label: string;
  tone?: 'accent' | 'warn';
}

/** Erste Seite eines PDF-Belegs als Canvas in Containerbreite. */
function PdfCanvas({ url, alt, onReady }: { url: string; alt: string; onReady?: (ratio: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [pdfjs, buf] = await Promise.all([
          loadPdfjs(),
          fetch(url, { credentials: 'same-origin' }).then((r) => {
            if (!r.ok) throw new Error(String(r.status));
            return r.arrayBuffer();
          }),
        ]);
        const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
        const page = await doc.getPage(1);
        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(2.5, Math.max(1, 1100 / base.width));
        const vp = page.getViewport({ scale });
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        await page.render({ canvas, viewport: vp }).promise;
        if (!cancelled) {
          setState('ready');
          onReady?.(canvas.height / canvas.width);
        }
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, onReady]);
  return (
    <>
      <canvas ref={canvasRef} role="img" aria-label={alt} className={cn('block h-auto w-full', state !== 'ready' && 'hidden')} />
      {state === 'loading' && <Placeholder busy>{tx.receipt.loading}</Placeholder>}
      {state === 'error' && <Placeholder>{tx.receipt.loadError}</Placeholder>}
    </>
  );
}

function Placeholder({ children, busy = false }: { children: ReactNode; busy?: boolean }) {
  return (
    <div role="status" className="flex aspect-[595/842] w-full flex-col items-center justify-center gap-2 bg-[#FFFDF8] px-6 text-center text-[13.5px] text-muted">
      {busy && <Loader2 aria-hidden="true" className="size-5 animate-spin text-accent" />}
      {children}
    </div>
  );
}

/** Beleg (Bild oder erste PDF-Seite) mit markierten OCR-Feldern als Rahmen in Prozent der Seite. */
export function ReceiptPage({
  file,
  boxes,
  className,
  showLabels = false,
  maxHeight,
}: {
  file: Pick<ReceiptFileInfo, 'url' | 'mime' | 'name'>;
  boxes: OverlayBox[];
  className?: string;
  showLabels?: boolean;
  /** Höchstens so hoch (px) – die Breite folgt dem Seitenverhältnis, Rahmen bleiben deckungsgleich */
  maxHeight?: number;
}) {
  const [imgState, setImgState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [ratio, setRatio] = useState<number | null>(null);
  const isPdf = file.mime === 'application/pdf';
  const alt = tx.receipt.alt(file.name);
  const ready = isPdf || imgState === 'ready';
  return (
    <div
      className={cn('relative mx-auto w-full overflow-hidden bg-[#FFFDF8]', className)}
      style={maxHeight && ratio ? { maxWidth: `${Math.round(maxHeight / ratio)}px` } : undefined}
      data-testid="beleg-seite"
    >
      {isPdf ? (
        <PdfCanvas url={file.url} alt={alt} onReady={setRatio} />
      ) : (
        <>
          <img
            src={file.url}
            alt={alt}
            onLoad={(e) => {
              setRatio(e.currentTarget.naturalHeight / Math.max(1, e.currentTarget.naturalWidth));
              setImgState('ready');
            }}
            onError={() => setImgState('error')}
            className={cn('block h-auto w-full', imgState !== 'ready' && 'hidden')}
          />
          {imgState === 'loading' && <Placeholder busy>{tx.receipt.loading}</Placeholder>}
          {imgState === 'error' && <Placeholder>{tx.receipt.loadError}</Placeholder>}
        </>
      )}
      {ready && boxes.length > 0 && (
        <ul aria-label={tx.review.title} className="pointer-events-none absolute inset-0 m-0 list-none p-0">
          {boxes.map((b) => (
            <li
              key={b.key}
              data-testid="ocr-rahmen"
              className={cn(
                'absolute rounded-[4px] outline-2 outline-offset-0',
                b.tone === 'warn' ? 'outline-warn' : 'outline-[#7FA2FF]',
                'outline',
              )}
              style={boxStyle(b.box)}
            >
              <span className={showLabels ? 'absolute -top-5 left-0 rounded-pill bg-accent px-1.5 text-[10px] font-semibold text-white' : 'sr-only'}>
                {b.label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Beleg-Vorschau der Prüfansicht (Screen 11): dunkle Fläche (`scan-bg`), Dateiname und Seiteninfo,
 * Papier mittig mit OCR-Rahmen; mehrere Belege blätterbar.
 */
export function ReceiptViewer({
  files,
  boxes,
  children,
  className,
}: {
  files: ReceiptFileInfo[];
  /** Rahmen je Datei-Index (OCR liest den ersten Beleg) */
  boxes: (fileIndex: number) => OverlayBox[];
  /** Zusatz unter dem Papier, z. B. Personen der Papierliste */
  children?: ReactNode;
  className?: string;
}) {
  const [idx, setIdx] = useState(0);
  const file = files[Math.min(idx, files.length - 1)];
  return (
    <section
      aria-label={tx.receipt.label}
      className={cn('flex min-w-0 flex-col items-center gap-3.5 rounded-card-lg bg-scan-bg-2 p-5 md:p-7', className)}
    >
      {file ? (
        <>
          <div className="flex w-full flex-wrap items-center justify-between gap-2 text-[13px] text-[#CBD5E1]">
            <span className="min-w-0 truncate" title={file.name}>
              {file.name}
            </span>
            <span className="flex items-center gap-1.5 tabular-nums">
              {files.length > 1 && (
                <>
                  <button
                    type="button"
                    aria-label={tx.receipt.prevFile}
                    disabled={idx === 0}
                    onClick={() => setIdx((i) => i - 1)}
                    className="relative inline-flex size-8 cursor-pointer items-center justify-center rounded-full text-white after:absolute after:-inset-1.5 hover:bg-white/10 disabled:cursor-default disabled:opacity-40"
                  >
                    <ChevronLeft aria-hidden="true" className="size-4" />
                  </button>
                  <span>{tx.receipt.fileOf(idx + 1, files.length)} ·</span>
                  <button
                    type="button"
                    aria-label={tx.receipt.nextFile}
                    disabled={idx >= files.length - 1}
                    onClick={() => setIdx((i) => i + 1)}
                    className="relative inline-flex size-8 cursor-pointer items-center justify-center rounded-full text-white after:absolute after:-inset-1.5 hover:bg-white/10 disabled:cursor-default disabled:opacity-40"
                  >
                    <ChevronRight aria-hidden="true" className="size-4" />
                  </button>
                </>
              )}
              {tx.receipt.pageInfo(1, Math.max(1, file.pages), 100)}
              <a
                href={file.url}
                target="_blank"
                rel="noreferrer"
                aria-label={tx.receipt.openOriginal}
                title={tx.receipt.openOriginal}
                className="relative ml-1 inline-flex size-8 items-center justify-center rounded-full text-white after:absolute after:-inset-1.5 hover:bg-white/10"
              >
                <ExternalLink aria-hidden="true" className="size-4" />
              </a>
            </span>
          </div>
          <div className="w-full max-w-[440px] overflow-hidden rounded-[6px] shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
            <ReceiptPage key={file.url} file={file} boxes={boxes(file.index)} />
          </div>
          {children}
        </>
      ) : (
        <div className="flex min-h-[320px] w-full flex-col items-center justify-center gap-2 text-center text-[#CBD5E1]">
          <FileX2 aria-hidden="true" className="size-8" />
          <p className="text-[15px] font-semibold text-white">{tx.receipt.noReceipt}</p>
          <p className="text-[13px]">{tx.receipt.noReceiptText}</p>
          {children}
        </div>
      )}
    </section>
  );
}

/** Rahmen aus erkannten Feldern (nur erster Beleg, Seite 1). */
export function toOverlay(fields: FieldBox[], warnKeys: string[] = []): OverlayBox[] {
  return fields.map((f) => ({ key: f.key, box: f.box, label: f.label, tone: warnKeys.includes(f.key) ? 'warn' : 'accent' }));
}
