/**
 * Vorprüfung gescannter QR-Inhalte im Browser (ohne Signatur – die prüft nur der Server) und Pflichtregeln für
 * „Ohne QR ausloggen“. Getestet in __tests__/scanLogic.test.ts.
 */
import { extractQrToken, MANUAL_NOTE_MIN, peekQrToken, type ManualCheckoutReason } from '@sn/shared';
import { tl } from '@/i18n/live';

export type TokenCheck = { ok: true; token: string; kind: 'start' | 'end'; runId: string } | { ok: false; message: string };

/**
 * QR-Inhalt (URL …/q/<token> oder nacktes Token) prüfen: Format, Art (Start/Ende) und – falls bekannt – Termin.
 * So bekommt man beim falschen Code sofort einen verständlichen Hinweis, auch offline.
 */
export function checkScannedToken(raw: string, expected: 'start' | 'end', runId?: string | null): TokenCheck {
  const token = extractQrToken(raw ?? '');
  const p = peekQrToken(token);
  if (!p) return { ok: false, message: tl.tn.scan.notAQr };
  if (runId && p.runId !== runId) return { ok: false, message: tl.tn.scan.wrongRun };
  if (p.kind !== expected) return { ok: false, message: expected === 'start' ? tl.tn.scan.wrongKindStart : tl.tn.scan.wrongKindEnd };
  return { ok: true, token, kind: p.kind, runId: p.runId };
}

/** Pflicht: Grund + Vermerk ≥ 10 Zeichen (SPEZIFIKATION 4.8). */
export function manualCheckoutValid(reason: ManualCheckoutReason | null, note: string): boolean {
  return reason !== null && note.trim().length >= MANUAL_NOTE_MIN;
}

export function manualNoteRemaining(note: string): number {
  return Math.max(0, MANUAL_NOTE_MIN - note.trim().length);
}
