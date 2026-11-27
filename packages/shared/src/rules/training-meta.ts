/** Anlass, Durchführungsart und Plattform einer Schulung (E-51/E-52) – eine Quelle für API, PDF und Oberfläche. */
export const ANLASS_TYPES = ['erst', 'wiederholung', 'anlass', 'sonstige'] as const;
export type AnlassTyp = (typeof ANLASS_TYPES)[number];

export const DELIVERY_TYPES = ['online', 'praesenz', 'live_online', 'extern', 'kombiniert'] as const;
export type DeliveryType = (typeof DELIVERY_TYPES)[number];

export const PLATFORMS = ['teams', 'zoom', 'meet', 'sonstige'] as const;
export type Platform = (typeof PLATFORMS)[number];

type Lang = 'de' | 'en';

export const ANLASS_LABELS: Record<Lang, Record<AnlassTyp, string>> = {
  de: { erst: 'Erstunterweisung', wiederholung: 'Wiederholungsunterweisung', anlass: 'Anlassbezogen', sonstige: 'Sonstige' },
  en: { erst: 'Initial instruction', wiederholung: 'Refresher instruction', anlass: 'Event-related', sonstige: 'Other' },
};

export const DELIVERY_LABELS: Record<Lang, Record<DeliveryType, string>> = {
  de: { online: 'Online-Selbstlernen', praesenz: 'Präsenz', live_online: 'Live-Online', extern: 'Extern', kombiniert: 'Kombiniert' },
  en: { online: 'Online self-study', praesenz: 'In person', live_online: 'Live online', extern: 'External', kombiniert: 'Blended' },
};

export const PLATFORM_LABELS: Record<Platform, string> = {
  teams: 'Microsoft Teams',
  zoom: 'Zoom',
  meet: 'Google Meet',
  sonstige: 'Sonstige Plattform',
};

/** Bisheriges Feld `format` (Fristen-Engine) aus der Durchführungsart ableiten. */
export function formatForDelivery(d: DeliveryType): 'online' | 'praesenz' | 'hybrid' | 'extern' {
  if (d === 'online') return 'online';
  if (d === 'kombiniert') return 'hybrid';
  if (d === 'extern') return 'extern';
  return 'praesenz';
}

/** Zeile „Anlass“ im Nachweis: „Anlassbezogen – Beinahe-Unfall …“ bzw. nur die Art. */
export function anlassLine(typ: string | null | undefined, text: string | null | undefined, lang: Lang = 'de'): string | null {
  if (!typ || !(ANLASS_TYPES as readonly string[]).includes(typ)) return null;
  const label = ANLASS_LABELS[lang][typ as AnlassTyp];
  const t = text?.trim();
  return t ? `${label} – ${t}` : label;
}
