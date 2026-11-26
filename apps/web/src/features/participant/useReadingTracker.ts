import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import type { HeartbeatBody, HeartbeatResponse } from './api';

/**
 * Lese-Erfassung im Browser (SPEZIFIKATION 4.1, E-06). Der Client meldet nur Signale – gutgeschrieben
 * wird ausschließlich Serverzeit. Gemeldet wird alle 5 s:
 *  - Sichtbarkeit der Seitenkarte (IntersectionObserver, ≥ 60 %),
 *  - Tab sichtbar (Page Visibility) und Fenster fokussiert,
 *  - Alter der letzten Bedienung (Zeiger, Tastatur, Scrollen, Touch),
 *  - Pause, solange ein Sheet (z. B. Inhaltsverzeichnis) offen ist → visibleRatio 0, focused false.
 * Offline erzeugte Heartbeats werden im Speicher gepuffert und mit `offline: true` nachgesendet
 * (der Server speichert sie, schreibt sie aber nie gut).
 */

export const MIN_VISIBLE_RATIO = 0.6;
export const IDLE_AFTER_MS = 30_000;
/** Abstand, den der Server mindestens zwischen zwei Heartbeats verlangt (+ Puffer) */
const MIN_GAP_MS = 1_100;
const MAX_QUEUE = 500;
const THRESHOLDS = Array.from({ length: 21 }, (_, i) => i / 20);

export type TrackerPhase =
  | 'starting'
  | 'tracking'
  | 'paused-sheet'
  | 'paused-window'
  | 'idle'
  | 'not-visible'
  | 'offline'
  | 'superseded';

export interface UseReadingTrackerOptions {
  /** Aktive Lesesitzung; null = noch nicht gestartet (keine Heartbeats) */
  sessionId: string | null;
  /** Aktuell angezeigte Seite */
  page: number;
  /** Beobachtetes Element (Seitenkarte); ohne Element bzw. ohne IntersectionObserver gilt 100 % */
  target: Element | null;
  /** Erfassung pausieren (z. B. Inhaltsverzeichnis offen) */
  paused?: boolean;
  intervalMs?: number;
  send: (sessionId: string, body: HeartbeatBody) => Promise<HeartbeatResponse>;
  onResponse?: (res: HeartbeatResponse) => void;
  onSuperseded?: () => void;
  /** Uhr (Tests) */
  now?: () => number;
}

export interface ReadingTracker {
  phase: TrackerPhase;
  visibleRatio: number;
  focused: boolean;
  online: boolean;
  inputAgeMs: number;
  /** Zuletzt vergebene Sequenznummer */
  seq: number;
  /** Anzahl gepufferter Offline-Heartbeats */
  queued: number;
  lastResponse: HeartbeatResponse | null;
  /** Zeitpunkt der letzten Serverantwort (Uhr des Hooks) */
  lastResponseAt: number | null;
  /** Aktuelle Zeit, wird jede Sekunde aktualisiert (für Countdown-Interpolation) */
  nowMs: number;
  /** Bedienung von außen melden (z. B. Button „Ich bin da“) */
  markInput: () => void;
}

/** Sichtbarer Anteil: klassische intersectionRatio, bei Seiten höher als der Viewport bezogen auf die Viewport-Höhe. */
export function effectiveRatio(entry: Pick<IntersectionObserverEntry, 'intersectionRatio' | 'intersectionRect' | 'boundingClientRect' | 'rootBounds'>): number {
  const base = entry.intersectionRatio;
  const rootH = entry.rootBounds?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 0);
  const h = entry.boundingClientRect.height;
  if (!rootH || !h || h <= rootH) return base;
  // Höher als der Viewport: 100 % sind erreicht, wenn die Seite den Viewport ausfüllt.
  const fill = entry.intersectionRect.height / rootH;
  const wFill = entry.boundingClientRect.width ? entry.intersectionRect.width / entry.boundingClientRect.width : 1;
  return Math.min(1, Math.max(base, Math.min(fill, wFill)));
}

function docFocused(): boolean {
  if (typeof document === 'undefined') return true;
  if (document.visibilityState === 'hidden') return false;
  return typeof document.hasFocus === 'function' ? document.hasFocus() : true;
}

const isNetworkError = (e: unknown) => !(e instanceof ApiError);

