import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ReceiptMime } from './receipts';

const exec = promisify(execFile);

/** Relativer Rahmen (0…1) auf einer Belegseite – das Frontend skaliert auf die angezeigte Größe. */
export interface Box {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface OcrLine {
  text: string;
  page: number;
  conf: number;
  box: Box;
  words: Array<{ text: string; box: Box; conf: number }>;
}
export interface OcrField {
  value: string;
  /** normalisierter Wert, z. B. ISO-Datum oder Stunden */
  normalized?: string | number | null;
  confidence: number;
  box: Box | null;
}
export interface OcrFields {
  course: OcrField | null;
  name: OcrField | null;
  date: OcrField | null;
  provider: OcrField | null;
  duration: OcrField | null;
}
export interface OcrResult {
  engine: string;
  pages: Array<{ width: number; height: number }>;
  lines: OcrLine[];
  text: string;
}

const MAX_PAGES = 4;
const MAX_LINES = 400;

/** Belege (Foto/PDF) mit Tesseract (deu) lesen – lokal, kein Cloud-OCR (E-18). PDFs werden vorher per pdftoppm gerastert. */
export async function runOcr(files: Array<{ data: Buffer; mime: ReceiptMime }>, opts: { tesseract?: string; lang?: string } = {}): Promise<OcrResult> {
  const dir = await mkdtemp(join(tmpdir(), 'sn-ocr-'));
  try {
    const images: string[] = [];
    let i = 0;
    for (const f of files) {
      if (images.length >= MAX_PAGES) break;
      i++;
      if (f.mime === 'application/pdf') {
        await writeFile(join(dir, `in${i}.pdf`), f.data);
        await exec('pdftoppm', ['-r', '200', '-png', '-f', '1', '-l', String(MAX_PAGES - images.length), join(dir, `in${i}.pdf`), join(dir, `p${i}`)], { timeout: 60_000 });
        const pages = (await readdir(dir)).filter((n) => n.startsWith(`p${i}-`) && n.endsWith('.png')).sort((a, b) => pageNo(a) - pageNo(b));
        images.push(...pages.map((n) => join(dir, n)));
      } else {
        const p = join(dir, `img${i}.${f.mime === 'image/png' ? 'png' : 'jpg'}`);
        await writeFile(p, f.data);
        images.push(p);
      }
    }
    const result: OcrResult = { engine: 'tesseract', pages: [], lines: [], text: '' };
    for (const [idx, img] of images.slice(0, MAX_PAGES).entries()) {
      const { stdout } = await exec(opts.tesseract ?? 'tesseract', [img, 'stdout', '-l', opts.lang ?? 'deu', '--psm', '3', 'tsv'], {
        timeout: 120_000, maxBuffer: 20 * 1024 * 1024,
      });
      const parsed = parseTsv(stdout, idx + 1);
      result.pages.push(parsed.size);
      result.lines.push(...parsed.lines);
    }
    result.lines = result.lines.slice(0, MAX_LINES);
    result.text = result.lines.map((l) => l.text).join('\n');
    const v = await exec(opts.tesseract ?? 'tesseract', ['--version']).catch(() => null);
    const m = v ? /tesseract\s+v?([\d.]+)/i.exec(`${v.stdout}${v.stderr}`) : null;
    if (m) result.engine = `tesseract ${m[1]}`;
    return result;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const pageNo = (n: string) => Number(/-(\d+)\.png$/.exec(n)?.[1] ?? 0);

/** Tesseract-TSV → Zeilen mit relativen Rahmen. */
export function parseTsv(tsv: string, page: number): { size: { width: number; height: number }; lines: OcrLine[] } {
  const rows = tsv.split('\n').slice(1).map((l) => l.split('\t'));
  let width = 1;
  let height = 1;
  const groups = new Map<string, Array<{ text: string; l: number; t: number; w: number; h: number; conf: number }>>();
  for (const r of rows) {
    if (r.length < 12) continue;
    const [level, , block, par, line, , l, t, w, h, conf] = r.map((x, i) => (i < 11 ? Number(x) : 0));
    const text = (r[11] ?? '').trim();
    if (level === 1) {
      width = w || 1;
      height = h || 1;
    }
    if (level !== 5 || !text) continue;
    const key = `${block}.${par}.${line}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ text, l: l!, t: t!, w: w!, h: h!, conf: conf! });
  }
  const rel = (l: number, t: number, w: number, h: number): Box => ({
    page, x: round(l / width), y: round(t / height), w: round(w / width), h: round(h / height),
  });
  const lines: OcrLine[] = [];
  for (const words of groups.values()) {
    const l = Math.min(...words.map((x) => x.l));
    const t = Math.min(...words.map((x) => x.t));
    const r = Math.max(...words.map((x) => x.l + x.w));
    const b = Math.max(...words.map((x) => x.t + x.h));
    const conf = words.reduce((s, x) => s + Math.max(0, x.conf), 0) / words.length;
    lines.push({
      text: words.map((x) => x.text).join(' '),
      page,
      conf: Math.round(conf),
      box: rel(l, t, r - l, b - t),
      words: words.map((x) => ({ text: x.text, box: rel(x.l, x.t, x.w, x.h), conf: Math.round(x.conf) })),
    });
  }
  lines.sort((a, b) => a.page - b.page || a.box.y - b.box.y || a.box.x - b.box.x);
  return { size: { width, height }, lines };
}
const round = (v: number) => Math.round(v * 10000) / 10000;

// ── Felderkennung (nur Vorschlag) ──────────────────────────

export const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ł/g, 'l')
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Kommt der Name (alle Namensteile ≥ 2 Zeichen) im Text vor? Unempfindlich gegen Akzente und Groß-/Kleinschreibung. */
export function nameInText(name: string, text: string): boolean {
  const tokens = normalize(name).split(' ').filter((t) => t.length >= 2);
  if (!tokens.length) return false;
  const hay = ` ${normalize(text)} `;
  return tokens.every((t) => hay.includes(` ${t} `));
}

const DATE_RE = /\b(\d{1,2})\s?\.\s?(\d{1,2})\s?\.\s?(\d{4}|\d{2})\b/;
const DURATION_RE = /(\d+(?:[.,]\d+)?)\s*(UE|Unterrichtseinheiten|Lehreinheiten|LE|Std\.?|Stunden|h)\b/i;
const COURSE_RE = /(fortbildung|ausbildung|schulung|unterweisung|lehrgang|kurs|seminar|unterrichtung|einweisung|training|auffrischung|grundlehrgang|pr[üu]fung|vorsorge)/i;
const TITLE_RE = /^(teilnahme)?(bescheinigung|best[äa]tigung|zertifikat|urkunde|nachweis|teilnahmebescheinigung|certificate)\b/i;
const PROVIDER_RE = /(e\.\s?v\.|gmbh|\bag\b|akademie|institut|t[üu]v|dekra|ihk|hwk|berufsgenossenschaft|\bbg\s|drk|johanniter|malteser|arbeiter-samariter|asb|schule|zentrum|verband)/i;

export function parseGermanDate(s: string): string | null {
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = Number(m[3]);
  if (y < 100) y += y >= 70 ? 1900 : 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1970 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Großgeschriebene Kopfzeilen lesbar machen („ERSTE-HILFE-AUSBILDUNG MUSTER E. V.“ → „Erste-Hilfe-Ausbildung Muster e. V.“). */
export function tidyCaps(s: string): string {
  const letters = s.replace(/[^\p{L}]/gu, '');
  if (!letters || letters !== letters.toUpperCase()) return s.trim();
  return s
    .toLowerCase()
    .replace(/(^|[\s-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase())
    .replace(/\bE\. ?V\./gi, 'e. V.')
    .replace(/\bGmbh\b/g, 'GmbH')
    .replace(/\bAg\b/g, 'AG')
    .trim();
}

const field = (value: string, line: OcrLine | null, normalized?: string | number | null, box?: Box | null): OcrField => ({
  value, normalized: normalized ?? null, confidence: line ? line.conf : 0, box: box ?? line?.box ?? null,
});

/**
 * Felder aus den erkannten Zeilen vorschlagen: Kurs, Name, Datum, Anbieter, Umfang.
 * Bewusst einfache, nachvollziehbare Regeln – Ergebnis ist immer nur ein Vorschlag (E-18).
 */
export function extractFields(lines: OcrLine[], personName?: string | null): OcrFields & { nameMatches: boolean | null } {
  const out: OcrFields & { nameMatches: boolean | null } = { course: null, name: null, date: null, provider: null, duration: null, nameMatches: null };
  // Datum: erstes plausibles Datum, Rahmen um das Wort
  for (const l of lines) {
    const iso = parseGermanDate(l.text);
    if (!iso) continue;
    const word = l.words.find((w) => DATE_RE.test(w.text));
    out.date = field(DATE_RE.exec(l.text)![0].replace(/\s/g, ''), l, iso, word?.box ?? l.box);
    break;
  }
  for (const l of lines) {
    const m = DURATION_RE.exec(l.text);
    if (!m) continue;
    const n = Number(m[1]!.replace(',', '.'));
    const unit = m[2]!.toUpperCase();
    const hours = /^(UE|UNTERRICHTSEINHEITEN|LEHREINHEITEN|LE)$/.test(unit) ? n * 0.75 : n;
    out.duration = field(`${m[1]} ${/^(UE|UNTERRICHTSEINHEITEN|LEHREINHEITEN|LE)$/.test(unit) ? 'UE' : 'Std.'}`, l, hours);
    break;
  }
  // Name
  if (personName) {
    out.nameMatches = nameInText(personName, lines.map((l) => l.text).join(' '));
    const hit = lines.find((l) => nameInText(personName, l.text));
    if (hit) out.name = field(personName, hit);
  }
  if (!out.name) {
    const idx = lines.findIndex((l) => /\bdass\b\s*$/i.test(l.text) || /^(name|teilnehmer(in)?|herr|frau)\s*:?/i.test(l.text));
    if (idx >= 0) {
      const l = lines[idx]!;
      const inline = /^(?:name|teilnehmer(?:in)?)\s*:\s*(.+)$/i.exec(l.text);
      const candidate = inline ? { text: inline[1]!, line: l } : lines[idx + 1] ? { text: lines[idx + 1]!.text, line: lines[idx + 1]! } : null;
      if (candidate && !DATE_RE.test(candidate.text)) out.name = field(candidate.text.replace(/^(herr|frau)\s+/i, '').trim(), candidate.line);
    }
  }
  // Anbieter: Zeile mit Rechtsform/Organisation, sonst die oberste Zeile, wenn sie kein Dokumenttitel ist
  const first = lines.find((l) => l.page === 1 && l.text.length > 3);
  const prov = lines.find((l) => PROVIDER_RE.test(l.text) && !COURSE_RE.test(l.text.replace(/ausbildung/i, ''))) ?? lines.find((l) => PROVIDER_RE.test(l.text));
  const provLine = prov ?? (first && !TITLE_RE.test(first.text) ? first : null);
  if (provLine) out.provider = field(tidyCaps(provLine.text.replace(/\s*·.*$/, '')), provLine);
  // Kurs: Zeile mit Kurs-Stichwort, die weder Kopfzeile (Anbieter) noch Titel noch Datumszeile ist
  const course = lines.find(
    (l) => l !== provLine && COURSE_RE.test(l.text) && !TITLE_RE.test(l.text) && !parseGermanDate(l.text) && !/\bdass\b/i.test(l.text),
  );
  if (course) {
    const cleaned = course.text.replace(/^(thema|kurs|schulung|lehrgang|veranstaltung)\s*:\s*/i, '').replace(/\s*\(([^)]*)\)\s*$/, '').trim();
    out.course = field(cleaned, course);
  }
  return out;
}
