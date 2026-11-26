import type { AppConfig } from '../config';

/** Laufzeitoptionen der Webhook-Zustellung (Tests ersetzen den Provider durch kurze Zeiten). */
export interface WebhookOptions {
  /** Versuche je Zustellung insgesamt */
  maxAttempts: number;
  /** Basis des exponentiellen Backoffs (Versuch n wartet base · 2^(n−1)) */
  backoffBaseMs: number;
  /** Endpunkt nach so vielen Fehlversuchen in Folge deaktivieren */
  disableAfterFailures: number;
  /** Zeitlimit je HTTP-Zustellung */
  timeoutMs: number;
  /** Abstand des Pollers, der fällige Zustellungen in die Queue gibt */
  pollMs: number;
  /** http:// zu localhost und private Ziele erlauben (Entwicklung/Test) */
  allowPrivate: boolean;
  /** Ereignisse/Protokoll aufbewahren */
  retentionDays: number;
}

export const WEBHOOK_OPTIONS = Symbol('WEBHOOK_OPTIONS');

export function webhookOptionsFrom(config: AppConfig): WebhookOptions {
  return {
    maxAttempts: config.WEBHOOK_MAX_ATTEMPTS,
    backoffBaseMs: config.WEBHOOK_BACKOFF_BASE_MS,
    disableAfterFailures: config.WEBHOOK_DISABLE_AFTER_FAILURES,
    timeoutMs: config.WEBHOOK_TIMEOUT_MS,
    pollMs: config.WEBHOOK_POLL_MS,
    // leer = nur außerhalb der Produktion; ausdrücklich „true“ z. B. für Ziele im Intranet
    allowPrivate: config.WEBHOOK_ALLOW_PRIVATE === '' ? config.NODE_ENV !== 'production' : config.WEBHOOK_ALLOW_PRIVATE === 'true',
    retentionDays: 30,
  };
}
