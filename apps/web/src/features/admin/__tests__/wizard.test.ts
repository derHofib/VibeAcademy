import {
  audiencePreview,
  chapterError,
  defaultConfirmText,
  expandOrgUnits,
  latestVersion,
  maxReachableStep,
  needsPublish,
  parseStep,
  stepBlocker,
  type WizardState,
} from '../wizard';
import { parsePageList } from '../training/DocumentCard';
import { validateRules } from '../training/RulesPanel';
import type { TrainingVersionSummary } from '../api';

const base: WizardState = {
  training: { id: 't1', quizRequired: true },
  version: { status: 'bereit', versionNo: 1, publishedAt: null },
  hasPublished: false,
  activeQuestions: 3,
  changeKind: null,
  selectedPersons: 2,
  selectedOrgUnits: 0,
};

describe('Schritt-Sperren im Assistenten', () => {
  it('ohne gespeicherte Grunddaten nur Schritt 1', () => {
    const s = { ...base, training: null };
    expect(stepBlocker(1, s)).toBeNull();
    expect(stepBlocker(2, s)).toBe('Bitte zuerst die Grunddaten speichern.');
    expect(maxReachableStep(s)).toBe(1);
  });

  it('ohne PDF bzw. während der Analyse bis Schritt 2', () => {
    expect(maxReachableStep({ ...base, version: null })).toBe(2);
    expect(stepBlocker(3, { ...base, version: null })).toBe('Bitte zuerst ein PDF hochladen.');
    expect(stepBlocker(3, { ...base, version: { status: 'analyse', versionNo: 1, publishedAt: null } })).toBe(
      'Die Seitenanalyse läuft noch.',
    );
  });

  it('fehlgeschlagene Analyse sperrt nur, wenn es keine veröffentlichte Version gibt', () => {
    const failed = { ...base, version: { status: 'fehler' as const, versionNo: 2, publishedAt: null } };
    expect(maxReachableStep(failed)).toBe(2);
    expect(maxReachableStep({ ...failed, hasPublished: true })).toBe(4);
  });

  it('Quiz verlangt mindestens eine aktive Frage', () => {
    expect(stepBlocker(3, { ...base, activeQuestions: 0 })).toMatch(/mindestens eine aktive Frage/);
    expect(
      stepBlocker(3, { ...base, activeQuestions: 0, training: { id: 't1', quizRequired: false } }),
    ).toBeNull();
  });

  it('ab Version 2 ist die Art der Änderung Pflicht (nicht bei veröffentlichter Version)', () => {
    const v2 = { ...base, version: { status: 'bereit' as const, versionNo: 2, publishedAt: null } };
    expect(stepBlocker(3, v2)).toMatch(/Art der Änderung/);
    expect(stepBlocker(3, { ...v2, changeKind: 'redaktionell' })).toBeNull();
    expect(
      stepBlocker(3, {
        ...v2,
        version: { ...v2.version, status: 'veroeffentlicht', publishedAt: '2026-11-01' },
      }),
    ).toBeNull();
  });

  it('Schritt 4 braucht eine Zielgruppe', () => {
    expect(stepBlocker(4, { ...base, selectedPersons: 0 })).toMatch(/Person oder Org-Einheit/);
    expect(stepBlocker(4, { ...base, selectedPersons: 0, selectedOrgUnits: 1 })).toBeNull();
    expect(maxReachableStep(base)).toBe(4);
  });

  it('parseStep, latestVersion, needsPublish', () => {
    expect(parseStep('3')).toBe(3);
    expect(parseStep('9')).toBe(1);
    expect(parseStep(null)).toBe(1);
    const v = (n: number) => ({ id: `v${n}`, version_no: n }) as TrainingVersionSummary;
    expect(latestVersion([v(1), v(3), v(2)])?.id).toBe('v3');
    expect(latestVersion([])).toBeNull();
    expect(needsPublish({ status: 'bereit', publishedAt: null })).toBe(true);
    expect(needsPublish({ status: 'veroeffentlicht', publishedAt: '2026-11-01' })).toBe(false);
    expect(needsPublish(null)).toBe(false);
  });
});

