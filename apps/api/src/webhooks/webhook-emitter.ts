import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { AnyWebhookEventType } from './events';

type Client = Pick<pg.PoolClient, 'query'>;
type Data = Record<string, unknown>;

const log = new Logger('Webhooks');
const SAVEPOINT = 'sn_webhook_emit';

/** Fachliche Haupt-ID je Typ → Idempotenzschlüssel „<typ>:<id>“ (ein Ereignis je Vorgang, auch bei Wiederholung). */
const PRIMARY: Partial<Record<AnyWebhookEventType, string>> = {
  'invitation.completed': 'invitationId',
  'evidence.created': 'evidenceId',
  'external_record.approved': 'externalRecordId',
  'attendance.confirmed': 'attendanceId',
};

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));

/**
 * Nutzlast vervollständigen – nur IDs, Status und Daten, nie Namen/E-Mail (E-37). Läuft mit der RLS des Aufrufers;
 * ist der Datensatz dort nicht sichtbar, bleibt es bei den übergebenen Angaben.
 */
async function enrich(c: Client, type: AnyWebhookEventType, data: Data): Promise<Data> {
  const one = async (sql: string, id: unknown) => (id ? (await c.query(sql, [id])).rows[0] : undefined);
  switch (type) {
    case 'invitation.completed': {
      const r = await one(
        `SELECT i.id, i.run_id, i.person_id, r.training_id, i.status, i.completed_at FROM invitation i JOIN run r ON r.id = i.run_id WHERE i.id = $1`,
        data.invitationId,
      );
      return r ? { invitationId: r.id, runId: r.run_id, personId: r.person_id, trainingId: r.training_id, status: r.status, completedAt: iso(r.completed_at) } : data;
    }
    case 'evidence.created': {
      const r = await one(
        `SELECT e.id, e.kind, e.status, e.invitation_id, e.attendance_id, e.external_record_id, e.nachweis_nr, e.pdf_sha256,
                app.evidence_person_id(e.id) AS person_id FROM evidence e WHERE e.id = $1`,
        data.evidenceId,
      );
      return r
        ? {
            evidenceId: r.id, kind: r.kind, status: r.status, personId: r.person_id, invitationId: r.invitation_id, attendanceId: r.attendance_id,
            externalRecordId: r.external_record_id, nachweisNr: r.nachweis_nr, sha256: r.pdf_sha256,
          }
        : data;
    }
    case 'external_record.approved': {
      const r = await one(
        `SELECT x.id, x.person_id, x.requirement_id, x.qualification_id, x.training_id, x.status, x.held_on::text AS held_on, x.valid_until::text AS valid_until
           FROM external_record x WHERE x.id = $1`,
        data.externalRecordId,
      );
      return r
        ? {
            externalRecordId: r.id, personId: r.person_id, requirementId: r.requirement_id, qualificationId: r.qualification_id, trainingId: r.training_id,
            status: r.status, heldOn: r.held_on, validUntil: r.valid_until,
          }
        : data;
    }
    case 'attendance.confirmed': {
      const r = await one(
        `SELECT a.id, a.run_id, a.person_id, a.invitation_id, a.completeness_state, a.release, a.confirmed_at FROM attendance a WHERE a.id = $1`,
        data.attendanceId,
      );
      return r
        ? {
            attendanceId: r.id, runId: r.run_id, personId: r.person_id, invitationId: r.invitation_id, completeness: r.completeness_state,
            credited: r.completeness_state === 'vollstaendig' || r.release === 'freigegeben', confirmedAt: iso(r.confirmed_at),
          }
        : data;
    }
    default:
      return data;
  }
}

/**
 * Webhook-Ereignisse in der laufenden fachlichen Transaktion eintragen (Outbox, E-37).
 * Fehler beim Eintragen brechen die fachliche Transaktion nie ab (Savepoint); zugestellt wird nach dem Commit
 * durch den WebhookDispatcher.
 */
