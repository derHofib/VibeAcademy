import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCREENSHOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../docs/screenshots/phase-0',
);

const pages = [
  { name: 'komponenten', url: '/dev/komponenten', ready: 'h1' },
  { name: 'layout-admin', url: '/dev/layout-admin', ready: 'h1' },
  { name: 'layout-teilnehmer', url: '/dev/layout-teilnehmer', ready: 'h1' },
  { name: 'anmelden', url: '/anmelden', ready: 'h1' },
  { name: 'registrieren', url: '/registrieren', ready: 'h1' },
] as const;

const widths = [
  { label: '390', width: 390, height: 844 },
  { label: '1440', width: 1440, height: 900 },
] as const;

async function expectFontsLoaded(page: Page) {
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    const faces = ['400 16px Inter', '600 16px Inter', '700 16px "Plus Jakarta Sans"'];
    await Promise.all(faces.map((f) => document.fonts.load(f)));
    return faces.map((f) => document.fonts.check(f));
  });
  expect(loaded, 'Schriften aus /fonts geladen').toEqual([true, true, true]);
}

async function expectNoSeriousA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const report = serious.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    targets: v.nodes.slice(0, 5).map((n) => `${n.target.join(' ')} — ${n.failureSummary ?? ''}`),
  }));
  expect(report, JSON.stringify(report, null, 2)).toEqual([]);
}

async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: true, animations: 'disabled' });
}

for (const vp of widths) {
  test.describe(`${vp.label} px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });

    for (const p of pages) {
      test(`${p.name}: axe + Screenshot`, async ({ page }) => {
        const external: string[] = [];
        page.on('request', (r) => {
          const u = new URL(r.url());
          if (u.hostname !== '127.0.0.1' && !u.protocol.startsWith('data')) external.push(r.url());
        });
        await page.goto(p.url);
        await expect(page.locator(p.ready).first()).toBeVisible();
        await expectFontsLoaded(page);
        await expectNoSeriousA11yViolations(page);
        await screenshot(page, `${p.name}-${vp.label}`);
        expect(external, 'keine externen Abrufe (Google Fonts o. ä.)').toEqual([]);
      });
    }

    test('Sheet geöffnet: axe + Screenshot', async ({ page }) => {
      await page.goto('/dev/komponenten');
      await expectFontsLoaded(page);
      await page.getByRole('button', { name: 'Frage stellen' }).click();
      const dialog = page.getByRole('dialog', { name: 'Frage an den Dozenten' });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute('data-variant', vp.width >= 768 ? 'panel' : 'sheet');
      await expectNoSeriousA11yViolations(page);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `sheet-${vp.label}.png`), animations: 'disabled' });
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    });
  });
}

test('Admin-Menü mobil (390 px)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dev/layout-admin');
  await expectFontsLoaded(page);
  await page.getByRole('button', { name: 'Menü öffnen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Menü' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('link', { name: /Externe Nachweise/ })).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  await expectNoSeriousA11yViolations(page);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'layout-admin-menue-390.png'), animations: 'disabled' });
});
