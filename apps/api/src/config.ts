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
