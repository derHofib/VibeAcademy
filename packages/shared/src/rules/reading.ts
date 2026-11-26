/**
 * Regelwerk Lesenachweis (SPEZIFIKATION 4.1, ENTSCHEIDUNGEN E-06).
 *
 * Reine Funktionen ohne I/O: Der Server übergibt Serverzeit (ms), den
 * gespeicherten Sitzungszustand und den kumulierten Fortschritt der Einladung
 * und erhält eine Entscheidung mit NEUEN Objekten zurück. Der Client ist nicht
 * vertrauenswürdig – gutgeschrieben wird ausschließlich Serverzeit.
 *
 * Nicht Teil dieses Moduls: Lease „genau eine aktive Sitzung je Einladung“
 * (409 für alte Sitzungen) und Offline-Queue – beides prüft der Aufrufer vorher.
 */

/** Sollabstand der Client-Heartbeats */
export const HEARTBEAT_INTERVAL_MS = 5000;
/** Höchstgutschrift je Intervall (Heartbeat k−1 → k) */
export const MAX_CREDIT_PER_HEARTBEAT_MS = 5000;
/** Heartbeats mit kleinerem Serverzeit-Abstand werden verworfen (Rate-Limit) */
export const MIN_HEARTBEAT_GAP_MS = 1000;
/** Mindestanteil der Seite im Viewport */
export const MIN_VISIBLE_RATIO = 0.6;
/** Letzte Eingabe muss jünger sein als dieser Wert */
export const MAX_INPUT_AGE_MS = 30000;
/** Plausibilitätsgrenze: Gesamt-Ist < 50 % von Σ t_min */
export const PLAUSIBILITY_RATIO = 0.5;

/** Heartbeat vom Client (alle 5 s). Alle Werte sind Client-Angaben. */
export interface Heartbeat {
  seq: number;
  page: number;
  visibleRatio: number;
  focused: boolean;
  lastInputAgeMs: number;
  /** Nur zur Plausibilitätsprüfung gespeichert, zählt nie für die Gutschrift */
  clientTs?: number;
}

/** Zustand je Lesesitzung (JSON-serialisierbar, wird persistiert). */
export interface SessionTrackState {
  lastSeq: number | null;
  lastServerTs: number | null;
  lastPage: number | null;
  lastValid: boolean;
}

/** Seite mit Mindestverweildauer in ms (aus reading-time.ts, ggf. × 1000). */
export interface PageRule {
  pageNo: number;
  tMinMs: number;
  /**
   * Pflichtseite für den Abschluss (Standard: true). Neueinladungen „nur geänderte Seiten“ (E-38) markieren alle
   * übrigen Seiten mit `required: false`: aufrufbar und erfassbar, aber nicht nötig für den Abschluss.
   */
  required?: boolean;
}

/** Pflichtseite? Fehlt die Angabe, ist jede Seite Pflicht (Verhalten bis Phase 2). */
export function isRequiredPage(p: PageRule): boolean {
  return p.required !== false;
}

/**
 * Markiert Pflichtseiten (E-38): `requiredPages` = null/leer → alle Seiten Pflicht; sonst nur die genannten
 * (unbekannte Nummern werden ignoriert; bleibt nichts übrig, sind wieder alle Seiten Pflicht).
 */
export function withRequiredPages(pages: readonly PageRule[], requiredPages: readonly number[] | null | undefined): PageRule[] {
  const wanted = new Set(requiredPages ?? []);
  const known = pages.filter((p) => wanted.has(p.pageNo));
  if (!known.length) return pages.map((p) => ({ ...p, required: true }));
  return pages.map((p) => ({ ...p, required: wanted.has(p.pageNo) }));
}

/** Nummern der Pflichtseiten, aufsteigend. */
export function requiredPageNos(pages: readonly PageRule[]): number[] {
  return orderedPageNos(pages.filter(isRequiredPage));
}

/** Fortschritt je Einladung, kumuliert über ALLE Sitzungen. */
export interface ProgressSnapshot {
  /** Gutgeschriebene Verweildauer je Seitennummer in ms */
  dwellMs: Record<number, number>;
  /** Erfüllte Seiten in Reihenfolge der Erfüllung */
  fulfilled: number[];
}

