/** Passwortregeln – eine Quelle für API (Zod) und Web (Formulare, Hinweise). */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

export const passwordTooShortText = (lang: 'de' | 'en' = 'de') =>
  lang === 'en'
    ? `The password must be at least ${PASSWORD_MIN_LENGTH} characters long`
    : `Das Passwort muss mindestens ${PASSWORD_MIN_LENGTH} Zeichen haben`;

export interface LoginLockPolicy {
  /** Fehlversuche ohne Sperre */
  freeAttempts: number;
  /** Erste Sperrdauer in Sekunden (danach je Fehlversuch verdoppelt) */
  baseSeconds: number;
  /** Höchste Sperrdauer in Sekunden */
  maxSeconds: number;
}

export const DEFAULT_LOGIN_LOCK: LoginLockPolicy = { freeAttempts: 5, baseSeconds: 60, maxSeconds: 24 * 3600 };

/**
 * Sperrdauer nach dem n-ten Fehlversuch in Folge: die ersten `freeAttempts` sind frei,
 * danach base, 2·base, 4·base … gedeckelt auf `maxSeconds`.
 */
export function loginLockSeconds(failures: number, p: LoginLockPolicy = DEFAULT_LOGIN_LOCK): number {
  const over = failures - p.freeAttempts;
  if (over <= 0) return 0;
  // 2^(over-1) ohne Überlauf: ab 2^40 ist jede sinnvolle Obergrenze erreicht
  const factor = 2 ** Math.min(over - 1, 40);
  return Math.min(p.baseSeconds * factor, p.maxSeconds);
}

/** „4 Minuten“, „1 Minute“, „2 Stunden“, „30 Sekunden“ – für Sperrmeldungen (aufgerundet). */
export function formatWaitDe(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 60) return s === 1 ? '1 Sekunde' : `${s} Sekunden`;
  const m = Math.ceil(s / 60);
  if (m < 60) return m === 1 ? '1 Minute' : `${m} Minuten`;
  const h = Math.ceil(m / 60);
  return h === 1 ? '1 Stunde' : `${h} Stunden`;
}

export const loginLockedText = (seconds: number) =>
  `Zu viele Fehlversuche. Bitte in ${formatWaitDe(seconds)} erneut versuchen.`;
