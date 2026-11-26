import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  allowedPages,
  applyHeartbeat,
  emptyProgress,
  type Heartbeat,
  INITIAL_SESSION_STATE,
  isComplete,
  isPageAllowed,
  isSignalValid,
  MAX_CREDIT_PER_HEARTBEAT_MS,
  type PageRule,
  plausibilityFlag,
  type ProgressSnapshot,
  remainingMs,
  type SessionTrackState,
  totalDwellMs,
  totalRequiredMs,
  requiredPageNos,
  withRequiredPages,
} from './reading';

const PAGES: PageRule[] = [
  { pageNo: 1, tMinMs: 10_000 },
  { pageNo: 2, tMinMs: 10_000 },
  { pageNo: 3, tMinMs: 10_000 },
];

/** Gültiger Heartbeat mit überschreibbaren Feldern */
function hb(seq: number, page: number, over: Partial<Heartbeat> = {}): Heartbeat {
  return { seq, page, visibleRatio: 1, focused: true, lastInputAgeMs: 1000, ...over };
}

/** Kleiner Simulator: Sitzungszustand + gemeinsamer Fortschritt */
class Session {
  state: SessionTrackState = { ...INITIAL_SESSION_STATE };
  constructor(
    public shared: { progress: ProgressSnapshot },
    public pages: PageRule[] = PAGES,
    public strictMode = false,
  ) {}
  send(h: Heartbeat, serverTs: number) {
    const d = applyHeartbeat({
      state: this.state,
      hb: h,
      serverTs,
      pages: this.pages,
      progress: this.shared.progress,
      strictMode: this.strictMode,
    });
    this.state = d.state;
    this.shared.progress = d.progress;
    return d;
  }
  /** n gültige Heartbeats im 5-s-Takt auf einer Seite */
  run(page: number, fromSeq: number, fromTs: number, n: number, over: Partial<Heartbeat> = {}) {
    const ds = [];
    for (let i = 0; i < n; i++) ds.push(this.send(hb(fromSeq + i, page, over), fromTs + i * 5000));
    return ds;
  }
}

describe('isSignalValid', () => {
  it('akzeptiert sichtbar ≥ 60 %, fokussiert, Eingabe < 30 s', () => {
    expect(isSignalValid(hb(1, 1))).toBe(true);
  });
  it('Grenze Sichtbarkeit: 0,59 ungültig, 0,6 gültig', () => {
    expect(isSignalValid(hb(1, 1, { visibleRatio: 0.59 }))).toBe(false);
    expect(isSignalValid(hb(1, 1, { visibleRatio: 0.6 }))).toBe(true);
  });
  it('Grenze letzte Eingabe: 29999 gültig, 30000 ungültig', () => {
    expect(isSignalValid(hb(1, 1, { lastInputAgeMs: 29_999 }))).toBe(true);
    expect(isSignalValid(hb(1, 1, { lastInputAgeMs: 30_000 }))).toBe(false);
  });
  it('ohne Fokus ungültig', () => {
    expect(isSignalValid(hb(1, 1, { focused: false }))).toBe(false);
  });
  it('unsinnige Zahlen sind ungültig', () => {
    expect(isSignalValid(hb(1, 1, { visibleRatio: 1.5 }))).toBe(false);
    expect(isSignalValid(hb(1, 1, { visibleRatio: Number.NaN }))).toBe(false);
    expect(isSignalValid(hb(1, 1, { lastInputAgeMs: -1 }))).toBe(false);
    expect(isSignalValid(hb(1, 1, { lastInputAgeMs: Number.POSITIVE_INFINITY }))).toBe(false);
  });
});

