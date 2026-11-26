import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { countWords } from '@sn/shared';
import { PDFDocument } from 'pdf-lib';

const exec = promisify(execFile);

export interface AnalyzedPage {
  pageNo: number;
  wordCount: number;
  title: string | null;
}
export interface AnalyzedChapter {
  idx: number;
  title: string;
  shortName: string;
  fromPage: number;
  toPage: number;
}
export interface PdfAnalysis {
  pageCount: number;
  pages: AnalyzedPage[];
  chapters: AnalyzedChapter[];
}

export function isPdf(buf: Buffer): boolean {
  return buf.subarray(0, 5).toString('latin1') === '%PDF-';
}

// pdfjs-dist ist ein reines ES-Modul → dynamisch laden (API läuft als CommonJS).
type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs', { with: { 'resolution-mode': 'import' } });
let pdfjsPromise: Promise<PdfJs> | null = null;
const loadPdfJs = () => (pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs'));

export function shortName(title: string): string {
  const t = title.replace(/^\s*(kapitel\s*)?\d+([.)]\d*)*[.):]?[\s:–-]*/i, '').trim() || title.trim();
  const first = t.split(/\s+/)[0] ?? t;
  return (first.length <= 12 ? first : `${first.slice(0, 11)}…`).replace(/[,:;–-]+$/, '');
}

/** Text je Seite (Wörter, erste Zeile als Titel) und Kapitel aus den Lesezeichen (E-05, E-06). */
export async function analyzePdf(data: Buffer): Promise<PdfAnalysis> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(data),
    disableFontFace: true,
    verbosity: 0,
    useSystemFonts: false,
  }).promise;
  try {
    const pages: AnalyzedPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const tc = await page.getTextContent();
      const parts: string[] = [];
      let firstLine = '';
      for (const it of tc.items) {
        if (!('str' in it)) continue;
        parts.push(it.str);
        if (!firstLine && it.str.trim().length > 2) firstLine = it.str.trim();
      }
      pages.push({ pageNo: n, wordCount: countWords(parts.join(' ')), title: firstLine ? firstLine.slice(0, 120) : null });
      page.cleanup();
    }

    const chapters: AnalyzedChapter[] = [];
    const outline = await doc.getOutline();
    if (outline?.length) {
      const starts: Array<{ title: string; page: number }> = [];
      for (const item of outline) {
        let dest = item.dest;
        if (typeof dest === 'string') dest = await doc.getDestination(dest);
        if (!Array.isArray(dest) || !dest[0]) continue;
        const pageIndex = await doc.getPageIndex(dest[0] as { num: number; gen: number });
        starts.push({ title: item.title.trim(), page: pageIndex + 1 });
      }
      starts.sort((a, b) => a.page - b.page);
      const unique = starts.filter((s, i) => i === 0 || s.page !== starts[i - 1]!.page);
      if (unique.length && unique[0]!.page > 1) unique.unshift({ title: 'Einleitung', page: 1 });
      unique.forEach((s, i) => {
        chapters.push({
          idx: i,
          title: s.title,
          shortName: shortName(s.title),
          fromPage: s.page,
          toPage: i + 1 < unique.length ? unique[i + 1]!.page - 1 : doc.numPages,
        });
      });
    }
    return { pageCount: doc.numPages, pages, chapters };
  } finally {
    await doc.destroy();
  }
}

/** Einzelseiten-PDFs (für signierte Seiten-URLs, E-05). */
export async function splitPages(data: Buffer): Promise<Buffer[]> {
  const src = await PDFDocument.load(data, { ignoreEncryption: false });
  const out: Buffer[] = [];
  for (let i = 0; i < src.getPageCount(); i++) {
    const one = await PDFDocument.create();
    const [p] = await one.copyPages(src, [i]);
    one.addPage(p!);
    out.push(Buffer.from(await one.save()));
  }
  return out;
}

/** Vorschaubilder (PNG, 240 px breit) per pdftoppm; ohne poppler-utils → leere Liste. */
export async function renderThumbnails(data: Buffer): Promise<Buffer[]> {
  const dir = await mkdtemp(join(tmpdir(), 'sn-thumb-'));
  try {
    await writeFile(join(dir, 'in.pdf'), data);
    await exec('pdftoppm', ['-png', '-scale-to-x', '240', '-scale-to-y', '-1', join(dir, 'in.pdf'), join(dir, 't')], {
      timeout: 120_000,
    });
    const files = (await readdir(dir)).filter((f) => f.startsWith('t-') && f.endsWith('.png'));
    files.sort((a, b) => Number(a.match(/(\d+)\.png$/)![1]) - Number(b.match(/(\d+)\.png$/)![1]));
    return Promise.all(files.map((f) => readFile(join(dir, f))));
  } catch {
    return [];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
