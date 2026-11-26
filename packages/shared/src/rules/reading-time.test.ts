import { describe, expect, it } from 'vitest';
import { countWords, DEFAULT_READING_TIME, hasText, minReadingSeconds } from './reading-time';

describe('minReadingSeconds', () => {
  it('berechnet W / v · 60 · f', () => {
    // 100 Wörter / 200 wpm = 0,5 min = 30 s · 0,6 = 18 s (Screen 2, S. 1)
    expect(minReadingSeconds(100)).toBe(18);
  });
  it('begrenzt nach oben auf t_cap', () => {
    expect(minReadingSeconds(5000)).toBe(90);
  });
  it('begrenzt nach unten auf t_floor', () => {
    expect(minReadingSeconds(6)).toBe(4);
  });
  it('Seiten ohne Text bekommen t_floor oder den manuellen Wert', () => {
    expect(minReadingSeconds(0)).toBe(4);
    expect(minReadingSeconds(2, DEFAULT_READING_TIME, { manualSeconds: 12 })).toBe(12);
  });
  it('Parameter sind je Schulung überschreibbar', () => {
    expect(minReadingSeconds(100, { wordsPerMinute: 100, factor: 1, floorSeconds: 1, capSeconds: 300 })).toBe(60);
  });
  it('Verlängerung je Person wirkt nach dem Clamping und verkürzt nie', () => {
    expect(minReadingSeconds(5000, DEFAULT_READING_TIME, { personFactor: 1.5 })).toBe(135);
    expect(minReadingSeconds(100, DEFAULT_READING_TIME, { personFactor: 0.5 })).toBe(18);
  });
  it('plausibel zu Screen 2: 2.090 Wörter ≈ 6 min 22 s', () => {
    // 12 Textseiten mit zusammen 2.090 Wörtern + 2 Seiten ohne Text
    const words = [100, 172, 233, 150, 0, 200, 250, 217, 122, 0, 183, 156, 228, 79];
    expect(words.reduce((a, b) => a + b, 0)).toBe(2090);
    const total = words.reduce((s, w) => s + minReadingSeconds(w), 0);
    expect(total).toBeGreaterThanOrEqual(375);
    expect(total).toBeLessThanOrEqual(390);
  });
  it('lehnt unsinnige Einstellungen ab', () => {
    expect(() => minReadingSeconds(10, { ...DEFAULT_READING_TIME, wordsPerMinute: 0 })).toThrow();
    expect(() => minReadingSeconds(10, { ...DEFAULT_READING_TIME, floorSeconds: 100 })).toThrow();
  });
});

describe('countWords / hasText', () => {
  it('zählt nur Tokens mit Buchstaben oder Ziffern', () => {
    expect(countWords('Die  fünf Sicherheitsregeln – 1. Freischalten • ')).toBe(5);
    expect(countWords('')).toBe(0);
  });
  it('markiert Seiten mit < 5 Wörtern als ohne Text', () => {
    expect(hasText(4)).toBe(false);
    expect(hasText(5)).toBe(true);
  });
});
