import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ApiClient, apiUp, registerDozent, uniqueEmail } from './admin-seed';

/**
 * Phase 4.1 (E-51/E-56): Einstellungsseite je Schulung gegen die echte API –
 * sieben Karten, Anlass mit Pflichttext, Live-Online mit Teams, Standard-Zielgruppe, Erinnerungen, Speichern, Neuladen.
 * Screenshots 1440/390 px nach docs/screenshots/phase-4/einstellungen/.
 */
test.skip(({ baseURL }) => !baseURL?.includes(':5176'), 'nur mit playwright.admin.config.ts (Proxy auf die API)');

const SHOTS = fileURLToPath(new URL('../../../docs/screenshots/phase-4/einstellungen/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });

async function noSeriousA11y(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
}

test('Einstellungen je Schulung: Anlass, Live-Online, Zielgruppe, Erinnerungen speichern', async ({ page }) => {
  test.setTimeout(120_000);
  expect(await apiUp(), 'API auf Port 3000 erreichbar').toBe(true);
  const email = uniqueEmail('einstellungen');
  const password = 'sicheres-passwort-42';
  const api = new ApiClient();
  await registerDozent(api, { name: 'Dennis Hofmann', organisation: 'Muster Elektrotechnik GmbH', email, password });
  await api.call('POST', '/org-units', { name: 'Service Nord' });
  await api.call('POST', '/org-units', { name: 'Montage' });
  const { id } = await api.call<{ id: string }>('POST', '/trainings', {
    titel: 'Anlassbezogene Arbeitsschutzunterweisung – Die fünf Sicherheitsregeln',
    kategorie: 'Arbeitsschutz',
    rechtsgrundlage: 'DGUV Vorschrift 1 § 4',
    ansprechpartner: 'Dennis Hofmann, 0761 123 456',
    confirmText: 'Ich habe die Unterweisung „Die fünf Sicherheitsregeln“ erhalten und verstanden.',
  });

  await page.goto('/anmelden');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/verwaltung$/);

  // Einstieg über die Schulungsliste
  await page.goto('/verwaltung/schulungen');
  await page.getByRole('link', { name: /Einstellungen: Anlassbezogene Arbeitsschutzunterweisung/ }).click();
  await expect(page).toHaveURL(new RegExp(`/verwaltung/schulungen/${id}/einstellungen$`));
  for (const name of ['Allgemein', 'Anlass', 'Durchführungsart', 'Inhalt & Lesen', 'Wissenscheck', 'Bestätigung & Signatur', 'Fristen & Gültigkeit']) {
    await expect(page.getByRole('region', { name, exact: true })).toBeVisible();
  }

  // Anlassbezogen ohne Text → Fehler am Feld
  await page.getByRole('radio', { name: 'Anlassbezogen' }).click();
  await page.getByRole('button', { name: 'Einstellungen speichern' }).click();
  await expect(page.getByText('Bitte den Anlass bzw. das Ereignis beschreiben')).toBeVisible();
  await page.getByLabel(/Anlass \/ Ereignis/).fill('Beinahe-Unfall am 12.11.2026 bei Arbeiten an einer Unterverteilung (Halle 3).');
  await expect(page.getByTestId('anlass-vorschau')).toContainText('Anlassbezogen – Beinahe-Unfall am 12.11.2026');

  // Live-Online mit Teams und https-Link
  await page.getByRole('radio', { name: /Live-Online/ }).click();
  await page.getByLabel('Plattform').selectOption('teams');
  await page.getByLabel(/Meeting-Link/).fill('http://teams.example/abc');
  await page.getByRole('button', { name: 'Einstellungen speichern' }).click();
  await expect(page.getByText('Bitte einen Link mit https:// angeben')).toBeVisible();
  await page.getByLabel(/Meeting-Link/).fill('https://teams.microsoft.com/l/meetup-join/abc');

  // Zielgruppe, Wissenscheck, Gegenzeichnung, Erinnerungen
  await page.getByRole('button', { name: 'Service Nord' }).click();
  await page.getByLabel('Bestehen ab').fill('90');
  await page.getByRole('button', { name: '3 Tage vorher' }).click();
  await page.getByRole('button', { name: '7 Tage vorher' }).click();
  await expect(page.getByText('Ungespeicherte Änderungen')).toBeVisible();
  await page.getByRole('button', { name: 'Einstellungen speichern' }).click();
  await expect(page.getByText('Einstellungen gespeichert.')).toBeVisible();

  // Neuladen: Werte stehen
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Anlassbezogen' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: /Live-Online/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Plattform')).toHaveValue('teams');
  await expect(page.getByRole('button', { name: 'Service Nord' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '3 Tage vorher' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '7 Tage vorher' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByLabel('Bestehen ab')).toHaveValue('90');
  await expect(page.getByTestId('pflicht-status')).toHaveText('Nicht in der Pflichtmatrix');

  // Gespeichert auf dem Server
  const t = await api.call<{ anlassTyp: string; defaultDelivery: string; defaultPlatform: string; settings: { passPct: number; reminderDaysBefore: number[] } }>('GET', `/trainings/${id}`);
  expect(t).toMatchObject({ anlassTyp: 'anlass', defaultDelivery: 'live_online', defaultPlatform: 'teams' });
  expect(t.settings).toMatchObject({ passPct: 90, reminderDaysBefore: [3, 2] });

  await noSeriousA11y(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: `${SHOTS}1440-einstellungen.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${SHOTS}390-einstellungen.png`, fullPage: true });

  // Einstieg aus dem Assistenten
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/verwaltung/schulungen/${id}`);
  await page.getByRole('link', { name: 'Einstellungen', exact: true }).click();
  await expect(page).toHaveURL(/\/einstellungen$/);
});
