import { BadRequestException } from '@nestjs/common';
import type pg from 'pg';

export interface PageQuery {
  limit: number;
  cursor: string | null;
}

export interface Page<T> {
  data: T[];
  /** Für die nächste Seite als `cursor` übergeben; null = letzte Seite */
  nextCursor: string | null;
}

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export function parsePage(q: { limit?: unknown; cursor?: unknown }): PageQuery {
  let limit = DEFAULT_LIMIT;
  if (q.limit !== undefined && q.limit !== '') {
    limit = Number(q.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new BadRequestException(`„limit“ muss zwischen 1 und ${MAX_LIMIT} liegen`);
  }
  const cursor = typeof q.cursor === 'string' && q.cursor ? q.cursor : null;
  return { limit, cursor };
}

export const encodeCursor = (keys: string[]) => Buffer.from(JSON.stringify(keys)).toString('base64url');

export function decodeCursor(cursor: string, n: number): string[] {
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'string' && x.length < 100)) return v;
  } catch {
    // unten
  }
  throw new BadRequestException('Ungültiger Cursor');
}

export interface KeysetSpec {
  /** Spaltenliste ohne SELECT */
  select: string;
  /** FROM-Teil ohne FROM (inkl. JOINs) */
  from: string;
  where: string[];
  params: unknown[];
  /** Sortierschlüssel (SQL-Ausdruck, Typ) – stabil und eindeutig in Kombination, z. B. [updated_at, id] */
  keys: Array<[string, 'timestamptz' | 'uuid' | 'text' | 'numeric']>;
  page: PageQuery;
}

/** Keyset-Paginierung (stabil bei gleichzeitigen Änderungen, keine Offsets). */
export async function keysetPage<R = Record<string, unknown>>(c: Pick<pg.PoolClient, 'query'>, s: KeysetSpec): Promise<{ rows: R[]; nextCursor: string | null }> {
  const params = [...s.params];
  const where = [...s.where];
  if (s.page.cursor) {
    const vals = decodeCursor(s.page.cursor, s.keys.length);
    const placeholders = vals.map((v, i) => {
      params.push(v);
      return `$${params.length}::${s.keys[i]![1]}`;
    });
    where.push(`(${s.keys.map(([k]) => k).join(', ')}) > (${placeholders.join(', ')})`);
  }
  params.push(s.page.limit + 1);
  const keySel = s.keys.map(([k], i) => `(${k})::text AS _k${i}`).join(', ');
  const sql = `SELECT ${s.select}, ${keySel} FROM ${s.from} WHERE ${where.length ? where.join(' AND ') : 'true'}
               ORDER BY ${s.keys.map(([k]) => k).join(', ')} LIMIT $${params.length}`;
  const rows = (await c.query(sql, params)).rows as Array<R & Record<string, string>>;
  const more = rows.length > s.page.limit;
  const out = rows.slice(0, s.page.limit);
  const last = out[out.length - 1];
  return { rows: out, nextCursor: more && last ? encodeCursor(s.keys.map((_, i) => last[`_k${i}`]!)) : null };
}
