import { barPct, kpiChips, methodShort, needsRelease, poolState, sortQuestions, statusTone } from '../organizer/model';
import type { AttendanceKpis, AttendanceRow, PollResult, PoolQuestion } from '../api';

const kpis: AttendanceKpis = { invited: 9, present: 5, participated: 8, checkedOutQr: 2, manual: 1, notesToReview: 1, missing: 1, confirmationsOpen: 7, confirmed: 0 };

describe('Organisator-Ableitungen', () => {
  it('Zähler-Chips laufend (12a) und beendet (12d)', () => {
    expect(kpiChips(kpis, false).map((c) => c.label)).toEqual(['5 anwesend', '2 per Ende-QR aus', '1 manuell mit Vermerk', '1 fehlt']);
    expect(kpiChips(kpis, true).map((c) => c.label)).toEqual(['8 teilgenommen', '7 Bestätigungen offen', '1 Vermerk', '1 fehlt']);
    expect(kpiChips({ ...kpis, confirmed: 2 }, true).map((c) => c.label)).toContain('2 bestätigt');
  });

  it('Status-Farben und Methoden-Kurzlabel', () => {
    expect(statusTone('anwesend')).toBe('success');
    expect(statusTone('vermerk_pruefen')).toBe('warn');
    expect(statusTone('bestaetigung_offen')).toBe('info');
    expect(statusTone('nicht_eingecheckt')).toBe('neutral');
    expect(methodShort('qr_start')).toBe('QR');
    expect(methodShort('kiosk')).toBe('Tablet');
    expect(methodShort('official_end')).toBe('offizielles Ende');
    expect(methodShort(null)).toBe('');
  });

  it('Freigabe nur bei „teilweise“, ausgecheckt, ohne offenen Vermerk', () => {
    const row = {
      attendanceId: 'a',
      intervals: [{ in: '', out: '', inMethod: 'qr_start', outMethod: 'manual', inOffline: false, outOffline: false }],
      checkedIn: false,
      belowThreshold: true,
      release: null,
      noteReview: null,
    } as unknown as AttendanceRow;
    expect(needsRelease(row)).toBe(true);
    expect(needsRelease({ ...row, noteReview: 'offen' })).toBe(false);
    expect(needsRelease({ ...row, noteReview: 'akzeptiert' })).toBe(true);
    expect(needsRelease({ ...row, release: 'freigegeben' })).toBe(false);
    expect(needsRelease({ ...row, checkedIn: true })).toBe(false);
    expect(needsRelease({ ...row, belowThreshold: false })).toBe(false);
  });

  it('Fragen: offene zuerst, dann nach Stimmen', () => {
    const q = (id: string, status: 'offen' | 'beantwortet', votes: number, createdAt = '2026-12-04T10:00:00Z') => ({ id, status, votes, createdAt });
    expect(sortQuestions([q('a', 'beantwortet', 9), q('b', 'offen', 1), q('c', 'offen', 5), q('d', 'offen', 5, '2026-12-04T09:00:00Z')]).map((x) => x.id)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('Fragenpool: läuft / ausgewertet / bereit', () => {
    const p = { id: 'q1' } as PoolQuestion;
    const poll = (open: boolean) => ({ sourceQuestionId: 'q1', open }) as PollResult;
    expect(poolState(p, []).state).toBe('ready');
    expect(poolState(p, [poll(true)]).state).toBe('running');
    expect(poolState(p, [poll(false)]).state).toBe('done');
    expect(barPct(4, 5)).toBe(80);
    expect(barPct(0, 0)).toBe(0);
  });
});
