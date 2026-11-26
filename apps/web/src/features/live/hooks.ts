import { useEffect, useState } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { applyLiveEvent, LIVE_EVENTS, nextChannelState, parseEventData, type ChannelState } from './liveReducer';
import { serverOffsetMs } from './time';
import type { LiveSnapshot } from './api';

/**
 * Verbindet den Live-Kanal `GET /api/runs/:id/live` (SSE, Cookie-Sitzung) mit dem Query-Cache unter `queryKey`.
 * Nach wiederholten Fehlern ohne Nachricht (oder wenn der Browser die Verbindung endgültig schließt) liefert der
 * Hook `polling` – die Seite fragt dann selbst in kurzen Abständen ab.
 */
export function useLiveChannel(opts: { runId: string | undefined; queryKey: QueryKey; asParticipant?: boolean; enabled?: boolean }) {
  const { runId, queryKey, asParticipant = false, enabled = true } = opts;
  const qc = useQueryClient();
  const [state, setState] = useState<ChannelState>({ mode: 'connecting', failures: 0 });
  const keyHash = JSON.stringify(queryKey);

  useEffect(() => {
    if (!enabled || !runId) return;
    if (typeof EventSource === 'undefined') {
      setState({ mode: 'polling', failures: 0 });
      return;
    }
    let st: ChannelState = { mode: 'connecting', failures: 0 };
    setState(st);
    const key = JSON.parse(keyHash) as QueryKey;
    const es = new EventSource(`/api/runs/${runId}/live${asParticipant ? '?as=teilnehmer' : ''}`, { withCredentials: true });
    const update = (ev: 'open' | 'message' | 'error') => {
      st = nextChannelState(st, ev);
      // Endgültig geschlossen (z. B. 401/404): nicht weiter warten
      if (ev === 'error' && es.readyState === EventSource.CLOSED) st = { mode: 'polling', failures: st.failures };
      setState(st);
      if (st.mode === 'polling') es.close();
    };
    const listeners = LIVE_EVENTS.map((type) => {
      const fn = (e: Event) => {
        const data = parseEventData((e as MessageEvent<string>).data);
        qc.setQueryData<LiveSnapshot<unknown, unknown, unknown>>(key, (prev) => applyLiveEvent(prev, type, data));
        update('message');
      };
      es.addEventListener(type, fn);
      return [type, fn] as const;
    });
    es.onopen = () => update('open');
    es.onerror = () => update('error');
    return () => {
      for (const [type, fn] of listeners) es.removeEventListener(type, fn);
      es.close();
    };
  }, [runId, enabled, asParticipant, keyHash, qc]);

  return enabled && runId ? state.mode : 'connecting';
}

/** Serverzeit in ms, tickt jede Sekunde. Der Versatz wird bei jeder neuen `serverTime` neu bestimmt. */
export function useServerNow(serverTimeIso: string | null | undefined, tickMs = 1000): number {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    setOffset(serverOffsetMs(serverTimeIso, Date.now()));
  }, [serverTimeIso]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now() + offset);
    const id = setInterval(() => setNow(Date.now() + offset), tickMs);
    return () => clearInterval(id);
  }, [offset, tickMs]);
  return now;
}
