import { defineConfig, devices } from '@playwright/test';

const PORT = 5181;
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * Englischer Teilnehmer-Ablauf + FES-Test-Anbieter (Phase 3, E-39/E-40) gegen die echte API
 * (Port 3000, muss laufen: Postgres/Redis, `node apps/api/dist/main.js`). Vite startet auf 5181 mit Proxy /api → 3000.
 * Der Browser bleibt deutsch eingestellt – die Sprache kommt aus der Person.
 * Start: pnpm --filter @sn/web exec playwright test -c playwright.i18n.config.ts --trace off
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /i18n-flow\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 180_000,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'off',
    ...devices['Desktop Chrome'],
    deviceScaleFactor: 1,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    acceptDownloads: true,
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command: `pnpm vite --port ${PORT} --strictPort --host 127.0.0.1`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
