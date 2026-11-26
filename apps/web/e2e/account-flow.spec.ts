import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { API, E2E_DOZENT, latestOtp, seedParticipantTraining, type SeededInvitation } from './participant-seed';
import { seedSecondTenantInvitation, type SecondTenantInvitation } from './account-seed';

/**
 * „Meine Nachweise“ (1.18, E-25) gegen die echte API:
 * Einladung per Link abschließen → aus dieser Sitzung Teilnehmerkonto anlegen (Person wird direkt verknüpft)
 * → Nachweis in „Erledigt“ → Einladung einer zweiten Organisation mit derselben E-Mail verknüpfen → erscheint in „Offen“.
 * Außerdem: Konto ohne Einladung (E-Mail per Code bestätigen, Konto löschen) und Dozent mit Link „Meine Nachweise“.
 * Screenshots 390/1440 px nach docs/screenshots/phase-1/account/.
 */

const SHOTS = fileURLToPath(new URL('../../../docs/screenshots/phase-1/account/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });

test.describe.configure({ mode: 'serial' });

const PASSWORD = 'e2e-konto-passwort-1';
let invA: SeededInvitation;
let invB: SecondTenantInvitation;

test.beforeAll(async () => {
  const up = await fetch(`${API}/api/health`).then((r) => r.ok).catch(() => false);
  test.skip(!up, `API unter ${API} nicht erreichbar – Konto-E2E übersprungen`);
  [invA] = (await seedParticipantTraining({ people: 1, wordsPerPage: [20], questions: 1, quizQuestionCount: 1 })) as [SeededInvitation];
  invB = await seedSecondTenantInvitation({ name: invA.personName, email: invA.personEmail });
});

async function shot(page: Page, name: string, opts: { fullPage?: boolean; a11y?: boolean } = {}) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}${name}.png`, fullPage: opts.fullPage ?? false });
  if (opts.a11y !== false) await expectNoSeriousA11yViolations(page);
}

async function expectNoSeriousA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const report = serious.map((v) => ({ id: v.id, help: v.help, targets: v.nodes.slice(0, 5).map((n) => `${n.target.join(' ')} — ${n.failureSummary ?? ''}`) }));
  expect(report, JSON.stringify(report, null, 2)).toEqual([]);
}

/** Kurzer Durchlauf bis zum Abschluss: eine Seite, eine Frage, Unterschrift mit Code. */
async function completeInvitation(page: Page, inv: SeededInvitation) {
  await page.goto(`/s/${inv.token}`);
  await expect(page).toHaveURL(new RegExp(`/teilnahme/${inv.invitationId}$`));
  await page.getByRole('button', { name: 'Los geht’s' }).click();
  const ring = page.getByTestId('ring-button');
  await expect(page.getByTestId('pdf-canvas')).toBeVisible({ timeout: 15_000 });
  await page.mouse.move(200, 300);
  await expect(ring).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
  await page.mouse.move(210, 310);
  await ring.click();
  await expect(page).toHaveURL(/\/wissenscheck$/);
  await page.getByRole('button', { name: 'Gegen Wiedereinschalten sichern' }).click();
  await expect(page.getByText('Richtig.')).toBeVisible();
  await ring.click();
  await expect(page.getByRole('heading', { name: 'Bestanden!' })).toBeVisible();
  await ring.click();
  await expect(page).toHaveURL(/\/abschluss$/);
  await page.getByRole('checkbox').check();
  const box = (await page.getByTestId('signature-pad').boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + box.height * 0.6);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) {
    await page.mouse.move(box.x + 30 + i * ((box.width - 60) / 24), box.y + box.height * (0.45 + 0.18 * Math.sin(i / 2)), { steps: 2 });
  }
  await page.mouse.up();
  await page.getByRole('button', { name: 'Code anfordern' }).click();
  await expect(page.getByText(/Code ist unterwegs/)).toBeVisible();
  await page.getByLabel(/Code aus deiner E-Mail/).fill(await latestOtp(inv.personEmail));
  await page.getByRole('button', { name: 'Verbindlich unterschreiben' }).click();
  await expect(page.getByRole('heading', { name: 'Unterschrieben' })).toBeVisible({ timeout: 20_000 });
}

test('Teilnehmer: Konto aus der Einladung anlegen, Nachweis sehen, zweite Organisation verknüpfen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await completeInvitation(page, invA);

  // Abschluss-Karte → Teilnehmer-Registrierung
  await expect(page.getByRole('heading', { name: 'Nachweise in einem Konto sammeln' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Nachweis herunterladen' })).toBeVisible({ timeout: 60_000 });
  await shot(page, '390-abschluss-konto-angebot', { fullPage: true });
  await page.getByRole('link', { name: 'Konto anlegen' }).click();
  await expect(page).toHaveURL(/\/registrieren\?teilnehmer=1/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Konto für deine Nachweise');
  await expect(page.getByText('Nachweise sammeln – kein Arbeitgeberzugang')).toBeVisible();
  await expect(page.getByLabel(/Organisation/)).toHaveCount(0);
  await shot(page, '390-registrieren-teilnehmer', { fullPage: true });

  await page.getByLabel(/^Name/).fill(invA.personName);
  await page.getByLabel(/^E-Mail/).fill(invA.personEmail);
  await page.getByLabel(/^Passwort/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Konto erstellen' }).click();

  // „Meine Nachweise“: Einladung aus der Link-Sitzung ist verknüpft und erledigt
  await expect(page).toHaveURL(/\/konto$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Meine Nachweise' })).toBeVisible();
  const done = page.getByRole('region', { name: /^Erledigt/ });
  await expect(done.getByRole('heading', { name: invA.trainingTitle })).toBeVisible();
  await expect(done.getByText('Gültig', { exact: true })).toBeVisible();
  await expect(done.getByRole('link', { name: /^Nachweis herunterladen/ })).toBeVisible({ timeout: 60_000 });
  await expect(done.getByRole('link', { name: /^Echtheit prüfen/ })).toHaveAttribute('href', /^\/verify\//);
  const [dl] = await Promise.all([page.waitForEvent('download'), done.getByRole('link', { name: /^Nachweis herunterladen/ }).click()]);
  expect(dl.suggestedFilename()).toMatch(/\.pdf$/);

  // E-Mail ist bestätigt (Link kam an diese Adresse) → zweite Organisation als Vorschlag, noch nicht verknüpft
  const link = page.getByTestId('verknuepfen');
  await expect(link.getByText('E-Mail-Adresse bestätigt')).toBeVisible();
  const candidate = link.getByRole('checkbox', { name: new RegExp(invB.tenantName) });
  await expect(candidate).toBeVisible();
  await expect(candidate).not.toBeChecked();
  await expect(link.getByText(/Die jeweilige Organisation sieht dadurch nichts Zusätzliches/)).toBeVisible();
  await expect(link.getByText('Verknüpft', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('region', { name: /^Offen/ })).toHaveCount(0);
  await shot(page, '390-konto', { fullPage: true });

  await candidate.check();
  await link.getByRole('button', { name: '1 Eintrag verknüpfen' }).click();
  await expect(link.getByText('1 Eintrag verknüpft.')).toBeVisible();
  const open = page.getByRole('region', { name: /^Offen/ });
  await expect(open.getByRole('heading', { name: invB.trainingTitle })).toBeVisible();
  await expect(open.getByText(invB.tenantName)).toBeVisible();
  await expect(link.getByText('Alle Einträge mit deiner E-Mail-Adresse sind verknüpft.')).toBeVisible();
  await shot(page, '390-konto-verknuepft', { fullPage: true });

  // Desktop-Ansicht derselben Seite
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await expect(page.getByRole('region', { name: /^Offen/ }).getByRole('heading', { name: invB.trainingTitle })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Nachweis herunterladen/ })).toBeVisible();
  await shot(page, '1440-konto', { fullPage: true });

  // „Weiter“ öffnet die Einladung der zweiten Organisation mit der Kontositzung
  await page.getByRole('link', { name: `Weiter: ${invB.trainingTitle}` }).click();
  await expect(page).toHaveURL(new RegExp(`/teilnahme/${invB.invitationId}$`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Erste-Hilfe');
});

test('Teilnehmer ohne Einladung: E-Mail per Code bestätigen, Konto löschen', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const email = `konto-${randomUUID().slice(0, 8)}@example.org`;
  await page.goto('/registrieren?teilnehmer=1');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Konto für deine Nachweise');
  await shot(page, '1440-registrieren-teilnehmer', { fullPage: true });
  await page.getByLabel(/^Name/).fill('Jonas Becker');
  await page.getByLabel(/^E-Mail/).fill(email);
  await page.getByLabel(/^Passwort/).fill('kurz');
  await page.getByRole('button', { name: 'Konto erstellen' }).click();
  await expect(page.getByText('Das Passwort muss mindestens 10 Zeichen haben')).toBeVisible();
  await page.getByLabel(/^Passwort/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Konto erstellen' }).click();

  await expect(page).toHaveURL(/\/konto$/);
  await expect(page.getByRole('heading', { name: 'Noch keine Nachweise' })).toBeVisible();
  const link = page.getByTestId('verknuepfen');
  await expect(link.getByText('Zuerst E-Mail-Adresse bestätigen')).toBeVisible();
  await expect(page.getByText('nicht bestätigt')).toBeVisible();
  await shot(page, '1440-konto-leer', { fullPage: true });

  await link.getByRole('button', { name: 'Code senden' }).click();
  await expect(link.getByText(/Code ist unterwegs/)).toBeVisible();
  await link.getByLabel('Code aus deiner E-Mail').fill('000000');
  await link.getByRole('button', { name: 'Bestätigen' }).click();
  await expect(link.getByText(/falsch oder abgelaufen/)).toBeVisible();
  await link.getByLabel('Code aus deiner E-Mail').fill(await latestOtp(email));
  await link.getByRole('button', { name: 'Bestätigen' }).click();
  await expect(link.getByText('E-Mail-Adresse bestätigt')).toBeVisible();
  await expect(link.getByText('Keine weiteren Einträge mit deiner E-Mail-Adresse gefunden.')).toBeVisible();

  // Mobil: Lösch-Sheet erklärt, dass Nachweise beim Mandanten bleiben
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Konto löschen' }).click();
  const sheet = page.getByRole('dialog', { name: 'Konto löschen?' });
  await expect(sheet.getByText(/zur Aufbewahrung verpflichtet/)).toBeVisible();
  await expect(sheet.getByText(/nur dein Konto und die Verknüpfung/)).toBeVisible();
  await shot(page, '390-konto-loeschen');
  await sheet.getByRole('button', { name: 'Konto endgültig löschen' }).click();
  await expect(page).toHaveURL(/\/konto\/geloescht$/);
  await expect(page.getByRole('heading', { name: 'Konto gelöscht' })).toBeVisible();
  await shot(page, '390-konto-geloescht');

  // Konto ist weg: Anmeldung schlägt fehl
  await page.goto('/anmelden?teilnehmer=1');
  await page.getByLabel(/^E-Mail/).fill(email);
  await page.getByLabel(/^Passwort/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.getByText(/E-Mail oder Passwort/)).toBeVisible();
});

test('Dozent: Link „Meine Nachweise“ in der Verwaltung, Löschen gesperrt solange Mitglied', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/anmelden');
  await page.getByLabel(/^E-Mail/).fill(E2E_DOZENT.email);
  await page.getByLabel(/^Passwort/).fill(E2E_DOZENT.password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/verwaltung$/);
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Meine Nachweise' }).click();
  await expect(page).toHaveURL(/\/konto$/);
  await expect(page.getByRole('link', { name: 'Zur Verwaltung' })).toBeVisible();
  await page.getByRole('button', { name: 'Konto löschen' }).click();
  const sheet = page.getByRole('dialog', { name: 'Konto löschen?' });
  await expect(sheet.getByText(/gehört noch zur Verwaltung einer Organisation/)).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Konto endgültig löschen' })).toBeDisabled();
  await shot(page, '1440-konto-dozent-loeschen');
});
