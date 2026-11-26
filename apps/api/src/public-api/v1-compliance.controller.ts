import { Controller, Get, Query } from '@nestjs/common';
import { Clock } from '../common/clock';
import { DbService } from '../db/db.service';
import { ApiKey, ApiScoped } from './api-key.guard';
import { apiContext, systemContext, type ApiPrincipal } from './api-key.service';
import { complianceDto, qualificationDto, requirementDto } from './dto';
import { keysetPage, parsePage } from './pagination';
import { enumFilter, uuidFilter } from './uuid.pipe';

const STATES = ['gueltig', 'laeuft_ab', 'abgelaufen', 'fehlt', 'befreit'] as const;

/** Pflichtmatrix je Person × Anforderung, Qualifikationen und Anforderungen – Scope compliance:read. */
@Controller('v1')
export class V1ComplianceController {
  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
  ) {}

  /**
   * Erfüllungsstand (wie in der Pflichtmatrix, Stichtag jetzt). Die Berechnung braucht Einladungen, Anwesenheiten und
   * externe Nachweise – sie läuft nach der Scope-Prüfung im Systemkontext des Mandanten; ausgegeben werden nur IDs und Status.
   */
  @Get('compliance')
  @ApiScoped('compliance:read')
  list(@ApiKey() k: ApiPrincipal, @Query() q: Record<string, string>) {
    const page = parsePage(q);
    const p = [
      this.clock.now(), uuidFilter(q.personId, 'personId'), uuidFilter(q.requirementId, 'requirementId'), uuidFilter(q.qualificationId, 'qualificationId'),
      enumFilter(q.state, 'state', STATES), uuidFilter(q.orgUnitId, 'orgUnitId'),
    ];
    return this.db.txAs(systemContext(k), async (c) => {
      const r = await keysetPage(c, {
        select: `cs.person_id, cs.requirement_id, cs.qualification_id, cs.training_id, cs.state, cs.exempt, cs.last_completed_on::text AS last_completed_on,
                 cs.valid_until::text AS valid_until, cs.expires_on::text AS expires_on, cs.interval_months, cs.grace_days, cs.source, cs.source_id`,
        from: 'app.compliance($1) cs',
        where: [
          '($2::uuid IS NULL OR cs.person_id = $2)', '($3::uuid IS NULL OR cs.requirement_id = $3)', '($4::uuid IS NULL OR cs.qualification_id = $4)',
          '($5::text IS NULL OR cs.state = $5)',
          `($6::uuid IS NULL OR cs.person_id IN (SELECT p.id FROM person p WHERE p.org_unit_id IN (
              WITH RECURSIVE units AS (SELECT id FROM org_unit WHERE id = $6 UNION SELECT o.id FROM org_unit o JOIN units u ON o.parent_id = u.id)
              SELECT id FROM units)))`,
        ],
        params: p,
        keys: [['cs.person_id', 'uuid'], ['cs.requirement_id', 'uuid']],
        page,
      });
      return { at: (p[0] as Date).toISOString(), data: r.rows.map(complianceDto), nextCursor: r.nextCursor };
    });
  }

  @Get('qualifications')
  @ApiScoped('compliance:read')
  qualifications(@ApiKey() k: ApiPrincipal, @Query() q: Record<string, string>) {
    const page = parsePage(q);
    return this.db.txAs(apiContext(k), async (c) => {
      const r = await keysetPage(c, {
        select: 'q.id, q.name, q.description, q.created_at', from: 'qualification q', where: [], params: [],
        keys: [['q.created_at', 'timestamptz'], ['q.id', 'uuid']], page,
      });
      return { data: r.rows.map(qualificationDto), nextCursor: r.nextCursor };
    });
  }

  @Get('requirements')
  @ApiScoped('compliance:read')
  requirements(@ApiKey() k: ApiPrincipal, @Query() q: Record<string, string>) {
    const page = parsePage(q);
    const p = [uuidFilter(q.qualificationId, 'qualificationId'), uuidFilter(q.trainingId, 'trainingId')];
    return this.db.txAs(apiContext(k), async (c) => {
      const r = await keysetPage(c, {
        select: 'r.id, r.qualification_id, r.training_id, r.interval_months, r.grace_days, r.reinvite_days, r.auto_invite, r.active, r.created_at',
        from: 'requirement r',
        where: ['($1::uuid IS NULL OR r.qualification_id = $1)', '($2::uuid IS NULL OR r.training_id = $2)'],
        params: p,
        keys: [['r.created_at', 'timestamptz'], ['r.id', 'uuid']],
        page,
      });
      return { data: r.rows.map(requirementDto), nextCursor: r.nextCursor };
    });
  }
}
