/** Reine Logik für SSO/SCIM in der Oberfläche (E-36): E-Mail-Domain, Fehlercodes, Rückleitungs-Fragment, Formular. */

export const looksLikeEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());

/** „Max@Firma.de“ → „firma.de“ */
export function emailDomain(email: string | null | undefined): string | null {
  const s = (email ?? '').trim().toLowerCase();
  if (!looksLikeEmail(s)) return null;
  return s.slice(s.lastIndexOf('@') + 1);
}

/** Nur relative, interne Ziele (kein offener Redirect). */
export function safeTarget(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
  return raw;
}

/** Start-URL der Firmenanmeldung (API leitet zum Identitätsanbieter weiter). */
export function ssoStartUrl(p: { email?: string; tenant?: string; weiter?: string | null }): string {
  const q = new URLSearchParams();
  if (p.tenant) q.set('tenant', p.tenant);
  else if (p.email) q.set('email', p.email.trim());
  const next = safeTarget(p.weiter);
  if (next) q.set('weiter', next);
  return `/api/auth/sso/start?${q.toString()}`;
}

export const stepUpStartUrl = (invitationId: string) =>
  `/api/auth/sso/step-up/start?purpose=${encodeURIComponent(`signature:${invitationId}`)}`;

/** Deutsche Texte zu den Fehlercodes der API (`/anmelden/sso?fehler=…`, `#sso-fehler=…`). */
export const SSO_ERRORS: Record<string, string> = {
  unknown_tenant: 'Für diese Organisation ist keine Anmeldung mit Firmenkonto eingerichtet.',
  idp_unreachable: 'Der Anmeldedienst deiner Organisation ist gerade nicht erreichbar. Bitte später erneut versuchen.',
  state_invalid: 'Die Anmeldung ist abgelaufen oder wurde in einem anderen Fenster begonnen. Bitte erneut starten.',
  idp_error: 'Der Anmeldedienst deiner Organisation hat die Anmeldung abgebrochen oder abgelehnt.',
  token_invalid: 'Die Antwort des Anmeldedienstes konnte nicht bestätigt werden. Bitte erneut versuchen oder die IT informieren.',
  email_unverified: 'Dein Firmenkonto liefert keine bestätigte E-Mail-Adresse. Bitte wende dich an deine IT.',
  domain_not_allowed: 'Deine E-Mail-Adresse gehört nicht zu den freigegebenen Domains dieser Organisation.',
  no_account: 'Für dein Firmenkonto gibt es hier noch keinen Zugang. Bitte wende dich an die Administration.',
  no_membership: 'Dein Konto ist für diese Organisation nicht freigeschaltet. Bitte wende dich an die Administration.',
  account_disabled: 'Dieses Konto ist gesperrt.',
  person_left: 'Dein Zugang zu dieser Organisation wurde beendet.',
  login_required: 'Bitte zuerst anmelden.',
  no_identity: 'Dein Konto ist nicht mit einem Firmenkonto dieser Organisation verbunden.',
  subject_mismatch: 'Du hast dich mit einem anderen Firmenkonto angemeldet. Bitte mit deinem eigenen Konto bestätigen.',
  reauth_required: 'Die erneute Anmeldung beim Firmenkonto wurde nicht bestätigt. Bitte erneut versuchen.',
  rate_limited: 'Zu viele Versuche. Bitte später erneut versuchen.',
};

export function ssoErrorMessage(code: string | null | undefined): string {
  return (code && SSO_ERRORS[code]) || 'Die Anmeldung mit dem Firmenkonto ist fehlgeschlagen. Bitte erneut versuchen.';
}

/** Rückleitung vom Step-up: `#sso=<ticket>` oder `#sso-fehler=<code>`. */
export function parseSsoFragment(hash: string): { ticket?: string; error?: string } {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const ticket = p.get('sso');
  const error = p.get('sso-fehler');
  return {
    ...(ticket && /^[\w-]{20,100}$/.test(ticket) ? { ticket } : {}),
    ...(error && /^[a-z_]{1,40}$/.test(error) ? { error } : {}),
  };
}

/** Textfeld „firma.de, Firma-Gruppe.de @werk.de“ → normalisierte, eindeutige Domains. */
export function parseDomains(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
        .filter(Boolean),
    ),
  ];
}

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export interface SsoFormValues {
  enabled: boolean;
  slug: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  hasClientSecret: boolean;
  scopes: string;
  domains: string;
  ssoOnly: boolean;
  emergencyAdminAccountId: string | null;
  jitEnabled: boolean;
  defaultRoles: string[];
}

/** Prüfung vor dem Speichern (die API prüft dasselbe noch einmal). */
export function validateSsoForm(v: SsoFormValues): Record<string, string> {
  const e: Record<string, string> = {};
  const domains = parseDomains(v.domains);
  if (v.issuer.trim()) {
    try {
      const u = new URL(v.issuer.trim());
      if (!/^https?:$/.test(u.protocol)) e.issuer = 'Bitte eine https-Adresse angeben';
    } catch {
      e.issuer = 'Bitte eine gültige Adresse angeben (z. B. https://login.firma.de)';
    }
  }
  if (v.enabled) {
    if (!v.issuer.trim()) e.issuer = 'Bitte den Issuer des Identitätsanbieters angeben';
    if (!v.clientId.trim()) e.clientId = 'Bitte die Client-ID angeben';
    if (!domains.length) e.emailDomains = 'Mindestens eine E-Mail-Domain angeben';
  }
  const bad = domains.filter((d) => !DOMAIN.test(d));
  if (bad.length) e.emailDomains = `Ungültige Domain: ${bad.join(', ')}`;
  if (v.slug.trim() && !/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(v.slug.trim().toLowerCase())) {
    e.slug = 'Nur Kleinbuchstaben, Ziffern und Bindestriche (3–50 Zeichen)';
  }
  if (!v.scopes.split(/\s+/).includes('openid')) e.scopes = 'Der Scope „openid“ ist erforderlich';
  if (v.ssoOnly && !v.enabled) e.ssoOnly = '„Nur SSO“ setzt eine aktive Firmenanmeldung voraus';
  if (!v.defaultRoles.length) e.defaultRoles = 'Mindestens eine Rolle wählen';
  return e;
}

/** Formular → Request-Body für `PUT /tenant/sso`. Leeres Secret = unverändert. */
export function ssoPayload(v: SsoFormValues) {
  return {
    enabled: v.enabled,
    slug: v.slug.trim().toLowerCase() || null,
    issuer: v.issuer.trim(),
    clientId: v.clientId.trim(),
    ...(v.clientSecret ? { clientSecret: v.clientSecret } : {}),
    scopes: v.scopes.trim().split(/\s+/).join(' '),
    emailDomains: parseDomains(v.domains),
    ssoOnly: v.ssoOnly,
    emergencyAdminAccountId: v.ssoOnly ? v.emergencyAdminAccountId : null,
    jitEnabled: v.jitEnabled,
    defaultRoles: v.defaultRoles,
  };
}
