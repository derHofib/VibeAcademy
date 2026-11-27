import { describe, expect, it } from 'vitest';
import { berlinLocal, parseAttendanceTable, secondsWithin } from '@sn/shared';
import { xlsxRows } from './backdated.service';

describe('Teilnehmerliste als XLSX', () => {
  it('Datumszellen als Ortszeit, Text und Zahlen als Text; danach wie CSV ausgewertet', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Teilnehmer');
    ws.addRow(['Name', 'E-Mail', 'Beitritt', 'Verlassen']);
    // Excel kennt keine Zeitzone: 09:05 Ortszeit wird als „09:05 UTC“ gespeichert
    ws.addRow(['Lea Wagner', 'lea@example.org', new Date(Date.UTC(2026, 10, 18, 9, 5)), new Date(Date.UTC(2026, 10, 18, 10, 0))]);
    ws.addRow(['Tobias Meier', { text: 'tobias@example.org', hyperlink: 'mailto:tobias@example.org' }, null, null]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const rows = await xlsxRows(buf);
    expect(rows[1]).toEqual(['Lea Wagner', 'lea@example.org', '2026-11-18 09:05:00', '2026-11-18 10:00:00']);
    expect(rows[2]!.slice(0, 2)).toEqual(['Tobias Meier', 'tobias@example.org']);
    const ctx = { startAt: berlinLocal(2026, 11, 18, 9, 0), endAt: berlinLocal(2026, 11, 18, 10, 0) };
    const r = parseAttendanceTable(rows, ctx);
    expect(r.entries).toHaveLength(2);
    expect(secondsWithin(r.entries[0]!.intervals, ctx.startAt, ctx.endAt)).toBe(55 * 60);
    expect(r.entries[1]!.intervals).toEqual([]);
  });
});
