import { describe, expect, it } from 'vitest';
import {
  canRedeliver, curlExample, deliveryStatus, endpointStatus, eventLabel, expiryValue, keyStatus, relativeTime, SCOPE_GROUPS, scopeHints, scopeLabel,
  scopeShort, toggle, webhookUrlError,
} from '../logic';

describe('Scopes', () => {
  it('alle zehn Scopes der API sind genau einmal in den Gruppen', () => {
    const ids = SCOPE_GROUPS.flatMap((g) => g.scopes.map((s) => s.id));
    expect(ids).toEqual([
      'persons:read', 'persons:write', 'trainings:read', 'runs:read', 'runs:write', 'evidence:read', 'external:read', 'external:write', 'compliance:read', 'webhooks:manage',
    ]);
    expect(new Set(ids).size).toBe(10);
  });
  it('Bezeichnungen und Kurzformen', () => {
    expect(scopeLabel('persons:write')).toBe('Personen & Org-Einheiten: anlegen und ändern');
    expect(scopeShort('evidence:read')).toBe('Nachweise lesen');
    expect(scopeShort('webhooks:manage')).toBe('Webhooks verwalten');
    expect(scopeShort('neu:x')).toBe('neu:x');
    expect(scopeLabel('unbekannt')).toBe('unbekannt');
  });
  it('Hinweis bei Schreibrecht ohne Leserecht', () => {
    expect(scopeHints(['persons:write'])).toHaveLength(1);
    expect(scopeHints(['persons:write', 'persons:read', 'runs:write'])[0]).toContain('Einladungen schreiben');
    expect(scopeHints(['evidence:read'])).toEqual([]);
  });
  it('toggle fügt hinzu/entfernt ohne Duplikate', () => {
    expect(toggle(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(toggle(['a', 'b'], 'b', true)).toEqual(['a', 'b']);
    expect(toggle(['a', 'b'], 'a', false)).toEqual(['b']);
  });
});

describe('Status', () => {
  it('Schlüssel', () => {
    expect(keyStatus('aktiv')).toEqual({ label: 'Aktiv', tone: 'success' });
    expect(keyStatus('abgelaufen').tone).toBe('warn');
    expect(keyStatus('widerrufen').label).toBe('Widerrufen');
  });
  it('Endpunkt: aktiv, mit Fehlversuchen, manuell bzw. automatisch deaktiviert', () => {
    expect(endpointStatus({ active: true, disabledReason: null, failureCount: 0 })).toEqual({ label: 'Aktiv', tone: 'success' });
    expect(endpointStatus({ active: true, disabledReason: null, failureCount: 1 }).label).toBe('Aktiv · 1 Fehlversuch');
    expect(endpointStatus({ active: true, disabledReason: null, failureCount: 3 }).label).toBe('Aktiv · 3 Fehlversuche');
    expect(endpointStatus({ active: false, disabledReason: 'manuell deaktiviert', failureCount: 0 })).toEqual({ label: 'Deaktiviert', tone: 'neutral' });
    expect(endpointStatus({ active: false, disabledReason: 'automatisch deaktiviert nach 20 Fehlversuchen in Folge', failureCount: 20 }).tone).toBe('danger');
  });
  it('Zustellung und „Erneut senden“', () => {
    expect(deliveryStatus('succeeded')).toEqual({ label: 'Zugestellt', tone: 'success' });
    expect(deliveryStatus('failed').tone).toBe('danger');
    expect(deliveryStatus('pending').label).toBe('Ausstehend');
    expect(deliveryStatus('sending').tone).toBe('info');
    expect([canRedeliver('succeeded'), canRedeliver('failed'), canRedeliver('pending'), canRedeliver('sending')]).toEqual([true, true, false, false]);
    expect(eventLabel('evidence.created')).toBe('Nachweis erstellt');
    expect(eventLabel('x.y')).toBe('x.y');
  });
});

describe('Eingaben', () => {
  it('Webhook-URL: https, http nur lokal, keine Zugangsdaten', () => {
    expect(webhookUrlError('https://hooks.example.com/sn')).toBeNull();
    expect(webhookUrlError('http://localhost:8080/hook')).toBeNull();
    expect(webhookUrlError('http://hooks.example.com/sn')).toBe('Webhooks müssen https verwenden');
    expect(webhookUrlError('')).toBe('Bitte eine URL angeben');
    expect(webhookUrlError('hooks.example.com')).toContain('vollständige URL');
    expect(webhookUrlError('https://a:b@example.com')).toBe('Zugangsdaten in der URL sind nicht erlaubt');
  });
  it('Ablaufdatum: leer = unbegrenzt, Vergangenheit/heute abgelehnt', () => {
    const today = new Date(2026, 10, 26);
    expect(expiryValue('', today)).toEqual({ value: null, error: null });
    expect(expiryValue('2026-11-26', today).error).toBe('Das Ablaufdatum muss in der Zukunft liegen');
    expect(expiryValue('2026-11-27', today)).toEqual({ value: '2026-11-27', error: null });
    expect(expiryValue('27.11.2026', today).error).toBeTruthy();
  });
});

describe('Zeit und Beispiel', () => {
  it('relative Zeitangaben', () => {
    const now = Date.parse('2026-11-26T12:00:00Z');
    expect(relativeTime(null, now)).toBe('noch nie');
    expect(relativeTime('2026-11-26T11:59:30Z', now)).toBe('gerade eben');
    expect(relativeTime('2026-11-26T11:45:00Z', now)).toBe('vor 15 Min.');
    expect(relativeTime('2026-11-26T09:00:00Z', now)).toBe('vor 3 Std.');
    expect(relativeTime('2026-11-25T12:00:00Z', now)).toBe('vor 1 Tag');
    expect(relativeTime('2026-11-22T12:00:00Z', now)).toBe('vor 4 Tagen');
    expect(relativeTime('2026-10-01T12:00:00Z', now)).toBe('01.10.2026');
  });
  it('curl-Beispiel mit Bearer-Header', () => {
    expect(curlExample('https://sn.example.org')).toBe('curl -H "Authorization: Bearer sn_live_…" https://sn.example.org/api/v1/persons?limit=10');
  });
});
