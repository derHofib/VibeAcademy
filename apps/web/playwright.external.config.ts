import { defineConfig, devices } from '@playwright/test';

const PORT = 5179;
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * Externe Nachweise + Pflichtmatrix (Phase 2, Schritte 2.9/2.10/2.13) gegen die echte API (Port 3000, muss laufen:
 * Postgres/Redis, `node apps/api/dist/main.js`, Tesseract für die Texterkennung). Vite startet auf 5179 mit Proxy /api → 3000.
 * Start: pnpm --filter @sn/web exec playwright test -c playwright.external.config.ts --trace off
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /external.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'off',
    ...devices['Desktop Chrome'],
    deviceScaleFactor: 1,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    acceptDownloads: true,
    // Datumsfelder im deutschen Format (TT.MM.JJJJ) wie auf deutschen Geräten
    launchOptions: { args: ['--lang=de-DE'], env: { ...process.env, LANG: 'de_DE.UTF-8', LANGUAGE: 'de' } },
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command: `pnpm vite --port ${PORT} --strictPort --host 127.0.0.1`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
