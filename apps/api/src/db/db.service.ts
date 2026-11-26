import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { withContext, type DbContext } from '@sn/db';
import pg from 'pg';
import { currentRequest } from '../common/request-context';

export const PG_POOL = Symbol('PG_POOL');

/** Ergebnis einer Datenbankoperation läuft immer in einer Transaktion mit RLS-Kontext (E-04). */
@Injectable()
export class DbService implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) readonly pool: pg.Pool) {}

  /** Kontext aus der aktuellen Server-Sitzung. */
  requestContext(): DbContext {
    const r = currentRequest();
    return {
      tenantId: r?.session?.tenantId ?? null,
      accountId: r?.session?.accountId ?? null,
      personId: r?.session?.kind === 'invitation' ? r.session.personId : null,
      roles: r?.roles ?? [],
    };
  }

  /** Transaktion im Kontext des aktuellen Requests. */
  tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    return withContext(this.pool, this.requestContext(), fn);
  }

  /** Transaktion mit explizitem Kontext (Jobs, Systemaufgaben, Login-Abläufe). */
  txAs<T>(ctx: DbContext, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    return withContext(this.pool, ctx, fn);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
