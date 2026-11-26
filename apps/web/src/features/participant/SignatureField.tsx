import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import SignaturePad from 'signature_pad';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { tp } from '@/i18n/participant';

export type Strokes = Array<Array<{ x: number; y: number; t: number }>>;

export interface SignatureFieldHandle {
  clear: () => void;
  strokes: () => Strokes;
  png: () => string;
}

export interface SignatureFieldProps {
  /** Unter dem Feld, z. B. Name der Person */
  caption?: string;
  /** Anzahl erfasster Punkte (zum Freischalten des Buttons) */
  onChange: (points: number) => void;
}

/** Mindestanzahl Punkte, ab der eine Unterschrift als vorhanden gilt (wie im Prototyp) */
export const MIN_SIGNATURE_POINTS = 8;

/**
 * Unterschriftsfeld (Screen 6) auf Basis von signature_pad (Pointer-Events). Liefert Strichdaten mit
 * Zeitstempeln und ein PNG (transparenter Hintergrund). Beim Ändern der Größe bleibt die Zeichnung erhalten.
 */
export const SignatureField = forwardRef<SignatureFieldHandle, SignatureFieldProps>(function SignatureField({ caption, onChange }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad | null>(null);
  const [empty, setEmpty] = useState(true);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pad = new SignaturePad(canvas, { penColor: '#1D2433', minWidth: 1.2, maxWidth: 2.8 });
    padRef.current = pad;
    const count = () => pad.toData().reduce((n, g) => n + g.points.length, 0);
    const report = () => {
      const n = count();
      setEmpty(n === 0);
      onChangeRef.current(n);
    };
    pad.addEventListener('endStroke', report);
    pad.addEventListener('beginStroke', () => setEmpty(false));
    const resize = () => {
      const data = pad.toData();
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      if (!w || !h) return;
      canvas.width = w * ratio;
      canvas.height = h * ratio;
      canvas.getContext('2d')?.scale(ratio, ratio);
      pad.clear();
      if (data.length) pad.fromData(data);
    };
    resize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    ro?.observe(canvas);
    return () => {
      ro?.disconnect();
      pad.off();
      padRef.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    clear: clearLocal,
    strokes: () =>
      (padRef.current?.toData() ?? []).map((g) => g.points.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, t: p.time }))),
    png: () => padRef.current?.toDataURL('image/png') ?? '',
  }));

  return (
    <Card padding="none" radius="md" className="flex flex-col gap-2 rounded-[20px] px-3.5 pt-3.5 pb-3">
      <div className="flex items-center justify-between gap-3 px-1">
        <h2 className="font-sans text-[13px] font-semibold text-ink">{tp.sign.padTitle}</h2>
        <Button variant="soft" size="sm" onClick={clearLocal}>
          {tp.sign.padClear}
        </Button>
      </div>
      <div className="relative h-40 rounded-[16px] bg-[#F7F9FD]">
        {empty && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center text-[14px] text-muted">
            {tp.sign.padPlaceholder}
          </div>
        )}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-[18px] bottom-[38px] border-t-[1.5px] border-dashed border-[#C9D1E0]" />
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={tp.sign.padAria}
          data-testid="signature-pad"
          className="absolute inset-0 size-full cursor-crosshair touch-none rounded-[16px]"
        />
      </div>
      {caption && <p className="px-1 text-[12.5px] text-muted">{caption}</p>}
    </Card>
  );

  function clearLocal() {
    padRef.current?.clear();
    setEmpty(true);
    onChangeRef.current(0);
  }
});
