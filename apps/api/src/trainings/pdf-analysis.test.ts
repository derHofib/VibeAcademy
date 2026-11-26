import { describe, expect, it } from 'vitest';
import { analyzePdf, isPdf, renderThumbnails, shortName, splitPages } from './pdf-analysis';
import { makeTestPdf } from './pdf-fixtures';

describe('PDF-Analyse', () => {
  it('zählt Wörter je Seite, erkennt Seiten ohne Text und Kapitel aus Lesezeichen', async () => {
    const pdf = await makeTestPdf({
      wordsPerPage: [100, 0, 57, 3],
      chapters: [
        { title: '1 Grundlagen', page: 1 },
        { title: '2 Elektrische Gefährdungen', page: 3 },
      ],
    });
    expect(isPdf(pdf)).toBe(true);
    const a = await analyzePdf(pdf);
    expect(a.pageCount).toBe(4);
    expect(a.pages.map((p) => p.wordCount)).toEqual([100, 0, 57, 3]);
    expect(a.chapters).toEqual([
      { idx: 0, title: '1 Grundlagen', shortName: 'Grundlagen', fromPage: 1, toPage: 2 },
      { idx: 1, title: '2 Elektrische Gefährdungen', shortName: 'Elektrische', fromPage: 3, toPage: 4 },
    ]);
  });

  it('ohne Lesezeichen keine Kapitel; Seitentitel aus der ersten Zeile', async () => {
    const a = await analyzePdf(await makeTestPdf({ wordsPerPage: [20], heading: () => 'Die fuenf Sicherheitsregeln' }));
    expect(a.chapters).toEqual([]);
    expect(a.pages[0]).toMatchObject({ wordCount: 20, title: 'Die fuenf Sicherheitsregeln' });
  });

  it('ergänzt „Einleitung“, wenn das erste Kapitel später beginnt', async () => {
    const a = await analyzePdf(await makeTestPdf({ wordsPerPage: [10, 10, 10], chapters: [{ title: 'Brandschutz', page: 2 }] }));
    expect(a.chapters.map((c) => [c.title, c.fromPage, c.toPage])).toEqual([
      ['Einleitung', 1, 1],
      ['Brandschutz', 2, 3],
    ]);
  });

  it('zerlegt in Einzelseiten und rendert Vorschaubilder', async () => {
    const pdf = await makeTestPdf({ wordsPerPage: [10, 20, 30] });
    const pages = await splitPages(pdf);
    expect(pages).toHaveLength(3);
    expect((await analyzePdf(pages[1]!)).pages[0]!.wordCount).toBe(20);
    const thumbs = await renderThumbnails(pdf);
    expect(thumbs).toHaveLength(3);
    expect(thumbs[0]!.subarray(1, 4).toString()).toBe('PNG');
  });

  it('erkennt Nicht-PDFs', () => {
    expect(isPdf(Buffer.from('GIF89a'))).toBe(false);
  });

  it('Kurznamen für die Kapitel-Leiste', () => {
    expect(shortName('2.4 Strom und Spannung')).toBe('Strom');
    expect(shortName('Kapitel 3: Notfallorganisation')).toBe('Notfallorga…');
  });
});
