import { describe, expect, it } from 'vitest';
import { extractFields, nameInText, parseGermanDate, parseTsv, tidyCaps, type OcrLine } from './ocr';

const line = (text: string, y: number, page = 1): OcrLine => ({
  text, page, conf: 90, box: { page, x: 0.1, y, w: 0.5, h: 0.03 },
  words: text.split(' ').map((w) => ({ text: w, conf: 90, box: { page, x: 0.1, y, w: 0.05, h: 0.03 } })),
});

describe('Felderkennung externer Belege (nur Vorschlag)', () => {
  const lines = [
    line('ERSTE-HILFE-AUSBILDUNG MUSTER E. V.', 0.08),
    line('Teilnahmebescheinigung', 0.14),
    line('Hiermit wird bestätigt, dass', 0.22),
    line('Lea Wagner', 0.27),
    line('am 04.12.2026 an der', 0.32),
    line('Erste-Hilfe-Fortbildung (9 UE)', 0.37),
    line('gemäß DGUV Grundsatz 304-001 teilgenommen hat.', 0.42),
  ];
  it('erkennt Kurs, Name, Datum, Anbieter und Umfang mit Rahmen', () => {
    const f = extractFields(lines, 'Lea Wagner');
    expect(f.course?.value).toBe('Erste-Hilfe-Fortbildung');
    expect(f.name?.value).toBe('Lea Wagner');
    expect(f.nameMatches).toBe(true);
    expect(f.date).toMatchObject({ value: '04.12.2026', normalized: '2026-12-04' });
    expect(f.provider?.value).toBe('Erste-Hilfe-Ausbildung Muster e. V.');
    expect(f.duration).toMatchObject({ value: '9 UE', normalized: 6.75 });
    expect(f.date?.box?.y).toBe(0.32);
  });
  it('Name weicht ab → nameMatches false, Name aus der Zeile nach „dass“', () => {
    const f = extractFields(lines, 'Mehmet Aydın');
    expect(f.nameMatches).toBe(false);
    expect(f.name?.value).toBe('Lea Wagner');
  });
  it('fehlendes Datum bleibt leer', () => {
    const f = extractFields([line('LOGISTIKPARTNER BEISPIEL GMBH', 0.1), line('Teilnehmer: Mehmet Aydın', 0.2), line('Thema: Sicherer Umgang mit Gabelstaplern (Unterweisung)', 0.3), line('Datum: ____', 0.4)]);
    expect(f.date).toBeNull();
    expect(f.name?.value).toBe('Mehmet Aydın');
    expect(f.provider?.value).toBe('Logistikpartner Beispiel GmbH');
  });
  it('Hilfsfunktionen', () => {
    expect(parseGermanDate('am 4.12.26')).toBe('2026-12-04');
    expect(parseGermanDate('31.02.2026')).toBeNull();
    expect(nameInText('Mehmet Aydın', 'Teilnehmer: MEHMET AYDIN')).toBe(true);
    expect(nameInText('Jörg Groß', 'Jorg Gross')).toBe(true);
    expect(tidyCaps('Normaler Text')).toBe('Normaler Text');
  });
  it('liest Tesseract-TSV mit relativen Rahmen', () => {
    const tsv = [
      'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
      '1\t1\t0\t0\t0\t0\t0\t0\t1000\t2000\t-1\t',
      '5\t1\t1\t1\t1\t1\t100\t200\t100\t40\t95\tLea',
      '5\t1\t1\t1\t1\t2\t220\t200\t200\t40\t91\tWagner',
    ].join('\n');
    const r = parseTsv(tsv, 1);
    expect(r.size).toEqual({ width: 1000, height: 2000 });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ text: 'Lea Wagner', conf: 93, box: { page: 1, x: 0.1, y: 0.1, w: 0.32, h: 0.02 } });
  });
});
