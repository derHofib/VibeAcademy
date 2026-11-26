/** Reine Logik der Seite „Schnittstellen“ (API-Schlüssel, Webhooks) – ohne React, getestet mit vitest. */

export type ScopeId =
  | 'persons:read'
  | 'persons:write'
  | 'trainings:read'
  | 'runs:read'
  | 'runs:write'
  | 'evidence:read'
  | 'external:read'
  | 'external:write'
  | 'compliance:read'
  | 'webhooks:manage';

/** Bereich → Lesen/Schreiben, für die Checkliste in Gruppen. */
export const SCOPE_GROUPS: Array<{ label: string; scopes: Array<{ id: ScopeId; label: string }> }> = [
  { label: 'Personen & Org-Einheiten', scopes: [{ id: 'persons:read', label: 'lesen' }, { id: 'persons:write', label: 'anlegen und ändern' }] },
  { label: 'Schulungen', scopes: [{ id: 'trainings:read', label: 'lesen (mit Versionen)' }] },
  { label: 'Durchführungen & Einladungen', scopes: [{ id: 'runs:read', label: 'lesen' }, { id: 'runs:write', label: 'Kampagnen anlegen, einladen' }] },
  { label: 'Nachweise', scopes: [{ id: 'evidence:read', label: 'lesen, PDF laden, Prüfcode prüfen' }] },
  { label: 'Externe Nachweise', scopes: [{ id: 'external:read', label: 'lesen' }, { id: 'external:write', label: 'erfassen (mit Beleg)' }] },
  { label: 'Pflichtmatrix', scopes: [{ id: 'compliance:read', label: 'Stand, Qualifikationen, Anforderungen lesen' }] },
  { label: 'Webhooks', scopes: [{ id: 'webhooks:manage', label: 'verwalten' }] },
];

const SCOPE_LABEL: Record<string, string> = Object.fromEntries(
  SCOPE_GROUPS.flatMap((g) => g.scopes.map((s) => [s.id, `${g.label}: ${s.label}`])),
);
export const scopeLabel = (id: string) => SCOPE_LABEL[id] ?? id;

/** Kurzform für Chips, z. B. „Personen lesen“. */
export function scopeShort(id: string): string {
  const [area, right] = id.split(':');
  const a: Record<string, string> = {
    persons: 'Personen', trainings: 'Schulungen', runs: 'Einladungen', evidence: 'Nachweise', external: 'Extern', compliance: 'Pflichtmatrix', webhooks: 'Webhooks',
  };
  const r: Record<string, string> = { read: 'lesen', write: 'schreiben', manage: 'verwalten' };
  return a[area ?? ''] && r[right ?? ''] ? `${a[area!]} ${r[right!]}` : id;
}

export function toggle<T>(list: readonly T[], item: T, on: boolean): T[] {
  return on ? (list.includes(item) ? [...list] : [...list, item]) : list.filter((x) => x !== item);
}

/** Schreibrecht ohne Leserecht ist erlaubt, aber meist ein Versehen → Hinweis. */
export function scopeHints(scopes: readonly string[]): string[] {
  const out: string[] = [];
  for (const [w, r] of [['persons:write', 'persons:read'], ['runs:write', 'runs:read'], ['external:write', 'external:read']] as const) {
    if (scopes.includes(w) && !scopes.includes(r)) out.push(`„${scopeShort(w)}“ ohne „${scopeShort(r)}“: Das System kann anlegen, aber nichts abrufen.`);
  }
  return out;
}

export const EVENT_LABELS: Record<string, string> = {
  'invitation.completed': 'Einladung abgeschlossen',
  'evidence.created': 'Nachweis erstellt',
  'external_record.approved': 'Externer Nachweis freigegeben',
  'attendance.confirmed': 'Anwesenheit bestätigt',
  'compliance.state_changed': 'Pflichtmatrix: Status geändert',
  'test.ping': 'Testereignis',
};
export const eventLabel = (id: string) => EVENT_LABELS[id] ?? id;

export type Tone = 'success' | 'info' | 'warn' | 'danger' | 'neutral';

export function keyStatus(status: string): { label: string; tone: Tone } {
  if (status === 'aktiv') return { label: 'Aktiv', tone: 'success' };
  if (status === 'abgelaufen') return { label: 'Abgelaufen', tone: 'warn' };
  return { label: 'Widerrufen', tone: 'neutral' };
}

export function endpointStatus(e: { active: boolean; disabledReason: string | null; failureCount: number }): { label: string; tone: Tone } {
  if (!e.active) return e.disabledReason?.startsWith('automatisch') ? { label: 'Automatisch deaktiviert', tone: 'danger' } : { label: 'Deaktiviert', tone: 'neutral' };
  if (e.failureCount > 0) return { label: `Aktiv · ${e.failureCount} Fehlversuch${e.failureCount === 1 ? '' : 'e'}`, tone: 'warn' };
  return { label: 'Aktiv', tone: 'success' };
}

export function deliveryStatus(status: string): { label: string; tone: Tone } {
  switch (status) {
    case 'succeeded':
      return { label: 'Zugestellt', tone: 'success' };
    case 'failed':
      return { label: 'Fehlgeschlagen', tone: 'danger' };
    case 'sending':
      return { label: 'Wird gesendet', tone: 'info' };
    default:
      return { label: 'Ausstehend', tone: 'warn' };
  }
}

/** Erneut senden nur für abgeschlossene Zustellungen. */
export const canRedeliver = (status: string) => status === 'succeeded' || status === 'failed';

/** Clientseitige Vorprüfung (die API prüft verbindlich, inkl. interner Adressen). */
export function webhookUrlError(raw: string): string | null {
  const v = raw.trim();
  if (!v) return 'Bitte eine URL angeben';
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return 'Bitte eine vollständige URL angeben (https://…)';
  }
  if (u.username || u.password) return 'Zugangsdaten in der URL sind nicht erlaubt';
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  if (u.protocol === 'https:') return null;
  if (u.protocol === 'http:' && local) return null;
  return 'Webhooks müssen https verwenden';
}

const dtf = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const df = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' });
export const formatDateTime = (iso: string | null | undefined) => (iso ? dtf.format(new Date(iso)) : '—');
export const formatDay = (iso: string | null | undefined) => (iso ? df.format(new Date(iso)) : '—');

/** „vor 5 Min.“, „vor 3 Std.“, „vor 2 Tagen“, sonst Datum. */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'noch nie';
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.floor(s / 60)} Min.`;
  if (s < 86400) return `vor ${Math.floor(s / 3600)} Std.`;
  if (s < 7 * 86400) {
    const d = Math.floor(s / 86400);
    return `vor ${d} ${d === 1 ? 'Tag' : 'Tagen'}`;
  }
  return formatDay(iso);
}

/** Ablaufdatum (JJJJ-MM-TT aus dem Datumsfeld) → API-Wert oder null; Vergangenheit ist ein Fehler. */
export function expiryValue(date: string, today = new Date()): { value: string | null; error: string | null } {
  if (!date) return { value: null, error: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { value: null, error: 'Bitte ein gültiges Datum wählen' };
  const t = new Date(today.getTime());
  const iso = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  if (date <= iso) return { value: null, error: 'Das Ablaufdatum muss in der Zukunft liegen' };
  return { value: date, error: null };
}

/** Beispielaufruf für die Doku-Karte. */
export function curlExample(origin: string, key = 'sn_live_…'): string {
  return `curl -H "Authorization: Bearer ${key}" ${origin}/api/v1/persons?limit=10`;
}