describe('applyHeartbeat – Erfüllung', () => {
  it('erfüllt eine Seite erst, wenn kumuliert t_min erreicht ist', () => {
    const s = new Session({ progress: emptyProgress() });
    const ds = s.run(1, 1, 0, 3); // erster Heartbeat = Basis, dann 2 × 5 s
    expect(ds[0]!.reason).toBe('first');
    expect(ds[0]!.credit).toBeNull();
    expect(ds[1]!.newlyFulfilled).toEqual([]);
    expect(remainingMs(1, PAGES, s.shared.progress)).toBe(0);
    expect(ds[2]!.newlyFulfilled).toEqual([1]);
    expect(s.shared.progress.fulfilled).toEqual([1]);
    expect(s.shared.progress.dwellMs[1]).toBe(10_000);
  });

  it('meldet eine Seite nur einmal als neu erfüllt und zählt weiter', () => {
    const s = new Session({ progress: emptyProgress() });
    const ds = s.run(1, 1, 0, 5);
    expect(ds.flatMap((d) => d.newlyFulfilled)).toEqual([1]);
    expect(s.shared.progress.dwellMs[1]).toBe(20_000);
  });

  it('kumuliert über zwei getrennte Sitzungen', () => {
    const shared = { progress: emptyProgress() };
    const a = new Session(shared);
    a.run(1, 1, 0, 2); // 5 s
    expect(shared.progress.fulfilled).toEqual([]);
    expect(remainingMs(1, PAGES, shared.progress)).toBe(5000);
    const b = new Session(shared); // neue Sitzung, neuer Zustand, seq beginnt neu
    const ds = b.run(1, 1, 100_000, 2);
    expect(ds[0]!.reason).toBe('first');
    expect(ds[1]!.newlyFulfilled).toEqual([1]);
    expect(shared.progress.dwellMs[1]).toBe(10_000);
  });

  it('Sichtbarkeit 0,59 gibt keine Gutschrift, 0,6 schon', () => {
    const s1 = new Session({ progress: emptyProgress() });
    const d1 = s1.run(1, 1, 0, 4, { visibleRatio: 0.59 });
    expect(d1.slice(1).every((d) => d.reason === 'invalid_signal' && d.credit === null)).toBe(true);
    expect(s1.shared.progress.dwellMs[1]).toBeUndefined();

    const s2 = new Session({ progress: emptyProgress() });
    s2.run(1, 1, 0, 3, { visibleRatio: 0.6 });
    expect(s2.shared.progress.fulfilled).toEqual([1]);
  });

  it('lastInputAgeMs 29999 zählt, 30000 nicht', () => {
    const s1 = new Session({ progress: emptyProgress() });
    s1.run(1, 1, 0, 3, { lastInputAgeMs: 29_999 });
    expect(s1.shared.progress.dwellMs[1]).toBe(10_000);

    const s2 = new Session({ progress: emptyProgress() });
    s2.run(1, 1, 0, 3, { lastInputAgeMs: 30_000 });
    expect(s2.shared.progress.dwellMs[1]).toBeUndefined();
  });

  it('ohne Fokus keine Gutschrift', () => {
    const s = new Session({ progress: emptyProgress() });
    s.run(1, 1, 0, 3, { focused: false });
    expect(s.shared.progress.fulfilled).toEqual([]);
  });

  it('ungültiger vorheriger Heartbeat verhindert die Gutschrift für das Intervall', () => {
    const s = new Session({ progress: emptyProgress() });
    s.send(hb(1, 1, { focused: false }), 0);
    const d = s.send(hb(2, 1), 5000);
    expect(d.reason).toBe('invalid_signal');
    expect(d.accepted).toBe(true);
    expect(s.send(hb(3, 1), 10_000).credit).toEqual({ page: 1, ms: 5000 });
  });
});

