import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ApiClient, apiUp, registerDozent, uniqueEmail } from './admin-seed';

/**
 * Phase 4.2 (E-52–E-54), Abnahme gegen die echte API: „Anlassbezogene Arbeitsschutzunterweisung – Die fünf
 * Sicherheitsregeln“ als Live-Online (Teams) für ein vergangenes Datum anlegen, Teams-Anwesenheitsliste importieren,
 * Gast neu anlegen, Beleg hochladen, gegenzeichnen → Nachweise. Screenshots nach docs/screenshots/phase-4/nachtraeglich/.
 */
test.skip(({ baseURL }) => !baseURL?.includes(':5176'), 'nur mit playwright.admin.config.ts (Proxy auf die API)');

const SHOTS = fileURLToPath(new URL('../../../docs/screenshots/phase-4/nachtraeglich/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function noSeriousA11y(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
}

/** Datum vor 9 Tagen (Ortszeit), als „YYYY-MM-DD“ und „DD.MM.YY“ für den Teams-Bericht. */
function pastDay() {
  const d = new Date(Date.now() - 9 * 86_400_000);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).split('-');
  return { iso: `${p[0]}-${p[1]}-${p[2]}`, de: `${p[2]}.${p[1]}.${p[0]!.slice(2)}` };
}

function teamsReport(day: string, mails: Record<string, string>) {
  const lines = [
    '1. Zusammenfassung',
    'Besprechungstitel\tUnterweisung Die fünf Sicherheitsregeln',
    '',
    '2. Teilnehmer',
    'Name\tErster Beitritt\tLetztes Verlassen\tDauer der Besprechung\tE-Mail-Adresse\tTeilnehmer-ID (UPN)\tRolle',
    `Dennis Hofmann\t${day}, 08:58:00\t${day}, 10:00:30\t1 Std. 2 Min.\tdozent@example.org\tdozent@example.org\tOrganisator`,
    `Lea Wagner\t${day}, 09:01:12\t${day}, 10:00:05\t58 Min. 53 Sek.\t${mails.lea}\t${mails.lea}\tTeilnehmer`,
    `Tobias Meier\t${day}, 09:00:00\t${day}, 10:00:00\t1 Std.\t${mails.tobias}\t${mails.tobias}\tTeilnehmer`,
    `Anna Schulz\t${day}, 09:12:00\t${day}, 10:00:00\t48 Min.\t${mails.anna}\t${mails.anna}\tTeilnehmer`,
    `Becker, Jonas (Gast)\t${day}, 09:05:00\t${day}, 09:55:00\t50 Min.\tj.becker@subunternehmer.example\t\tTeilnehmer`,
  ].join('\r\n');
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(lines, 'utf16le')]);
}

