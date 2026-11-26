/**
 * QR-Tokens für Präsenz/Live (E-16) – reine Funktionen ohne Node-Abhängigkeit.
 *
 * Token = base64url(payload) "." base64url(HMAC-SHA256(payload))[gekürzt]
 * payload (21 Byte): run_id (16) · flags (1: Bit0 = Ende, Bit1 = gedruckt) · slot (4, uint32 big endian)
 *
 * - Rotierend: slot = floor(Serverzeit / 30 s); gültig sind aktueller und vorheriger Slot.
 * - Gedruckt (Aushang): gültig 30 min vor Beginn bis 60 min nach geplantem Ende (slot = Ausstellungs-Slot, nur Info).
 * - Nach dem offiziellen Ende ist jedes Token des Termins ungültig (Statusprüfung).
 * - Offline-Scan: Scanzeit = signierter Slot-Beginn (nie die Geräteuhr), höchstens 12 h nachträglich.
 *
 * Die Signatur wird von außen übergeben (Node: HMAC mit Schlüssel je Mandant), damit diese Datei im Browser
 * und im Server identisch nutzbar bleibt.
 */

export const QR_SLOT_MS = 30_000;
export const QR_PRINT_BEFORE_MS = 30 * 60_000;
export const QR_PRINT_AFTER_MS = 60 * 60_000;
export const QR_OFFLINE_MAX_MS = 12 * 3600_000;
/** Länge der gekürzten Signatur in Byte (128 Bit) */
export const QR_SIG_BYTES = 16;

export type QrKind = 'start' | 'end';
export type QrMode = 'rotierend' | 'gedruckt';

export interface QrPayload {
  runId: string;
  kind: QrKind;
  mode: QrMode;
  slot: number;
}

export type QrRejectReason =
  | 'format'
  | 'signatur'
  | 'falscher_termin'
  | 'falsche_art'
  | 'abgelaufen'
  | 'zukunft'
  | 'ausserhalb_zeitfenster'
  | 'beendet'
  | 'offline_zu_alt';

export const QR_REJECT_TEXT: Record<QrRejectReason, string> = {
  format: 'Dieser QR-Code gehört nicht zu einer Schulung.',
  signatur: 'Dieser QR-Code ist ungültig.',
  falscher_termin: 'Dieser QR-Code gehört zu einem anderen Termin.',
  falsche_art: 'Das ist nicht der richtige Code. Bitte den anderen QR-Code scannen.',
  abgelaufen: 'Der QR-Code ist abgelaufen. Bitte den aktuellen Code am Bildschirm scannen.',
  zukunft: 'Der QR-Code ist noch nicht gültig.',
  ausserhalb_zeitfenster: 'Der ausgedruckte QR-Code gilt nur 30 Minuten vor Beginn bis 60 Minuten nach dem geplanten Ende.',
  beendet: 'Die Schulung wurde offiziell beendet. Ein- und Auschecken ist nicht mehr möglich.',
  offline_zu_alt: 'Der Scan liegt mehr als 12 Stunden zurück und kann nicht mehr übernommen werden.',
};

export const slotOf = (ms: number) => Math.floor(ms / QR_SLOT_MS);
export const slotStartMs = (slot: number) => slot * QR_SLOT_MS;
/** Sekunden bis zum nächsten Code-Wechsel */
export const secondsToNextSlot = (ms: number) => Math.ceil((slotStartMs(slotOf(ms) + 1) - ms) / 1000);

