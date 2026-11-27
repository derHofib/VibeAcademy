import { changedOnly, toSettingsDraft, validateSettingsDraft } from '../training/settingsDraft';
import type { Training } from '../api';

const training: Training = {
  id: 't1',
  titel: 'Die fünf Sicherheitsregeln',
  kategorie: 'Arbeitsschutz',
  rechtsgrundlage: 'DGUV Vorschrift 1',
  format: 'online',
  quizRequired: true,
  confirmText: 'Ich habe verstanden.',
  ansprechpartner: 'Dennis Hofmann',
  anlassTyp: 'erst',
  anlassText: null,
  defaultDelivery: 'online',
  defaultPlatform: null,
  defaultMeetingUrl: null,
  defaultOrgUnits: [],
  settings: {
    wordsPerMinute: 200, factor: 0.6, floorSeconds: 4, capSeconds: 90, strictMode: true, passPct: 80, maxAttempts: 3,
    quizQuestionCount: 10, requireStepUp: true, allowDownload: false, deadlineDays: 14, intervalMonths: 12, completenessPct: 90,
    quizOnReinvite: true, signatureLevel: 'ees', countersignRequired: true, reminderDaysBefore: [7, 2], reminderDaysAfter: 1,
  },
  versions: [],
};

describe('Einstellungsseite – Entwurf', () => {
  it('übernimmt Server-Werte; unverändert → keine Änderung', () => {
    const d = toSettingsDraft(training);
    expect(d).toMatchObject({ anlassTyp: 'erst', defaultDelivery: 'online', factor: '0,6', reminderDaysBefore: [7, 2] });
    const v = validateSettingsDraft(d);
    expect(v.errors).toEqual({});
    expect(changedOnly(training, v.value!)).toEqual({ training: {}, settings: {} });
  });

  it('Anlassbezogen braucht Text; Meeting-Link nur https; Zahlenbereiche', () => {
    const d = { ...toSettingsDraft(training), anlassTyp: 'anlass' as const, anlassText: ' ', defaultMeetingUrl: 'http://zoom.us/j/1', passPct: '120', floorSeconds: '100' };
    expect(validateSettingsDraft(d).errors).toEqual({
      anlassText: 'Bitte den Anlass bzw. das Ereignis beschreiben',
      defaultMeetingUrl: 'Bitte einen Link mit https:// angeben',
      passPct: 'Bitte eine Zahl von 1 bis 100',
      floorSeconds: 'Bitte eine Zahl von 1 bis 90',
    });
  });

  it('sendet nur Geändertes; Plattform/Link nur bei Live-Online', () => {
    const d = {
      ...toSettingsDraft(training),
      anlassTyp: 'anlass' as const,
      anlassText: 'Beinahe-Unfall in Halle 3',
      defaultDelivery: 'live_online' as const,
      defaultPlatform: 'teams' as const,
      defaultMeetingUrl: 'https://teams.microsoft.com/l/x',
      passPct: '90',
      reminderDaysBefore: [3, 14],
      reminderDaysAfter: 0,
    };
    const out = changedOnly(training, validateSettingsDraft(d).value!);
    expect(out.training).toEqual({
      anlassTyp: 'anlass', anlassText: 'Beinahe-Unfall in Halle 3', defaultDelivery: 'live_online',
      defaultPlatform: 'teams', defaultMeetingUrl: 'https://teams.microsoft.com/l/x',
    });
    expect(out.settings).toEqual({ passPct: 90, reminderDaysBefore: [14, 3], reminderDaysAfter: 0 });
    // zurück auf Online: Plattform und Link werden geleert
    const back = changedOnly({ ...training, defaultDelivery: 'live_online', defaultPlatform: 'teams' }, validateSettingsDraft({ ...toSettingsDraft(training), defaultPlatform: 'teams' }).value!);
    expect(back.training).toEqual({ defaultDelivery: 'online', defaultPlatform: null });
  });
});
