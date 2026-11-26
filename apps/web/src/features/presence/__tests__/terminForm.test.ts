import { buildTerminPayload, defaultTerminValues, type TerminFormValues } from '../terminForm';

const base = (): TerminFormValues => ({ ...defaultTerminValues(new Date(2026, 11, 4)), titel: 'Erste-Hilfe-Fortbildung', provider: 'Erste-Hilfe-Ausbildung Muster e. V.' });

describe('Termin anlegen – Anfrage', () => {
  it('externe Live-Schulung mit freiem Titel und Anbieter', () => {
    const r = buildTerminPayload({ ...base(), ort: ' Schulungsraum Lager ', personIds: ['p1'] });
    expect('payload' in r).toBe(true);
    if (!('payload' in r)) return;
    expect(r.payload).toMatchObject({
      typ: 'live_extern',
      titel: 'Erste-Hilfe-Fortbildung',
      provider: 'Erste-Hilfe-Ausbildung Muster e. V.',
      ort: 'Schulungsraum Lager',
      completenessPct: 90,
      allowWalkIn: true,
      sendMail: true,
      personIds: ['p1'],
    });
    expect(new Date(r.payload.startAt).getHours()).toBe(8);
    expect(Date.parse(r.payload.endAt) - Date.parse(r.payload.startAt)).toBe(7.5 * 3600_000);
    expect(r.payload).not.toHaveProperty('trainingId');
  });

  it('Pflichtregeln: Ende nach Beginn, Titel bzw. Schulung', () => {
    expect(buildTerminPayload({ ...base(), end: '07:00' })).toEqual({ errors: { end: 'Das Ende muss nach dem Beginn liegen' } });
    expect(buildTerminPayload({ ...base(), titel: '' })).toMatchObject({ errors: { titel: expect.any(String) } });
    expect(buildTerminPayload({ ...base(), typ: 'termin' })).toMatchObject({ errors: { trainingId: expect.any(String) } });
    expect(buildTerminPayload({ ...base(), date: '' })).toMatchObject({ errors: { date: expect.any(String) } });
    expect(buildTerminPayload({ ...base(), completenessPct: '120' })).toMatchObject({ errors: { completenessPct: '1–100' } });
  });

  it('Präsenztermin mit Schulung: kein Anbieter, Trainer übernommen', () => {
    const r = buildTerminPayload({ ...base(), typ: 'termin', trainingId: 't1', titel: '', trainerPersonId: 'p9' });
    expect(r).toMatchObject({ payload: { typ: 'termin', trainingId: 't1', trainerPersonId: 'p9' } });
    if ('payload' in r) expect(r.payload).not.toHaveProperty('provider');
  });
});