export function useReadingTracker(opts: UseReadingTrackerOptions): ReadingTracker {
  const clock = opts.now ?? Date.now;
  const clockRef = useRef(clock);
  clockRef.current = clock;
  const intervalMs = opts.intervalMs ?? 5000;

  const [visibleRatio, setVisibleRatio] = useState(1);
  const [focused, setFocused] = useState(docFocused);
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  const [networkDown, setNetworkDown] = useState(false);
  const [superseded, setSuperseded] = useState(false);
  const [lastResponse, setLastResponse] = useState<HeartbeatResponse | null>(null);
  const [lastResponseAt, setLastResponseAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => clock());
  const [seq, setSeq] = useState(0);
  const [queued, setQueued] = useState(0);

  // Veränderliche Werte für den Timer (ohne Neustart bei jedem Render)
  const r = useRef({
    seq: 0,
    lastInput: clock(),
    ratio: 1,
    focused: docFocused(),
    online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
    paused: !!opts.paused,
    page: opts.page,
    inFlight: false,
    lastSent: -Infinity,
    queue: [] as HeartbeatBody[],
    superseded: false,
    timer: null as ReturnType<typeof setTimeout> | null,
    reschedule: null as ((delay: number) => void) | null,
  });
  r.current.paused = !!opts.paused;
  r.current.page = opts.page;

  const cb = useRef({ send: opts.send, onResponse: opts.onResponse, onSuperseded: opts.onSuperseded });
  cb.current = { send: opts.send, onResponse: opts.onResponse, onSuperseded: opts.onSuperseded };

  const markInput = useCallback(() => {
    r.current.lastInput = clockRef.current();
  }, []);

  // Bedienung: Zeiger, Tastatur, Scrollen (auch in inneren Containern), Touch
  useEffect(() => {
    const onInput = () => {
      r.current.lastInput = clockRef.current();
    };
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
    for (const e of events) window.addEventListener(e, onInput, { passive: true, capture: true });
    return () => {
      for (const e of events) window.removeEventListener(e, onInput, { capture: true });
    };
  }, []);

  // Tab sichtbar + Fenster fokussiert
  useEffect(() => {
    const update = () => {
      const f = docFocused();
      r.current.focused = f;
      setFocused(f);
      // Rückkehr ins Fenster zählt als Bedienung
      if (f) r.current.lastInput = clockRef.current();
    };
    const blur = () => {
      r.current.focused = false;
      setFocused(false);
    };
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // Netz
  useEffect(() => {
    const on = () => {
      r.current.online = true;
      setOnline(true);
    };
    const off = () => {
      r.current.online = false;
      setOnline(false);
    };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // Sichtbarkeit der Seitenkarte
  useEffect(() => {
    const el = opts.target;
    if (!el || typeof IntersectionObserver === 'undefined') {
      r.current.ratio = 1;
      setVisibleRatio(1);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1];
        if (!last) return;
        const v = last.isIntersecting ? effectiveRatio(last) : 0;
        r.current.ratio = v;
        setVisibleRatio(v);
      },
      { threshold: THRESHOLDS },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [opts.target]);

  // Sekundentakt für Countdown und „Noch da?“
  useEffect(() => {
    if (!opts.sessionId) return;
    const t = setInterval(() => setNowMs(clockRef.current()), 1000);
    return () => clearInterval(t);
  }, [opts.sessionId]);

  const sessionId = opts.sessionId;

  // Heartbeat-Taktgeber
  useEffect(() => {
    const st = r.current;
    if (!sessionId) return;
    const sid: string = sessionId;
    st.superseded = false;
    setSuperseded(false);
    st.seq = 0;
    st.queue = [];
    st.lastSent = -Infinity;
    setSeq(0);
    setQueued(0);
    let cancelled = false;

    const schedule = (delay: number) => {
      if (st.timer) clearTimeout(st.timer);
      if (cancelled || st.superseded) return;
      st.timer = setTimeout(tick, delay);
    };

    const handleError = (e: unknown, body: HeartbeatBody): 'superseded' | 'network' | 'other' => {
      if (e instanceof ApiError && e.status === 409 && e.code === 'abgeloest') {
        st.superseded = true;
        setSuperseded(true);
        cb.current.onSuperseded?.();
        return 'superseded';
      }
      if (isNetworkError(e)) {
        if (st.queue.length < MAX_QUEUE) st.queue.push({ ...body, offline: true });
        setQueued(st.queue.length);
        setNetworkDown(true);
        return 'network';
      }
      return 'other';
    };

    /** Gepufferte Offline-Heartbeats in Reihenfolge nachsenden. false = weiterhin offline. */
    const flush = async (): Promise<boolean> => {
      while (st.queue.length && !cancelled) {
        const item = st.queue[0]!;
        try {
          await cb.current.send(sid, item);
        } catch (e) {
          if (e instanceof ApiError && e.status === 409 && e.code === 'abgeloest') {
            handleError(e, item);
            return false;
          }
          if (isNetworkError(e)) return false;
          // fachlich abgelehnt (z. B. Validierung): verwerfen
        }
        st.queue.shift();
        setQueued(st.queue.length);
      }
      return true;
    };

    async function tick() {
      if (cancelled || st.superseded) return;
      if (st.inFlight) {
        schedule(intervalMs);
        return;
      }
      const now = clockRef.current();
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      const pausedNow = st.paused || hidden;
      st.seq += 1;
      setSeq(st.seq);
      const body: HeartbeatBody = {
        seq: st.seq,
        page: st.page,
        visibleRatio: pausedNow ? 0 : Math.round(st.ratio * 1000) / 1000,
        focused: st.focused && !pausedNow,
        lastInputAgeMs: Math.max(0, Math.round(now - st.lastInput)),
        clientTs: Math.round(now),
      };
      st.lastSent = now;
      if (!st.online) {
        if (st.queue.length < MAX_QUEUE) st.queue.push({ ...body, offline: true });
        setQueued(st.queue.length);
        schedule(intervalMs);
        return;
      }
      st.inFlight = true;
      try {
        const ok = await flush();
        if (!ok) {
          if (!st.superseded) {
            if (st.queue.length < MAX_QUEUE) st.queue.push({ ...body, offline: true });
            setQueued(st.queue.length);
          }
        } else {
          const res = await cb.current.send(sid, body);
          if (cancelled) return;
          setNetworkDown(false);
          setLastResponse(res);
          setLastResponseAt(clockRef.current());
          cb.current.onResponse?.(res);
        }
      } catch (e) {
        if (!cancelled) handleError(e, body);
      } finally {
        st.inFlight = false;
        schedule(intervalMs);
      }
    }

    // Erster Heartbeat sofort (Basis), danach im Takt
    schedule(0);
    const onOnline = () => schedule(0);
    window.addEventListener('online', onOnline);
    st.reschedule = schedule;
    return () => {
      cancelled = true;
      if (st.timer) clearTimeout(st.timer);
      st.timer = null;
      st.reschedule = null;
      window.removeEventListener('online', onOnline);
    };
  }, [sessionId, intervalMs]);

  // Seitenwechsel: neuen Heartbeat bald senden, damit die Erfassung der neuen Seite ohne Leerlauf beginnt
  const firstPage = useRef(true);
  useEffect(() => {
    if (firstPage.current) {
      firstPage.current = false;
      return;
    }
    const st = r.current;
    if (!sessionId || st.superseded || !st.reschedule) return;
    const since = clockRef.current() - st.lastSent;
    st.reschedule(Math.max(0, MIN_GAP_MS - since));
  }, [opts.page, sessionId]);

  const inputAgeMs = Math.max(0, nowMs - r.current.lastInput);

  let phase: TrackerPhase;
  if (superseded) phase = 'superseded';
  else if (!sessionId) phase = 'starting';
  else if (!online || networkDown) phase = 'offline';
  else if (opts.paused) phase = 'paused-sheet';
  else if (!focused) phase = 'paused-window';
  else if (inputAgeMs >= IDLE_AFTER_MS) phase = 'idle';
  else if (visibleRatio < MIN_VISIBLE_RATIO) phase = 'not-visible';
  else phase = 'tracking';

  return {
    phase,
    visibleRatio,
    focused,
    online: online && !networkDown,
    inputAgeMs,
    seq,
    queued,
    lastResponse,
    lastResponseAt,
    nowMs,
    markInput,
  };
}
