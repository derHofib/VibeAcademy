import {
  addMonthsIso,
  boxStyle,
  caseMeta,
  creditFor,
  deDate,
  effectRow,
  fieldBoxes,
  fileExt,
  formatMmSs,
  isFutureDate,
  mmYY,
  pageRatio,
  queueChip,
  relativeDay,
  requirementLabel,
  scaleBox,
  stateChip,
  statusChip,
} from '../model';
import type { OcrFields } from '../api';

const NOW = new Date('2026-11-26T20:30:00Z'); // 21:30 Berliner Zeit

describe('Datumsformate', () => {
  it('kurz und lang', () => {
    expect(mmYY('2028-12-04')).toBe('12/28');
    expect(mmYY(null)).toBe('—');
    expect(deDate('2028-12-04')).toBe('04.12.2028');
    expect(deDate('2026-01-31T10:00:00Z')).toBe('31.01.2026');
    expect(deDate(undefined)).toBe('—');
  });

  it('relativer Tag wie in der Warteschlange', () => {
    expect(relativeDay('2026-11-26T20:04:00Z', NOW)).toBe('heute, 21:04');
    expect(relativeDay('2026-11-25T09:00:00Z', NOW)).toBe('gestern');
    expect(relativeDay('2026-11-25T09:00:00Z', NOW, true)).toBe('gestern, 10:00');
    expect(relativeDay('2026-11-23T09:00:00Z', NOW)).toBe('23.11.');
    expect(relativeDay(null, NOW)).toBe('—');
  });

  it('Meta-Zeile einer Karte', () => {
    expect(caseMeta({ submittedAt: '2026-11-26T20:04:00Z', sourceLabel: 'selbst eingereicht', fileKind: 'Foto' }, NOW)).toBe(
      'heute, 21:04 · selbst eingereicht · Foto',
    );
    expect(caseMeta({ submittedAt: '2026-11-23T08:00:00Z', sourceLabel: 'von Verwaltung erfasst', fileKind: null }, NOW)).toBe(
      '23.11. · von Verwaltung erfasst',
    );
  });

  it('Zukunft, Countdown, Intervall', () => {
    expect(isFutureDate('2026-11-27', NOW)).toBe(true);
    expect(isFutureDate('2026-11-26', NOW)).toBe(false);
    expect(formatMmSs(581_900)).toBe('9:41');
    expect(formatMmSs(600_400)).toBe('10:00');
    expect(formatMmSs(-5)).toBe('0:00');
    expect(addMonthsIso('2026-12-04', 24)).toBe('2028-12-04');
    expect(addMonthsIso('2026-01-31', 1)).toBe('2026-02-28');
  });
});

describe('Status-Chips', () => {
  it('Erfüllungsstand → Chip (Screen 9 „Was sich ändert“)', () => {
    expect(stateChip('abgelaufen', '2026-10-01')).toEqual({ label: 'abgelaufen', tone: 'danger' });
    expect(stateChip('laeuft_ab', '2026-12-15')).toEqual({ label: 'läuft ab 12/26', tone: 'warn' });
    expect(stateChip('gueltig', '2027-05-10')).toEqual({ label: 'gültig bis 05/27', tone: 'success' });
    expect(stateChip('neu', null)).toEqual({ label: 'neu', tone: 'neutral' });
    expect(stateChip('fehlt', null).tone).toBe('danger');
    expect(stateChip('befreit', null).label).toBe('befreit');
  });

  it('bisher → neu je Person', () => {
    const row = effectRow({ personId: 'p', name: 'Anna Schulz', current: { state: 'abgelaufen', validUntil: '2026-10-01' }, next: { validUntil: '2028-11-20' } });
    expect(row.from.label).toBe('abgelaufen');
    expect(row.to).toEqual({ label: 'bis 11/28', tone: 'success' });
    expect(effectRow({ personId: 'p', name: 'X', current: { state: 'neu', validUntil: null }, next: { validUntil: null } }).to).toBeNull();
  });

  it('Warteschlange: Hinweis-Chip oder Entscheidung', () => {
    expect(queueChip({ chip: { label: 'alles passt', tone: 'ok' }, status: 'eingereicht' })).toEqual({ label: 'alles passt', tone: 'success' });
    expect(queueChip({ chip: { label: 'Datum fehlt', tone: 'warn' }, status: 'eingereicht' })).toEqual({ label: 'Datum fehlt', tone: 'warn' });
    expect(queueChip({ chip: { label: 'alles passt', tone: 'ok' }, status: 'eingereicht' }, 'freigegeben')).toMatchObject({ label: 'freigegeben', check: true });
    expect(queueChip({ chip: { label: 'x', tone: 'warn' }, status: 'zurueckgegeben' }).label).toBe('zurückgegeben');
  });

  it('Status eines eigenen Nachweises', () => {
    expect(statusChip('eingereicht')).toEqual({ label: 'In Prüfung', tone: 'info' });
    expect(statusChip('freigegeben').tone).toBe('success');
    expect(statusChip('zurueckgegeben').tone).toBe('warn');
    expect(statusChip('entwurf').tone).toBe('neutral');
  });
});

