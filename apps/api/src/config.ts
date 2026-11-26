import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default('redis://127.0.0.1:63799'),
  REDIS_PREFIX: z.string().default('sn:'),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:5173'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET muss mindestens 32 Zeichen haben'),
  HMAC_MASTER_SECRET: z.string().min(32, 'HMAC_MASTER_SECRET muss mindestens 32 Zeichen haben'),
  MAIL_PROVIDER: z.enum(['log', 'smtp']).default('log'),
  MAIL_FROM: z.string().default('Schulungsnachweis <no-reply@example.org>'),
  SMTP_URL: z.string().optional(),
  SMS_PROVIDER: z.enum(['log']).default('log'),
  STORAGE_DRIVER: z.enum(['fs', 's3']).default('fs'),
  STORAGE_DIR: z.string().default('.local/storage'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('eu-central-1'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_BUCKET_UPLOADS: z.string().default('sn-uploads'),
  S3_BUCKET_EVIDENCE: z.string().default('sn-evidence'),
  /** Maximale PDF-Größe in MB */
  UPLOAD_MAX_MB: z.coerce.number().int().positive().default(50),
  /** Nachweis-PDF: playwright (lokales Chromium) oder gotenberg (Dienst, E-09) */
  PDF_RENDERER: z.enum(['playwright', 'gotenberg']).default('playwright'),
  GOTENBERG_URL: z.string().default('http://127.0.0.1:3001'),
  /** Siegel: pyhanko (PAdES-B-T, E-10) oder none (nur Entwicklung ohne Python) */
  SEAL_MODE: z.enum(['pyhanko', 'none']).default('pyhanko'),
  SEAL_PYTHON: z.string().default('python3'),
  SEAL_SCRIPT: z.string().default('infra/seal/seal.py'),
  SEAL_P12_PATH: z.string().optional(),
  SEAL_P12_PASSWORD: z.string().default(''),
  TSA_URL: z.string().default(''),
  SEAL_DEV_TSA_KEY: z.string().optional(),
  SEAL_DEV_TSA_CERT: z.string().optional(),
  /** Schriften für das Nachweis-PDF (woff2) */
  FONT_DIR: z.string().default('apps/web/public/fonts'),
  /** Aufbewahrung im WORM-Speicher ab Ablage (Jahre, E-24) */
  EVIDENCE_LOCK_YEARS: z.coerce.number().int().min(1).max(30).default(3),
  /** Web-Push (VAPID, E-12). Ohne Schlüssel: Push nur ins Log. Erzeugen: `npx web-push generate-vapid-keys` */
  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  VAPID_SUBJECT: z.string().default('mailto:admin@example.org'),
  /** Texterkennung externer Belege (E-18): Tesseract mit Sprachpaket deu */
  TESSERACT_BIN: z.string().default('tesseract'),
  OCR_LANG: z.string().default('deu'),
  /** Externe Nachweise: Upload-Grenze je Beleg in MB, Rückgängig-Frist nach Freigabe in Minuten */
  EXTERNAL_UPLOAD_MAX_MB: z.coerce.number().int().positive().default(20),
  EXTERNAL_UNDO_MINUTES: z.coerce.number().int().min(0).max(1440).default(10),
  RUN_WORKERS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type AppConfig = z.infer<typeof schema>;
export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Ungültige Konfiguration: ${msg}`);
  }
  return parsed.data;
}

import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

/** Relative Pfade aus der Konfiguration gelten ab dem Repo-Root (gesucht ab dem Arbeitsverzeichnis). */
export function repoPath(p: string): string {
  if (isAbsolute(p)) return p;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return join(dir, p);
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return join(process.cwd(), p);
}
