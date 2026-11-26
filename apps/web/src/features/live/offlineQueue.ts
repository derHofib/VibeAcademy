/**
 * Offline-Warteschlange für QR-Scans (SPEZIFIKATION 4.8 „Offline-Scans mit signiertem Zeitstempel nachsynchronisieren“).
 * Gespeichert werden Token, Art und Geräteuhrzeit. Beim Senden mit `offline: true` nimmt der Server den signierten
 * Slot-Beginn des Tokens als Scanzeit – die Geräteuhr zählt nie. Getestet in __tests__/offlineQueue.test.ts.
 */
export interface QueuedScan {
  id: string;
  kind: 'start' | 'end';
  token: string;
  /** Geräteuhrzeit beim Scan (nur zur Information) */
  deviceTime: string;
  invitationId: string | null;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const QUEUE_KEY = 'sn:live:offline-scans';
/** Ältere Scans lehnt der Server ohnehin ab (offline_zu_alt, 12 h) */
export const QUEUE_MAX_AGE_MS = 12 * 3600_000;
const MAX_ITEMS = 20;

export function readQueue(store: KeyValueStore | null): QueuedScan[] {
  if (!store) return [];
  try {
    const raw = store.getItem(QUEUE_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list)
      ? list.filter((x): x is QueuedScan => !!x && typeof x === 'object' && typeof (x as QueuedScan).token === 'string' && ((x as QueuedScan).kind === 'start' || (x as QueuedScan).kind === 'end'))
      : [];
  } catch {
    return [];
  }
}

function writeQueue(store: KeyValueStore | null, list: QueuedScan[]) {
  if (!store) return;
  try {
    if (list.length) store.setItem(QUEUE_KEY, JSON.stringify(list));
    else store.removeItem(QUEUE_KEY);
  } catch {
    // Speicher voll/gesperrt – Scan geht dann verloren, der Nutzer sieht den Fehler direkt
  }
}

/** Scan anhängen (derselbe Token nur einmal). */
export function enqueueScan(store: KeyValueStore | null, scan: Omit<QueuedScan, 'id'>, id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`): QueuedScan[] {
  const list = readQueue(store).filter((x) => x.token !== scan.token);
  const next = [...list, { ...scan, id }].slice(-MAX_ITEMS);
  writeQueue(store, next);
  return next;
}

export type SendResult = 'ok' | 'rejected' | 'network';

export interface FlushReport {
  sent: QueuedScan[];
  rejected: Array<{ scan: QueuedScan; message: string }>;
  remaining: QueuedScan[];
}

/**
 * Sendet alle wartenden Scans der Reihe nach (Start vor Ende, in Scan-Reihenfolge). Netzfehler → Rest bleibt liegen;
 * fachliche Ablehnung (4xx) → Scan wird verworfen und gemeldet. Zu alte Scans werden ohne Senden verworfen.
 */
export async function flushScans(
  store: KeyValueStore | null,
  send: (scan: QueuedScan) => Promise<{ result: SendResult; message?: string }>,
  nowMs = Date.now(),
): Promise<FlushReport> {
  const report: FlushReport = { sent: [], rejected: [], remaining: [] };
  const list = readQueue(store);
  for (let i = 0; i < list.length; i++) {
    const scan = list[i]!;
    const age = nowMs - Date.parse(scan.deviceTime);
    if (Number.isFinite(age) && age > QUEUE_MAX_AGE_MS) {
      report.rejected.push({ scan, message: 'zu alt' });
      continue;
    }
    const r = await send(scan);
    if (r.result === 'ok') report.sent.push(scan);
    else if (r.result === 'rejected') report.rejected.push({ scan, message: r.message ?? '' });
    else {
      report.remaining = list.slice(i);
      break;
    }
  }
  writeQueue(store, report.remaining);
  return report;
}

/** localStorage, falls verfügbar (privater Modus kann werfen). */
export function browserStore(): KeyValueStore | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}