describe('OCR-Rahmen', () => {
  it('skaliert relativ (Prozent) mit Rand und begrenzt auf die Seite', () => {
    expect(boxStyle({ page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.05 }, 0)).toEqual({ left: '10%', top: '20%', width: '30%', height: '5%' });
    const s = boxStyle({ page: 1, x: 0, y: 0.98, w: 0.5, h: 0.05 }, 0.01);
    expect(s.left).toBe('0%');
    expect(s.top).toBe('97%');
    expect(s.height).toBe('3%');
  });

  it('skaliert in Pixel', () => {
    expect(scaleBox({ page: 1, x: 0.25, y: 0.5, w: 0.5, h: 0.1 }, 800, 1000)).toEqual({ x: 200, y: 500, w: 400, h: 100 });
  });

  it('liefert erkannte Felder je Seite ohne doppelte Rahmen', () => {
    const box = { page: 1, x: 0.1, y: 0.3, w: 0.4, h: 0.04 };
    const fields: OcrFields = {
      name: { value: 'Lea Wagner', confidence: 90, box },
      date: { value: '20.11.2026', normalized: '2026-11-20', confidence: 88, box: { page: 1, x: 0.15, y: 0.36, w: 0.1, h: 0.03 } },
      course: { value: 'Erste-Hilfe-Fortbildung', confidence: 80, box: { ...box } },
      provider: { value: 'Muster e. V.', confidence: 70, box: { page: 2, x: 0, y: 0, w: 0.1, h: 0.1 } },
      duration: null,
      nameMatches: true,
    };
    const b = fieldBoxes(fields, 1);
    expect(b.map((x) => x.key)).toEqual(['name', 'date']);
    expect(b[0]!.label).toBe('Name');
    expect(fieldBoxes(fields, 2).map((x) => x.key)).toEqual(['provider']);
    expect(fieldBoxes(null)).toEqual([]);
  });

  it('Seitenverhältnis aus OCR-Seitenmaßen', () => {
    expect(pageRatio([{ width: 1000, height: 1414 }])).toBeCloseTo(1.414);
    expect(pageRatio([])).toBeCloseTo(842 / 595);
  });
});

describe('Belege und Zuordnung', () => {
  it('Dateiart', () => {
    expect(fileExt('Teilnahmebescheinigungen.pdf')).toBe('PDF');
    expect(fileExt('scan', 'image/png')).toBe('PNG');
    expect(fileExt('IMG_0001.JPEG')).toBe('JPG');
    expect(fileExt('liste.docx', 'application/octet-stream')).toBe('DATEI');
  });

  it('Optionstext und Anrechnung', () => {
    expect(requirementLabel({ training_title: 'Erste-Hilfe-Fortbildung', qualification_name: 'Ersthelfer', interval_months: 24 })).toBe(
      'Erste-Hilfe-Fortbildung · Qualifikation Ersthelfer · alle 2 Jahre',
    );
    expect(requirementLabel({ training_title: 'Stapler', qualification_name: 'Staplerfahrer', interval_months: 12 })).toContain('jährlich');
    expect(creditFor({ qualificationName: 'Ersthelfer', intervalMonths: 24 }, '2026-11-20')).toEqual({ label: 'Ersthelfer', validUntil: '2028-11-20' });
    expect(creditFor({ qualificationName: 'Ersthelfer', intervalMonths: 24 }, null)).toEqual({ label: 'Ersthelfer', validUntil: null });
    expect(creditFor(null, '2026-11-20')).toBeNull();
  });
});
