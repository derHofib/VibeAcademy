import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Loader2, Lock } from 'lucide-react';
import { ApiError, get } from '@/lib/api';
import { cn } from '@/lib/cn';
import { tp } from '@/i18n/participant';

/** PDF.js wird erst beim Lesen geladen (eigener Chunk). */
let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;
function loadPdfjs() {
  pdfjsPromise ??= import('pdfjs-dist').then((m) => {
    m.GlobalWorkerOptions.workerSrc = workerUrl;
    return m;
  });
  return pdfjsPromise;
}

const A4_RATIO = 842 / 595;

export interface PdfPageProps {
  invitationId: string;
  pageNo: number;
  /** Render-Zoom 0,9–1,3 (E-05: „Schriftgröße“) */
  zoom: number;
  className?: string;
  /** Wird nach dem ersten Rendern der Seite aufgerufen */
  onRendered?: (pageNo: number) => void;
}

type LoadState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'locked' } | { kind: 'ready'; doc: PDFDocumentProxy; text: string };

/**
 * Eine Seite aus kurzlebiger signierter URL (60 s, E-05) als Canvas. Die URL wird bei jedem Anzeigen
 * neu angefordert; im Browser liegt immer nur das Einzelseiten-PDF. Der Text-Layer steht unsichtbar
 * für Screenreader bereit.
 */
export function PdfPage({ invitationId, pageNo, zoom, className, onRendered }: PdfPageProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [ratio, setRatio] = useState(A4_RATIO);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const onRenderedRef = useRef(onRendered);
  onRenderedRef.current = onRendered;

  // Breite der Karte beobachten (Render-Breite = Kartenbreite × Zoom)
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.floor(el.clientWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Seite laden: signierte URL → Bytes → PDF.js
  useEffect(() => {
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    setState({ kind: 'loading' });
    (async () => {
      try {
        const { url } = await get<{ url: string; expiresInSeconds: number }>(`/me/invitations/${invitationId}/pages/${pageNo}`);
        const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
        if (!res.ok) throw new Error(tp.reader.pageError);
        const data = new Uint8Array(await res.arrayBuffer());
        const pdfjs = await loadPdfjs();
        doc = await pdfjs.getDocument({ data }).promise;
        const page = await doc.getPage(1);
        const vp = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const text = content.items.map((i) => ('str' in i ? i.str : '')).join(' ').replace(/\s+/g, ' ').trim();
        if (cancelled) return;
        setRatio(vp.height / vp.width);
        setState({ kind: 'ready', doc, text });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 409) setState({ kind: 'locked' });
        else setState({ kind: 'error', message: e instanceof Error && e.message ? e.message : tp.reader.pageError });
      }
    })();
    return () => {
      cancelled = true;
      void doc?.destroy();
    };
  }, [invitationId, pageNo]);

  // Rendern (bei Breiten- und Zoomänderung ohne neuen Abruf)
  useEffect(() => {
    if (state.kind !== 'ready' || !width || !canvasRef.current) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    (async () => {
      const page = await state.doc.getPage(1);
      if (cancelled || !canvasRef.current) return;
      const base = page.getViewport({ scale: 1 });
      const cssWidth = width * zoom;
      const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
      const vp = page.getViewport({ scale: (cssWidth / base.width) * dpr });
      const canvas = canvasRef.current;
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${(cssWidth * base.height) / base.width}px`;
      task = page.render({ canvas, viewport: vp });
      try {
        await task.promise;
        if (!cancelled) onRenderedRef.current?.(pageNo);
      } catch {
        // abgebrochen (Seiten-/Zoomwechsel)
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [state, width, zoom, pageNo]);

  const cssHeight = width ? width * zoom * ratio : undefined;

  return (
    <div ref={boxRef} className={cn('relative w-full', className)}>
      <div className={cn('overflow-x-auto', zoom > 1 && 'pb-1')}>
        <div style={{ width: width ? width * zoom : '100%', height: cssHeight }} className="relative">
          {state.kind === 'ready' && (
            <>
              <canvas ref={canvasRef} role="img" aria-label={tp.reader.pageRender(pageNo)} className="block" data-testid="pdf-canvas" />
              {state.text && <p className="sr-only">{state.text}</p>}
            </>
          )}
          {state.kind === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-[14px] text-muted" role="status">
              <Loader2 aria-hidden="true" className="size-5 animate-spin" />
              {tp.reader.pageLoading}
            </div>
          )}
          {state.kind === 'locked' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-[14px] text-muted">
              <Lock aria-hidden="true" className="size-6" />
              {tp.reader.pageLocked}
            </div>
          )}
          {state.kind === 'error' && (
            <div role="alert" className="absolute inset-0 flex items-center justify-center px-6 text-center text-[14px] text-danger-text">
              {state.message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