describe('applyHeartbeat – manipulierte Heartbeats', () => {
  it('seq-Lücke: keine Gutschrift, neue Basis', () => {
    const s = new Session({ progress: emptyProgress() });
    s.send(hb(1, 1), 0);
    const d = s.send(hb(3, 1), 5000);
    expect(d).toMatchObject({ accepted: true, reason: 'seq_gap', credit: null });
    expect(d.state.lastSeq).toBe(3);
    expect(s.send(hb(4, 1), 10_000).credit?.ms).toBe(5000);
  });

  it('doppelte seq wird verworfen, Zustand bleibt', () => {
    const s = new Session({ progress: emptyProgress() });
    s.send(hb(1, 1), 0);
    s.send(hb(2, 1), 5000);
    const before = s.state;
    const d = s.send(hb(2, 1), 10_000);
    expect(d).toMatchObject({ accepted: false, reason: 'stale_or_duplicate', credit: null });
    expect(d.state).toEqual(before);
    expect(s.shared.progress.dwellMs[1]).toBe(5000);
  });

  it('Rücksprung der seq wird verworfen', () => {
    const s = new Session({ progress: emptyProgress() });
    s.run(1, 5, 0, 2);
    const d = s.send(hb(3, 1), 10_000);
    expect(d).toMatchObject({ accepted: false, reason: 'stale_or_duplicate' });
    expect(d.state.lastSeq).toBe(6);
  });

  it('Serverzeit-Sprung > 5 s wird auf 5 s gedeckelt', () => {
    const s = new Session({ progress: emptyProgress() });
    s.send(hb(1, 1), 0);
    const d = s.send(hb(2, 1), 60_000);
    expect(d.credit).toEqual({ page: 1, ms: MAX_CREDIT_PER_HEARTBEAT_MS });
  });

  it('clientTs in ferner Zukunft wird ignoriert', () => {
    const s = new Session({ progress: emptyProgress() });
    s.send(hb(1, 1, { clientTs: 0 }), 0);
    const d = s.send(hb(2, 1, { clientTs: 9_999_999_999_999 }), 3000);
    expect(d.credit).toEqual({ page: 1, ms: 3000 });
  });

  it('Flut von Heartbeats < 1 s wird verworfen', () => {
    const s = new Session({ progress: emptyProgress() });
    s.send(hb(1, 1), 0);
    for (let i = 1; i <= 20; i++) {
      const d = s.send(hb(1 + i, 1), i * 40); // 20 Heartbeats innerhalb von 800 ms
      expect(d).toMatchObject({ accepted: false, reason: 'too_fast', credit: null });
    }
    expect(s.state.lastSeq).toBe(1);
    expect(s.shared.progress.dwellMs[1]).toBeUndefined();
    // Danach gilt nur die tatsächlich vergangene Serverzeit
    expect(s.send(hb(2, 1), 1000).credit?.ms).toBe(1000);
  });

  it('Serverzeit rückwärts wird verworfen', () => {
    const s = new Session({ progress: emptyProgress() });
    s.send(hb(1, 1), 10_000);
    expect(s.send(hb(2, 1), 4000).reason).toBe('too_fast');
  });

  it('Seitenwechsel zwischen Heartbeats: keine Gutschrift', () => {
    const s = new Session({ progress: emptyProgress() });
    s.send(hb(1, 1), 0);
    const d = s.send(hb(2, 2), 5000);
    expect(d).toMatchObject({ accepted: true, reason: 'page_changed', credit: null });
    expect(s.send(hb(3, 2), 10_000).credit).toEqual({ page: 2, ms: 5000 });
    expect(s.shared.progress.dwellMs[1]).toBeUndefined();
  });

  it('unbekannte Seite wird verworfen', () => {
    const s = new Session({ progress: emptyProgress() });
    const d = s.send(hb(1, 99), 0);
    expect(d).toMatchObject({ accepted: false, reason: 'unknown_page' });
    expect(d.state).toEqual(INITIAL_SESSION_STATE);
  });

  it('ungültige seq oder Serverzeit wird als malformed verworfen', () => {
    const s = new Session({ progress: emptyProgress() });
    expect(s.send(hb(1.5, 1), 0).reason).toBe('malformed');
    expect(s.send(hb(-1, 1), 0).reason).toBe('malformed');
    expect(s.send(hb(1, 1), Number.NaN).reason).toBe('malformed');
  });
});

describe('Strenger Modus', () => {
  const fulfilledOne = { dwellMs: { 1: 10_000 }, fulfilled: [1] };

  it('Seite n+2 ist gesperrt, n+1 frei', () => {
    expect(allowedPages(PAGES, [], true)).toEqual([1]);
    expect(allowedPages(PAGES, [1], true)).toEqual([1, 2]);
    expect(isPageAllowed(3, PAGES, [1], true)).toBe(false);
  });

  it('gelesene Seiten bleiben frei aufrufbar', () => {
    expect(isPageAllowed(1, PAGES, [1, 2], true)).toBe(true);
    expect(allowedPages(PAGES, [1, 2, 3], true)).toEqual([1, 2, 3]);
  });

  it('nicht strenger Modus erlaubt alle Seiten', () => {
    expect(allowedPages(PAGES, [], false)).toEqual([1, 2, 3]);
  });

  it('keine Gutschrift auf gesperrter Seite', () => {
    const s = new Session({ progress: { dwellMs: { ...fulfilledOne.dwellMs }, fulfilled: [1] } }, PAGES, true);
    const ds = s.run(3, 1, 0, 3);
    expect(ds.slice(1).every((d) => d.reason === 'page_locked' && d.credit === null)).toBe(true);
    expect(s.shared.progress.dwellMs[3]).toBeUndefined();
  });

  it('Gutschrift auf erfüllter und auf nächster Seite', () => {
    const s = new Session({ progress: { dwellMs: { ...fulfilledOne.dwellMs }, fulfilled: [1] } }, PAGES, true);
    expect(s.run(1, 1, 0, 2)[1]!.reason).toBe('ok');
    const ds = s.run(2, 3, 20_000, 3);
    expect(ds[2]!.newlyFulfilled).toEqual([2]);
    // Jetzt ist Seite 3 freigeschaltet
    expect(s.run(3, 6, 40_000, 2)[1]!.reason).toBe('ok');
  });
});

