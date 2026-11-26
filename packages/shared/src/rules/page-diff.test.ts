import { describe, expect, it } from 'vitest';
import { diffPages, diffTokens, normalizePageText, pageFingerprint, suggestKind, type PageTextInput } from './page-diff';

/** Erzeugt einen eindeutigen Seitentext mit `n` Wörtern zum Thema `topic`. */
function text(topic: string, n = 60): string {
  return Array.from({ length: n }, (_, i) => `${topic}${i}`).join(' ');
}
const pages = (...texts: string[]): PageTextInput[] => texts.map((t, i) => ({ pageNo: i + 1, text: t }));
const statuses = (r: ReturnType<typeof diffPages>) => r.pages.map((p) => `${p.oldPageNo ?? '-'}>${p.pageNo ?? '-'}:${p.status}`);

const A = text('alpha');
const B = text('bravo');
const C = text('charlie');
const D = text('delta');
const E = text('echo');

describe('normalizePageText', () => {
  it('ignoriert Leerraum, Silbentrennung, typografische Zeichen und Seitenzahlen', () => {
    expect(normalizePageText('  Sicher-\n heit „geht“ vor –  immer.\n\nSeite 3 von 14 ')).toBe('Sicherheit "geht" vor - immer.');
    expect(normalizePageText('7\nText über alles\n7')).toBe('Text über alles');
    expect(normalizePageText('Page 2 of 9 Hello world')).toBe('Hello world');
    expect(normalizePageText('Wei­che Tren­nung')).toBe('Weiche Trennung');
  });

  it('gleicher Inhalt → gleicher Fingerabdruck, anderer Inhalt → anderer', () => {
    expect(pageFingerprint(normalizePageText('A  b\nc'))).toBe(pageFingerprint(normalizePageText('A b c')));
    expect(pageFingerprint('a b c')).not.toBe(pageFingerprint('a b d'));
    expect(pageFingerprint('')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('diffTokens', () => {
  it('findet Einfügungen und Löschungen', () => {
    const ops = diffTokens('a b c d'.split(' '), 'a x c d e'.split(' '))!;
    expect(ops).toEqual([
      { kind: 'same', tokens: ['a'] },
      { kind: 'del', tokens: ['b'] },
      { kind: 'ins', tokens: ['x'] },
      { kind: 'same', tokens: ['c', 'd'] },
      { kind: 'ins', tokens: ['e'] },
    ]);
  });
});

describe('diffPages – Ausrichtung', () => {
  it('identische Versionen: alles unverändert, kein Vorschlag', () => {
    const r = diffPages(pages(A, B, C), pages(A, B, C));
    expect(statuses(r)).toEqual(['1>1:unveraendert', '2>2:unveraendert', '3>3:unveraendert']);
    expect(r.changedPages).toEqual([]);
    expect(r.suggestedChangeKind).toBeNull();
    expect(r.pages.every((p) => p.similarity === 1 && !p.excerpt)).toBe(true);
  });

  it('eingefügte Seite: nur die neue Seite ist „neu“, folgende Seiten bleiben unverändert', () => {
    const r = diffPages(pages(A, B, C), pages(A, D, B, C));
    expect(statuses(r)).toEqual(['1>1:unveraendert', '->2:neu', '2>3:unveraendert', '3>4:unveraendert']);
    expect(r.changedPages).toEqual([2]);
    expect(r.suggestedChangeKind).toBe('inhaltlich');
    expect(r.summary).toEqual({ unveraendert: 3, geaendert: 0, neu: 1, entfernt: 0 });
  });

  it('entfernte Seite wird an alter Stelle gemeldet; keine Seite der neuen Version ist geändert', () => {
    const r = diffPages(pages(A, B, C, D), pages(A, C, D));
    expect(statuses(r)).toEqual(['1>1:unveraendert', '2>-:entfernt', '3>2:unveraendert', '4>3:unveraendert']);
    expect(r.changedPages).toEqual([]);
    expect(r.pages[1]!.excerpt?.removed).toContain('bravo0');
    expect(r.suggestedChangeKind).toBe('inhaltlich');
  });

  it('kleine Änderung: geändert mit hoher Ähnlichkeit und Auszug; redaktionell vorgeschlagen', () => {
    const changed = B.replace('bravo30', 'BRAVO-NEU');
    const r = diffPages(pages(A, B, C), pages(A, changed, C));
    expect(statuses(r)).toEqual(['1>1:unveraendert', '2>2:geaendert', '3>3:unveraendert']);
    const p = r.pages[1]!;
    expect(p.similarity).toBeGreaterThan(0.97);
    expect(p.similarity).toBeLessThan(1);
    expect(p.excerpt).toEqual({ removed: 'bravo30', added: 'BRAVO-NEU' });
    expect(r.changedPages).toEqual([2]);
    expect(r.suggestedChangeKind).toBe('redaktionell');
  });

  it('größere Änderung einer Seite: geändert, inhaltlich vorgeschlagen', () => {
    const words = B.split(' ');
    const changed = [...words.slice(0, 40), ...text('neu', 20).split(' ')].join(' ');
    const r = diffPages(pages(A, B, C), pages(A, changed, C));
    expect(r.pages[1]).toMatchObject({ pageNo: 2, oldPageNo: 2, status: 'geaendert' });
    expect(r.pages[1]!.similarity).toBeGreaterThan(0.5);
    expect(r.pages[1]!.similarity).toBeLessThan(0.8);
    expect(r.suggestedChangeKind).toBe('inhaltlich');
  });

  it('Seite eingefügt UND nachfolgende Seite geändert', () => {
    const c2 = C.replace('charlie5', 'charlieX');
    const r = diffPages(pages(A, B, C, D), pages(A, E, B, c2, D));
    expect(statuses(r)).toEqual(['1>1:unveraendert', '->2:neu', '2>3:unveraendert', '3>4:geaendert', '4>5:unveraendert']);
    expect(r.changedPages).toEqual([2, 4]);
  });

  it('Reihenfolge getauscht: verschobene Seiten werden erkannt, nicht als neu gemeldet', () => {
    const r = diffPages(pages(A, B, C, D), pages(A, C, B, D));
    expect(r.summary).toEqual({ unveraendert: 4, geaendert: 0, neu: 0, entfernt: 0 });
    const moved = r.pages.filter((p) => p.moved);
    expect(moved).toHaveLength(1);
    expect(r.changedPages).toEqual([]);
    expect(r.pages.find((p) => p.pageNo === 2)!.oldPageNo).toBe(3);
    expect(r.pages.find((p) => p.pageNo === 3)!.oldPageNo).toBe(2);
  });

  it('verschobene und geänderte Seite', () => {
    const b2 = B.replace('bravo1 ', 'bravoX ');
    const r = diffPages(pages(A, B, C, D), pages(A, C, D, b2));
    const p = r.pages.find((x) => x.pageNo === 4)!;
    expect(p).toMatchObject({ oldPageNo: 2, status: 'geaendert', moved: true });
    expect(r.changedPages).toEqual([4]);
  });

  it('völlig andere Seite an gleicher Stelle: entfernt + neu statt geändert', () => {
    const r = diffPages(pages(A, B, C), pages(A, D, C));
    expect(statuses(r)).toEqual(['1>1:unveraendert', '2>-:entfernt', '->2:neu', '3>3:unveraendert']);
    expect(r.changedPages).toEqual([2]);
  });

  it('Seiten ohne Text werden markiert', () => {
    const r = diffPages(pages(A, '', C), pages(A, '', C));
    expect(r.pages[1]).toMatchObject({ status: 'unveraendert', noText: true });
  });

  it('Neuexport mit anderer Silbentrennung und Seitenzahlen gilt als unverändert', () => {
    const r = diffPages(
      [{ pageNo: 1, text: 'Sicherheits-\nunterweisung für alle Beschäftigten im Lager Seite 1 von 2' }],
      [{ pageNo: 1, text: 'Sicherheitsunterweisung für alle  Beschäftigten im Lager  Seite 1 von 3' }],
    );
    expect(r.pages[0]!.status).toBe('unveraendert');
  });

  it('große Dokumente bleiben schnell (300 Seiten, eine eingefügt)', () => {
    const old = Array.from({ length: 300 }, (_, i) => text(`p${i}x`, 200));
    const neu = [...old.slice(0, 150), text('inserted', 200), ...old.slice(150)];
    const t0 = Date.now();
    const r = diffPages(pages(...old), pages(...neu));
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(r.changedPages).toEqual([151]);
  });
});

describe('suggestKind', () => {
  it('nichts geändert → null', () => {
    expect(suggestKind([])).toBeNull();
  });
});
