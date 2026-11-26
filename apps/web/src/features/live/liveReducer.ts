/**
 * Live-Kanal (SSE, E-15): Ereignisse `snapshot | run | attendance | questions | polls` auf den Query-Cache anwenden.
 * Reine Funktion – getestet in __tests__/liveReducer.test.ts.
 */
export const LIVE_EVENTS = ['snapshot', 'run', 'attendance', 'questions', 'polls'] as const;
export type LiveEventType = (typeof LIVE_EVENTS)[number];

type AnySnapshot = { run: unknown; attendance: unknown; questions: unknown; polls: unknown };

/**
 * Wendet ein Ereignis an. `snapshot` ersetzt alles (auch nach Wiederverbindung); Teilstücke ersetzen nur ihren
 * Abschnitt. Ohne vorhandenen Stand werden Teilstücke verworfen (der nächste Snapshot kommt sicher).
 */
export function applyLiveEvent<S extends AnySnapshot>(prev: S | undefined, type: string, data: unknown): S | undefined {
  if (type === 'snapshot') {
    if (!data || typeof data !== 'object') return prev;
    const { resumedFrom: _ignored, ...rest } = data as Record<string, unknown>;
    return { ...(prev ?? {}), ...rest } as S;
  }
  if (!prev || data === undefined || data === null) return prev;
  switch (type) {
    case 'run':
      return { ...prev, run: data };
    case 'attendance':
      return { ...prev, attendance: data };
    case 'questions':
      return { ...prev, questions: data };
    case 'polls':
      return { ...prev, polls: data };
    default:
      return prev;
  }
}

/** JSON eines SSE-Ereignisses sicher lesen. */
export function parseEventData(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Ab so vielen Fehlern ohne erfolgreiche Nachricht dazwischen fällt der Kanal auf Abfragen zurück. */
export const SSE_MAX_FAILURES = 3;
export const POLL_FALLBACK_MS = 4000;

export interface ChannelState {
  mode: 'connecting' | 'sse' | 'polling';
  failures: number;
}

/** Zustandsübergang des Kanals: Nachricht → verbunden; Fehler zählen; zu viele → Abfragen. */
export function nextChannelState(s: ChannelState, ev: 'open' | 'message' | 'error'): ChannelState {
  if (s.mode === 'polling') return s;
  if (ev === 'message' || ev === 'open') return ev === 'message' ? { mode: 'sse', failures: 0 } : { ...s, mode: s.mode === 'sse' ? 'sse' : 'connecting' };
  const failures = s.failures + 1;
  return failures >= SSE_MAX_FAILURES ? { mode: 'polling', failures } : { mode: 'connecting', failures };
}