describe('Unveränderlichkeit der Eingaben', () => {
  it('verändert state und progress nicht', () => {
    const state: SessionTrackState = { lastSeq: 1, lastServerTs: 0, lastPage: 1, lastValid: true };
    const progress: ProgressSnapshot = { dwellMs: { 1: 5000 }, fulfilled: [] };
    const pages = PAGES.map((p) => ({ ...p }));
    const h = hb(2, 1);
    const snap = JSON.stringify({ state, progress, pages, h });
    const d = applyHeartbeat({ state, hb: h, serverTs: 5000, pages, progress, strictMode: true });
    expect(d.newlyFulfilled).toEqual([1]);
    expect(JSON.stringify({ state, progress, pages, h })).toBe(snap);
    expect(d.progress).not.toBe(progress);
    expect(d.progress.fulfilled).not.toBe(progress.fulfilled);
  });

  it('auch abgelehnte Entscheidungen liefern Kopien', () => {
    const state: SessionTrackState = { lastSeq: 5, lastServerTs: 0, lastPage: 1, lastValid: true };
    const progress = emptyProgress();
    const d = applyHeartbeat({ state, hb: hb(5, 1), serverTs: 5000, pages: PAGES, progress, strictMode: false });
    expect(d.state).not.toBe(state);
    expect(d.progress).not.toBe(progress);
  });

  it('Zustand ist JSON-serialisierbar', () => {
    const s = new Session({ progress: emptyProgress() });
    const d = s.run(1, 1, 0, 3)[2]!;
    expect(JSON.parse(JSON.stringify(d.state))).toEqual(d.state);
    const p = JSON.parse(JSON.stringify(d.progress)) as ProgressSnapshot;
    expect(remainingMs(1, PAGES, p)).toBe(0);
    expect(p.dwellMs[1]).toBe(10_000);
  });
});

describe('Auswertung', () => {
  it('remainingMs für den Countdown', () => {
    expect(remainingMs(2, PAGES, { dwellMs: { 2: 3000 }, fulfilled: [] })).toBe(7000);
    expect(() => remainingMs(9, PAGES, emptyProgress())).toThrow(RangeError);
  });

  it('isComplete erst wenn alle Seiten erfüllt sind', () => {
    expect(isComplete(PAGES, { dwellMs: {}, fulfilled: [1, 2] })).toBe(false);
    expect(isComplete(PAGES, { dwellMs: {}, fulfilled: [3, 1, 2] })).toBe(true);
    expect(isComplete([], emptyProgress())).toBe(false);
  });

  it('Summen', () => {
    expect(totalRequiredMs(PAGES)).toBe(30_000);
    expect(totalDwellMs(PAGES, { dwellMs: { 1: 4000, 2: 6000, 99: 1_000_000 }, fulfilled: [] })).toBe(10_000);
  });

  it('Plausibilitätsflag nur bei vollständig und < 50 % von Σ t_min', () => {
    const all = [1, 2, 3];
    expect(plausibilityFlag(PAGES, { dwellMs: { 1: 14_999 }, fulfilled: all })).toBe(true);
    expect(plausibilityFlag(PAGES, { dwellMs: { 1: 15_000 }, fulfilled: all })).toBe(false);
    expect(plausibilityFlag(PAGES, { dwellMs: {}, fulfilled: [1, 2] })).toBe(false);
  });

  it('über die Engine erfüllt ergibt nie ein Plausibilitätsflag', () => {
    const s = new Session({ progress: emptyProgress() });
    s.run(1, 1, 0, 3);
    s.run(2, 4, 20_000, 3);
    s.run(3, 7, 40_000, 3);
    expect(isComplete(PAGES, s.shared.progress)).toBe(true);
    expect(plausibilityFlag(PAGES, s.shared.progress)).toBe(false);
  });
});

