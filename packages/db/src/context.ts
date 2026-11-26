import pg from 'pg';

/** Sicherheitskontext einer Transaktion (E-04). Kommt immer aus der Server-Sitzung, nie aus dem Client. */
export interface DbContext {
  tenantId?: string | null;
  accountId?: string | null;
  personId?: string | null;
  roles?: readonly string[];
}

export type Queryable = Pick<pg.PoolClient, 'query'>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function check(id: string | null | undefined, name: string): string {
  if (id == null) return '';
  if (!UUID.test(id)) throw new Error(`DbContext.${name} ist keine UUID`);
  return id;
}

/** Setzt den Kontext für die laufende Transaktion (set_config(..., is_local = true)). */
export async function applyContext(client: Queryable, ctx: DbContext): Promise<void> {
  const roles = (ctx.roles ?? []).join(',');
  if (/[^a-z_,]/.test(roles)) throw new Error('DbContext.roles enthält ungültige Zeichen');
  await client.query(
    `SELECT set_config('app.tenant_id', $1, true), set_config('app.account_id', $2, true),
            set_config('app.person_id', $3, true), set_config('app.roles', $4, true)`,
    [check(ctx.tenantId, 'tenantId'), check(ctx.accountId, 'accountId'), check(ctx.personId, 'personId'), roles],
  );
}

/**
 * Führt fn in einer Transaktion mit gesetztem Kontext aus. Commit bei Erfolg, Rollback bei Fehler.
 * Der Kontext endet mit der Transaktion – Verbindungen im Pool tragen keinen Kontext weiter.
 */
export async function withContext<T>(pool: pg.Pool, ctx: DbContext, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await applyContext(client, ctx);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
