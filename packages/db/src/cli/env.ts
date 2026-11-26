import { config } from 'dotenv';
import { resolve } from 'node:path';

// .env aus dem Repo-Root laden (falls vorhanden); echte Umgebungsvariablen haben Vorrang.
config({ path: resolve(import.meta.dirname, '../../../../.env'), quiet: true });

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Umgebungsvariable ${name} fehlt (siehe .env.example)`);
  return v;
}
