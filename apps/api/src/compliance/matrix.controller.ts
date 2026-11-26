import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { COMPLIANCE_STATES, type ComplianceState } from '@sn/shared';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { Roles } from '../auth/decorators';
import { Clock } from '../common/clock';
import { ZodBody } from '../common/errors';
import { currentRequest } from '../common/request-context';
import { DbService } from '../db/db.service';
import { ComplianceService } from './compliance.service';

const QualificationInput = z.object({
  name: z.string().trim().min(1, 'Bitte einen Namen angeben').max(200),
  description: z.string().trim().max(2000).nullish(),
});
const RequirementInput = z.object({
  qualificationId: z.uuid(),
  trainingId: z.uuid(),
  intervalMonths: z.number().int().min(1).max(240),
  graceDays: z.number().int().min(0).max(365).default(0),
  reinviteDays: z.number().int().min(0).max(365).default(30),
  autoInvite: z.boolean().default(true),
  active: z.boolean().default(true),
});
const RequirementPatch = RequirementInput.omit({ qualificationId: true, trainingId: true }).partial();
const PersonQualifications = z.object({ qualificationIds: z.array(z.uuid()).max(200) });
const AssignPersons = z.object({ personIds: z.array(z.uuid()).min(1).max(5000), since: z.iso.date().nullish() });
const Exemption = z.object({
  personId: z.uuid(),
  requirementId: z.uuid(),
  reason: z.string().trim().min(3, 'Bitte einen Grund angeben').max(1000),
  validUntil: z.iso.date().nullish(),
});

const STAFF = ['admin', 'verantwortlich'] as const;
const isStaffish = () => (currentRequest()?.roles ?? []).some((r) => ['admin', 'verantwortlich', 'auditor'].includes(r));

function mapUnique(e: unknown): never {
  const c = (e as { constraint?: string; code?: string }).constraint;
  if (c === 'qualification_name_uq') throw new BadRequestException('Diese Qualifikation gibt es bereits');
  if (c === 'requirement_qualification_id_training_id_key') throw new BadRequestException('Diese Anforderung gibt es bereits');
  if (c === 'compliance_exemption_person_id_requirement_id_key') throw new BadRequestException('Für diese Person gibt es bereits eine Ausnahme');
  if ((e as { code?: string }).code === '23503') throw new BadRequestException('Verknüpfter Datensatz nicht gefunden');
  throw e;
}

