import { useCallback, useState } from 'react';
import { clampZoom } from './viewerModel';

const KEY = 'sn.teilnahme.zoom';

/** Render-Zoom der Seiten (90–130 %), je Browser gemerkt (reine Bequemlichkeit, kein Nachweisdatum). */
export function useViewerZoom(): [number, (z: number) => void] {
  const [zoom, setZoomState] = useState(() => {
    try {
      const v = Number(localStorage.getItem(KEY));
      return Number.isFinite(v) && v > 0 ? clampZoom(v) : 1;
    } catch {
      return 1;
    }
  });
  const setZoom = useCallback((z: number) => {
    const v = clampZoom(z);
    setZoomState(v);
    try {
      localStorage.setItem(KEY, String(v));
    } catch {
      // Speicher nicht verfügbar (privates Fenster) – Zoom gilt dann nur für diese Ansicht
    }
  }, []);
  return [zoom, setZoom];
}
