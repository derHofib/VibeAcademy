import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { ZodBody } from '../common/errors';
import { DbService } from '../db/db.service';
import { actorPayload } from '../webhooks/actor';
import { ApiKey, ApiScoped } from './api-key.guard';
import { apiContext, type ApiPrincipal } from './api-key.service';
import { ORG_UNIT_SELECT, orgUnitDto, PERSON_SELECT, personDto } from './dto';
import { keysetPage, parsePage } from './pagination';
import { dateTimeFilter, Uuid, uuidFilter } from './uuid.pipe';

const PersonInput = z.object({
  name: z.string().trim().min(1, 'Bitte einen Namen angeben').max(200),
  externalId: z.string().trim().min(1).max(255).nullish(),
  personalnr: z.string().trim().min(1).max(50).nullish(),
  email: z.email('Ungültige E-Mail-Adresse').trim().toLowerCase().max(254).nullish(),
  mobile: z.string().trim().max(50).nullish(),
  orgUnitId: z.uuid('Ungültige Org-Einheit').nullish(),
  external: z.boolean().optional(),
  language: z.enum(['de', 'en'], { error: 'Sprache: de oder en' }).optional(),
  exitDate: z.iso.date('Datum im Format JJJJ-MM-TT').nullish(),
});
const PersonPatch = PersonInput.partial().refine((b) => Object.values(b).some((v) => v !== undefined), { message: 'Keine Änderungen' });
type PersonInput = z.infer<typeof PersonInput>;

const COLS: Record<string, string> = {
  name: 'name', externalId: 'external_id', personalnr: 'personalnr', email: 'email', mobile: 'mobil', orgUnitId: 'org_unit_id', external: 'extern',
  language: 'sprache', exitDate: 'austritt_am',
};

function mapUnique(e: unknown): never {
  const m = (e as { constraint?: string }).constraint;
  if (m === 'person_email_uq') throw new ConflictException('Diese E-Mail-Adresse ist bereits einer Person zugeordnet');
  if (m === 'person_personalnr_uq') throw new ConflictException('Diese Personalnummer ist bereits vergeben');
  if (m === 'person_external_id_uq') throw new ConflictException('Diese externe ID ist bereits vergeben');
  if ((e as { code?: string }).code === '23503') throw new BadRequestException('Org-Einheit nicht gefunden');
  throw e;
}

/** Personen und Org-Einheiten (Scopes persons:read / persons:write). */
@Controller('v1')
export class V1PersonsController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  @Get('persons')
  @ApiScoped('persons:read')
  list(@ApiKey() k: ApiPrincipal, @Query() q: Record<string, string>) {
    const page = parsePage(q);
    const f = {
      externalId: q.externalId || null, personalnr: q.personalnr || null, email: q.email?.trim().toLowerCase() || null,
      orgUnitId: uuidFilter(q.orgUnitId, 'orgUnitId'), updatedSince: dateTimeFilter(q.updatedSince, 'updatedSince'),
    };
    return this.db.txAs(apiContext(k), async (c) => {
      const r = await keysetPage(c, {
        select: PERSON_SELECT,
        from: 'person p',
        where: [
          '($1::text IS NULL OR p.external_id = $1)', '($2::text IS NULL OR p.personalnr = $2)', '($3::citext IS NULL OR p.email = $3::citext)',
          '($4::uuid IS NULL OR p.org_unit_id = $4)', '($5::timestamptz IS NULL OR p.updated_at >= $5)',
        ],
        params: [f.externalId, f.personalnr, f.email, f.orgUnitId, f.updatedSince],
        keys: [['p.updated_at', 'timestamptz'], ['p.id', 'uuid']],
        page,
      });
      return { data: r.rows.map(personDto), nextCursor: r.nextCursor };
    });
  }

  @Get('persons/:id')
  @ApiScoped('persons:read')
  get(@ApiKey() k: ApiPrincipal, @Param('id', Uuid) id: string) {
    return this.db.txAs(apiContext(k), async (c) => {
      const r = (await c.query(`SELECT ${PERSON_SELECT} FROM person p WHERE p.id = $1`, [id])).rows[0];
      if (!r) throw new NotFoundException('Person nicht gefunden');
      return personDto(r);
    });
  }

  @Post('persons')
  @ApiScoped('persons:write')
  create(@ApiKey() k: ApiPrincipal, @Body(new ZodBody(PersonInput)) b: PersonInput) {
    return this.db
      .txAs(apiContext(k), async (c) => {
        const r = await c.query(
          `INSERT INTO person AS p (name, external_id, personalnr, email, mobil, org_unit_id, extern, sprache, austritt_am)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${PERSON_SELECT}`,
          [b.name, b.externalId ?? null, b.personalnr ?? null, b.email ?? null, b.mobile ?? null, b.orgUnitId ?? null, b.external ?? false, b.language ?? 'de', b.exitDate ?? null],
        );
        await this.audit.record(c, { entity: 'person', entityId: r.rows[0].id, action: 'created', payload: actorPayload({ kind: 'api-key', keyId: k.keyId }) });
        return personDto(r.rows[0]);
      })
      .catch(mapUnique);
  }

  @Patch('persons/:id')
  @ApiScoped('persons:write')
  update(@ApiKey() k: ApiPrincipal, @Param('id', Uuid) id: string, @Body(new ZodBody(PersonPatch)) b: Partial<PersonInput>) {
    const entries = Object.entries(b).filter(([key, v]) => v !== undefined && COLS[key]);
    return this.db
      .txAs(apiContext(k), async (c) => {
        const r = await c.query(
          `UPDATE person p SET ${entries.map(([key], i) => `${COLS[key]} = $${i + 2}`).join(', ')} WHERE p.id = $1 RETURNING ${PERSON_SELECT}`,
          [id, ...entries.map(([, v]) => v)],
        );
        if (!r.rowCount) throw new NotFoundException('Person nicht gefunden');
        await this.audit.record(c, {
          entity: 'person', entityId: id, action: 'updated', payload: actorPayload({ kind: 'api-key', keyId: k.keyId }, { fields: entries.map(([key]) => key) }),
        });
        return personDto(r.rows[0]);
      })
      .catch(mapUnique);
  }

  @Get('org-units')
  @ApiScoped('persons:read')
  orgUnits(@ApiKey() k: ApiPrincipal, @Query() q: Record<string, string>) {
    const page = parsePage(q);
    return this.db.txAs(apiContext(k), async (c) => {
      const r = await keysetPage(c, {
        select: ORG_UNIT_SELECT, from: 'org_unit o', where: [], params: [], keys: [['o.created_at', 'timestamptz'], ['o.id', 'uuid']], page,
      });
      return { data: r.rows.map(orgUnitDto), nextCursor: r.nextCursor };
    });
  }
}
