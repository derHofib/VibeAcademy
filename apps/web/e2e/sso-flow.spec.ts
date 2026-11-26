/**
 * Firmenanmeldung (SSO, E-36) im Browser: Domain-Erkennung auf der Anmeldeseite, Weiterleitung zum Test-IdP,
 * JIT-Konto mit Standardrollen, Fehlerseite bei ungültiger IdP-Antwort, Einstellungen „Anmeldung & Benutzerverwaltung“
 * mit SCIM-Token (einmal angezeigt). Umgebung: playwright.sso.config.ts (e2e/sso-stack.mjs).
 */
import { expect, test } from '@playwright/test';
import { FakeIdp } from '../../api/test/fake-idp';

const API = 'http://127.0.0.1:5180/api';
const DOZENT = { name: 'Sina Sorge', organisation: 'E2E Firmenkonto GmbH', email: 'e2e-sso-admin@example.org', password: 'e2e-passwort-sso-1' };
let idp: FakeIdp;

/** Minimaler API-Client mit Cookie und CSRF (über den Vite-Proxy). */
async function adminApi() {
  let cookie = '';
  let csrf = '';
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: { cookie, ...(method !== 'GET' ? { 'x-csrf-token': csrf } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of r.headers.getSetCookie()) {
      const kv = c.split(';')[0]!;
      const k = kv.split('=')[0]!;
      cookie = [...cookie.split('; ').filter((x) => x && !x.startsWith(`${k}=`)), kv].join('; ');
      if (k === 'sn_csrf') csrf = kv.slice(k.length + 1);
    }
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
    return r.json();
  };
  await call('GET', '/auth/csrf');
  await call('POST', '/auth/register', DOZENT);
  return call;
}

test.beforeAll(async () => {
  idp = await FakeIdp.start(5181);
  const api = await adminApi();
  await api('PUT', '/tenant/sso', {
    enabled: true,
    slug: 'e2e-firma',
    issuer: idp.issuer,
    clientId: idp.clientId,
    clientSecret: idp.clientSecret,
    emailDomains: ['e2e-firma.example'],
    jitEnabled: true,
    defaultRoles: ['verantwortlich', 'trainer'],
  });
});

test.afterAll(async () => {
  await idp?.close();
});

test('Anmeldung mit Firmenkonto: Domain erkannt, JIT-Konto, Verwaltung', async ({ page }) => {
  idp.user = { sub: 'e2e-mara', email: 'mara@e2e-firma.example', email_verified: true, name: 'Mara Firmkonto' };
  await page.goto('/anmelden');
  await page.getByLabel('E-Mail').fill('mara@e2e-firma.example');
  await expect(page.getByRole('status')).toContainText('E2E Firmenkonto GmbH nutzt die Anmeldung mit dem Firmenkonto.');
  await page.getByRole('link', { name: 'Mit Firmenkonto anmelden' }).click();
  await expect(page).toHaveURL(/\/verwaltung$/);
  expect(idp.lastAuthorize?.get('code_challenge_method')).toBe('S256');
  await page.goto('/verwaltung/einstellungen');
  await expect(page.getByText('mara@e2e-firma.example').first()).toBeVisible();
});

test('ungültige Antwort des IdP → deutsche Fehlermeldung', async ({ page }) => {
  idp.user = { sub: 'e2e-mara', email: 'mara@e2e-firma.example', email_verified: true };
  idp.next = { claims: { aud: 'fremder-client' } };
  await page.goto('/anmelden');
  await page.getByLabel('E-Mail').fill('mara@e2e-firma.example');
  await expect(page.getByRole('status')).toContainText('nutzt die Anmeldung');
  await page.getByRole('link', { name: 'Mit Firmenkonto anmelden' }).click();
  await expect(page).toHaveURL(/\/anmelden\/sso\?fehler=token_invalid/);
  await expect(page.getByTestId('sso-error')).toContainText('konnte nicht bestätigt werden');
  await page.getByRole('link', { name: 'Zurück zur Anmeldung' }).click();
  await expect(page).toHaveURL(/\/anmelden$/);
});

test('Einstellungen: Verbindungstest und SCIM-Token einmalig anzeigen', async ({ page }) => {
  await page.goto('/anmelden');
  await page.getByLabel('E-Mail').fill(DOZENT.email);
  await page.getByLabel('Passwort').fill(DOZENT.password);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/verwaltung/);
  await page.goto('/verwaltung/einstellungen');
  const section = page.getByTestId('sso-settings');
  await expect(section.getByRole('heading', { name: 'Anmeldung & Benutzerverwaltung' })).toBeVisible();
  await expect(section.getByLabel('Issuer-URL')).toHaveValue(idp.issuer);
  await section.getByRole('button', { name: 'Verbindung testen' }).click();
  await expect(section.getByTestId('sso-test-result')).toContainText(`Verbindung erfolgreich: ${idp.issuer}`);
  await expect(section.getByTestId('scim-base-url')).toHaveText('http://127.0.0.1:5180/api/scim/v2');
  await section.getByLabel('Bezeichnung (optional)').fill('Entra ID');
  await section.getByRole('button', { name: 'Token erzeugen' }).click();
  const once = page.getByTestId('scim-token-once');
  await expect(once).toHaveText(/^scim_/);
  const token = (await once.textContent())!;
  // Token funktioniert gegen die SCIM-Schnittstelle
  const r = await fetch(`${API}/scim/v2/Users`, { headers: { authorization: `Bearer ${token}` } });
  expect(r.status).toBe(200);
  await page.getByRole('button', { name: 'Ich habe das Token kopiert' }).click();
  await expect(once).toHaveCount(0);
  await expect(section.getByText('Entra ID')).toBeVisible();
  await expect(section.getByText(token)).toHaveCount(0);
});
