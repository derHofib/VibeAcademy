import { useEffect, useState } from 'react';

/** Verbleibende Sekunden bis `untilMs` (Date.now()-Basis), sekündlich aktualisiert; 0 = abgelaufen. */
export function useCountdown(untilMs: number | null): number {
  const left = () => (untilMs ? Math.max(0, Math.ceil((untilMs - Date.now()) / 1000)) : 0);
  const [seconds, setSeconds] = useState(left);
  useEffect(() => {
    setSeconds(left());
    if (!untilMs) return;
    const id = window.setInterval(() => {
      const s = left();
      setSeconds(s);
      if (s <= 0) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [untilMs]);
  return seconds;
}

/** 3:07 bzw. 1:02:05 – für Countdowns auf Knöpfen. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
