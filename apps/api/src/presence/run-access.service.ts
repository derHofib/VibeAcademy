import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { DbContext } from '@sn/db';
import type pg from 'pg';
import { currentRequest } from '../common/request-context';
import { DbService } from '../db/db.service';
import type { ParticipantCtx } from '../participant/participant.service';

export interface ManageCtx {
  tenantId: string;
  accountId: string;
  runId: string;
}

/**
 * Zugriff auf Präsenz-/Live-Termine:
 *  - Organisator: admin/verantwortlich (alle Termine) oder Trainer des Termins
 *  - Teilnehmer: Einladung zu genau diesem Termin (Link-Sitzung oder verknüpftes Konto, E-25)
 * Schreibende Aktionen laufen danach im Systemkontext des Mandanten (E-27).
 */
@Injectable()
export class RunAccess {
  constructor(private readonly db: DbService) {}

  /** Termin + Mandant zu einer Frage/Kontrollfrage/Anwesenheit (ohne Mandantenkontext). */
  async ref(kind: 'question' | 'poll' | 'attendance', id: string): Promise<{ runId: string; tenantId: string }> {
    const args = [kind === 'question' ? id : null, kind === 'poll' ? id : null, kind === 'attendance' ? id : null];
    const r = (await this.db.txAs({}, (c) => c.query('SELECT * FROM app.live_ref($1, $2, $3)', args))).rows[0];
    if (!r) throw new NotFoundException('Nicht gefunden');
    return { runId: r.run_id, tenantId: r.tenant_id };
  }

  /** Darf die aktuelle Sitzung den Termin führen? (ohne Ausnahme → boolean) */
  async canManage(runId: string): Promise<ManageCtx | null> {
    const req = currentRequest();
    const s = req?.session;
    if (s?.kind !== 'account' || !s.tenantId) return null;
    const r = (
      await this.db.tx((c) =>
        c.query(
          `SELECT r.id, r.tenant_id, (r.trainer_person_id IS NOT NULL AND r.trainer_person_id IN (SELECT app.my_person_ids())) AS is_trainer
             FROM run r WHERE r.id = $1 AND r.typ IN ('termin','live_extern')`,
          [runId],
        ),
      )
    ).rows[0];
    if (!r) return null;
    const roles = req!.roles;
    if (roles.includes('admin') || roles.includes('verantwortlich') || (roles.includes('trainer') && r.is_trainer)) {
      return { tenantId: r.tenant_id, accountId: s.accountId, runId };
    }
    return null;
  }

  async manage(runId: string): Promise<ManageCtx> {
    const m = await this.canManage(runId);
    if (m) return m;
    const s = currentRequest()?.session;
    if (s?.kind === 'account' && s.tenantId) {
      const exists = await this.db.tx((c) => c.query(`SELECT 1 FROM run WHERE id = $1 AND typ IN ('termin','live_extern')`, [runId]));
      if (exists.rowCount) throw new ForbiddenException('Nur Organisator oder Trainer dieses Termins');
    }
    throw new NotFoundException('Termin nicht gefunden');
  }

  /** Systemkontext für den Organisator (Audit mit Konto als Akteur). */
  sys<T>(m: Pick<ManageCtx, 'tenantId' | 'accountId'>, fn: (c: pg.PoolClient) => Promise<T>) {
    return this.db.txAs({ tenantId: m.tenantId, accountId: m.accountId, roles: ['system'] }, fn);
  }

  /** Einladung der aktuellen Sitzung zu diesem Termin. */
  async participant(runId: string): Promise<ParticipantCtx | null> {
    const s = currentRequest()?.session;
    if (s?.kind === 'invitation') {
      const ok = await this.db.txAs({ tenantId: s.tenantId, roles: ['system'] }, (c) =>
        c.query('SELECT 1 FROM invitation WHERE id = $1 AND run_id = $2', [s.invitationId, runId]),
      );
      if (ok.rowCount) return { tenantId: s.tenantId, personId: s.personId, invitationId: s.invitationId, accountId: null };
      return null;
    }
    if (s?.kind === 'account') {
      const r = (await this.db.txAs({}, (c) => c.query('SELECT * FROM app.invitation_for_account_run($1, $2)', [runId, s.accountId]))).rows[0];
      if (r) return { tenantId: r.tenant_id, personId: r.person_id, invitationId: r.invitation_id, accountId: s.accountId };
    }
    return null;
  }

  async requireParticipant(runId: string): Promise<ParticipantCtx> {
    const p = await this.participant(runId);
    if (!p) throw new NotFoundException('Sie sind für diesen Termin nicht angemeldet');
    return p;
  }

  /** Teilnehmer-Schreibkontext (E-27). withPerson=false → ohne Personenbezug (anonyme Fragen, Audit ohne Akteur). */
  pctx(p: ParticipantCtx, withPerson = true): DbContext {
    return withPerson
      ? { tenantId: p.tenantId, personId: p.personId, accountId: p.accountId, roles: ['system', 'teilnehmer'] }
      : { tenantId: p.tenantId, roles: ['system'] };
  }
}
