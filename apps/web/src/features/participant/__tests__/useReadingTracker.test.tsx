import { act, renderHook } from '@testing-library/react';
import { ApiError } from '@/lib/api';
import type { HeartbeatBody, HeartbeatResponse } from '../api';
import { effectiveRatio, useReadingTracker, type UseReadingTrackerOptions } from '../useReadingTracker';

/** Steuerbarer IntersectionObserver für jsdom */
class FakeIO {
  static last: FakeIO | null = null;
  constructor(public cb: IntersectionObserverCallback) {
    FakeIO.last = this;
  }
  observe() {}
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
  emit(ratio: number) {
    const rect = { height: 500, width: 300 } as DOMRectReadOnly;
    this.cb(
      [
        {
          isIntersecting: ratio > 0,
          intersectionRatio: ratio,
          intersectionRect: { height: 500 * ratio, width: 300 } as DOMRectReadOnly,
          boundingClientRect: rect,
          rootBounds: { height: 800, width: 400 } as DOMRectReadOnly,
        } as IntersectionObserverEntry,
      ],
      this as unknown as IntersectionObserver,
    );
  }
}

const RESPONSE: HeartbeatResponse = { accepted: true, reason: 'ok', newlyFulfilled: [], complete: false, strictMode: true, pages: [] };

