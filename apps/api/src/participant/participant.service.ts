import { Injectable, NotFoundException } from '@nestjs/common';
import type { DbContext } from '@sn/db';
import type pg from 'pg';
import { currentRequest } from '../common/request-context';
import { DbService } from '../db/db.service';

export interface ParticipantCtx {
  tenantId: string;
  personId: string;
  invitationId: string;
  accountId: string | null;
}

/**
 * Prüft, ob die aktuelle Sitzung auf eine Einladung zugreifen darf, und liefert den Kontext dafür:
 *  - Einladungslink-Sitzung: nur genau diese Einladung
 *  - Konto: Einladungen aller mit dem Konto verknüpften Personen, mandantenübergreifend (E-25)
 */
@Injectable()
export class ParticipantService {
  constructor(private readonly db: DbService) {}

  async resolve(invitationId: string): Promise<ParticipantCtx> {
    const s = currentRequest()?.session;
    if (s?.kind === 'invitation') {
      if (s.invitationId !== invitationId) throw new NotFoundException('Einladung nicht gefunden');
      return { tenantId: s.tenantId, personId: s.personId, invitationId, accountId: null };
    }
    if (s?.kind === 'account') {
      const r = await this.db.txAs({}, (c) =>
        c.query('SELECT * FROM app.invitation_for_account($1, $2)', [invitationId, s.accountId]),
      );
      if (r.rowCount) return { tenantId: r.rows[0].tenant_id, personId: r.rows[0].person_id, invitationId, accountId: s.accountId };
    }
    throw new NotFoundException('Einladung nicht gefunden');
  }

  /** Lesender Kontext als Teilnehmer (RLS: nur eigene Daten). */
  read<T>(p: ParticipantCtx, fn: (c: pg.PoolClient) => Promise<T>) {
    return this.db.txAs(this.ctx(p, ['teilnehmer']), fn);
  }

  /** Schreibender Kontext: Systemrolle im Mandanten der Einladung – erst nach geprüfter Berechtigung verwenden. */
  write<T>(p: ParticipantCtx, fn: (c: pg.PoolClient) => Promise<T>) {
    return this.db.txAs(this.ctx(p, ['system', 'teilnehmer']), fn);
  }

  private ctx(p: ParticipantCtx, roles: string[]): DbContext {
    return { tenantId: p.tenantId, personId: p.personId, accountId: p.accountId, roles };
  }
}
