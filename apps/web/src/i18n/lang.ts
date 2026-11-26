import { useEffect, useSyncExternalStore } from 'react';

/**
 * Kleine i18n-Schicht für die Teilnehmersicht (E-39). Die Verwaltung bleibt Deutsch.
 *
 * - Sprache: ausdrückliche Wahl (Umschalter, gespeichert) > Sprache der Person aus den Einladungsdaten >
 *   `navigator.language` > Deutsch. Ohne Teilnehmerseite bleibt die Sprache Deutsch.
 * - Wörterbücher: Je Bereich ein deutsches Objekt plus eine englische Fassung vom selben Typ
 *   (TypeScript prüft gleiche Schlüssel, `i18n-parity.test.ts` zusätzlich zur Laufzeit).
 * - `localized({ de, en })` liefert ein Objekt, das bei jedem Zugriff in der aktuellen Sprache auflöst – bestehende
 *   Aufrufe wie `tp.start.cta.start` bleiben unverändert. Komponenten abonnieren die Sprache mit `useLang()`/`useT()`.
 */
export type Lang = 'de' | 'en';
export const LANGS: readonly Lang[] = ['de', 'en'];

const STORAGE_KEY = 'sn.lang';
let current: Lang = 'de';
let explicitChoice: Lang | null = readStored();
const listeners = new Set<() => void>();

function readStored(): Lang | null {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return v === 'de' || v === 'en' ? v : null;
  } catch {
    return null;
  }
}

/** „en-GB“, „EN“ … → unterstützte Sprache; sonst null. */
export function toLang(raw: string | null | undefined): Lang | null {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v.startsWith('en')) return 'en';
  if (v.startsWith('de')) return 'de';
  return null;
}

/** Sprache des Browsers (Rückfall, wenn keine Daten/Wahl vorliegen). */
export function browserLang(): Lang {
  const list = typeof navigator !== 'undefined' ? [...(navigator.languages ?? []), navigator.language] : [];
  for (const l of list) {
    const x = toLang(l);
    if (x) return x;
  }
  return 'de';
}

/**
 * Sprache für eine Teilnehmerseite bestimmen: Wahl des Nutzers > Datenlage (Person/Einladung) > Browser.
 * Reine Funktion (getestet).
 */
export function pickLang(opts: { explicit?: Lang | null; data?: string | null; browser?: Lang }): Lang {
  return opts.explicit ?? toLang(opts.data) ?? opts.browser ?? 'de';
}

export function getLang(): Lang {
  return current;
}

function emit(next: Lang) {
  if (next === current) return;
  current = next;
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  for (const fn of listeners) fn();
}

/** Ausdrückliche Wahl über den Umschalter (wird gespeichert). */
export function chooseLang(lang: Lang) {
  explicitChoice = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* privates Fenster: nur für diese Sitzung */
  }
  emit(lang);
}

/** Sprache ohne Speicherung setzen (Teilnehmerseiten beim Laden, Verwaltung → Deutsch). */
export function applyLang(lang: Lang) {
  emit(lang);
}

export function hasExplicitLang(): boolean {
  return explicitChoice !== null;
}

/** Nur für Tests */
export function resetLangForTests() {
  explicitChoice = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* egal */
  }
  emit('de');
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Aktuelle Sprache; die Komponente rendert bei einem Wechsel neu. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, () => 'de');
}

/**
 * Für Teilnehmerseiten: Sprache aus den Daten (Person/Einladung) übernehmen, sofern der Nutzer nicht selbst gewählt
 * hat; ohne Daten die Browsersprache. Liefert die aktuelle Sprache (abonniert).
 */
export function useParticipantLang(dataLang?: string | null): Lang {
  const lang = useLang();
  useEffect(() => {
    applyLang(pickLang({ explicit: explicitChoice, data: dataLang, browser: browserLang() }));
  }, [dataLang]);
  return lang;
}

/** Verwaltungsseiten: immer Deutsch (E-39). */
export function useAdminLang() {
  useEffect(() => applyLang('de'), []);
}

/** Wörterbuch eines Bereichs in der aktuellen Sprache (abonniert). */
export function useT<T extends object>(dict: T): T {
  useLang();
  return dict;
}

type Dicts<T> = Record<Lang, T>;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

function resolve(dicts: Dicts<unknown>, lang: Lang, path: readonly PropertyKey[]): unknown {
  let v: unknown = dicts[lang];
  for (const k of path) v = (v as Record<PropertyKey, unknown> | undefined)?.[k];
  return v;
}

/**
 * Objekt, das bei jedem Zugriff in der aktuellen Sprache auflöst (auch verschachtelt und für Aliase wie
 * `const t = tl.tn`). Fehlt ein englischer Wert, gilt der deutsche.
 */
export function localized<T extends object>(dicts: Dicts<T>): T {
  const cache = new Map<string, object>();
  const make = (path: PropertyKey[]): object => {
    const key = path.map(String).join('\u0000');
    const hit = cache.get(key);
    if (hit) return hit;
    const target = resolve(dicts, 'de', path) as object;
    const value = (prop: PropertyKey) => {
      const v = resolve(dicts, current, [...path, prop]);
      return v === undefined ? resolve(dicts, 'de', [...path, prop]) : v;
    };
    const proxy = new Proxy(target, {
      get(t, prop) {
        if (typeof prop === 'symbol') return Reflect.get(t, prop);
        const v = value(prop);
        return isPlainObject(v) ? make([...path, prop]) : v;
      },
      getOwnPropertyDescriptor(t, prop) {
        const d = Reflect.getOwnPropertyDescriptor(t, prop);
        if (!d || typeof prop === 'symbol') return d;
        const v = value(prop);
        return { ...d, value: isPlainObject(v) ? make([...path, prop]) : v };
      },
    });
    cache.set(key, proxy);
    return proxy;
  };
  return make([]) as T;
}

/** Datums-Locale je Sprache */
export const LOCALE: Record<Lang, string> = { de: 'de-DE', en: 'en-GB' };
