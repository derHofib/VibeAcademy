import { defineConfig, devices } from '@playwright/test';

const PORT = 5176;
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * Verwaltungs-Ablauf (Phase 1, 1.11/1.12) gegen die echte API (Port 3000 muss laufen: Postgres/Redis, `node apps/api/dist/main.js`).
 * Vite startet auf 5176 mit Proxy /api → 3000.
 * Start: pnpm --filter @sn/web exec playwright test -c playwright.admin.config.ts --trace off
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /admin.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 240_000,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'off',
    ...devices['Desktop Chrome'],
    deviceScaleFactor: 1,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command: `pnpm vite --port ${PORT} --strictPort --host 127.0.0.1`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
