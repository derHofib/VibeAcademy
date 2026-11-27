import type { AnlassTyp, DeliveryType, Platform } from '@sn/shared';
import type { Training, TrainingSettings } from '../api';
import { formatDecimal, parseDecimal } from '../format';
import { ts } from '@/i18n/training-settings';

/** Entwurf der Einstellungsseite (Phase 4.1): Zahlen als Text, damit Eingaben nicht springen. */
export interface SettingsDraft {
  titel: string;
  kategorie: string;
  rechtsgrundlage: string;
  ansprechpartner: string;
  defaultOrgUnits: string[];
  anlassTyp: AnlassTyp;
  anlassText: string;
  defaultDelivery: DeliveryType;
  defaultPlatform: Platform | '';
  defaultMeetingUrl: string;
  completenessPct: string;
  wordsPerMinute: string;
  factor: string;
  floorSeconds: string;
  capSeconds: string;
  strictMode: boolean;
  allowDownload: boolean;
  quizRequired: boolean;
  quizQuestionCount: string;
  passPct: string;
  maxAttempts: string;
  quizOnReinvite: boolean;
  confirmText: string;
  signatureLevel: 'ees' | 'fes' | 'qes';
  requireStepUp: boolean;
  countersignRequired: boolean;
  deadlineDays: number;
  intervalMonths: number;
  reminderDaysBefore: number[];
  reminderDaysAfter: number;
}

export type DraftErrors = Partial<Record<keyof SettingsDraft, string>>;

export function toSettingsDraft(t: Training): SettingsDraft {
  const s = t.settings;
  return {
    titel: t.titel,
    kategorie: t.kategorie ?? '',
    rechtsgrundlage: t.rechtsgrundlage ?? '',
    ansprechpartner: t.ansprechpartner ?? '',
    defaultOrgUnits: t.defaultOrgUnits ?? [],
    anlassTyp: t.anlassTyp ?? 'erst',
    anlassText: t.anlassText ?? '',
    defaultDelivery: t.defaultDelivery ?? 'online',
    defaultPlatform: t.defaultPlatform ?? '',
    defaultMeetingUrl: t.defaultMeetingUrl ?? '',
    completenessPct: String(s.completenessPct),
    wordsPerMinute: String(s.wordsPerMinute),
    factor: formatDecimal(s.factor),
    floorSeconds: String(s.floorSeconds),
    capSeconds: String(s.capSeconds),
    strictMode: s.strictMode,
    allowDownload: s.allowDownload,
    quizRequired: t.quizRequired,
    quizQuestionCount: String(s.quizQuestionCount),
    passPct: String(s.passPct),
    maxAttempts: String(s.maxAttempts),
    quizOnReinvite: s.quizOnReinvite ?? true,
    confirmText: t.confirmText,
    signatureLevel: s.signatureLevel ?? 'ees',
    requireStepUp: s.requireStepUp,
    countersignRequired: s.countersignRequired ?? true,
    deadlineDays: s.deadlineDays,
    intervalMonths: s.intervalMonths,
    reminderDaysBefore: s.reminderDaysBefore ?? [7, 2],
    reminderDaysAfter: s.reminderDaysAfter ?? 1,
  };
}

const NUMERIC: Array<{ key: keyof SettingsDraft; min: number; max: number; decimal?: boolean }> = [
  { key: 'completenessPct', min: 1, max: 100 },
  { key: 'wordsPerMinute', min: 50, max: 600 },
  { key: 'factor', min: 0.1, max: 1, decimal: true },
  { key: 'floorSeconds', min: 1, max: 600 },
  { key: 'capSeconds', min: 1, max: 1800 },
  { key: 'quizQuestionCount', min: 1, max: 50 },
  { key: 'passPct', min: 1, max: 100 },
  { key: 'maxAttempts', min: 1, max: 10 },
];

export interface ValidDraft {
  training: Record<string, unknown>;
  settings: Partial<TrainingSettings>;
}