// ── base64url ohne Buffer (Browser + Node) ───────────────────
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63]!;
    if (i + 2 < bytes.length) out += B64[n & 63]!;
  }
  return out;
}
export function fromBase64Url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of s) {
    buf = (buf << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeQrPayload(p: QrPayload): string {
  if (!UUID.test(p.runId)) throw new Error('runId ist keine UUID');
  if (!Number.isInteger(p.slot) || p.slot < 0 || p.slot > 0xffffffff) throw new Error('slot ungültig');
  const b = new Uint8Array(21);
  const hex = p.runId.replace(/-/g, '');
  for (let i = 0; i < 16; i++) b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  b[16] = (p.kind === 'end' ? 1 : 0) | (p.mode === 'gedruckt' ? 2 : 0);
  b[17] = (p.slot >>> 24) & 0xff;
  b[18] = (p.slot >>> 16) & 0xff;
  b[19] = (p.slot >>> 8) & 0xff;
  b[20] = p.slot & 0xff;
  return toBase64Url(b);
}

export function decodeQrPayload(body: string): QrPayload | null {
  const b = fromBase64Url(body);
  if (!b || b.length !== 21 || (b[16]! & ~3) !== 0) return null;
  const hex = Array.from(b.subarray(0, 16), (x) => x.toString(16).padStart(2, '0')).join('');
  const runId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const slot = ((b[17]! << 24) >>> 0) + (b[18]! << 16) + (b[19]! << 8) + b[20]!;
  return { runId, kind: b[16]! & 1 ? 'end' : 'start', mode: b[16]! & 2 ? 'gedruckt' : 'rotierend', slot };
}

/** Signatur über den Payload-Text; liefert base64url (wird auf QR_SIG_BYTES gekürzt). */
export type QrSigner = (body: string) => Uint8Array;

export function makeQrToken(p: QrPayload, sign: QrSigner): string {
  const body = encodeQrPayload(p);
  return `${body}.${toBase64Url(sign(body).subarray(0, QR_SIG_BYTES))}`;
}

/** Zerlegt ein Token ohne Signaturprüfung (z. B. um den Termin und damit den Mandantenschlüssel zu finden). */
export function peekQrToken(token: string): QrPayload | null {
  if (typeof token !== 'string' || token.length > 200) return null;
  const t = extractQrToken(token);
  const [body, sig] = t.split('.');
  if (!body || !sig || t.split('.').length !== 2) return null;
  return decodeQrPayload(body);
}

/** QR-Inhalt ist eine URL (…/q/<token>) oder das nackte Token. */
export function extractQrToken(raw: string): string {
  const m = /\/q\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\/?$/.exec(raw.trim());
  return m ? m[1]! : raw.trim();
}

/** Signaturprüfung in konstanter Zeit. */
export function verifyQrSignature(token: string, sign: QrSigner): QrPayload | null {
  const t = extractQrToken(token);
  const parts = t.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];
  const p = decodeQrPayload(body);
  const given = fromBase64Url(sig);
  if (!p || !given || given.length !== QR_SIG_BYTES) return null;
  const expected = sign(body).subarray(0, QR_SIG_BYTES);
  let diff = 0;
  for (let i = 0; i < QR_SIG_BYTES; i++) diff |= expected[i]! ^ given[i]!;
  return diff === 0 ? p : null;
}

export interface QrRunState {
  runId: string;
  startAt: number;
  endAt: number;
  /** offizielles Ende (ms) oder null */
  endedAt: number | null;
}

export interface QrScanInput {
  payload: QrPayload;
  expectedKind: QrKind;
  run: QrRunState;
  /** Serverzeit beim Eingang */
  nowMs: number;
  /** Scan wurde offline gepuffert und wird nachsynchronisiert */
  offline?: boolean;
}

export type QrScanResult = { ok: true; scanAtMs: number; offline: boolean } | { ok: false; reason: QrRejectReason };

/** Zeitfenster des gedruckten Aushangs. */
export function printedWindow(run: Pick<QrRunState, 'startAt' | 'endAt'>) {
  return { from: run.startAt - QR_PRINT_BEFORE_MS, until: run.endAt + QR_PRINT_AFTER_MS };
}

/**
 * Entscheidet, ob ein (signaturgeprüftes) Token jetzt angenommen wird und welche Scanzeit gilt.
 * Die Scanzeit ist immer Serverzeit: online der Eingang, offline der signierte Slot-Beginn.
 */
export function checkQrScan(i: QrScanInput): QrScanResult {
  const { payload: p, run, nowMs } = i;
  if (p.runId !== run.runId) return { ok: false, reason: 'falscher_termin' };
  if (p.kind !== i.expectedKind) return { ok: false, reason: 'falsche_art' };
  if (p.mode === 'gedruckt') {
    // Gedruckter Code: keine signierte Zeit → immer Eingangszeit, nur im Fenster und vor dem offiziellen Ende.
    if (run.endedAt !== null && nowMs >= run.endedAt) return { ok: false, reason: 'beendet' };
    const w = printedWindow(run);
    if (nowMs < w.from || nowMs > w.until) return { ok: false, reason: 'ausserhalb_zeitfenster' };
    return { ok: true, scanAtMs: nowMs, offline: false };
  }
  const current = slotOf(nowMs);
  if (p.slot > current) return { ok: false, reason: 'zukunft' };
  if (i.offline) {
    const scanAtMs = slotStartMs(p.slot);
    if (nowMs - scanAtMs > QR_OFFLINE_MAX_MS) return { ok: false, reason: 'offline_zu_alt' };
    if (run.endedAt !== null && scanAtMs >= run.endedAt) return { ok: false, reason: 'beendet' };
    return { ok: true, scanAtMs, offline: true };
  }
  if (run.endedAt !== null && nowMs >= run.endedAt) return { ok: false, reason: 'beendet' };
  if (p.slot < current - 1) return { ok: false, reason: 'abgelaufen' };
  return { ok: true, scanAtMs: nowMs, offline: false };
}
