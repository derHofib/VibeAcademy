import { describe, expect, it } from 'vitest';
import { anlassLine, formatForDelivery } from './training-meta';

describe('Anlass und Durchführungsart', () => {
  it('Anlass-Zeile mit und ohne Freitext, unbekannt → null', () => {
    expect(anlassLine('anlass', 'Beinahe-Unfall am 12.11.2026')).toBe('Anlassbezogen – Beinahe-Unfall am 12.11.2026');
    expect(anlassLine('erst', null)).toBe('Erstunterweisung');
    expect(anlassLine('wiederholung', '  ', 'en')).toBe('Refresher instruction');
    expect(anlassLine('quatsch', 'x')).toBeNull();
    expect(anlassLine(null, null)).toBeNull();
  });
  it('Format für die Fristen-Engine', () => {
    expect(formatForDelivery('online')).toBe('online');
    expect(formatForDelivery('praesenz')).toBe('praesenz');
    expect(formatForDelivery('live_online')).toBe('praesenz');
    expect(formatForDelivery('kombiniert')).toBe('hybrid');
    expect(formatForDelivery('extern')).toBe('extern');
  });
});
