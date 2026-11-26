import { describe, expect, it } from 'vitest';
import { pageList, requiredOf, type PageProgress } from '../api';
import { resumePage } from '../viewerModel';

const page = (pageNo: number, over: Partial<PageProgress> = {}): PageProgress => ({ pageNo, tMinMs: 4000, dwellMs: 0, fulfilled: false, allowed: true, ...over });

describe('Nur geänderte Seiten (E-38)', () => {
  it('Seitenliste „3, 7, 8“ mit Bereichen ab drei Seiten', () => {
    expect(pageList([8, 3, 7])).toBe('3, 7, 8');
    expect(pageList([2, 3, 4, 9])).toBe('2–4, 9');
    expect(pageList([5])).toBe('5');
  });

  it('Pflichtseiten: ohne Angabe alle', () => {
    expect(requiredOf([page(1), page(2, { required: false }), page(3, { required: true })]).map((p) => p.pageNo)).toEqual([1, 3]);
  });

  it('Weiterlesen beginnt bei der ersten offenen Pflichtseite', () => {
    expect(resumePage([page(1, { required: false }), page(2), page(3, { required: false })])).toBe(2);
    expect(resumePage([page(1, { required: false }), page(2, { fulfilled: true })])).toBe(1);
  });
});
