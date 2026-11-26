/**
 * Sprachen der Teilnehmersicht (E-39): Deutsch (Standard) und Englisch. Die Verwaltung bleibt Deutsch.
 * `person.sprache` ist Freitext (z. B. „en-GB“ aus SCIM) → auf die unterstützten Sprachen abbilden.
 */
export type Lang = 'de' | 'en';
export const LANGS: readonly Lang[] = ['de', 'en'];

export function participantLanguage(raw: string | null | undefined): Lang {
  return String(raw ?? '').trim().toLowerCase().startsWith('en') ? 'en' : 'de';
}

export const TZ = 'Europe/Berlin';
const LOCALE: Record<Lang, string> = { de: 'de-DE', en: 'en-GB' };

/** Datum (+ Uhrzeit) in der Sprache der Person, Zeitzone Europe/Berlin. */
export function formatDate(lang: Lang, d: Date | string | null, withTime = true): string {
  if (!d) return '–';
  return new Intl.DateTimeFormat(LOCALE[lang], {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(d));
}

export function formatDayMonth(lang: Lang, d: Date | string | null): string {
  return d ? new Intl.DateTimeFormat(LOCALE[lang], { timeZone: TZ, day: '2-digit', month: '2-digit' }).format(new Date(d)) : '–';
}

export function formatDateTimeLong(lang: Lang, d: Date | string): string {
  return new Intl.DateTimeFormat(LOCALE[lang], { timeZone: TZ, dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(d));
}
