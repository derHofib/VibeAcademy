import { berlinIso, buildEntries, cleanName, defaultChoices, type ImportRow } from '../backdated';

const rows: ImportRow[] = [
  { index: 0, line: 8, name: 'Dennis Hofmann', email: 'd@x.de', role: 'Organisator', minutes: 60, pct: 100, state: 'vollstaendig', match: null },
  { index: 1, line: 9, name: 'Lea Wagner', email: 'lea@x.de', role: 'Teilnehmer', minutes: 59, pct: 98, state: 'vollstaendig', match: { personId: 'p-lea', personName: 'Lea Wagner', by: 'email' } },
  { index: 2, line: 10, name: 'Anna Schulz', email: 'anna@x.de', role: 'Teilnehmer', minutes: 43, pct: 71, state: 'teilweise', match: { personId: 'p-anna', personName: 'Anna Schulz', by: 'email' } },
  { index: 3, line: 11, name: 'Becker, Jonas (Gast)', email: 'j@sub.de', role: 'Teilnehmer', minutes: 54, pct: 90, state: 'vollstaendig', match: null },
];

describe('Nachträgliche Erfassung – Auswahl', () => {
  it('Vorbelegung: Zugeordnete ja, Organisator und Unbekannte nein', () => {
    const c = defaultChoices(rows);
    expect([0, 1, 2, 3].map((i) => c[i]!.include)).toEqual([false, true, true, false]);
  });

  it('Einträge: Zuordnung, neu anlegen, trotzdem anrechnen, Checkliste ohne Doppelte; fehlende Zuordnung gemeldet', () => {
    const c = defaultChoices(rows);
    c[2] = { ...c[2]!, credit: true };
    c[3] = { include: true, personId: null, createNew: true, credit: false };
    expect(buildEntries(rows, c, ['p-lea', 'p-kai'])).toEqual({
      entries: [
        { index: 1, personId: 'p-lea', credit: false },
        { index: 2, personId: 'p-anna', credit: true },
        { index: 3, newPerson: { name: 'Jonas Becker', email: 'j@sub.de' }, credit: false },
        { personId: 'p-kai', credit: false },
      ],
      missing: [],
    });
    c[0] = { include: true, personId: null, createNew: false, credit: false };
    expect(buildEntries(rows, c, []).missing).toEqual(['Dennis Hofmann']);
  });

  it('Name säubern und Ortszeit mit Offset (Winter/Sommer)', () => {
    expect(cleanName('Becker, Jonas (Gast)')).toBe('Jonas Becker');
    expect(cleanName('Lea  Wagner')).toBe('Lea Wagner');
    expect(berlinIso('2026-11-18', '09:00')).toBe('2026-11-18T09:00:00+01:00');
    expect(berlinIso('2026-07-01', '09:00')).toBe('2026-07-01T09:00:00+02:00');
  });
});
