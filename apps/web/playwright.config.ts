import { defineConfig, devices } from '@playwright/test';

const PORT = 5174;
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * Design-System-Prüfung (Phase 0.7): axe + Screenshots 390/1440 px.
 * Start: pnpm --filter @sn/web e2e   (entspricht `playwright test --trace off`)
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'off',
    ...devices['Desktop Chrome'],
    deviceScaleFactor: 1,
    locale: 'de-DE',
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command: `pnpm vite --port ${PORT} --strictPort --host 127.0.0.1`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
