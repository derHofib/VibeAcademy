/** Rollen je Mandant (SPEZIFIKATION Kap. 2). In der Oberfläche heißt „verantwortlich“ + „trainer“ beim Selbstregistrierer „Dozent“. */
export const ROLES = ['admin', 'verantwortlich', 'trainer', 'vorgesetzter', 'teilnehmer', 'auditor'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Mandanten-Admin',
  verantwortlich: 'Schulungsverantwortlicher',
  trainer: 'Trainer / Dozent',
  vorgesetzter: 'Vorgesetzter',
  teilnehmer: 'Teilnehmer',
  auditor: 'Auditor',
};

/** Rollen, die Seiten-Detaildaten (Lesenachweis) sehen dürfen. Vorgesetzte ausdrücklich nicht. */
export const ROLES_WITH_PAGE_DETAILS: readonly Role[] = ['admin', 'verantwortlich', 'auditor'];

/** Rollen, die ein selbst registrierter Dozent für seinen neuen Mandanten erhält (E-07). */
export const SELF_SIGNUP_ROLES: readonly Role[] = ['admin', 'verantwortlich', 'trainer'];
