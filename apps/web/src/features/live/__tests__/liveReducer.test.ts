import { applyLiveEvent, nextChannelState, parseEventData, SSE_MAX_FAILURES, type ChannelState } from '../liveReducer';

type S = { run: { id: string; status: string }; attendance: number[]; questions: string[]; polls: { active: null | string } };
const base: S = { run: { id: 'r', status: 'laeuft' }, attendance: [1], questions: ['a'], polls: { active: null } };

describe('SSE-Reducer', () => {
  it('Snapshot ersetzt alles und verwirft resumedFrom', () => {
    const snap = { role: 'organizer', run: { id: 'r', status: 'beendet' }, attendance: [], questions: [], polls: { active: null }, resumedFrom: '7' };
    const next = applyLiveEvent<S>(undefined, 'snapshot', snap);
    expect(next).toEqual({ role: 'organizer', run: { id: 'r', status: 'beendet' }, attendance: [], questions: [], polls: { active: null } });
    expect(next).not.toHaveProperty('resumedFrom');
  });

  it('Teilstücke ersetzen nur ihren Abschnitt', () => {
    const a = applyLiveEvent(base, 'attendance', [1, 2]);
    expect(a).toEqual({ ...base, attendance: [1, 2] });
    expect(a!.questions).toBe(base.questions);
    expect(applyLiveEvent(base, 'questions', ['b'])!.questions).toEqual(['b']);
    expect(applyLiveEvent(base, 'polls', { active: 'p1' })!.polls).toEqual({ active: 'p1' });
    expect(applyLiveEvent(base, 'run', { id: 'r', status: 'beendet' })!.run.status).toBe('beendet');
  });

  it('ignoriert Teilstücke ohne Stand, unbekannte Ereignisse und kaputte Daten', () => {
    expect(applyLiveEvent<S>(undefined, 'attendance', [1])).toBeUndefined();
    expect(applyLiveEvent(base, 'ping', {})).toBe(base);
    expect(applyLiveEvent(base, 'questions', undefined)).toBe(base);
    expect(applyLiveEvent(base, 'snapshot', 'kaputt')).toBe(base);
    expect(parseEventData('{"a":1}')).toEqual({ a: 1 });
    expect(parseEventData('{kaputt')).toBeUndefined();
  });

  it('Kanal: Nachricht verbindet, wiederholte Fehler → Abfragen', () => {
    let s: ChannelState = { mode: 'connecting', failures: 0 };
    s = nextChannelState(s, 'open');
    expect(s.mode).toBe('connecting');
    s = nextChannelState(s, 'message');
    expect(s).toEqual({ mode: 'sse', failures: 0 });
    s = nextChannelState(s, 'error');
    expect(s.mode).toBe('connecting');
    // erfolgreiche Wiederverbindung setzt den Zähler zurück
    s = nextChannelState(s, 'message');
    expect(s.failures).toBe(0);
    for (let i = 0; i < SSE_MAX_FAILURES; i++) s = nextChannelState(s, 'error');
    expect(s.mode).toBe('polling');
    // bleibt beim Abfragen
    expect(nextChannelState(s, 'message').mode).toBe('polling');
  });
});
