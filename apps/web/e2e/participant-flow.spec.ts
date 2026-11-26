import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { API, latestOtp, seedParticipantTraining, type SeededInvitation } from './participant-seed';

/**
 * Teilnehmer-Ablauf gegen die echte API: Link öffnen → Start → alle Seiten lesen (Erfassung sichtbar)
 * → Wissenscheck → Unterschrift mit Code → Nachweis herunterladen → Prüfseite mit Dateiabgleich.
 * Nebenbei entstehen die Screenshots für docs/screenshots/phase-1/participant/ (390 und 1440 px).
 */

const SHOTS = fileURLToPath(new URL('../../../docs/screenshots/phase-1/participant/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });

// Ein Seed für beide Tests (eine Anmeldung je Lauf)
test.describe.configure({ mode: 'serial' });

let invitations: SeededInvitation[] = [];

test.beforeAll(async () => {
  const up = await fetch(`${API}/api/health`).then((r) => r.ok).catch(() => false);
  test.skip(!up, `API unter ${API} nicht erreichbar – Teilnehmer-E2E übersprungen`);
  invitations = await seedParticipantTraining({ people: 3, wordsPerPage: [20, 20, 20], questions: 2, quizQuestionCount: 2 });
});

async function shot(page: Page, name: string, a11y = true) {
  // Animationen (Puls, Sheet) kurz ausklingen lassen
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}${name}.png` });
  if (a11y) await expectNoSeriousA11yViolations(page);
}

/** axe (WCAG 2.x A/AA): keine ernsten oder kritischen Verstöße */
async function expectNoSeriousA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const report = serious.map((v) => ({ id: v.id, help: v.help, targets: v.nodes.slice(0, 5).map((n) => `${n.target.join(' ')} — ${n.failureSummary ?? ''}`) }));
  expect(report, JSON.stringify(report, null, 2)).toEqual([]);
}

/** Bedienung simulieren (zählt als Interaktion für „letzte Eingabe < 30 s“). */
async function wiggle(page: Page) {
  const vp = page.viewportSize()!;
  await page.mouse.move(vp.width / 2 + Math.random() * 20, vp.height / 3 + Math.random() * 20);
}

async function readAllPages(page: Page, prefix: string, total: number) {
  const ring = page.getByTestId('ring-button');
  for (let n = 1; n <= total; n++) {
    await expect(page.getByTestId('pdf-canvas')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: `Seite ${n}` })).toBeVisible();
    if (n === 2) {
      // Erfassung läuft sichtbar: Status-Pille und Countdown im Ring
      await expect(page.getByTestId('status-pill')).toContainText('Seite wird erfasst');
      await expect(ring).toHaveAttribute('data-state', 'counting');
      await shot(page, `${prefix}-05b-lesen-wird-erfasst`);

      // Inhaltsverzeichnis: mobil pausiert die Erfassung
      await page.getByRole('button', { name: /^Inhalt/ }).first().click();
      const toc = page.getByRole('dialog', { name: 'Inhalt' });
      await expect(toc).toBeVisible();
      await expect(toc.getByRole('button', { name: /Seite 1: .*erfasst/ })).toBeVisible();
      await expect(toc.getByRole('button', { name: /Seite 3: .*gesperrt/ })).toBeDisabled();
      await shot(page, `${prefix}-05d-inhalt-offen`);
      await toc.getByRole('button', { name: 'Schließen' }).click();
      await expect(toc).toBeHidden();

      // Frage stellen (Phase 1: Kontakt zum Ansprechpartner)
      await page.getByRole('button', { name: /^Frage/ }).first().click();
      const ask = page.getByRole('dialog', { name: 'Frage zu Seite 2' });
      await expect(ask).toBeVisible();
      await expect(ask.getByText('Dennis Hofmann')).toBeVisible();
      await ask.getByLabel('Deine Frage').fill('Gilt Regel 4 auch im Niederspannungsnetz?');
      await shot(page, `${prefix}-05e-frage`);
      await ask.getByRole('button', { name: 'Schließen' }).click();
      await expect(ask).toBeHidden();
    }
    await wiggle(page);
    await expect(ring).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
    await expect(page.getByTestId('status-pill')).toContainText(/erfasst/);
    if (n === 2) await shot(page, `${prefix}-05c-lesen-erfasst`);
    await wiggle(page);
    await ring.click();
  }
}

async function runFlow(page: Page, inv: SeededInvitation, prefix: string) {
  // Persönlicher Link → Startbildschirm
  await page.goto(`/s/${inv.token}`);
  await expect(page).toHaveURL(new RegExp(`/teilnahme/${inv.invitationId}$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Sicherheits\u00AD?unterweisung 2026/);
  await expect(page.getByText('So läuft es ab')).toBeVisible();
  await expect(page.getByText(/Keine Kamera, kein Standort, keine Tastatureingaben/)).toBeVisible();
  await shot(page, `${prefix}-05a-start`);
  await page.getByRole('button', { name: 'Los geht’s' }).click();

  // Lesen
  await expect(page).toHaveURL(/\/lesen/);
  await readAllPages(page, prefix, inv.pages);

  // Wissenscheck: Frage 1 richtig, Frage 2 falsch → 50 % = bestanden (Grenze 50 %)
  await expect(page).toHaveURL(/\/wissenscheck$/);
  const ring = page.getByTestId('ring-button');
  await expect(page.getByText(/Frage 1 von 2 · Versuch 1/)).toBeVisible();
  await expect(ring).toHaveAttribute('data-state', 'quiz');
  const q1 = (await page.getByRole('heading', { level: 2 }).first().textContent()) ?? '';
  const right1 = q1.includes('Freischalten') ? 'Gegen Wiedereinschalten sichern' : 'Den Stromkreis unterbrechen';
  await page.getByRole('button', { name: right1 }).click();
  await expect(page.getByText('Richtig.')).toBeVisible();
  await expect(ring).toHaveAttribute('data-state', 'ready');
  await shot(page, `${prefix}-05f-quiz-feedback`);
  await ring.click();
  await expect(page.getByText(/Frage 2 von 2/)).toBeVisible();
  const q2 = (await page.getByRole('heading', { level: 2 }).first().textContent()) ?? '';
  const wrong2 = q2.includes('Freischalten') ? 'Erden und kurzschließen' : 'Die Person vom Gerät wegziehen';
  await page.getByRole('button', { name: wrong2 }).click();
  await expect(page.getByText('Nicht ganz.')).toBeVisible();
  await expect(page.locator('[data-state="correct"]')).toHaveCount(1);
  await expect(page.locator('[data-state="wrong"]')).toHaveCount(1);
  await expect(page.locator('[data-state="dimmed"]')).toHaveCount(1);
  if (prefix === '1440') await shot(page, `${prefix}-05j-quiz-feedback-falsch`);
  await ring.click();
  await expect(page.getByRole('heading', { name: 'Bestanden!' })).toBeVisible();
  await expect(ring).toHaveAttribute('data-state', 'done');
  await shot(page, `${prefix}-05g-quiz-bestanden`);
  await ring.click();

  // Unterschrift
  await expect(page).toHaveURL(/\/abschluss$/);
  const submit = page.getByRole('button', { name: 'Verbindlich unterschreiben' });
  await expect(submit).toBeDisabled();
  await expect(page.getByText(/Noch offen: Bestätigung ankreuzen, unterschreiben, Code eingeben/)).toBeVisible();
  await page.getByRole('checkbox').check();
  const pad = page.getByTestId('signature-pad');
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + box.height * 0.6);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) {
    await page.mouse.move(box.x + 30 + i * ((box.width - 60) / 24), box.y + box.height * (0.45 + 0.18 * Math.sin(i / 2)), { steps: 2 });
  }
  await page.mouse.up();
  await page.getByRole('button', { name: 'Code anfordern' }).click();
  await expect(page.getByText(/Code ist unterwegs/)).toBeVisible();
  const code = await latestOtp(inv.personEmail);
  await page.getByLabel(/Code aus deiner E-Mail/).fill(code);
  await expect(page.getByText(/Alles bereit/)).toBeVisible();
  await expect(submit).toBeEnabled();
  await shot(page, `${prefix}-06-unterschrift`);
  await submit.click();

  // Abschluss: Nachweis-Nr., Prüfcode, PDF sobald erstellt
  await expect(page.getByRole('heading', { name: 'Unterschrieben' })).toBeVisible({ timeout: 20_000 });
  const download = page.getByRole('link', { name: 'Nachweis herunterladen' });
  await expect(download).toBeVisible({ timeout: 60_000 });
  await shot(page, `${prefix}-07-abschluss`);
  const verifyCode = (await page.getByTestId('verify-code').textContent())!.trim();
  const [dl] = await Promise.all([page.waitForEvent('download'), download.click()]);
  const pdfPath = test.info().outputPath(`nachweis-${prefix}.pdf`);
  await dl.saveAs(pdfPath);

  // Öffentliche Prüfseite + lokaler Dateiabgleich
  await page.getByRole('link', { name: 'Echtheit prüfen' }).click();
  await expect(page).toHaveURL(new RegExp(`/verify/${verifyCode}$`));
  await expect(page.getByText('Gültig – der Nachweis ist echt')).toBeVisible();
  const initials = inv.personName.split(' ').map((w) => w[0]).join('');
  await expect(page.getByText(new RegExp(`^${initials}[.]?$`))).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(pdfPath);
  await expect(page.getByTestId('file-check')).toContainText('stimmt mit dem hinterlegten Nachweis überein');
  await shot(page, `${prefix}-08-pruefseite`);
}

