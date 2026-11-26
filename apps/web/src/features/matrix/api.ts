/**
 * Pflichtmatrix (Schritt 2.9): Qualifikationen, Anforderungen, Erfüllungsstand, Ausnahmen, Fristen-Engine,
 * Nachweismappe-Export (apps/api/src/{compliance,deadlines,exports}).
 */
import { ApiError, get } from '@/lib/api';
import type { ComplianceState } from '@/features/external/api';

export interface Qualification {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  person_count: number;
  requirement_count: number;
}

export interface QualificationPerson {
  id: string;
  name: string;
  personalnr: string | null;
  org_unit_name: string | null;
  since: string | null;
}

export interface ComplianceRow {
  personId: string;
  personName: string;
  personalnr?: string | null;
  orgUnitId: string | null;
  orgUnitName: string | null;
  requirementId: string;
  qualificationId: string;
  qualificationName: string;
  trainingId: string;
  trainingTitle: string;
  trainingFormat: string;
  intervalMonths?: number;
  graceDays?: number;
  state: ComplianceState;
  lastCompletedOn?: string | null;
  validUntil: string | null;
  expiresOn: string | null;
  reinviteOn?: string | null;
  source?: string | null;
  sourceId?: string | null;
}

export interface ComplianceSummary {
  total: number;
  gueltig: number;
  laeuft_ab: number;
  abgelaufen: number;
  fehlt: number;
  befreit: number;
  erfuellungsquote: number | null;
}

export interface ComplianceRequirement {
  id: string;
  qualificationName: string;
  trainingTitle: string;
  trainingFormat: string;
  intervalMonths: number;
}

export interface Compliance {
  asOf: string;
  summary: ComplianceSummary;
  requirements: ComplianceRequirement[];
  rows: ComplianceRow[];
}

export interface Exemption {
  id: string;
  person_id: string;
  person_name: string;
  requirement_id: string;
  qualification_name: string;
  training_title: string;
  reason: string;
  valid_until: string | null;
  created_at: string;
}

export interface DashboardCompliance {
  compliance?: {
    erfuellungsquote: number | null;
    gesamt: number;
    erfuellt: number;
    laeuftAb30: number;
    abgelaufen: number;
    fehlt: number;
    befreit: number;
    naechsteWiedereinladung: string | null;
  };
  eskaliert?: number;
  externZuPruefen?: number;
}

export const mk = {
  compliance: ['admin', 'compliance'] as const,
  qualifications: ['admin', 'qualifications'] as const,
  qualificationPersons: (id: string) => ['admin', 'qualifications', id, 'persons'] as const,
  personQualifications: (id: string) => ['admin', 'person-qualifications', id] as const,
  exemptions: ['admin', 'compliance', 'exemptions'] as const,
};

export const fetchCompliance = () => get<Compliance>('/compliance');

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]!) : null;
}

/** POST mit JSON, Antwort als Datei (z. B. Nachweismappe-ZIP) – speichert sie im Browser. */
export async function downloadPost(path: string, json: unknown, fallbackName: string): Promise<{ name: string; headers: Headers }> {
  let token = readCookie('sn_csrf');
  if (!token) token = (await get<{ token: string }>('/auth/csrf')).token;
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-csrf-token': token },
    body: JSON.stringify(json),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(res.status, typeof body?.message === 'string' ? body.message : 'Export fehlgeschlagen. Bitte erneut versuchen.', body);
  }
  const cd = res.headers.get('content-disposition') ?? '';
  const name = /filename="?([^";]+)"?/.exec(cd)?.[1] ?? fallbackName;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { name, headers: res.headers };
}