let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-11-26T10:00:00Z'));
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  vi.stubGlobal('IntersectionObserver', FakeIO);
  FakeIO.last = null;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup(over: Partial<UseReadingTrackerOptions> = {}) {
  const send = vi.fn<(sid: string, body: HeartbeatBody) => Promise<HeartbeatResponse>>().mockResolvedValue(RESPONSE);
  const onSuperseded = vi.fn();
  const target = document.createElement('div');
  const props: UseReadingTrackerOptions = { sessionId: 's1', page: 1, target, send, onSuperseded, now: () => Date.now(), ...over };
  const hook = renderHook((p: UseReadingTrackerOptions) => useReadingTracker(p), { initialProps: props });
  const bodies = () => send.mock.calls.map((c) => c[1]);
  return { ...hook, send, onSuperseded, bodies, props };
}

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe('useReadingTracker', () => {
  it('sendet sofort einen ersten Heartbeat und danach alle 5 s mit fortlaufender seq', async () => {
    const { send, bodies } = setup();
    await advance(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toBe('s1');
    await advance(4999);
    expect(send).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(send).toHaveBeenCalledTimes(2);
    await advance(10_000);
    expect(bodies().map((b) => b.seq)).toEqual([1, 2, 3, 4]);
    expect(bodies().every((b) => b.page === 1 && b.focused && b.visibleRatio === 1 && !b.offline)).toBe(true);
    // clientTs ist die Client-Uhr (nur Plausibilität)
    expect(bodies()[1]!.clientTs - bodies()[0]!.clientTs).toBe(5000);
  });

  it('ohne Sitzung keine Heartbeats', async () => {
    const { send, result } = setup({ sessionId: null });
    await advance(20_000);
    expect(send).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('starting');
  });

  it('pausiert bei offenem Inhaltsverzeichnis: visibleRatio 0, focused false', async () => {
    const { bodies, rerender, props, result } = setup();
    await advance(0);
    rerender({ ...props, paused: true });
    expect(result.current.phase).toBe('paused-sheet');
    await advance(5000);
    expect(bodies()[1]).toMatchObject({ seq: 2, visibleRatio: 0, focused: false });
    rerender({ ...props, paused: false });
    await advance(5000);
    expect(bodies()[2]).toMatchObject({ seq: 3, visibleRatio: 1, focused: true });
  });

  it('pausiert bei verstecktem Tab', async () => {
    const { bodies, result } = setup();
    await advance(0);
    visibility = 'hidden';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current.phase).toBe('paused-window');
    await advance(5000);
    expect(bodies()[1]).toMatchObject({ visibleRatio: 0, focused: false });
    visibility = 'visible';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await advance(5000);
    expect(bodies()[2]).toMatchObject({ visibleRatio: 1, focused: true });
    expect(result.current.phase).toBe('tracking');
  });

  it('pausiert, wenn das Fenster den Fokus verliert', async () => {
    const { bodies, result } = setup();
    await advance(0);
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(result.current.phase).toBe('paused-window');
    await advance(5000);
    expect(bodies()[1]!.focused).toBe(false);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await advance(5000);
    expect(bodies()[2]!.focused).toBe(true);
  });

  it('meldet das Alter der letzten Eingabe und zeigt nach 30 s „Noch da?“', async () => {
    const { bodies, result } = setup();
    await advance(0);
    expect(bodies()[0]!.lastInputAgeMs).toBe(0);
    await advance(10_000);
    expect(bodies()[2]!.lastInputAgeMs).toBe(10_000);
    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
    });
    await advance(5000);
    expect(bodies()[3]!.lastInputAgeMs).toBe(5000);
    // Scrollen in einem inneren Container zählt ebenfalls (Capture-Phase)
    const inner = document.createElement('div');
    document.body.appendChild(inner);
    act(() => {
      inner.dispatchEvent(new Event('scroll'));
    });
    await advance(5000);
    expect(bodies()[4]!.lastInputAgeMs).toBe(5000);
    expect(result.current.phase).toBe('tracking');
    await advance(30_000);
    expect(result.current.phase).toBe('idle');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    });
    await advance(1000);
    expect(result.current.phase).toBe('tracking');
  });

  it('meldet die Sichtbarkeit der Seitenkarte (IntersectionObserver)', async () => {
    const { bodies, result } = setup();
    await advance(0);
    act(() => FakeIO.last!.emit(0.4));
    expect(result.current.phase).toBe('not-visible');
    await advance(5000);
    expect(bodies()[1]!.visibleRatio).toBe(0.4);
    act(() => FakeIO.last!.emit(0.75));
    await advance(5000);
    expect(bodies()[2]!.visibleRatio).toBe(0.75);
    expect(result.current.phase).toBe('tracking');
  });

  it('sendet bei Seitenwechsel früh einen Heartbeat für die neue Seite (≥ 1,1 s Abstand)', async () => {
    const { bodies, rerender, props } = setup();
    await advance(0);
    await advance(500);
    rerender({ ...props, page: 2 });
    await advance(599);
    expect(bodies()).toHaveLength(1);
    await advance(1);
    expect(bodies()).toHaveLength(2);
    expect(bodies()[1]).toMatchObject({ seq: 2, page: 2 });
    // danach wieder im 5-s-Takt
    await advance(5000);
    expect(bodies()[2]).toMatchObject({ seq: 3, page: 2 });
  });

  it('puffert offline und sendet nachher mit offline: true (seq läuft weiter)', async () => {
    const { send, bodies, result } = setup();
    await advance(0);
    send.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await advance(5000); // seq 2 scheitert → Puffer
    expect(result.current.phase).toBe('offline');
    expect(result.current.queued).toBe(1);
    // Gerät meldet offline → keine Anfrage, nur Puffer
    act(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      window.dispatchEvent(new Event('offline'));
    });
    const callsBefore = send.mock.calls.length;
    await advance(5000); // seq 3
    expect(send.mock.calls.length).toBe(callsBefore);
    expect(result.current.queued).toBe(2);
    // wieder online → Puffer zuerst (offline: true), dann der aktuelle Heartbeat ohne Flag
    act(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
      window.dispatchEvent(new Event('online'));
    });
    await advance(0);
    const sent = bodies().slice(callsBefore);
    expect(sent.map((b) => [b.seq, !!b.offline])).toEqual([
      [2, true],
      [3, true],
      [4, false],
    ]);
    expect(result.current.queued).toBe(0);
    expect(result.current.phase).toBe('tracking');
  });

  it('stoppt bei 409 „abgeloest“ und meldet die Übernahme', async () => {
    const { send, onSuperseded, result } = setup();
    await advance(0);
    send.mockRejectedValueOnce(new ApiError(409, 'In einem anderen Fenster geöffnet', { code: 'abgeloest' }));
    await advance(5000);
    expect(onSuperseded).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('superseded');
    const n = send.mock.calls.length;
    await advance(30_000);
    expect(send.mock.calls.length).toBe(n);
  });

  it('neue Sitzung („Hier weiterlesen“) beginnt wieder bei seq 1', async () => {
    const { bodies, rerender, props, send } = setup();
    await advance(0);
    send.mockRejectedValueOnce(new ApiError(409, 'abgelöst', { code: 'abgeloest' }));
    await advance(5000);
    rerender({ ...props, sessionId: 's2' });
    await advance(0);
    expect(send.mock.calls.at(-1)![0]).toBe('s2');
    expect(bodies().at(-1)!.seq).toBe(1);
  });

  it('übernimmt die Serverantwort (maßgeblicher Fortschritt)', async () => {
    const onResponse = vi.fn();
    const res = { ...RESPONSE, current: { pageNo: 1, remainingMs: 3000 } };
    const { send, result } = setup({ onResponse });
    send.mockResolvedValue(res);
    await advance(0);
    expect(onResponse).toHaveBeenCalledWith(res);
    expect(result.current.lastResponse).toEqual(res);
    expect(result.current.lastResponseAt).toBe(Date.now());
  });
});

describe('effectiveRatio', () => {
  const entry = (ratio: number, h: number, visibleH: number) => ({
    intersectionRatio: ratio,
    intersectionRect: { height: visibleH, width: 300 } as DOMRectReadOnly,
    boundingClientRect: { height: h, width: 300 } as DOMRectReadOnly,
    rootBounds: { height: 800, width: 400 } as DOMRectReadOnly,
  });
  it('normale Seite: intersectionRatio', () => {
    expect(effectiveRatio(entry(0.5, 600, 300))).toBe(0.5);
  });
  it('Seite höher als der Viewport: Anteil am Viewport zählt', () => {
    // 1200 px hoch, 800 px sichtbar → füllt den Viewport vollständig
    expect(effectiveRatio(entry(800 / 1200, 1200, 800))).toBe(1);
    expect(effectiveRatio(entry(400 / 1200, 1200, 400))).toBe(0.5);
  });
});
