import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestDb, type TestDb } from '@sn/db/testing';
import request from 'supertest';
import { loadConfig } from '../src/config';
import { createApp } from '../src/create-app';
import type { Provider } from '@nestjs/common';

export interface Harness {
  app: NestExpressApplication;
  db: TestDb;
  agent(): Promise<Client>;
  close(): Promise<void>;
}

/** Supertest-Agent mit Cookie-Jar und automatischem CSRF-Header. */
export class Client {
  constructor(
    readonly http: ReturnType<typeof request.agent>,
    private readonly csrf: string,
  ) {}
  get(url: string) {
    return this.http.get(url);
  }
  post(url: string, body?: object) {
    return this.http.post(url).set('x-csrf-token', this.csrf).send(body ?? {});
  }
  patch(url: string, body?: object) {
    return this.http.patch(url).set('x-csrf-token', this.csrf).send(body ?? {});
  }
  upload(url: string, field: string, file: Buffer, name: string, fields: Record<string, string> = {}) {
    let r = this.http.post(url).set('x-csrf-token', this.csrf).attach(field, file, name);
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    return r;
  }
  delete(url: string) {
    return this.http.delete(url).set('x-csrf-token', this.csrf);
  }
}

export async function startHarness(overrides: Provider[] = [], env: Record<string, string> = {}): Promise<Harness> {
  const db = await createTestDb();
  const storageDir = mkdtempSync(join(tmpdir(), 'sn-storage-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: db.appUrl,
    REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:63799',
    REDIS_PREFIX: `sntest:${randomBytes(4).toString('hex')}:`,
    SESSION_SECRET: randomBytes(32).toString('hex'),
    HMAC_MASTER_SECRET: randomBytes(32).toString('hex'),
    PUBLIC_BASE_URL: 'http://localhost:5173',
    RUN_WORKERS: 'true',
    STORAGE_DRIVER: 'fs',
    STORAGE_DIR: storageDir,
    ...sealEnv(),
    ...env,
  });
  const app = await createApp({ config, overrides });
  await app.init();
  return {
    app,
    db,
    async agent() {
      const http = request.agent(app.getHttpServer());
      const r = await http.get('/api/auth/csrf');
      return new Client(http, r.body.token);
    },
    async close() {
      await app.close();
      await db.drop();
      rmSync(storageDir, { recursive: true, force: true });
    },
  };
}

/** Wartet, bis eine Bedingung erfüllt ist (für asynchrone Jobs). */
export async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, timeoutMs = 5000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('Zeitüberschreitung beim Warten');
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Siegel in Tests: pyHanko aus scripts/setup-seal.sh, falls eingerichtet; sonst ohne Siegel. */
export const ROOT = join(__dirname, '..', '..', '..');
export function sealEnv(): Record<string, string> {
  const venv = join(ROOT, '.local/seal-venv/bin/python');
  const certs = join(ROOT, '.local/certs');
  if (!existsSync(venv) || !existsSync(join(certs, 'seal.p12'))) return { SEAL_MODE: 'none' };
  return {
    SEAL_MODE: 'pyhanko', SEAL_PYTHON: venv, SEAL_P12_PATH: join(certs, 'seal.p12'), SEAL_P12_PASSWORD: 'dev-seal',
    SEAL_DEV_TSA_KEY: join(certs, 'tsa.key'), SEAL_DEV_TSA_CERT: join(certs, 'tsa.pem'),
  };
}
