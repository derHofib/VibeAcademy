/** Scopes der API-Schlüssel (E-37). Jeder Scope wird im RLS-Kontext zu einer eigenen Rolle „api_<bereich>_<recht>“. */
export const API_SCOPES = [
  'persons:read',
  'persons:write',
  'trainings:read',
  'runs:read',
  'runs:write',
  'evidence:read',
  'external:read',
  'external:write',
  'compliance:read',
  'webhooks:manage',
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const SCOPE_DESCRIPTIONS: Record<ApiScope, string> = {
  'persons:read': 'Personen und Org-Einheiten lesen',
  'persons:write': 'Personen anlegen und ändern',
  'trainings:read': 'Schulungen und Versionen lesen',
  'runs:read': 'Durchführungen und Einladungen lesen',
  'runs:write': 'Kampagnen anlegen und Personen einladen',
  'evidence:read': 'Nachweise lesen, PDF herunterladen, Prüfcode prüfen',
  'external:read': 'Externe Nachweise lesen',
  'external:write': 'Externe Nachweise erfassen (mit Beleg)',
  'compliance:read': 'Pflichtmatrix, Qualifikationen und Anforderungen lesen',
  'webhooks:manage': 'Webhooks verwalten',
};

export const scopeRole = (s: ApiScope) => `api_${s.replace(':', '_')}`;
