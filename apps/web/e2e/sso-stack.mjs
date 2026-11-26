/**
 * E2E-Umgebung für die Firmenanmeldung (E-36), ein Prozess:
 *  - frische Testdatenbank (Bootstrap + alle Migrationen, wird beim Beenden gelöscht)
 *  - API aus apps/api/dist auf Port 3180 mit PUBLIC_BASE_URL=http://127.0.0.1:5180 und SSO_ALLOW_HTTP_ISSUER=true
 *  - Vite auf Port 5180 mit Proxy /api → 3180
 * Der Test-IdP läuft im Playwright-Prozess (e2e/sso-flow.spec.ts, Port 5181).
 * Voraussetzung: Postgres/Redis (scripts/local-services.sh start), `pnpm --filter @sn/api build`.
 */
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const require = createRequire(import.meta.url);
const { createTestDb } = require('../../../packages/db/dist/testing.cjs');
const { loadConfig } = require('../../api/dist/config.js');
const { createApp } = require('../../api/dist/create-app.js');

const API_PORT = 3180;
const WEB_PORT = 5180;

const db = await createTestDb();
const storage = mkdtempSync(join(tmpdir(), 'sn-sso-e2e-'));
const config = loadConfig({
  NODE_ENV: 'development',
  DATABASE_URL: db.appUrl,
  REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:63799',
  REDIS_PREFIX: `sne2e:${randomBytes(4).toString('hex')}:`,
  SESSION_SECRET: randomBytes(32).toString('hex'),
  HMAC_MASTER_SECRET: randomBytes(32).toString('hex'),
  PUBLIC_BASE_URL: `http://127.0.0.1:${WEB_PORT}`,
  API_PORT: String(API_PORT),
  SSO_ALLOW_HTTP_ISSUER: 'true',
  SSO_DOMAIN_VERIFICATION: 'trust',
  STORAGE_DRIVER: 'fs',
  STORAGE_DIR: storage,
  SEAL_MODE: 'none',
  RUN_WORKERS: 'true',
});
const app = await createApp({ config });
await app.listen(API_PORT, '127.0.0.1');

const { createServer } = await import('vite');
const vite = await createServer({
  configFile: new URL('../vite.config.ts', import.meta.url).pathname,
  root: new URL('..', import.meta.url).pathname,
  server: { port: WEB_PORT, strictPort: true, host: '127.0.0.1', proxy: { '/api': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: false } } },
});
await vite.listen();
console.log(`SSO-E2E bereit: http://127.0.0.1:${WEB_PORT} (API ${API_PORT}, DB ${db.name})`);

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await vite.close().catch(() => undefined);
  await app.close().catch(() => undefined);
  await db.drop().catch(() => undefined);
  rmSync(storage, { recursive: true, force: true });
  process.exit(0);
}
// Nests Shutdown-Hooks beenden den Prozess sofort – hier selbst aufräumen (Testdatenbank löschen).
process.removeAllListeners('SIGTERM');
process.removeAllListeners('SIGINT');
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