describe('Eigenschaften (fast-check)', () => {
  const PROP_PAGES: PageRule[] = [
    { pageNo: 1, tMinMs: 8000 },
    { pageNo: 2, tMinMs: 15_000 },
    { pageNo: 3, tMinMs: 4000 },
  ];

  // Ein Schritt: Serverzeit-Abstand (auch negativ/klein/groß), seq-Sprung, Seite, Signal
  const stepArb = fc.record({
    dt: fc.oneof(fc.integer({ min: -2000, max: 20_000 }), fc.constantFrom(0, 999, 1000, 5000, 5001)),
    dseq: fc.oneof(fc.constant(1), fc.integer({ min: -3, max: 4 })),
    page: fc.integer({ min: 0, max: 4 }), // 0 und 4 sind unbekannt
    visibleRatio: fc.oneof(fc.double({ min: 0, max: 1, noNaN: true }), fc.constantFrom(0.59, 0.6, 1)),
    focused: fc.boolean(),
    lastInputAgeMs: fc.oneof(fc.integer({ min: 0, max: 40_000 }), fc.constantFrom(29_999, 30_000)),
    clientTs: fc.integer({ min: -1e12, max: 1e13 }),
  });

  const seqArb = fc.record({
    steps: fc.array(stepArb, { minLength: 1, maxLength: 80 }),
    strictMode: fc.boolean(),
  });

  it('Gutschrift ≤ vergangene Serverzeit, je Seite ≤ Zeit auf dieser Seite, je Heartbeat ≤ 5 s', () => {
    fc.assert(
      fc.property(seqArb, ({ steps, strictMode }) => {
        let state: SessionTrackState = { ...INITIAL_SESSION_STATE };
        let progress = emptyProgress();
        let ts = 1_000_000;
        let seq = 0;
        let firstAcceptedTs: number | null = null;
        let lastAcceptedTs: number | null = null;
        let last: { ts: number; page: number } | null = null;
        const elapsedOnPage: Record<number, number> = {};
        const credited: Record<number, number> = {};
        let totalCredit = 0;

        for (const st of steps) {
          ts += st.dt;
          seq += st.dseq;
          const h: Heartbeat = {
            seq,
            page: st.page,
            visibleRatio: st.visibleRatio,
            focused: st.focused,
            lastInputAgeMs: st.lastInputAgeMs,
            clientTs: st.clientTs,
          };
          const d = applyHeartbeat({ state, hb: h, serverTs: ts, pages: PROP_PAGES, progress, strictMode });

          if (d.credit) {
            expect(d.accepted).toBe(true);
            expect(d.credit.ms).toBeGreaterThanOrEqual(0);
            expect(d.credit.ms).toBeLessThanOrEqual(MAX_CREDIT_PER_HEARTBEAT_MS);
            credited[d.credit.page] = (credited[d.credit.page] ?? 0) + d.credit.ms;
            totalCredit += d.credit.ms;
          }
          if (d.accepted) {
            firstAcceptedTs ??= ts;
            lastAcceptedTs = ts;
            // Zeit zwischen zwei angenommenen Heartbeats auf derselben Seite
            if (last && last.page === st.page) elapsedOnPage[st.page] = (elapsedOnPage[st.page] ?? 0) + (ts - last.ts);
            last = { ts, page: st.page };
          } else {
            expect(d.state).toEqual(state);
            expect(d.progress).toEqual(progress);
          }
          // Fortschritt wächst monoton, erfüllt ⇔ Ist ≥ t_min
          for (const p of PROP_PAGES) {
            expect(d.progress.dwellMs[p.pageNo] ?? 0).toBeGreaterThanOrEqual(progress.dwellMs[p.pageNo] ?? 0);
            expect(d.progress.fulfilled.includes(p.pageNo)).toBe((d.progress.dwellMs[p.pageNo] ?? 0) >= p.tMinMs);
          }
          state = d.state;
          progress = d.progress;
        }

        const elapsed = firstAcceptedTs === null || lastAcceptedTs === null ? 0 : lastAcceptedTs - firstAcceptedTs;
        expect(totalCredit).toBeLessThanOrEqual(elapsed);
        expect(totalDwellMs(PROP_PAGES, progress)).toBe(totalCredit);
        for (const p of PROP_PAGES) {
          expect(credited[p.pageNo] ?? 0).toBeLessThanOrEqual(elapsedOnPage[p.pageNo] ?? 0);
        }
        expect(plausibilityFlag(PROP_PAGES, progress)).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it('strenger Modus: Erfüllung nur in Seitenreihenfolge', () => {
    // Überwiegend gültige, lückenlose Heartbeats, damit Seiten tatsächlich erfüllt werden
    const friendlyArb = fc.record({
      dt: fc.oneof(fc.constant(5000), fc.integer({ min: -1000, max: 8000 })),
      dseq: fc.oneof(fc.constant(1), fc.constant(1), fc.integer({ min: 0, max: 3 })),
      page: fc.integer({ min: 1, max: 3 }),
      visibleRatio: fc.oneof(fc.constant(1), fc.double({ min: 0, max: 1, noNaN: true })),
      focused: fc.oneof(fc.constant(true), fc.boolean()),
      lastInputAgeMs: fc.oneof(fc.constant(1000), fc.integer({ min: 0, max: 40_000 })),
    });
    fc.assert(
      fc.property(fc.array(friendlyArb, { minLength: 1, maxLength: 120 }), (steps) => {
        let state: SessionTrackState = { ...INITIAL_SESSION_STATE };
        let progress = emptyProgress();
        let ts = 0;
        let seq = 0;
        for (const st of steps) {
          ts += st.dt;
          seq += st.dseq;
          const d = applyHeartbeat({
            state,
            hb: { seq, page: st.page, visibleRatio: st.visibleRatio, focused: st.focused, lastInputAgeMs: st.lastInputAgeMs },
            serverTs: ts,
            pages: PROP_PAGES,
            progress,
            strictMode: true,
          });
          state = d.state;
          progress = d.progress;
        }
        // Erfüllte Seiten bilden immer ein Präfix 1, 2, …
        const sorted = [...progress.fulfilled].sort((a, b) => a - b);
        expect(progress.fulfilled).toEqual(sorted);
        expect(sorted).toEqual(sorted.map((_, i) => i + 1));
      }),
      { numRuns: 300 },
    );
  });
});

describe('Pflichtseiten – Neueinladung nur geänderte Seiten (E-38)', () => {
  const FIVE: PageRule[] = [1, 2, 3, 4, 5].map((pageNo) => ({ pageNo, tMinMs: 10_000 }));
  const only = (nos: number[] | null) => withRequiredPages(FIVE, nos);

  it('ohne Angabe bzw. leer → alle Seiten Pflicht', () => {
    expect(requiredPageNos(only(null))).toEqual([1, 2, 3, 4, 5]);
    expect(requiredPageNos(only([]))).toEqual([1, 2, 3, 4, 5]);
    expect(requiredPageNos(only([99]))).toEqual([1, 2, 3, 4, 5]);
  });

  it('Abschluss nur über die Pflichtseiten', () => {
    const p = only([2, 4]);
    expect(isComplete(p, { dwellMs: {}, fulfilled: [2] })).toBe(false);
    expect(isComplete(p, { dwellMs: {}, fulfilled: [4, 2] })).toBe(true);
    expect(isComplete(only([]), { dwellMs: {}, fulfilled: [4, 2] })).toBe(false);
    expect(totalRequiredMs(p)).toBe(20_000);
  });

  it('strenger Modus nur unter den Pflichtseiten; andere Seiten frei aufrufbar', () => {
    const p = only([2, 4]);
    expect(allowedPages(p, [], true)).toEqual([1, 2, 3, 5]);
    expect(isPageAllowed(4, p, [], true)).toBe(false);
    expect(allowedPages(p, [2], true)).toEqual([1, 2, 3, 4, 5]);
  });

  it('Gutschrift auf freiwilligen Seiten zählt nicht für den Abschluss', () => {
    const p = only([2]);
    const s = new Session({ progress: emptyProgress() }, p, true);
    s.run(1, 1, 0, 3);
    expect(s.shared.progress.fulfilled).toEqual([1]);
    expect(isComplete(p, s.shared.progress)).toBe(false);
    s.run(2, 4, 20_000, 3);
    expect(isComplete(p, s.shared.progress)).toBe(true);
    expect(plausibilityFlag(p, s.shared.progress)).toBe(false);
  });
});
