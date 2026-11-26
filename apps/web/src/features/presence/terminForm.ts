/** Formular „Termin anlegen“ → Anfrage für POST /api/runs/termin (getestet in __tests__/terminForm.test.ts). */
import { tl } from '@/i18n/live';
import type { RunTyp } from '@/features/live/api';
import { localDateTimeIso } from '@/features/live/time';

export interface TerminFormValues {
  typ: RunTyp;
  trainingId: string;
  titel: string;
  provider: string;
  date: string;
  start: string;
  end: string;
  ort: string;
  trainerPersonId: string;
  completenessPct: string;
  allowWalkIn: boolean;
  sendMail: boolean;
  personIds: string[];
  orgUnitIds: string[];
}

export interface TerminPayload {
  typ: RunTyp;
  trainingId?: string;
  titel?: string;
  provider?: string;
  startAt: string;
  endAt: string;
  ort?: string;
  trainerPersonId?: string;
  completenessPct?: number;
  allowWalkIn: boolean;
  personIds: string[];
  orgUnitIds: string[];
  sendMail: boolean;
}

export function defaultTerminValues(now = new Date()): TerminFormValues {
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return {
    typ: 'live_extern',
    trainingId: '',
    titel: '',
    provider: '',
    date,
    start: '08:00',
    end: '15:30',
    ort: '',
    trainerPersonId: '',
    completenessPct: '90',
    allowWalkIn: true,
    sendMail: true,
    personIds: [],
    orgUnitIds: [],
  };
}

export type TerminErrors = Partial<Record<'trainingId' | 'titel' | 'date' | 'end' | 'completenessPct', string>>;

/** Prüft die Eingaben und baut die Anfrage; bei Fehlern `{ errors }`. */
export function buildTerminPayload(v: TerminFormValues): { payload: TerminPayload } | { errors: TerminErrors } {
  const f = tl.form;
  const errors: TerminErrors = {};
  const startAt = localDateTimeIso(v.date, v.start);
  const endAt = localDateTimeIso(v.date, v.end);
  if (!startAt || !endAt) errors.date = f.errDate;
  else if (Date.parse(endAt) <= Date.parse(startAt)) errors.end = f.errEnd;
  if (v.typ === 'termin' && !v.trainingId) errors.trainingId = f.errTraining;
  if (v.typ === 'live_extern' && !v.trainingId && v.titel.trim().length < 2) errors.titel = f.errTitle;
  const pct = Number(v.completenessPct);
  if (v.completenessPct.trim() && (!Number.isInteger(pct) || pct < 1 || pct > 100)) errors.completenessPct = '1–100';
  if (Object.keys(errors).length) return { errors };
  return {
    payload: {
      typ: v.typ,
      ...(v.trainingId ? { trainingId: v.trainingId } : {}),
      ...(v.titel.trim() ? { titel: v.titel.trim() } : {}),
      ...(v.typ === 'live_extern' && v.provider.trim() ? { provider: v.provider.trim() } : {}),
      startAt: startAt!,
      endAt: endAt!,
      ...(v.ort.trim() ? { ort: v.ort.trim() } : {}),
      ...(v.trainerPersonId ? { trainerPersonId: v.trainerPersonId } : {}),
      ...(v.completenessPct.trim() ? { completenessPct: pct } : {}),
      allowWalkIn: v.allowWalkIn,
      personIds: v.personIds,
      orgUnitIds: v.orgUnitIds,
      sendMail: v.sendMail,
    },
  };
}
