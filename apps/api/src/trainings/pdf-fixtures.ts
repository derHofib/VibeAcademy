import { PDFDocument, PDFHexString, PDFName, StandardFonts, type PDFRef } from 'pdf-lib';

/**
 * Erzeugt Test-PDFs mit bekannter Wortzahl je Seite und optionalen Lesezeichen (Kapiteln).
 * Wird von Tests und dem Demo-Seed genutzt.
 */
export async function makeTestPdf(opts: {
  wordsPerPage: number[];
  chapters?: Array<{ title: string; page: number }>;
  heading?: (pageNo: number) => string;
  /** Fester Text je Seite (statt „WortN“-Füllwörtern), z. B. für den Seiten-Diff; ersetzt wordsPerPage[i] */
  pageTexts?: Array<string | null>;
}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pageRefs: PDFRef[] = [];
  opts.wordsPerPage.forEach((words, i) => {
    const page = doc.addPage([595, 842]);
    pageRefs.push(page.ref);
    let y = 780;
    const fixed = opts.pageTexts?.[i];
    if (fixed) {
      const tokens = fixed.split(/\s+/).filter(Boolean);
      for (let k = 0; k < tokens.length; k += 10) {
        page.drawText(tokens.slice(k, k + 10).join(' '), { x: 56, y, size: 11, font });
        y -= 16;
        if (y < 60) y = 780;
      }
      return;
    }
    let remaining = words;
    if (words > 0 && opts.heading) {
      const h = opts.heading(i + 1);
      page.drawText(h, { x: 56, y, size: 20, font: bold });
      remaining -= h.split(/\s+/).filter(Boolean).length;
      y -= 36;
    }
    let n = 0;
    while (remaining > 0) {
      const count = Math.min(10, remaining);
      const line = Array.from({ length: count }, () => `Wort${++n}`).join(' ');
      page.drawText(line, { x: 56, y, size: 11, font });
      remaining -= count;
      y -= 16;
      if (y < 60) y = 780; // Überlauf ist für Tests egal (Text liegt übereinander)
    }
  });
  if (opts.chapters?.length) {
    const ctx = doc.context;
    const outlinesRef = ctx.nextRef();
    const refs = opts.chapters.map(() => ctx.nextRef());
    opts.chapters.forEach((ch, i) => {
      ctx.assign(
        refs[i]!,
        ctx.obj({
          Title: PDFHexString.fromText(ch.title),
          Parent: outlinesRef,
          Dest: ctx.obj([pageRefs[ch.page - 1]!, PDFName.of('Fit')]),
          ...(i > 0 ? { Prev: refs[i - 1]! } : {}),
          ...(i < refs.length - 1 ? { Next: refs[i + 1]! } : {}),
        }),
      );
    });
    ctx.assign(outlinesRef, ctx.obj({ Type: 'Outlines', First: refs[0]!, Last: refs[refs.length - 1]!, Count: refs.length }));
    doc.catalog.set(PDFName.of('Outlines'), outlinesRef);
  }
  return Buffer.from(await doc.save());
}
