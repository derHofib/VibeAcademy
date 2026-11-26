import { Injectable } from '@nestjs/common';
import type pg from 'pg';
import { currentRequest } from '../common/request-context';

export interface AuditEntry {
  entity: string;
  entityId?: string | null;
  action: string;
  payload?: Record<string, unknown>;
}

/**
 * Schreibt Audit-Ereignisse in die Hash-Kette (E-11) – immer in der fachlichen Transaktion,
 * damit Änderung und Protokoll gemeinsam committen. Ohne RETURNING (SELECT-Policy greift sonst).
 */
@Injectable()
export class AuditService {
  async record(client: pg.PoolClient, e: AuditEntry): Promise<void> {
    const ipHash = currentRequest()?.ipHash;
    const payload = { ...(e.payload ?? {}), ...(ipHash ? { ip_hash: ipHash } : {}) };
    await client.query('INSERT INTO audit_event (entity, entity_id, action, payload) VALUES ($1, $2, $3, $4)', [
      e.entity,
      e.entityId ?? null,
      e.action,
      payload,
    ]);
  }
}
