import { ApiError } from '@/lib/api';

/** Sekunden bis zum Ende einer Login-Sperre aus einer 429-Antwort (sonst null). */
export function lockSecondsFrom(e: unknown): number | null {
  if (!(e instanceof ApiError) || e.status !== 429) return null;
  const s = Number((e.body as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds);
  return Number.isFinite(s) && s > 0 ? s : null;
}