export type DecisionReason =
  | 'ok'
  | 'first'
  | 'too_fast'
  | 'stale_or_duplicate'
  | 'seq_gap'
  | 'invalid_signal'
  | 'page_changed'
  | 'page_locked'
  | 'unknown_page'
  /** seq oder Serverzeit sind keine gültigen Zahlen */
  | 'malformed';

export interface Decision {
  /** true = Heartbeat wird als neue Basis übernommen (auch ohne Gutschrift) */
  accepted: boolean;
  reason: DecisionReason;
  credit: { page: number; ms: number } | null;
  state: SessionTrackState;
  newlyFulfilled: number[];
  progress: ProgressSnapshot;
}

export interface ApplyHeartbeatInput {
  state: SessionTrackState;
  hb: Heartbeat;
  /** Serverzeit beim Eingang in ms */
  serverTs: number;
  pages: readonly PageRule[];
  progress: ProgressSnapshot;
  strictMode: boolean;
}

export const INITIAL_SESSION_STATE: SessionTrackState = {
  lastSeq: null,
  lastServerTs: null,
  lastPage: null,
  lastValid: false,
};

export function emptyProgress(): ProgressSnapshot {
  return { dwellMs: {}, fulfilled: [] };
}

/** Sichtbar ≥ 60 %, fokussiert, letzte Eingabe < 30 s; nur endliche Zahlen. */
export function isSignalValid(hb: Heartbeat): boolean {
  const { visibleRatio, focused, lastInputAgeMs } = hb;
  if (!Number.isFinite(visibleRatio) || !Number.isFinite(lastInputAgeMs)) return false;
  if (visibleRatio < MIN_VISIBLE_RATIO || visibleRatio > 1) return false;
  if (lastInputAgeMs < 0 || lastInputAgeMs >= MAX_INPUT_AGE_MS) return false;
  return focused === true;
}

/** Seitennummern aufsteigend, ohne Duplikate. */
function orderedPageNos(pages: readonly PageRule[]): number[] {
  return [...new Set(pages.map((p) => p.pageNo))].sort((a, b) => a - b);
}

/**
 * Aufrufbare Seiten. Strenger Modus: erfüllte Seiten plus die erste noch nicht
 * erfüllte Seite in Reihenfolge. Sonst alle Seiten.
 * Mit Pflichtseiten (E-38) gilt der strenge Modus nur unter den Pflichtseiten;
 * Seiten, die nicht Pflicht sind, bleiben immer aufrufbar.
 */
export function allowedPages(pages: readonly PageRule[], fulfilled: readonly number[], strictMode: boolean): number[] {
  const order = orderedPageNos(pages);
  if (!strictMode) return order;
  const optional = new Set(pages.filter((p) => !isRequiredPage(p)).map((p) => p.pageNo));
  const done = new Set(fulfilled);
  const next = order.find((n) => !done.has(n) && !optional.has(n));
  return order.filter((n) => done.has(n) || n === next || optional.has(n));
}

export function isPageAllowed(
  pageNo: number,
  pages: readonly PageRule[],
  fulfilled: readonly number[],
  strictMode: boolean,
): boolean {
  return allowedPages(pages, fulfilled, strictMode).includes(pageNo);
}

function findPage(pageNo: number, pages: readonly PageRule[]): PageRule | undefined {
  return pages.find((p) => p.pageNo === pageNo);
}

/**
 * Verarbeitet einen Heartbeat (Reihenfolge der Prüfungen wie E-06):
 * unbekannte Seite → erster Heartbeat → veraltet/doppelt → zu schnell →
 * seq-Lücke → Signal/Seitenwechsel/Sperre → Gutschrift.
 * Eingaben werden nie verändert.
 */
