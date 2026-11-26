import { buildGrid, cellChip, defaultExportRange } from '../model';
import type { ComplianceRequirement, ComplianceRow } from '../api';

const reqs: ComplianceRequirement[] = [
  { id: 'r1', qualificationName: 'Ersthelfer', trainingTitle: 'Erste-Hilfe-Fortbildung', trainingFormat: 'extern', intervalMonths: 24 },
  { id: 'r2', qualificationName: 'Staplerfahrer', trainingTitle: 'Unterweisung Flurförderzeuge', trainingFormat: 'online', intervalMonths: 12 },
  { id: 'r3', qualificationName: 'Elektrofachkraft', trainingTitle: 'EFK-Unterweisung', trainingFormat: 'online', intervalMonths: 12 },
];

const row = (personId: string, personName: string, requirementId: string, state: ComplianceRow['state'], validUntil: string | null = null): ComplianceRow => {
  const r = reqs.find((x) => x.id === requirementId)!;
  return {
    personId,
    personName,
    orgUnitId: null,
    orgUnitName: 'Lager',
    requirementId,
    qualificationId: `q-${requirementId}`,
    qualificationName: r.qualificationName,
    trainingId: `t-${requirementId}`,
    trainingTitle: r.trainingTitle,
    trainingFormat: r.trainingFormat,
    state,
    validUntil,
    expiresOn: validUntil,
  };
};

const rows: ComplianceRow[] = [
  row('a', 'Anna Schulz', 'r1', 'abgelaufen', '2026-10-01'),
  row('a', 'Anna Schulz', 'r2', 'gueltig', '2027-04-01'),
  row('t', 'Tobias Meier', 'r1', 'laeuft_ab', '2026-12-15'),
  row('j', 'Julia Becker', 'r1', 'fehlt'),
  row('l', 'Lea Wagner', 'r1', 'gueltig', '2028-11-20'),
  row('o', 'Özlem Yıldız', 'r2', 'befreit'),
];

describe('Pflichtmatrix-Raster', () => {
  it('baut Spalten nur für vorkommende Anforderungen und sortiert Personen nach Name', () => {
    const g = buildGrid(rows, reqs, { search: '', state: '', qualificationId: '' });
    expect(g.columns.map((c) => c.id)).toEqual(['r1', 'r2']);
    expect(g.persons.map((p) => p.name)).toEqual(['Anna Schulz', 'Julia Becker', 'Lea Wagner', 'Özlem Yıldız', 'Tobias Meier']);
    expect(g.total).toBe(5);
    const anna = g.persons[0]!;
    expect(Object.keys(anna.cells)).toEqual(['r1', 'r2']);
    expect(anna.worst).toBe('abgelaufen');
    expect(g.persons.find((p) => p.personId === 'o')!.worst).toBe('befreit');
  });

  it('filtert nach Status (Person mit mindestens einer Zelle in diesem Status)', () => {
    expect(buildGrid(rows, reqs, { search: '', state: 'gueltig', qualificationId: '' }).persons.map((p) => p.personId)).toEqual(['a', 'l']);
    expect(buildGrid(rows, reqs, { search: '', state: 'fehlt', qualificationId: '' }).persons.map((p) => p.personId)).toEqual(['j']);
  });

  it('filtert nach Qualifikation (Spalten und Personen)', () => {
    const g = buildGrid(rows, reqs, { search: '', state: '', qualificationId: 'q-r2' });
    expect(g.columns.map((c) => c.id)).toEqual(['r2']);
    expect(g.persons.map((p) => p.personId)).toEqual(['a', 'o']);
    expect(g.total).toBe(5);
  });

  it('sucht akzent-unempfindlich nach Namen', () => {
    expect(buildGrid(rows, reqs, { search: 'ozlem', state: '', qualificationId: '' }).persons.map((p) => p.personId)).toEqual(['o']);
    expect(buildGrid(rows, reqs, { search: 'SCHULZ', state: '', qualificationId: '' }).persons).toHaveLength(1);
  });

  it('Zellen-Chips', () => {
    expect(cellChip({ state: 'gueltig', validUntil: '2028-11-20' })).toEqual({ label: 'bis 11/28', tone: 'success' });
    expect(cellChip({ state: 'laeuft_ab', validUntil: '2026-12-15' })).toEqual({ label: 'läuft ab 12/26', tone: 'warn' });
    expect(cellChip({ state: 'abgelaufen', validUntil: '2026-10-01' })).toEqual({ label: 'abgelaufen', tone: 'danger' });
    expect(cellChip({ state: 'fehlt', validUntil: null })).toEqual({ label: 'fehlt', tone: 'danger' });
    expect(cellChip({ state: 'befreit', validUntil: null })).toEqual({ label: 'befreit', tone: 'neutral' });
  });

  it('Standard-Zeitraum der Nachweismappe', () => {
    expect(defaultExportRange('2026-11-26')).toEqual({ from: '2026-01-01', to: '2026-11-26' });
  });
});
