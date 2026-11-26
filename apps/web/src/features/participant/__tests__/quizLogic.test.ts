import { firstOpenQuestion, neededCorrect, optionState, quizRingState } from '../quizLogic';
import { chapterLabel, contactLine, nextMobileZoom, parseContact, clampZoom, resumePage } from '../viewerModel';

describe('optionState', () => {
  it('vor der Antwort neutral, gewählte Option während der Auswertung „selected“', () => {
    expect([0, 1, 2].map((i) => optionState(i, undefined))).toEqual(['idle', 'idle', 'idle']);
    expect([0, 1, 2].map((i) => optionState(i, undefined, 1))).toEqual(['idle', 'selected', 'idle']);
  });

  it('richtig gewählt: richtige grün, Rest gedimmt', () => {
    const a = { option: 1, correct: 1, isCorrect: true, explanation: null };
    expect([0, 1, 2].map((i) => optionState(i, a))).toEqual(['dimmed', 'correct', 'dimmed']);
  });

  it('falsch gewählt: gewählte gelb (✕), richtige grün (✓), Rest gedimmt', () => {
    const a = { option: 0, correct: 2, isCorrect: false, explanation: 'Eigenschutz zuerst' };
    expect([0, 1, 2].map((i) => optionState(i, a))).toEqual(['wrong', 'dimmed', 'correct']);
    // nach der Auswertung spielt „pending“ keine Rolle mehr
    expect(optionState(1, a, 1)).toBe('dimmed');
  });
});

describe('firstOpenQuestion', () => {
  const ans = { option: 0, correct: 0, isCorrect: true, explanation: null };
  it('erste unbeantwortete Frage', () => {
    expect(firstOpenQuestion([{ answer: ans }, {}, {}])).toBe(1);
    expect(firstOpenQuestion([{}, {}])).toBe(0);
  });
  it('alle beantwortet → letzte Frage (zum Auswerten)', () => {
    expect(firstOpenQuestion([{ answer: ans }, { answer: ans }])).toBe(1);
    expect(firstOpenQuestion([])).toBe(0);
  });
});

describe('quizRingState / neededCorrect', () => {
  it('„?“ bis zur Antwort, dann Pfeil', () => {
    expect(quizRingState(false)).toBe('quiz');
    expect(quizRingState(true)).toBe('ready');
  });
  it('Bestehensgrenze in richtigen Antworten', () => {
    expect(neededCorrect(80, 10)).toBe(8);
    expect(neededCorrect(80, 3)).toBe(3);
    expect(neededCorrect(50, 2)).toBe(1);
    expect(neededCorrect(70, 10)).toBe(7);
  });
});

describe('viewerModel', () => {
  it('Kapitelname ohne Nummer, Kurzname mit Fallback', () => {
    expect(chapterLabel({ idx: 1, title: '2 Elektrische Gefährdungen', short_name: 'Strom', from_page: 4, to_page: 7 })).toEqual({
      no: 2,
      title: 'Elektrische Gefährdungen',
      short: 'Strom',
    });
    expect(chapterLabel({ idx: 0, title: '1.2 Grundlagen', short_name: null, from_page: 1, to_page: 3 }).short).toBe('Grundlagen');
  });

  it('Ansprechpartner aus Freitext', () => {
    const c = parseContact('Dennis Hofmann, Telefon 030 1234567, dennis.hofmann@example.org')!;
    expect(c).toMatchObject({ name: 'Dennis Hofmann', initials: 'DH', phone: '030 1234567', email: 'dennis.hofmann@example.org' });
    expect(contactLine(c)).toBe('Dennis Hofmann · 030 1234567');
    expect(parseContact('  ')).toBeNull();
    expect(parseContact('Frau Müller')).toMatchObject({ name: 'Frau Müller', phone: null, email: null });
  });

  it('Zoom: mobil 100 → 115 → 130 → 100, Desktop 90–130 %', () => {
    expect(nextMobileZoom(1)).toBe(1.15);
    expect(nextMobileZoom(1.15)).toBe(1.3);
    expect(nextMobileZoom(1.3)).toBe(1);
    expect(nextMobileZoom(0.9)).toBe(1);
    expect(clampZoom(1.5)).toBe(1.3);
    expect(clampZoom(0.5)).toBe(0.9);
  });

  it('Weiterlesen bei der ersten offenen, erlaubten Seite', () => {
    const p = (pageNo: number, fulfilled: boolean, allowed: boolean) => ({ pageNo, fulfilled, allowed, tMinMs: 4000, dwellMs: 0 });
    expect(resumePage([p(1, true, true), p(2, false, true), p(3, false, false)])).toBe(2);
    expect(resumePage([p(1, true, true), p(2, true, true)])).toBe(2);
  });
});
