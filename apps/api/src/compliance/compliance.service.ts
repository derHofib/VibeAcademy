import { Injectable } from '@nestjs/common';
import { addMonths, reinviteOn, type ComplianceState } from '@sn/shared';
import type pg from 'pg';

export interface ComplianceFilter {
  orgUnitId?: string | null;
  state?: ComplianceState | null;
  qualificationId?: string | null;
  requirementId?: string | null;
  personId?: string | null;
}

export interface ComplianceRow {
  personId: string;
  personName: string;
  personalnr: string | null;
  orgUnitId: string | null;
  orgUnitName: string | null;
  requirementId: string;
  qualificationId: string;
  qualificationName: string;
  trainingId: string;
  trainingTitle: string;
  trainingFormat: string;
  intervalMonths: number;
  graceDays: number;
  state: ComplianceState;
  lastCompletedOn: string | null;
  validUntil: string | null;
  expiresOn: string | null;
  /** Tag der automatischen Wiedereinladung bzw. des Hinweises „neuen Termin buchen“ */
  reinviteOn: string | null;
  source: string | null;
  sourceId: string | null;
}

const d = (v: unknown): string | null => (v == null ? null : v instanceof Date ? berlinDateOf(v) : String(v).slice(0, 10));
/** pg liefert `date` als lokale Mitternacht – Datumsteile direkt übernehmen. */
const berlinDateOf = (v: Date) => `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
export const pgDate = d;

/** Erfüllungsstand je Person × Anforderung (Pflichtmatrix, Schritt 2.1). Läuft mit der RLS des Aufrufers. */
@Injectable()
export class ComplianceService {
  async rows(c: pg.PoolClient, at: Date, f: ComplianceFilter = {}): Promise<ComplianceRow[]> {
    const r = await c.query(
      `WITH RECURSIVE units AS (
         SELECT id FROM org_unit WHERE id = $2::uuid
         UNION SELECT o.id FROM org_unit o JOIN units u ON o.parent_id = u.id)
       SELECT cs.*, p.name AS person_name, p.personalnr, p.org_unit_id, o.name AS org_unit_name,
              q.name AS qualification_name, t.titel AS training_title, t.format AS training_format
         FROM app.compliance($1) cs
         JOIN person p ON p.id = cs.person_id
         LEFT JOIN org_unit o ON o.id = p.org_unit_id
         JOIN qualification q ON q.id = cs.qualification_id
         JOIN training t ON t.id = cs.training_id
        WHERE ($2::uuid IS NULL OR p.org_unit_id IN (SELECT id FROM units))
          AND ($3::text IS NULL OR cs.state = $3)
          AND ($4::uuid IS NULL OR cs.qualification_id = $4)
          AND ($5::uuid IS NULL OR cs.requirement_id = $5)
          AND ($6::uuid IS NULL OR cs.person_id = $6)
        ORDER BY p.name, q.name, t.titel`,
      [at, f.orgUnitId ?? null, f.state ?? null, f.qualificationId ?? null, f.requirementId ?? null, f.personId ?? null],
    );
    return r.rows.map((x) => {
      const validUntil = d(x.valid_until);
      return {
        personId: x.person_id,
        personName: x.person_name,
        personalnr: x.personalnr,
        orgUnitId: x.org_unit_id,
        orgUnitName: x.org_unit_name,
        requirementId: x.requirement_id,
        qualificationId: x.qualification_id,
        qualificationName: x.qualification_name,
        trainingId: x.training_id,
        trainingTitle: x.training_title,
        trainingFormat: x.training_format,
        intervalMonths: x.interval_months,
        graceDays: x.grace_days,
        state: x.state,
        lastCompletedOn: d(x.last_completed_on),
        validUntil,
        expiresOn: d(x.expires_on),
        reinviteOn: validUntil ? reinviteOn(validUntil, x.reinvite_days) : null,
        source: x.source,
        sourceId: x.source_id,
      };
    });
  }

  summarize(rows: Array<{ state: ComplianceState }>) {
    const count = (s: ComplianceState) => rows.filter((r) => r.state === s).length;
    const relevant = rows.filter((r) => r.state !== 'befreit').length;
    const erfuellt = count('gueltig') + count('laeuft_ab');
    return {
      total: rows.length,
      gueltig: count('gueltig'),
      laeuft_ab: count('laeuft_ab'),
      abgelaufen: count('abgelaufen'),
      fehlt: count('fehlt'),
      befreit: count('befreit'),
      erfuellungsquote: relevant ? Math.round((erfuellt / relevant) * 100) : null,
    };
  }

  /** Gültigkeitsvorschlag: Intervall aus der Anforderung, sonst aus den Einstellungen der Schulung. */
  async intervalFor(c: pg.PoolClient, requirementId: string | null, trainingId: string | null): Promise<number | null> {
    if (requirementId) {
      const r = (await c.query('SELECT interval_months FROM requirement WHERE id = $1', [requirementId])).rows[0];
      if (r) return r.interval_months;
    }
    if (trainingId) {
      const r = (
        await c.query(
          `SELECT coalesce((SELECT min(interval_months) FROM requirement q WHERE q.training_id = t.id AND q.active),
                           (t.settings->>'intervalMonths')::int) AS m FROM training t WHERE t.id = $1`,
          [trainingId],
        )
      ).rows[0];
      return r?.m ?? null;
    }
    return null;
  }

  proposeValidUntil(heldOn: string | null, months: number | null): string | null {
    return heldOn && months ? addMonths(heldOn, months) : null;
  }
}
