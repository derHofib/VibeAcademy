import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { API, ApiClient } from './participant-seed';

/**
 * Login-Sperre mit steigender Dauer und „Passwort ändern“ unter /konto gegen die echte API.
 * Die API muss mit LOGIN_LOCK_FREE_ATTEMPTS=5 laufen (CI setzt das; in der Entwicklung sonst 100 freie Versuche).
 * Start: pnpm --filter @sn/web exec playwright test -c playwright.account.config.ts account-password --trace off
 */
test.describe.configure({ mode: 'serial' });

const SHOTS = fileURLToPath(new URL('../../../docs/screenshots/sicherheit/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });

const mail = (p: string) => `${p}-${randomUUID().slice(0, 8)}@example.org`;

test.beforeAll(async () => {
  const up = await fetch(`${API}/api/health`).then((r) => r.ok).catch(() => false);
  test.skip(!up, `API unter ${API} nicht erreichbar – E2E übersprungen`);
});

async function registerAccount(email: string, password: string) {
  const api = new ApiClient();
  await api.call('GET', '/auth/csrf');
  await api.call('POST', '/auth/register-account', { name: 'Paula Passwort', email, password });
}

async function loginUi(page: Page, email: string, password: string) {
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
}

async function expectNoSeriousA11yViolations(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
}

test('Login: nach 5 Fehlversuchen Sperre mit Restzeit, Anmelden deaktiviert mit Countdown', async ({ page }) => {
  const email = mail('sperre');
  await registerAccount(email, 'richtiges-passwort-1');
  await page.goto('/anmelden');
  for (let i = 1; i <= 5; i++) {
    await loginUi(page, email, `falsch-${i}-falsch`);
    await expect(page.getByText('E-Mail oder Passwort ist falsch')).toBeVisible();
  }
  await loginUi(page, email, 'falsch-6-falsch');
  const alert = page.getByTestId('login-sperre');
  await expect(alert).toHaveText('Zu viele Fehlversuche. Bitte in 1 Minute erneut versuchen.');
  const button = page.getByRole('button', { name: /^Gesperrt – noch 0:\d\d$/ });
  await expect(button).toBeDisabled();
  // Countdown läuft
  const first = await button.textContent();
  await page.waitForTimeout(2100);
  expect(await button.textContent()).not.toBe(first);
  await page.screenshot({ path: `${SHOTS}login-sperre.png` });
  await expectNoSeriousA11yViolations(page);

  // Auch mit richtigem Passwort keine Anmeldung während der Sperre (API direkt)
  const api = new ApiClient();
  await api.call('GET', '/auth/csrf');
  await expect(api.call('POST', '/auth/login', { email, password: 'richtiges-passwort-1' })).rejects.toThrow(/429/);
});

test('Konto: Passwort ändern – Fehler, Erfolg, andere Sitzungen abgemeldet, neues Passwort gilt', async ({ page, browser }) => {
  const email = mail('wechsel');
  const OLD = 'altes-passwort-1';
  const NEW = 'neues-passwort-1';
  await registerAccount(email, OLD);

  // zweites Gerät
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto('/anmelden?teilnehmer=1');
  await loginUi(otherPage, email, OLD);
  await expect(otherPage).toHaveURL(/\/konto$/);

  await page.goto('/anmelden?teilnehmer=1');
  await loginUi(page, email, OLD);
  await expect(page).toHaveURL(/\/konto$/);
  const card = page.getByRole('region', { name: 'Passwort ändern' });
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByText('Mindestens 10 Zeichen.')).toBeVisible();

  // zu kurz (Browser-Prüfung)
  await card.getByLabel('Aktuelles Passwort').fill(OLD);
  await card.getByLabel(/^Neues Passwort(?! wiederholen)/).fill('kurz');
  await card.getByLabel('Neues Passwort wiederholen').fill('kurz');
  await card.getByRole('button', { name: 'Passwort ändern' }).click();
  await expect(card.getByText('Das Passwort muss mindestens 10 Zeichen haben')).toBeVisible();

  // falsches aktuelles Passwort (Server)
  await card.getByLabel('Aktuelles Passwort').fill('falsch-falsch-1');
  await card.getByLabel(/^Neues Passwort(?! wiederholen)/).fill(NEW);
  await card.getByLabel('Neues Passwort wiederholen').fill(NEW);
  await card.getByRole('button', { name: 'Passwort ändern' }).click();
  await expect(card.getByText('Das aktuelle Passwort ist falsch')).toBeVisible();

  // Erfolg
  await card.getByLabel('Aktuelles Passwort').fill(OLD);
  await card.getByRole('button', { name: 'Passwort ändern' }).click();
  await expect(card.getByText('Passwort geändert. Andere Geräte wurden abgemeldet.')).toBeVisible();
  await card.screenshot({ path: `${SHOTS}passwort-aendern.png` });
  await expectNoSeriousA11yViolations(page);

  // aktuelle Sitzung bleibt, die andere ist beendet
  await page.reload();
  await expect(page).toHaveURL(/\/konto$/);
  await otherPage.reload();
  await expect(otherPage).toHaveURL(/\/anmelden/);

  // altes Passwort gilt nicht mehr, neues schon
  await loginUi(otherPage, email, OLD);
  await expect(otherPage.getByText('E-Mail oder Passwort ist falsch')).toBeVisible();
  await loginUi(otherPage, email, NEW);
  await expect(otherPage).toHaveURL(/\/konto$/);
  await other.close();
});