/** Prüft den Entwurf wie die API; liefert die beiden PATCH-Körper oder Feldfehler. */
export function validateSettingsDraft(d: SettingsDraft): { errors: DraftErrors; value?: ValidDraft } {
  const errors: DraftErrors = {};
  if (d.titel.trim().length < 2) errors.titel = ts.required;
  if (d.anlassTyp === 'anlass' && d.anlassText.trim().length < 3) errors.anlassText = ts.anlass.textRequired;
  const url = d.defaultMeetingUrl.trim();
  if (url && !url.startsWith('https://')) errors.defaultMeetingUrl = ts.delivery.httpsOnly;
  const nums: Record<string, number> = {};
  for (const f of NUMERIC) {
    const n = parseDecimal(String(d[f.key]));
    if (Number.isNaN(n) || n < f.min || n > f.max || (!f.decimal && !Number.isInteger(n))) errors[f.key] = ts.range(f.min, f.max);
    else nums[f.key] = n;
  }
  if (!errors.floorSeconds && !errors.capSeconds && nums.floorSeconds! > nums.capSeconds!) errors.floorSeconds = ts.range(1, nums.capSeconds!);
  if (Object.keys(errors).length) return { errors };
  const live = d.defaultDelivery === 'live_online';
  return {
    errors,
    value: {
      training: {
        titel: d.titel.trim(),
        kategorie: d.kategorie.trim() || null,
        rechtsgrundlage: d.rechtsgrundlage.trim() || null,
        ansprechpartner: d.ansprechpartner.trim() || null,
        defaultOrgUnits: d.defaultOrgUnits,
        anlassTyp: d.anlassTyp,
        anlassText: d.anlassText.trim() || null,
        defaultDelivery: d.defaultDelivery,
        defaultPlatform: live && d.defaultPlatform ? d.defaultPlatform : null,
        defaultMeetingUrl: live && url ? url : null,
        quizRequired: d.quizRequired,
        confirmText: d.confirmText.trim(),
      },
      settings: {
        completenessPct: nums.completenessPct!,
        wordsPerMinute: nums.wordsPerMinute!,
        factor: nums.factor!,
        floorSeconds: nums.floorSeconds!,
        capSeconds: nums.capSeconds!,
        strictMode: d.strictMode,
        allowDownload: d.allowDownload,
        quizQuestionCount: nums.quizQuestionCount!,
        passPct: nums.passPct!,
        maxAttempts: nums.maxAttempts!,
        quizOnReinvite: d.quizOnReinvite,
        signatureLevel: d.signatureLevel,
        requireStepUp: d.requireStepUp,
        countersignRequired: d.countersignRequired,
        deadlineDays: d.deadlineDays,
        intervalMonths: d.intervalMonths,
        reminderDaysBefore: [...d.reminderDaysBefore].sort((a, b) => b - a),
        reminderDaysAfter: d.reminderDaysAfter,
      },
    },
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Nur die geänderten Felder senden (das Protokoll zeigt sonst Scheinänderungen nicht, aber der Verlauf bleibt schlank). */
export function changedOnly(t: Training, v: ValidDraft): ValidDraft {
  const current: Record<string, unknown> = {
    titel: t.titel, kategorie: t.kategorie, rechtsgrundlage: t.rechtsgrundlage, ansprechpartner: t.ansprechpartner,
    defaultOrgUnits: t.defaultOrgUnits ?? [], anlassTyp: t.anlassTyp ?? 'erst', anlassText: t.anlassText ?? null,
    defaultDelivery: t.defaultDelivery ?? 'online', defaultPlatform: t.defaultPlatform ?? null, defaultMeetingUrl: t.defaultMeetingUrl ?? null,
    quizRequired: t.quizRequired, confirmText: t.confirmText,
  };
  const training = Object.fromEntries(Object.entries(v.training).filter(([k, val]) => !same(current[k], val)));
  const s = t.settings as unknown as Record<string, unknown>;
  const settings = Object.fromEntries(Object.entries(v.settings).filter(([k, val]) => !same(s[k], val)));
  return { training, settings };
}

/** Erinnerungsstufen zum Auswählen. */
export const REMINDER_BEFORE_OPTIONS = [14, 7, 3, 2, 1];
export const REMINDER_AFTER_OPTIONS = [0, 1, 3, 7];