export class WebhookEmitter {
  /**
   * @returns Ereignis-ID oder null (kein Endpunkt abonniert, Duplikat oder Fehler)
   */
  static async emit(
    c: Client,
    tenantId: string,
    type: AnyWebhookEventType,
    data: Data,
    opts: { endpointId?: string; dedupKey?: string; subscribed?: boolean } = {},
  ): Promise<string | null> {
    await c.query(`SAVEPOINT ${SAVEPOINT}`);
    try {
      if (!opts.endpointId && opts.subscribed === undefined) {
        const sub = (await c.query('SELECT app.webhook_subscribed($1) AS ok', [type])).rows[0]?.ok;
        if (!sub) {
          await c.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
          return null;
        }
      }
      const payload = await enrich(c, type, data);
      const key = PRIMARY[type];
      const dedup = opts.dedupKey ?? (key && payload[key] ? `${type}:${String(payload[key])}` : `${type}:${randomUUID()}`);
      const r = await c.query('SELECT app.webhook_emit($1, $2, $3, $4, $5) AS id', [tenantId, type, payload, dedup, opts.endpointId ?? null]);
      await c.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
      return (r.rows[0]?.id as string | null) ?? null;
    } catch (e) {
      await c.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`).catch(() => undefined);
      log.error(`Webhook-Ereignis ${type} konnte nicht eingetragen werden: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Fristen-Job: Stand Person × Anforderung mit dem letzten Lauf vergleichen (compliance_snapshot) und für jede
   * Statusänderung `compliance.state_changed` auslösen. Der erste Lauf eines Mandanten legt nur den Ausgangsstand an.
   * Muss im Systemkontext des Mandanten laufen.
   */
  static async complianceChanged(c: Client, tenantId: string, at: Date): Promise<number> {
    const SP = 'sn_webhook_compliance';
    await c.query(`SAVEPOINT ${SP}`);
    try {
      const cur = (
        await c.query(
          `SELECT person_id, requirement_id, qualification_id, training_id, state, valid_until::text AS valid_until FROM app.compliance($1)`,
          [at],
        )
      ).rows as Array<{ person_id: string; requirement_id: string; qualification_id: string; training_id: string; state: string; valid_until: string | null }>;
      const prevRows = (await c.query('SELECT person_id, requirement_id, state, valid_until::text AS valid_until FROM compliance_snapshot')).rows;
      const prev = new Map<string, { state: string; valid_until: string | null }>(prevRows.map((r) => [`${r.person_id}:${r.requirement_id}`, r]));
      const baseline = prev.size === 0;
      const changed = cur.filter((r) => {
        const p = prev.get(`${r.person_id}:${r.requirement_id}`);
        return !p || p.state !== r.state || p.valid_until !== r.valid_until;
      });
      if (changed.length) {
        await c.query(
          `INSERT INTO compliance_snapshot (person_id, requirement_id, state, valid_until, updated_at)
           SELECT * , $5::timestamptz FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::date[])
           ON CONFLICT (person_id, requirement_id) DO UPDATE SET state = excluded.state, valid_until = excluded.valid_until, updated_at = excluded.updated_at`,
          [changed.map((r) => r.person_id), changed.map((r) => r.requirement_id), changed.map((r) => r.state), changed.map((r) => r.valid_until), at],
        );
      }
      if (prevRows.length) {
        // nicht mehr relevante Paare (Anforderung inaktiv, Qualifikation entzogen, Austritt) aus dem Stand entfernen
        await c.query(
          `DELETE FROM compliance_snapshot s WHERE NOT EXISTS (
             SELECT 1 FROM unnest($1::uuid[], $2::uuid[]) AS x(p, r) WHERE x.p = s.person_id AND x.r = s.requirement_id)`,
          [cur.map((r) => r.person_id), cur.map((r) => r.requirement_id)],
        );
      }
      let emitted = 0;
      const stateChanges = baseline ? [] : changed.filter((r) => prev.get(`${r.person_id}:${r.requirement_id}`)?.state !== r.state);
      if (stateChanges.length && (await c.query('SELECT app.webhook_subscribed($1) AS ok', ['compliance.state_changed'])).rows[0]?.ok) {
        for (const r of stateChanges) {
          const id = await WebhookEmitter.emit(
            c, tenantId, 'compliance.state_changed',
            {
              personId: r.person_id, requirementId: r.requirement_id, qualificationId: r.qualification_id, trainingId: r.training_id,
              previousState: prev.get(`${r.person_id}:${r.requirement_id}`)?.state ?? null, state: r.state, validUntil: r.valid_until, checkedAt: at.toISOString(),
            },
            { dedupKey: `compliance.state_changed:${r.person_id}:${r.requirement_id}:${at.toISOString()}`, subscribed: true },
          );
          if (id) emitted++;
        }
      }
      await c.query(`RELEASE SAVEPOINT ${SP}`);
      return emitted;
    } catch (e) {
      await c.query(`ROLLBACK TO SAVEPOINT ${SP}`).catch(() => undefined);
      log.error(`Pflichtmatrix-Vergleich für Webhooks fehlgeschlagen: ${(e as Error).message}`);
      return 0;
    }
  }
}
