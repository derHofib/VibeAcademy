/**
 * Testdaten für die Präsenz-/Live-E2E-Tests: fester E2E-Organisator (eigener Mandant), Personen mit eindeutigen
 * E-Mail-Adressen je Lauf, eine Schulung „Erste Hilfe“ mit Fragenpool. Termine legt der Test selbst an.
 */
import { randomUUID } from 'node:crypto';
import type { BrowserContext } from '@playwright/test';
import { ApiClient } from './admin-seed';

export { API } from './admin-seed';

export const E2E_ORGANIZER = {
  name: 'Dennis Hofmann',
  organisation: 'E2E Live-Schulungen',
  email: process.env.E2E_LIVE_EMAIL ?? 'e2e-live-organisator@example.org',
  password: process.env.E2E_LIVE_PASSWORT ?? 'e2e-passwort-live-1',
};

export interface LiveSeed {
  api: ApiClient;
  suffix: string;
  trainingId: string;
  trainingTitle: string;
  persons: Record<'anna' | 'kai' | 'sven' | 'jonas', { id: string; name: string; email: string }>;
}

const PEOPLE = [
  ['anna', 'Anna Schulz'],
  ['kai', 'Kai Neumann'],
  ['sven', 'Sven Albrecht'],
  ['jonas', 'Jonas Krüger'],
] as const;

export async function seedLive(): Promise<LiveSeed> {
  const api = new ApiClient();
  const suffix = randomUUID().slice(0, 8);
  await api.call('GET', '/auth/csrf');
  try {
    await api.call('POST', '/auth/login', { email: E2E_ORGANIZER.email, password: E2E_ORGANIZER.password });
  } catch {
    await api.call('POST', '/auth/register', E2E_ORGANIZER);
  }
  const persons = {} as LiveSeed['persons'];
  for (const [key, name] of PEOPLE) {
    const email = `live-${key}-${suffix}@example.org`;
    const p = await api.call<{ id: string }>('POST', '/persons', { name, email, personalnr: `L-${suffix}-${key}` });
    persons[key] = { id: p.id, name, email };
  }
  const trainingTitle = 'Erste Hilfe';
  const t = await api.call<{ id: string }>('POST', '/trainings', {
    titel: trainingTitle,
    kategorie: 'Pflichtunterweisung',
    rechtsgrundlage: 'DGUV Vorschrift 1 § 26',
    ansprechpartner: 'Dennis Hofmann',
    confirmText: 'Ich habe an der Erste-Hilfe-Schulung teilgenommen.',
  });
  const qs: Array<[string, string[], number, string]> = [
    ['Was tust du bei einem Stromunfall zuerst?', ['Sofort mit der Herzdruckmassage beginnen', 'Den Stromkreis unterbrechen', 'Die Person vom Gerät wegziehen'], 1, 'Eigenschutz zuerst – sonst wirst du selbst durchströmt.'],
    ['Wie viele Herzdruckmassagen kommen auf zwei Beatmungen?', ['15', '30', '50'], 1, '30 : 2 ist der Standard für Erwachsene.'],
    ['Welche Notrufnummer gilt europaweit?', ['110', '112', '116 117'], 1, 'Die 112 erreicht in ganz Europa die Rettungsleitstelle.'],
  ];
  for (const [text, options, correct, explanation] of qs) {
    await api.call('POST', `/trainings/${t.id}/questions`, { text, options, correct, explanation });
  }
  return { api, suffix, trainingId: t.id, trainingTitle, persons };
}

/** Sitzung des API-Clients in einen Browser-Kontext übernehmen (Organisator ohne UI-Anmeldung). */
export async function shareSession(api: ApiClient, ctx: BrowserContext, baseURL: string) {
  const cookies = api.cookie
    .split('; ')
    .filter(Boolean)
    .map((kv) => {
      const i = kv.indexOf('=');
      return { name: kv.slice(0, i), value: kv.slice(i + 1), url: baseURL };
    });
  await ctx.addCookies(cookies);
}

/** Persönlicher Link (Token) zu einer Einladung. */
export async function inviteToken(api: ApiClient, invitationId: string): Promise<string> {
  const { link } = await api.call<{ link: string }>('POST', `/invitations/${invitationId}/link`);
  const token = /\/s\/([^/?#]+)/.exec(link)?.[1];
  if (!token) throw new Error(`Kein Token im Link: ${link}`);
  return token;
}

/** „HH:MM“ in Europe/Berlin, um `minutes` verschoben. */
export function berlinTime(minutes: number, base = Date.now()): { date: string; time: string } {
  const d = new Date(base + minutes * 60_000);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const p = (t: string) => parts.find((x) => x.type === t)!.value;
  return { date: `${p('year')}-${p('month')}-${p('day')}`, time: `${p('hour') === '24' ? '00' : p('hour')}:${p('minute')}` };
}