export function applyHeartbeat(input: ApplyHeartbeatInput): Decision {
  const { state, hb, serverTs, pages, progress, strictMode } = input;

  // Abgelehnt: Zustand und Fortschritt bleiben unverändert (Kopien).
  const reject = (reason: DecisionReason): Decision => ({
    accepted: false,
    reason,
    credit: null,
    state: { ...state },
    newlyFulfilled: [],
    progress: cloneProgress(progress),
  });

  const valid = isSignalValid(hb);
  const nextState: SessionTrackState = { lastSeq: hb.seq, lastServerTs: serverTs, lastPage: hb.page, lastValid: valid };
  // Angenommen ohne Gutschrift: Heartbeat wird neue Basis.
  const baseline = (reason: DecisionReason): Decision => ({
    accepted: true,
    reason,
    credit: null,
    state: nextState,
    newlyFulfilled: [],
    progress: cloneProgress(progress),
  });

  if (!Number.isSafeInteger(hb.seq) || hb.seq < 0 || !Number.isFinite(serverTs)) return reject('malformed');

  const rule = findPage(hb.page, pages);
  if (!rule) return reject('unknown_page');

  if (state.lastSeq === null || state.lastServerTs === null) return baseline('first');

  if (hb.seq <= state.lastSeq) return reject('stale_or_duplicate');

  const elapsed = serverTs - state.lastServerTs;
  if (elapsed < MIN_HEARTBEAT_GAP_MS) return reject('too_fast');

  if (hb.seq > state.lastSeq + 1) return baseline('seq_gap');

  if (!state.lastValid || !valid) return baseline('invalid_signal');
  if (state.lastPage !== hb.page) return baseline('page_changed');
  if (!isPageAllowed(hb.page, pages, progress.fulfilled, strictMode)) return baseline('page_locked');

  // Gutschrift: nur Serverzeit, gedeckelt, nie negativ.
  const ms = Math.max(0, Math.min(elapsed, MAX_CREDIT_PER_HEARTBEAT_MS));
  const next = cloneProgress(progress);
  const dwell = (next.dwellMs[hb.page] ?? 0) + ms;
  next.dwellMs[hb.page] = dwell;

  const newlyFulfilled: number[] = [];
  if (dwell >= rule.tMinMs && !next.fulfilled.includes(hb.page)) {
    next.fulfilled.push(hb.page);
    newlyFulfilled.push(hb.page);
  }

  return {
    accepted: true,
    reason: 'ok',
    credit: { page: hb.page, ms },
    state: nextState,
    newlyFulfilled,
    progress: next,
  };
}

function cloneProgress(p: ProgressSnapshot): ProgressSnapshot {
  return { dwellMs: { ...p.dwellMs }, fulfilled: [...p.fulfilled] };
}

/** Restzeit bis zur Erfüllung einer Seite (Countdown in der Oberfläche); 0 wenn erfüllt. */
export function remainingMs(pageNo: number, pages: readonly PageRule[], progress: ProgressSnapshot): number {
  const rule = findPage(pageNo, pages);
  if (!rule) throw new RangeError(`Unbekannte Seite ${pageNo}`);
  if (progress.fulfilled.includes(pageNo)) return 0;
  return Math.max(0, rule.tMinMs - (progress.dwellMs[pageNo] ?? 0));
}

/** Σ t_min aller Pflichtseiten in ms. */
export function totalRequiredMs(pages: readonly PageRule[]): number {
  return pages.filter(isRequiredPage).reduce((s, p) => s + p.tMinMs, 0);
}

/** Gesamt-Ist in ms; nur Pflichtseiten des Dokuments zählen. */
export function totalDwellMs(pages: readonly PageRule[], progress: ProgressSnapshot): number {
  return requiredPageNos(pages).reduce((s, n) => s + (progress.dwellMs[n] ?? 0), 0);
}

/** Alle Pflichtseiten erfüllt. Ein Dokument ohne (Pflicht-)Seiten gilt nie als abgeschlossen. */
export function isComplete(pages: readonly PageRule[], progress: ProgressSnapshot): boolean {
  const required = pages.filter(isRequiredPage);
  if (required.length === 0) return false;
  const done = new Set(progress.fulfilled);
  return required.every((p) => done.has(p.pageNo));
}

/**
 * Plausibilitätsflag für den Lesenachweis (markieren, nicht blockieren):
 * true, wenn alle Seiten erfüllt sind, das Gesamt-Ist aber unter 50 % von
 * Σ t_min liegt. Über die Engine ist das nicht erreichbar (Erfüllung setzt
 * Ist ≥ t_min je Seite voraus) – es deckt manuelle Korrekturen auf, z. B.
 * per Hand als erfüllt markierte Seiten. Unvollständige Nachweise werden
 * nicht geflaggt (noch kein Nachweis).
 */
export function plausibilityFlag(pages: readonly PageRule[], progress: ProgressSnapshot): boolean {
  if (!isComplete(pages, progress)) return false;
  return totalDwellMs(pages, progress) < PLAUSIBILITY_RATIO * totalRequiredMs(pages);
}