test('Teilnehmer-Ablauf mobil 390x844', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await runFlow(page, invitations[0]!, '390');
});

test('Teilnehmer-Ablauf Desktop 1440x900', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await runFlow(page, invitations[1]!, '1440');
});

test('Zweites Fenster übernimmt die Erfassung, „Hier weiterlesen“ holt sie zurück', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const inv = invitations[2]!;
  await page.goto(`/s/${inv.token}`);
  await page.getByRole('button', { name: 'Los geht’s' }).click();
  await expect(page.getByTestId('pdf-canvas')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('status-pill')).toContainText('Seite wird erfasst');

  // Gleiche Einladung in einem zweiten Fenster (gleiche Sitzung/Cookie) → neue Lesesitzung übernimmt
  const second = await context.newPage();
  await second.setViewportSize({ width: 390, height: 844 });
  await second.goto(`/teilnahme/${inv.invitationId}/lesen`);
  await expect(second.getByTestId('pdf-canvas')).toBeVisible({ timeout: 15_000 });

  const dialog = page.getByRole('alertdialog', { name: 'In einem anderen Fenster geöffnet' });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await shot(page, '390-05k-anderes-fenster');
  await second.close();
  await dialog.getByRole('button', { name: 'Hier weiterlesen' }).click();
  await expect(dialog).toBeHidden();
  await wiggle(page);
  await expect(page.getByTestId('ring-button')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
});
