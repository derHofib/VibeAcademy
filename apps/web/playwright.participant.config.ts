import { defineConfig, devices } from '@playwright/test';

const PORT = 5175;
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * Teilnehmer-Ablauf gegen die echte API (Port 3000, muss laufen: Postgres/Redis, `node apps/api/dist/main.js`).
 * Vite startet auf 5175 mit Proxy /api → 3000.
 * Start: pnpm --filter @sn/web exec playwright test -c playwright.participant.config.ts --trace off
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /participant.*\.spec\.ts/,
  fullyParallel: true,
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