test('Teams-Schulung nachträglich erfassen: Termin, Import, Beleg, Gegenzeichnung → Nachweise', async ({ page }) => {
  test.setTimeout(180_000);
  expect(await apiUp(), 'API auf Port 3000 erreichbar').toBe(true);
  const email = uniqueEmail('nachtraeglich');
  const password = 'sicheres-passwort-42';
  const api = new ApiClient();
  await registerDozent(api, { name: 'Dennis Hofmann', organisation: 'Muster Elektrotechnik GmbH', email, password });
  const { id: trainingId } = await api.call<{ id: string }>('POST', '/trainings', {
    titel: 'Anlassbezogene Arbeitsschutzunterweisung – Die fünf Sicherheitsregeln',
    rechtsgrundlage: 'DGUV Vorschrift 1 § 4',
    anlassTyp: 'anlass',
    anlassText: 'Beinahe-Unfall am 12.11.2026 bei Arbeiten an einer Unterverteilung (Halle 3).',
    defaultDelivery: 'live_online',
  });
  await api.call('PATCH', `/trainings/${trainingId}`, { defaultPlatform: 'teams' });
  const suffix = email.split('@')[0]!.split('-').at(-1);
  const mails = { lea: `lea-${suffix}@example.org`, tobias: `tobias-${suffix}@example.org`, anna: `anna-${suffix}@example.org` };
  for (const [name, mail] of [['Lea Wagner', mails.lea], ['Tobias Meier', mails.tobias], ['Anna Schulz', mails.anna]] as const) {
    await api.call('POST', '/persons', { name, email: mail });
  }
  const day = pastDay();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/anmelden');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/verwaltung$/);

  // ── Schritt 1: Termin ──
  await page.goto('/verwaltung/termine');
  await page.getByRole('link', { name: 'Nachträglich erfassen' }).click();
  await expect(page.getByRole('heading', { name: 'Stattgefundene Schulung nachträglich erfassen' })).toBeVisible();
  await page.getByLabel('Schulung').selectOption(trainingId);
  await expect(page.getByLabel('Plattform')).toHaveValue('teams');
  await expect(page.getByTestId('vorschau-art')).toHaveText('Live-Online · Microsoft Teams');
  await page.getByLabel('Datum').fill(day.iso);
  await page.getByLabel('Beginn').fill('09:00');
  await page.getByLabel('Ende').fill('10:00');
  await page.getByRole('button', { name: 'Weiter: Anwesenheit' }).click();
  await expect(page.getByText('Bitte begründen (mindestens 10 Zeichen)')).toBeVisible();
  await page.getByLabel(/Begründung der nachträglichen Erfassung/).fill('Unterweisung kurzfristig per Teams gehalten (Kollegen auf Montage).');
  await page.screenshot({ path: `${SHOTS}1440-1-termin.png`, fullPage: true });
  await page.getByRole('button', { name: 'Weiter: Anwesenheit' }).click();
  await expect(page).toHaveURL(/\/nachtraeglich\?schritt=2$/);

  // ── Schritt 2: Teams-Bericht ──
  await page.getByTestId('import-datei').setInputFiles({ name: 'Anwesenheitsbericht.csv', mimeType: 'text/csv', buffer: teamsReport(day.de, mails) });
  await expect(page.getByText(/Anwesenheitsbericht\.csv · geplante Dauer 60 min · Teams-Bericht/)).toBeVisible();
  const table = page.getByRole('table', { name: 'Teilnehmerliste' });
  await expect(table.getByRole('row')).toHaveCount(6);
  await expect(page.getByText(/Anna Schulz war 48 von 60 Minuten anwesend \(80 %\)/)).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Dennis Hofmann übernehmen' })).not.toBeChecked();
  await page.getByLabel('Person für Becker, Jonas (Gast)').selectOption('__neu');
  await expect(page.getByRole('status').filter({ hasText: 'übernommen' })).toHaveText('4 Personen werden übernommen');
  await noSeriousA11y(page);
  await page.screenshot({ path: `${SHOTS}1440-2-anwesenheit.png`, fullPage: true });
  await page.getByRole('button', { name: 'Weiter: Beleg' }).click();
  await expect(page.getByText('Anwesenheit übernommen.')).toBeVisible();

  // ── Schritt 3: Beleg ──
  await expect(page.getByText('Teilnehmerliste (Import)')).toBeVisible();
  await page.getByTestId('beleg-datei').setInputFiles({ name: 'Bildschirmfoto Teams.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText('Bildschirmfoto Teams.png')).toBeVisible();
  await page.getByRole('button', { name: 'Weiter: Gegenzeichnen' }).click();

  // ── Schritt 4: Gegenzeichnen ──
  await expect(page.getByRole('heading', { name: 'Gegenzeichnen' })).toBeVisible();
  await page.getByLabel('Dein Passwort').fill(password);
  await page.getByRole('button', { name: 'Gegenzeichnen und Nachweise erzeugen' }).click();
  await expect(page.getByText('4 Nachweise werden erzeugt.')).toBeVisible();
  await expect(page.getByText(/Gegengezeichnet – von Dennis Hofmann/)).toBeVisible();
  // Nachweise erzeugt (Prüfcodes erscheinen)
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(/Nachweis [A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/)).toHaveCount(4);
  }).toPass({ timeout: 60_000 });
  await noSeriousA11y(page);
  await page.screenshot({ path: `${SHOTS}1440-4-gegengezeichnet.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${SHOTS}390-4-gegengezeichnet.png`, fullPage: true });

  // Terminliste: Live-Online · Microsoft Teams · nachträglich erfasst
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/verwaltung/termine');
  await expect(page.getByText(/Live-Online · Microsoft Teams .*nachträglich erfasst/).first()).toBeVisible();
});