describe('Bestätigungstext und Zielgruppe', () => {
  it('Vorschlag wie in Screen 2', () => {
    expect(defaultConfirmText('Sicherheitsunterweisung 2026', 'Dennis Hofmann, 030 1234567', 3)).toBe(
      'Ich habe die Unterweisung „Sicherheitsunterweisung 2026, Version 3“ vollständig gelesen und verstanden. Rückfragen konnte ich an Dennis Hofmann richten.',
    );
    expect(defaultConfirmText('Test', null)).toBe(
      'Ich habe die Unterweisung „Test, Version 1“ vollständig gelesen und verstanden.',
    );
  });

  const units = [
    { id: 'a', parent_id: null },
    { id: 'b', parent_id: 'a' },
    { id: 'c', parent_id: 'b' },
    { id: 'd', parent_id: null },
  ];
  it('Org-Einheiten inkl. Unter-Einheiten', () => {
    expect([...expandOrgUnits(['a'], units)].sort()).toEqual(['a', 'b', 'c']);
    expect([...expandOrgUnits(['d'], units)]).toEqual(['d']);
  });

  it('Vorschau zählt jede Person einmal und lässt Ausgetretene weg', () => {
    const persons = [
      { id: '1', org_unit_id: 'c', email: 'x@y.de', austritt_am: null },
      { id: '2', org_unit_id: 'd', email: null, austritt_am: null },
      { id: '3', org_unit_id: 'b', email: 'z@y.de', austritt_am: '2026-01-01' },
      { id: '4', org_unit_id: null, email: null, austritt_am: null },
    ];
    const r = audiencePreview(persons, units, ['1', '4'], ['a'], '2026-11-26');
    expect(r.total).toBe(2);
    expect(r.withoutEmail).toBe(1);
    expect(r.ids.sort()).toEqual(['1', '4']);
  });
});

describe('Kapitel, geänderte Seiten, Regeln', () => {
  const ch = (title: string, fromPage: number, toPage: number) => ({
    title,
    shortName: title.slice(0, 6),
    fromPage,
    toPage,
  });
  it('Kapitel müssen lückenlos bis zur letzten Seite reichen', () => {
    expect(chapterError([], 10)).toBeNull();
    expect(chapterError([ch('A', 1, 4), ch('B', 5, 10)], 10)).toBeNull();
    expect(chapterError([ch('A', 1, 4), ch('B', 6, 10)], 10)).toMatch(/lückenlos/);
    expect(chapterError([ch('A', 1, 4), ch('B', 5, 9)], 10)).toBe(
      'Das letzte Kapitel muss bis Seite 10 reichen.',
    );
    expect(chapterError([ch('', 1, 10)], 10)).toMatch(/Titel und Kurznamen/);
  });

  it('geänderte Seiten aus Freitext', () => {
    expect(parsePageList('3, 7, 8', 14)).toEqual([3, 7, 8]);
    expect(parsePageList('2-4; 9 20', 14)).toEqual([2, 3, 4, 9]);
    expect(parsePageList('x, 0, 5–3', 14)).toEqual([3, 4, 5]);
  });

  const draft = {
    wordsPerMinute: '200',
    factor: '0,6',
    floorSeconds: '4',
    capSeconds: '90',
    strictMode: true,
    quizRequired: true,
    quizQuestionCount: '10',
    passPct: '80',
    maxAttempts: '3',
    requireStepUp: true,
    allowDownload: false,
    deadlineDays: 14,
    intervalMonths: 12,
  };
  it('Regeln: gültige Werte werden zu Einstellungen', () => {
    const r = validateRules(draft);
    expect(r.errors).toEqual({});
    expect(r.settings).toMatchObject({
      wordsPerMinute: 200,
      factor: 0.6,
      floorSeconds: 4,
      capSeconds: 90,
      quizQuestionCount: 10,
    });
  });
  it('Regeln: Bereichs- und Plausibilitätsfehler', () => {
    expect(validateRules({ ...draft, factor: '1,5' }).errors.factor).toBe('Erlaubt: 0.1–1');
    expect(validateRules({ ...draft, wordsPerMinute: 'schnell' }).errors.wordsPerMinute).toBe(
      'Bitte eine Zahl eingeben',
    );
    expect(validateRules({ ...draft, floorSeconds: '100' }).errors.floorSeconds).toBe(
      'Minimum darf das Maximum nicht übersteigen',
    );
    expect(validateRules({ ...draft, maxAttempts: '2,5' }).errors.maxAttempts).toBe('Erlaubt: 1–10');
    expect(validateRules({ ...draft, factor: '1,5' }).settings).toBeUndefined();
  });
});
