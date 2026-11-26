import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { API, latestOtp } from './participant-seed';
import { seedEnglishTraining, type SeededEnglish } from './i18n-seed';

/**
 * Phase 3 (E-39/E-40): Teilnehmer-Ablauf auf Englisch gegen die echte API – der Browser ist deutsch eingestellt,
 * die Sprache kommt aus der Person. Start → Lesen → Wissenscheck → Unterschrift mit Code → Nachweis → Prüfseite;
 * Sprachumschalter; FES mit Test-Anbieter. Screenshots (390 px) → docs/screenshots/phase-3/i18n/.
 */
const SHOTS = fileURLToPath(new URL('../../../docs/screenshots/phase-3/i18n/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });

test.describe.configure({ mode: 'serial' });

let ees: SeededEnglish;
let fes: SeededEnglish;

test.beforeAll(async () => {
  const up = await fetch(`${API}/api/health`).then((r) => r.ok).catch(() => false);
  test.skip(!up, `API unter ${API} nicht erreichbar – i18n-E2E übersprungen`);
  ees = await seedEnglishTraining();
  fes = await seedEnglishTraining({ signatureLevel: 'fes' });
});

async function shot(page: Page, name: string) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}${name}.png` });
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => ({ id: v.id, targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }))).toEqual([]);
}

async function wiggle(page: Page) {
  const vp = page.viewportSize()!;
  await page.mouse.move(vp.width / 2 + Math.random() * 20, vp.height / 3 + Math.random() * 20);
}

async function readAll(page: Page, total: number, screenshot: boolean) {
  const ring = page.getByTestId('ring-button');
  for (let n = 1; n <= total; n++) {
    await expect(page.getByTestId('pdf-canvas')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: `Page ${n}` })).toBeVisible();
    if (n === 2 && screenshot) {
      await expect(page.getByTestId('status-pill')).toContainText('Recording page');
      await shot(page, '390-en-05b-viewer');
    }
    await wiggle(page);
    await expect(ring).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
    await expect(page.getByTestId('status-pill')).toContainText(/recorded/);
    await wiggle(page);
    await ring.click();
  }
}

async function quiz(page: Page) {
  const ring = page.getByTestId('ring-button');
  await expect(page).toHaveURL(/\/wissenscheck$/);
  await expect(page.getByText(/Question 1 of 2 · Attempt 1/)).toBeVisible();
  const q1 = (await page.getByRole('heading', { level: 2 }).first().textContent()) ?? '';
  await page.getByRole('button', { name: q1.includes('disconnect') ? 'Secure against reconnection' : 'Interrupt the circuit' }).click();
  await expect(page.getByText('Correct.')).toBeVisible();
  await ring.click();
  const q2 = (await page.getByRole('heading', { level: 2 }).first().textContent()) ?? '';
  await page.getByRole('button', { name: q2.includes('disconnect') ? 'Earth and short-circuit' : 'Pull the person away' }).click();
  await expect(page.getByText('Not quite.')).toBeVisible();
  await ring.click();
  await expect(page.getByRole('heading', { name: 'Passed!' })).toBeVisible();
  await ring.click();
  await expect(page).toHaveURL(/\/abschluss/);
}

test('Englischer Teilnehmer-Ablauf mobil 390x844 (Browser deutsch, Person englisch)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/s/${ees.token}`);
  await expect(page).toHaveURL(new RegExp(`/teilnahme/${ees.invitationId}$`));
  await expect(page.getByText('How it works')).toBeVisible();
  await expect(page.getByText(/No camera, no location, no keystrokes/)).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  // Sprachumschalter: Deutsch und zurück (Wahl wird gespeichert, auch bei der Person)
  await page.getByRole('button', { name: /^de/i }).click();
  await expect(page.getByText('So läuft es ab')).toBeVisible();
  await page.getByRole('button', { name: /^en/i }).click();
  await expect(page.getByText('How it works')).toBeVisible();
  await shot(page, '390-en-05a-start');
  await page.getByRole('button', { name: 'Let’s go' }).click();

  await expect(page).toHaveURL(/\/lesen/);
  await readAll(page, ees.pages, true);
  await quiz(page);

  // Unterschrift mit Code
  const submit = page.getByRole('button', { name: 'Sign with binding effect' });
  await expect(submit).toBeDisabled();
  await expect(page.getByText(/Still missing: tick the confirmation, sign, enter code/)).toBeVisible();
  await page.getByRole('checkbox').check();
  const pad = page.getByTestId('signature-pad');
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + box.height * 0.6);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) {
    await page.mouse.move(box.x + 30 + i * ((box.width - 60) / 24), box.y + box.height * (0.45 + 0.18 * Math.sin(i / 2)), { steps: 2 });
  }
  await page.mouse.up();
  await page.getByRole('button', { name: 'Request code' }).click();
  await expect(page.getByText(/The code is on its way/)).toBeVisible();
  const box2 = await fetch(`${API}/api/dev/postausgang?an=${encodeURIComponent(ees.personEmail)}`).then((r) => r.json() as Promise<Array<{ subject: string }>>);
  expect(box2.some((m) => m.subject.startsWith('Your confirmation code'))).toBe(true);
  await page.getByLabel(/code from your e-mail/i).fill(await latestOtp(ees.personEmail));
  await expect(page.getByText(/All set/)).toBeVisible();
  await shot(page, '390-en-06-signature');
  await submit.click();

  await expect(page.getByRole('heading', { name: 'Signed' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('link', { name: 'Download record' })).toBeVisible({ timeout: 60_000 });
  await shot(page, '390-en-07-done');
  const code = (await page.getByTestId('verify-code').textContent())!.trim();
  await page.getByRole('link', { name: 'Verify authenticity' }).click();
  await expect(page).toHaveURL(new RegExp(`/verify/${code}$`));
  await expect(page.getByText('Valid – the record is authentic')).toBeVisible();
  await shot(page, '390-en-08-verify');
});

test('FES mit Test-Anbieter auf Englisch: Bestätigen → Anbieter → zurück → Nachweis', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/s/${fes.token}`);
  await expect(page.getByText('How it works')).toBeVisible();
  await page.getByRole('button', { name: 'Let’s go' }).click();
  await readAll(page, fes.pages, false);
  await quiz(page);

  const go = page.getByRole('button', { name: 'Continue to signature provider' });
  await expect(page.getByText('Sign with the signature provider')).toBeVisible();
  await expect(page.getByText(/advanced electronic signature \(AdES\)/)).toBeVisible();
  await expect(page.getByText('Test provider: this signature has no legal effect.')).toBeVisible();
  await expect(go).toBeDisabled();
  await page.getByRole('checkbox').check();
  await shot(page, '390-en-06b-signature-provider');
  await go.click();

  // Signaturseite des Test-Anbieters (in der API)
  await expect(page).toHaveURL(/\/api\/qes\/test\/sign\/TEST-/);
  await expect(page.getByText('TEST PROVIDER – no legal effect')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}390-en-06c-test-provider.png` });
  await page.getByRole('link', { name: 'Sign' }).click();

  await expect(page).toHaveURL(new RegExp(`/teilnahme/${fes.invitationId}/abschluss\\?signatur=ok$`));
  await expect(page.getByRole('heading', { name: 'Signed' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Advanced electronic signature')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download record' })).toBeVisible({ timeout: 60_000 });
  await shot(page, '390-en-07b-done-fes');
});
