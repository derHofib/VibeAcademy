import { defineConfig, devices } from '@playwright/test';

const PORT = 5180;
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * Firmenanmeldung (SSO, E-36) Ende-zu-Ende: eigene Testdatenbank + API (Port 3180) + Vite (Port 5180) aus e2e/sso-stack.mjs,
 * Test-IdP im Playwright-Prozess (Port 5181). Voraussetzungen: Postgres/Redis laufen, `pnpm --filter @sn/api build`.
 * Start: pnpm --filter @sn/web exec playwright test -c playwright.sso.config.ts --trace off
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /sso-flow\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 120_000,
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
    command: 'node e2e/sso-stack.mjs',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    // SIGTERM statt SIGKILL, damit sso-stack.mjs die Testdatenbank wieder löscht
    gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 },
  },
});