/** Pflichtmatrix (Schritt 2.1): Qualifikationen, Anforderungen, Zuordnung Person ↔ Qualifikation, Erfüllungsstand. */
@Controller()
export class MatrixController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly compliance: ComplianceService,
    private readonly clock: Clock,
  ) {}

  // ── Qualifikationen ──
  @Get('qualifications')
  @Roles('admin', 'verantwortlich', 'trainer', 'vorgesetzter', 'auditor')
  qualifications() {
    return this.db.tx(async (c) =>
      (
        await c.query(
          `SELECT q.id, q.name, q.description, q.created_at,
                  (SELECT count(*)::int FROM person_qualification pq WHERE pq.qualification_id = q.id) AS person_count,
                  (SELECT count(*)::int FROM requirement r WHERE r.qualification_id = q.id) AS requirement_count
             FROM qualification q ORDER BY lower(q.name)`,
        )
      ).rows,
    );
  }

  @Post('qualifications')
  @Roles(...STAFF)
  createQualification(@Body(new ZodBody(QualificationInput)) b: z.infer<typeof QualificationInput>) {
    return this.db.tx(async (c) => {
      const r = await c.query('INSERT INTO qualification (name, description) VALUES ($1, $2) RETURNING id', [b.name, b.description ?? null]).catch(mapUnique);
      await this.audit.record(c, { entity: 'qualification', entityId: r.rows[0].id, action: 'created', payload: { name: b.name } });
      return { id: r.rows[0].id as string };
    });
  }

  @Patch('qualifications/:id')
  @Roles(...STAFF)
  updateQualification(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(QualificationInput.partial())) b: Partial<z.infer<typeof QualificationInput>>) {
    return this.db.tx(async (c) => {
      const r = await c
        .query('UPDATE qualification SET name = coalesce($2, name), description = CASE WHEN $3::boolean THEN $4 ELSE description END WHERE id = $1', [
          id, b.name ?? null, b.description !== undefined, b.description ?? null,
        ])
        .catch(mapUnique);
      if (!r.rowCount) throw new NotFoundException('Qualifikation nicht gefunden');
      await this.audit.record(c, { entity: 'qualification', entityId: id, action: 'updated', payload: b });
      return { ok: true };
    });
  }

  @Delete('qualifications/:id')
  @Roles(...STAFF)
  deleteQualification(@Param('id', ParseUUIDPipe) id: string) {
    return this.db.tx(async (c) => {
      const r = await c.query('DELETE FROM qualification WHERE id = $1', [id]);
      if (!r.rowCount) throw new NotFoundException('Qualifikation nicht gefunden');
      await this.audit.record(c, { entity: 'qualification', entityId: id, action: 'deleted' });
      return { ok: true };
    });
  }

  @Get('qualifications/:id/persons')
  @Roles('admin', 'verantwortlich', 'vorgesetzter', 'auditor')
  qualificationPersons(@Param('id', ParseUUIDPipe) id: string) {
    return this.db.tx(async (c) =>
      (
        await c.query(
          `SELECT p.id, p.name, p.personalnr, o.name AS org_unit_name, pq.since::text AS since
             FROM person_qualification pq JOIN person p ON p.id = pq.person_id LEFT JOIN org_unit o ON o.id = p.org_unit_id
            WHERE pq.qualification_id = $1 ORDER BY p.name`,
          [id],
        )
      ).rows,
    );
  }

  @Post('qualifications/:id/persons')
  @Roles(...STAFF)
  assign(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(AssignPersons)) b: z.infer<typeof AssignPersons>) {
    return this.db.tx(async (c) => {
      const r = await c
        .query(
          `INSERT INTO person_qualification (person_id, qualification_id, since)
           SELECT p.id, $1, $3 FROM person p WHERE p.id = ANY($2::uuid[]) ON CONFLICT DO NOTHING`,
          [id, b.personIds, b.since ?? null],
        )
        .catch(mapUnique);
      await this.audit.record(c, { entity: 'qualification', entityId: id, action: 'persons_assigned', payload: { count: r.rowCount } });
      return { assigned: r.rowCount ?? 0 };
    });
  }

  @Delete('qualifications/:id/persons/:personId')
  @Roles(...STAFF)
  unassign(@Param('id', ParseUUIDPipe) id: string, @Param('personId', ParseUUIDPipe) personId: string) {
    return this.db.tx(async (c) => {
      const r = await c.query('DELETE FROM person_qualification WHERE qualification_id = $1 AND person_id = $2', [id, personId]);
      if (!r.rowCount) throw new NotFoundException('Zuordnung nicht gefunden');
      await this.audit.record(c, { entity: 'qualification', entityId: id, action: 'person_unassigned', payload: { personId } });
      return { ok: true };
    });
  }

  @Get('persons/:id/qualifications')
  @Roles('admin', 'verantwortlich', 'vorgesetzter', 'auditor')
  personQualifications(@Param('id', ParseUUIDPipe) id: string) {
    return this.db.tx(async (c) =>
      (
        await c.query(
          `SELECT q.id, q.name, pq.since::text AS since FROM person_qualification pq JOIN qualification q ON q.id = pq.qualification_id
            WHERE pq.person_id = $1 ORDER BY lower(q.name)`,
          [id],
        )
      ).rows,
    );
  }

  /** Qualifikationen einer Person setzen (ersetzt die bisherige Zuordnung). */
  @Put('persons/:id/qualifications')
  @Roles(...STAFF)
  setPersonQualifications(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(PersonQualifications)) b: z.infer<typeof PersonQualifications>) {
    return this.db.tx(async (c) => {
      const p = await c.query('SELECT 1 FROM person WHERE id = $1', [id]);
      if (!p.rowCount) throw new NotFoundException('Person nicht gefunden');
      await c.query('DELETE FROM person_qualification WHERE person_id = $1 AND NOT (qualification_id = ANY($2::uuid[]))', [id, b.qualificationIds]);
      await c
        .query(
          `INSERT INTO person_qualification (person_id, qualification_id)
           SELECT $1, q.id FROM qualification q WHERE q.id = ANY($2::uuid[]) ON CONFLICT DO NOTHING`,
          [id, b.qualificationIds],
        )
        .catch(mapUnique);
      await this.audit.record(c, { entity: 'person', entityId: id, action: 'qualifications_set', payload: { qualificationIds: b.qualificationIds } });
      return { ok: true };
    });
  }

  // ── Anforderungen (Pflichtmatrix) ──
  @Get('requirements')
  @Roles('admin', 'verantwortlich', 'trainer', 'vorgesetzter', 'auditor')
  requirements() {
    return this.db.tx(async (c) =>
      (
        await c.query(
          `SELECT r.id, r.qualification_id, q.name AS qualification_name, r.training_id, t.titel AS training_title, t.format AS training_format,
                  r.interval_months, r.grace_days, r.reinvite_days, r.auto_invite, r.active, r.created_at,
                  (SELECT count(*)::int FROM person_qualification pq WHERE pq.qualification_id = r.qualification_id) AS person_count
             FROM requirement r JOIN qualification q ON q.id = r.qualification_id JOIN training t ON t.id = r.training_id
            ORDER BY lower(q.name), t.titel`,
        )
      ).rows,
    );
  }

  @Post('requirements')
  @Roles(...STAFF)
  createRequirement(@Body(new ZodBody(RequirementInput)) b: z.infer<typeof RequirementInput>) {
    return this.db.tx(async (c) => {
      const r = await c
        .query(
          `INSERT INTO requirement (qualification_id, training_id, interval_months, grace_days, reinvite_days, auto_invite, active)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [b.qualificationId, b.trainingId, b.intervalMonths, b.graceDays, b.reinviteDays, b.autoInvite, b.active],
        )
        .catch(mapUnique);
      await this.audit.record(c, { entity: 'requirement', entityId: r.rows[0].id, action: 'created', payload: b });
      return { id: r.rows[0].id as string };
    });
  }

  @Patch('requirements/:id')
  @Roles(...STAFF)
  updateRequirement(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(RequirementPatch)) b: z.infer<typeof RequirementPatch>) {
    const map: Record<string, string> = {
      intervalMonths: 'interval_months', graceDays: 'grace_days', reinviteDays: 'reinvite_days', autoInvite: 'auto_invite', active: 'active',
    };
    const entries = Object.entries(b).filter(([k, v]) => v !== undefined && map[k]);
    if (!entries.length) throw new BadRequestException('Keine Änderungen');
    return this.db.tx(async (c) => {
      const sets = entries.map(([k], i) => `${map[k]} = $${i + 2}`).join(', ');
      const r = await c.query(`UPDATE requirement SET ${sets} WHERE id = $1`, [id, ...entries.map(([, v]) => v)]);
      if (!r.rowCount) throw new NotFoundException('Anforderung nicht gefunden');
      await this.audit.record(c, { entity: 'requirement', entityId: id, action: 'updated', payload: Object.fromEntries(entries) });
      return { ok: true };
    });
  }

  @Delete('requirements/:id')
  @Roles(...STAFF)
  deleteRequirement(@Param('id', ParseUUIDPipe) id: string) {
    return this.db.tx(async (c) => {
      const r = await c.query('DELETE FROM requirement WHERE id = $1', [id]);
      if (!r.rowCount) throw new NotFoundException('Anforderung nicht gefunden');
      await this.audit.record(c, { entity: 'requirement', entityId: id, action: 'deleted' });
      return { ok: true };
    });
  }

  // ── Erfüllungsstand ──
  /**
   * GET /compliance?org_unit=&state=&qualification=&requirement=&person=
   * Vorgesetzte (ohne Verwaltungsrolle) sehen per RLS nur ihr Team und nur Status-Felder.
   */
  @Get('compliance')
  @Roles('admin', 'verantwortlich', 'vorgesetzter', 'auditor')
  list(
    @Query('org_unit') orgUnit?: string,
    @Query('state') state?: string,
    @Query('qualification') qualification?: string,
    @Query('requirement') requirement?: string,
    @Query('person') person?: string,
  ) {
    const uuid = (v: string | undefined, name: string) => {
      if (!v) return null;
      if (!z.uuid().safeParse(v).success) throw new BadRequestException(`Ungültiger Filter ${name}`);
      return v;
    };
    if (state && !COMPLIANCE_STATES.includes(state as ComplianceState)) throw new BadRequestException('Ungültiger Status');
    const at = this.clock.now();
    return this.db.tx(async (c) => {
      const rows = await this.compliance.rows(c, at, {
        orgUnitId: uuid(orgUnit, 'org_unit'), state: (state as ComplianceState) || null, qualificationId: uuid(qualification, 'qualification'),
        requirementId: uuid(requirement, 'requirement'), personId: uuid(person, 'person'),
      });
      const all = state ? await this.compliance.rows(c, at, { orgUnitId: uuid(orgUnit, 'org_unit') }) : rows;
      const requirements = (
        await c.query(
          `SELECT r.id, q.name AS qualification_name, t.titel AS training_title, t.format AS training_format, r.interval_months
             FROM requirement r JOIN qualification q ON q.id = r.qualification_id JOIN training t ON t.id = r.training_id
            WHERE r.active ORDER BY lower(q.name), t.titel`,
        )
      ).rows.map((r) => ({ id: r.id, qualificationName: r.qualification_name, trainingTitle: r.training_title, trainingFormat: r.training_format, intervalMonths: r.interval_months }));
      const full = isStaffish();
      return {
        asOf: at.toISOString(),
        summary: this.compliance.summarize(all),
        requirements,
        rows: full
          ? rows
          : rows.map((r) => ({
              personId: r.personId, personName: r.personName, orgUnitId: r.orgUnitId, orgUnitName: r.orgUnitName, requirementId: r.requirementId,
              qualificationId: r.qualificationId, qualificationName: r.qualificationName, trainingId: r.trainingId, trainingTitle: r.trainingTitle,
              trainingFormat: r.trainingFormat, state: r.state, validUntil: r.validUntil, expiresOn: r.expiresOn,
            })),
      };
    });
  }

  // ── Ausnahmen (befreit) ──
  @Get('compliance/exemptions')
  @Roles('admin', 'verantwortlich', 'auditor', 'vorgesetzter')
  exemptions() {
    return this.db.tx(async (c) =>
      (
        await c.query(
          `SELECT x.id, x.person_id, p.name AS person_name, x.requirement_id, q.name AS qualification_name, t.titel AS training_title,
                  x.reason, x.valid_until::text AS valid_until, x.created_at
             FROM compliance_exemption x JOIN person p ON p.id = x.person_id JOIN requirement r ON r.id = x.requirement_id
             JOIN qualification q ON q.id = r.qualification_id JOIN training t ON t.id = r.training_id ORDER BY p.name`,
        )
      ).rows,
    );
  }

  @Post('compliance/exemptions')
  @Roles(...STAFF)
  exempt(@Body(new ZodBody(Exemption)) b: z.infer<typeof Exemption>) {
    return this.db.tx(async (c) => {
      const r = await c
        .query('INSERT INTO compliance_exemption (person_id, requirement_id, reason, valid_until) VALUES ($1, $2, $3, $4) RETURNING id', [
          b.personId, b.requirementId, b.reason, b.validUntil ?? null,
        ])
        .catch(mapUnique);
      await this.audit.record(c, { entity: 'compliance_exemption', entityId: r.rows[0].id, action: 'created', payload: b });
      return { id: r.rows[0].id as string };
    });
  }

  @Delete('compliance/exemptions/:id')
  @Roles(...STAFF)
  @HttpCode(200)
  removeExemption(@Param('id', ParseUUIDPipe) id: string) {
    return this.db.tx(async (c) => {
      const r = await c.query('DELETE FROM compliance_exemption WHERE id = $1', [id]);
      if (!r.rowCount) throw new NotFoundException('Ausnahme nicht gefunden');
      await this.audit.record(c, { entity: 'compliance_exemption', entityId: id, action: 'deleted' });
      return { ok: true };
    });
  }
}
