import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { deEnShared } from '../en/common';
import { taEn, txAccountEn } from '../en/account';
import { tnEn } from '../en/live';
import { tpEn } from '../en/participant';
import { taDe, ta } from '../account';
import { de } from '../de';
import { txAccountDe } from '../external';
import { applyLang, chooseLang, getLang, hasExplicitLang, localized, pickLang, resetLangForTests, toLang, useParticipantLang } from '../lang';
import { tnDe, tl } from '../live';
import { formatDateTime, formatDayMonth, tp, tpDe } from '../participant';

/** Schlüsselpfade eines Wörterbuchs; Funktionen und Werte werden mit ihrem Typ markiert. */
function shape(o: unknown, path = ''): string[] {
  if (typeof o === 'function') return [`${path}:fn`];
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    return Object.keys(o)
      .sort()
      .flatMap((k) => shape((o as Record<string, unknown>)[k], path ? `${path}.${k}` : k));
  }
  return [`${path}:${typeof o}`];
}

/** Alle Texte (Funktionen mit Beispielargumenten aufgerufen) – keiner darf leer sein. */
function texts(o: unknown): string[] {
  if (typeof o === 'string') return [o];
  if (typeof o === 'function') {
    let r: unknown;
    try {
      r = (o as (...a: unknown[]) => unknown)(3, 2, 1, 0);
    } catch {
      r = (o as (...a: unknown[]) => unknown)(['x']); // Listen-Parameter
    }
    return typeof r === 'string' ? [r] : [];
  }
  if (o && typeof o === 'object') return Object.values(o).flatMap(texts);
  return [];
}

const pairs: Array<[string, unknown, unknown]> = [
  ['Teilnehmersicht (participant.ts)', tpDe, tpEn],
  ['Live/Präsenz-Teilnehmer (live.ts tn)', tnDe, tnEn],
  ['Meine Nachweise (account.ts)', { ...taDe, register: undefined, login: undefined, nav: undefined }, { ...taEn, register: undefined, login: undefined, nav: undefined }],
  ['Meine Nachweise – extern (external.ts account)', txAccountDe, txAccountEn],
  ['gemeinsame Bausteine (de.ts)', { common: de.common, progress: de.progress, quiz: de.quiz, ringButton: de.ringButton }, deEnShared],
];

afterEach(() => resetLangForTests());

describe('Wörterbücher de/en (E-39)', () => {
  it.each(pairs)('%s: gleiche Schlüssel und Arten', (_name, d, e) => {
    applyLang('de');
    expect(shape(e)).toEqual(shape(d));
  });

  it.each(pairs)('%s: keine leeren englischen Texte', (_name, _d, e) => {
    for (const s of texts(e)) expect(s.trim().length).toBeGreaterThan(0);
  });

  it('englische Texte unterscheiden sich von den deutschen (Stichproben)', () => {
    expect(tpEn.start.cta.start).not.toBe(tpDe.start.cta.start);
    expect(tnEn.landing.scan).not.toBe(tnDe.landing.scan);
    expect(taEn.page.title).not.toBe(taDe.page.title);
  });
});

describe('Sprachwahl', () => {
  it('toLang erkennt Sprachcodes', () => {
    expect(toLang('en-GB')).toBe('en');
    expect(toLang('EN')).toBe('en');
    expect(toLang('de-AT')).toBe('de');
    expect(toLang('fr')).toBeNull();
    expect(toLang(null)).toBeNull();
  });

  it('Reihenfolge: eigene Wahl > Daten der Person > Browser > Deutsch', () => {
    expect(pickLang({ explicit: 'de', data: 'en', browser: 'en' })).toBe('de');
    expect(pickLang({ explicit: null, data: 'en', browser: 'de' })).toBe('en');
    expect(pickLang({ data: 'fr', browser: 'en' })).toBe('en');
    expect(pickLang({})).toBe('de');
  });

  it('Wörterbücher lösen in der aktuellen Sprache auf – auch über Aliase', () => {
    const alias = tl.tn.scan;
    expect(tp.start.cta.start).toBe('Los geht’s');
    applyLang('en');
    expect(tp.start.cta.start).toBe('Let’s go');
    expect(alias.titleStart).toBe('Scan start QR');
    expect(ta.page.title).toBe('My records');
    expect(ta.register.title).toBe(taDe.register.title); // Registrieren bleibt Deutsch
    expect(de.ringButton.next).toBe('On to the next page');
    expect(de.nav.dashboard).toBe('Dashboard');
    expect({ ...tp.lang }).toEqual({ label: 'Language', de: 'Deutsch', en: 'English' });
    applyLang('de');
    expect(alias.titleStart).toBe('Start-QR scannen');
  });

  it('fehlende englische Werte fallen auf Deutsch zurück', () => {
    const d = localized({ de: { a: 'A', b: { c: 'C' } }, en: { a: 'EN-A' } as unknown as { a: string; b: { c: string } } });
    applyLang('en');
    expect(d.a).toBe('EN-A');
    expect(d.b.c).toBe('C');
  });

  it('Datumsformat folgt der Sprache', () => {
    const iso = '2026-11-26T13:05:00Z';
    expect(formatDateTime(iso)).toMatch(/Uhr$/);
    expect(formatDayMonth(iso)).toBe('26.11.');
    applyLang('en');
    expect(formatDateTime(iso)).not.toMatch(/Uhr/);
    expect(formatDayMonth(iso)).toBe('26/11');
  });

  it('Teilnehmerseite übernimmt die Sprache der Person, bis der Nutzer selbst wählt', () => {
    const { result, rerender } = renderHook(({ lang }: { lang?: string }) => useParticipantLang(lang), { initialProps: { lang: 'en' } });
    expect(result.current).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    act(() => chooseLang('de'));
    expect(result.current).toBe('de');
    expect(hasExplicitLang()).toBe(true);
    expect(localStorage.getItem('sn.lang')).toBe('de');
    rerender({ lang: 'en-GB' });
    expect(getLang()).toBe('de');
  });

  it('ohne Daten gilt die Browsersprache', () => {
    const nav = Object.getOwnPropertyDescriptor(window.navigator, 'languages');
    Object.defineProperty(window.navigator, 'languages', { value: ['en-US'], configurable: true });
    try {
      const { result } = renderHook(() => useParticipantLang());
      expect(result.current).toBe('en');
    } finally {
      if (nav) Object.defineProperty(window.navigator, 'languages', nav);
      else delete (window.navigator as unknown as Record<string, unknown>).languages;
    }
  });
});
