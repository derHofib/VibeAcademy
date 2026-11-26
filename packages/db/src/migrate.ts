import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// funktioniert aus src/ (tsx/vitest) und dist/ (ESM und CJS)
const here = typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(here, '..', 'migrations');

/** Führt alle SQL-Migrationen in Reihenfolge aus, jede in einer eigenen Transaktion. Prüft Checksummen. */
export async function migrate(migratorUrl: string, dir = MIGRATIONS_DIR, log = console.log): Promise<string[]> {
  const c = new pg.Client({ connectionString: migratorUrl });
  await c.connect();
  const applied: string[] = [];
  try {
    await c.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Map<string, string>(
      (await c.query('SELECT name, checksum FROM public.schema_migrations')).rows.map((r) => [r.name, r.checksum]),
    );
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      const sql = readFileSync(join(dir, f), 'utf8');
      const sum = createHash('sha256').update(sql).digest('hex');
      const prev = done.get(f);
      if (prev) {
        if (prev !== sum) throw new Error(`Migration ${f} wurde nach dem Ausführen verändert (Checksumme weicht ab)`);
        continue;
      }
      await c.query('BEGIN');
      try {
        await c.query(sql);
        await c.query('INSERT INTO public.schema_migrations (name, checksum) VALUES ($1, $2)', [f, sum]);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw new Error(`Migration ${f} fehlgeschlagen: ${(e as Error).message}`, { cause: e });
      }
      applied.push(f);
      log(`✓ ${f}`);
    }
  } finally {
    await c.end();
  }
  return applied;
}
