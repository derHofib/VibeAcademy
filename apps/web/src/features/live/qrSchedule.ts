/**
 * Planung der QR-Aktualisierung (rotierender Code, neu alle 30 s, E-16). Der Server liefert `expiresInSeconds`
 * bis zum nächsten Slot; der alte Code gilt noch einen Slot weiter – wir holen kurz nach dem Wechsel den neuen.
 */
import { tl } from '@/i18n/live';
import { dateDe, hm, sameDay } from './time';

export const QR_SLOT_SECONDS = 30;
/** Puffer nach dem Slot-Wechsel, damit der Server sicher schon den neuen Slot hat */
export const QR_REFRESH_SLACK_MS = 400;

/** Wartezeit bis zum nächsten Abruf in ms (1 s … 31 s). */
export function qrRefetchDelayMs(expiresInSeconds: number | undefined): number {
  const s = typeof expiresInSeconds === 'number' && Number.isFinite(expiresInSeconds) ? expiresInSeconds : QR_SLOT_SECONDS;
  return Math.min(QR_SLOT_SECONDS * 1000 + 1000, Math.max(1000, s * 1000 + QR_REFRESH_SLACK_MS));
}

/** Sekunden bis zum Code-Wechsel für die Anzeige „Code wechselt in 0:21“. */
export function secondsLeft(fetchedAtMs: number, expiresInSeconds: number | undefined, nowMs: number): number {
  if (typeof expiresInSeconds !== 'number') return 0;
  return Math.max(0, Math.ceil((fetchedAtMs + expiresInSeconds * 1000 - nowMs) / 1000));
}

/** „0:21“ */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** „heute 07:30–16:30“ bzw. „am 04.12.2026 07:30–16:30“ (Gültigkeit des gedruckten/rotierenden Codes). */
export function validWindowLabel(fromIso: string, untilIso: string, nowMs: number): string {
  const from = hm(fromIso);
  const until = hm(untilIso);
  return sameDay(fromIso, nowMs) ? tl.org.qr.windowToday(from, until) : tl.org.qr.windowDate(dateDe(fromIso), from, until);
}
