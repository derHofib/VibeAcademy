import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { Roles } from '../auth/decorators';
import { ZodBody } from '../common/errors';
import { DbService } from '../db/db.service';

const PersonInput = z.object({
  name: z.string().trim().min(1, 'Bitte einen Namen angeben').max(200),
  personalnr: z.string().trim().max(50).nullish(),
  email: z.email('Ungültige E-Mail-Adresse').trim().toLowerCase().nullish().or(z.literal('').transform(() => null)),
  mobil: z.string().trim().max(50).nullish(),
  orgUnitId: z.uuid().nullish(),
  extern: z.boolean().default(false),
  birthdateUnder18: z.boolean().default(false),
  austrittAm: z.iso.date().nullish(),
  readingTimeFactor: z.number().min(1).max(5).default(1),
  /** Sprache für Teilnehmeroberfläche, Mails und Nachweis (E-39) */
  sprache: z.enum(['de', 'en']).optional(),
});
const PersonPatch = PersonInput.partial();
const OrgUnitInput = z.object({
  name: z.string().trim().min(1).max(200),
  parentId: z.uuid().nullish(),
  leiterPersonId: z.uuid().nullish(),
});
const ImportInput = z.object({ csv: z.string().min(1).max(2_000_000) });

const COLS: Record<string, string> = {
  name: 'name', personalnr: 'personalnr', email: 'email', mobil: 'mobil', orgUnitId: 'org_unit_id', extern: 'extern',
  birthdateUnder18: 'birthdate_under18', austrittAm: 'austritt_am', readingTimeFactor: 'reading_time_factor', sprache: 'sprache',
};

function mapUnique(e: unknown): never {
  const m = (e as { constraint?: string }).constraint;
  if (m === 'person_email_uq') throw new BadRequestException('Diese E-Mail-Adresse ist bereits einer Person zugeordnet');
  if (m === 'person_personalnr_uq') throw new BadRequestException('Diese Personalnummer ist bereits vergeben');
  throw e;
}

/** Einfaches CSV (Trennzeichen ; oder ,), erste Zeile = Kopf. Anführungszeichen werden unterstützt. */
export function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = (lines[0]!.match(/;/g)?.length ?? 0) >= (lines[0]!.match(/,/g)?.length ?? 0) ? ';' : ',';
  const split = (line: string) => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const head = split(lines[0]!).map((h) => h.toLowerCase());
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i] ?? `col${i}`, v])));
}

@Controller()
export class PersonsController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  @Get('persons')
  @Roles('admin', 'verantwortlich', 'vorgesetzter', 'auditor')
  list(@Query('q') q?: string, @Query('org') org?: string) {
    return this.db.tx(async (c) =>
      (
        await c.query(
          `SELECT p.id, p.name, p.personalnr, p.email, p.mobil, p.org_unit_id, o.name AS org_unit_name, p.extern,
                  p.birthdate_under18, p.austritt_am, p.reading_time_factor, p.account_id IS NOT NULL AS has_account, p.sprache
             FROM person p LEFT JOIN org_unit o ON o.id = p.org_unit_id
            WHERE ($1::text IS NULL OR p.name ILIKE '%' || $1 || '%' OR p.email ILIKE '%' || $1 || '%' OR p.personalnr = $1)
              AND ($2::uuid IS NULL OR p.org_unit_id = $2)
            ORDER BY p.name LIMIT 1000`,
          [q?.trim() || null, org || null],
        )
      ).rows,
    );
  }

  @Post('persons')
  @Roles('admin', 'verantwortlich')
  create(@Body(new ZodBody(PersonInput)) b: z.infer<typeof PersonInput>) {
    return this.db
      .tx(async (c) => {
        const r = await c.query(
          `INSERT INTO person (name, personalnr, email, mobil, org_unit_id, extern, birthdate_under18, austritt_am, reading_time_factor, sprache)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [b.name, b.personalnr ?? null, b.email ?? null, b.mobil ?? null, b.orgUnitId ?? null, b.extern, b.birthdateUnder18, b.austrittAm ?? null, b.readingTimeFactor, b.sprache ?? 'de'],
        );
        await this.audit.record(c, { entity: 'person', entityId: r.rows[0].id, action: 'created' });
        return { id: r.rows[0].id as string };
      })
      .catch(mapUnique);
  }

  @Patch('persons/:id')
  @Roles('admin', 'verantwortlich')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(PersonPatch)) b: z.infer<typeof PersonPatch>) {
    const entries = Object.entries(b).filter(([k, v]) => v !== undefined && COLS[k]);
    if (!entries.length) throw new BadRequestException('Keine Änderungen');
    return this.db
      .tx(async (c) => {
        const r = await c.query(
          `UPDATE person SET ${entries.map(([k], i) => `${COLS[k]} = $${i + 2}`).join(', ')} WHERE id = $1`,
          [id, ...entries.map(([, v]) => v)],
        );
        if (!r.rowCount) throw new NotFoundException('Person nicht gefunden');
        await this.audit.record(c, { entity: 'person', entityId: id, action: 'updated', payload: { fields: entries.map(([k]) => k) } });
        return { ok: true };
      })
      .catch(mapUnique);
  }

  /** CSV-Import: Spalten name, personalnr, email, mobil, org_einheit (Name; wird bei Bedarf angelegt). */
  @Post('persons/import')
  @Roles('admin', 'verantwortlich')
  import(@Body(new ZodBody(ImportInput)) b: z.infer<typeof ImportInput>) {
    const rows = parseCsv(b.csv);
    if (!rows.length) throw new BadRequestException('Die Datei enthält keine Zeilen');
    if (!('name' in rows[0]!)) throw new BadRequestException('Spalte „name“ fehlt');
    return this.db.tx(async (c) => {
      const units = new Map<string, string>(
        (await c.query('SELECT id, name FROM org_unit')).rows.map((r) => [r.name.toLowerCase(), r.id]),
      );
      let created = 0;
      let updated = 0;
      const errors: Array<{ zeile: number; fehler: string }> = [];
      for (const [i, row] of rows.entries()) {
        const parsed = PersonInput.safeParse({
          name: row.name, personalnr: row.personalnr || null, email: row.email || null, mobil: row.mobil || null,
        });
        if (!parsed.success) { errors.push({ zeile: i + 2, fehler: parsed.error.issues[0]!.message }); continue; }
        let orgId: string | null = null;
        const orgName = (row.org_einheit ?? row.abteilung ?? '').trim();
        if (orgName) {
          orgId = units.get(orgName.toLowerCase()) ?? null;
          if (!orgId) {
            orgId = (await c.query('INSERT INTO org_unit (name) VALUES ($1) RETURNING id', [orgName])).rows[0].id as string;
            units.set(orgName.toLowerCase(), orgId);
          }
        }
        const p = parsed.data;
        await c.query('SAVEPOINT row');
        try {
          const existing = p.personalnr
            ? (await c.query('SELECT id FROM person WHERE personalnr = $1', [p.personalnr])).rows[0]
            : p.email ? (await c.query('SELECT id FROM person WHERE email = $1', [p.email])).rows[0] : undefined;
          if (existing) {
            await c.query('UPDATE person SET name = $2, email = coalesce($3, email), mobil = coalesce($4, mobil), org_unit_id = coalesce($5, org_unit_id) WHERE id = $1',
              [existing.id, p.name, p.email ?? null, p.mobil ?? null, orgId]);
            updated++;
          } else {
            await c.query('INSERT INTO person (name, personalnr, email, mobil, org_unit_id) VALUES ($1, $2, $3, $4, $5)',
              [p.name, p.personalnr ?? null, p.email ?? null, p.mobil ?? null, orgId]);
            created++;
          }
          await c.query('RELEASE SAVEPOINT row');
        } catch (e) {
          await c.query('ROLLBACK TO SAVEPOINT row');
          errors.push({ zeile: i + 2, fehler: (e as { constraint?: string }).constraint ? 'E-Mail oder Personalnummer doppelt' : 'Zeile konnte nicht übernommen werden' });
        }
      }
      await this.audit.record(c, { entity: 'person', action: 'imported', payload: { created, updated, errors: errors.length } });
      return { created, updated, errors };
    });
  }

  @Get('org-units')
  orgUnits() {
    return this.db.tx(async (c) =>
      (await c.query(
        `SELECT o.id, o.name, o.parent_id, o.leiter_person_id, l.name AS leiter_name
           FROM org_unit o LEFT JOIN person l ON l.id = o.leiter_person_id ORDER BY o.name`,
      )).rows,
    );
  }

  @Post('org-units')
  @Roles('admin', 'verantwortlich')
  createOrgUnit(@Body(new ZodBody(OrgUnitInput)) b: z.infer<typeof OrgUnitInput>) {
    return this.db.tx(async (c) => {
      const r = await c.query('INSERT INTO org_unit (name, parent_id, leiter_person_id) VALUES ($1, $2, $3) RETURNING id', [b.name, b.parentId ?? null, b.leiterPersonId ?? null]);
      await this.audit.record(c, { entity: 'org_unit', entityId: r.rows[0].id, action: 'created', payload: { name: b.name } });
      return { id: r.rows[0].id as string };
    });
  }

  @Patch('org-units/:id')
  @Roles('admin', 'verantwortlich')
  updateOrgUnit(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(OrgUnitInput.partial())) b: Partial<z.infer<typeof OrgUnitInput>>) {
    return this.db.tx(async (c) => {
      if (b.parentId === id) throw new BadRequestException('Eine Einheit kann nicht ihr eigenes Elternteil sein');
      if (b.parentId) {
        const cycle = await c.query(
          `WITH RECURSIVE up AS (SELECT id, parent_id FROM org_unit WHERE id = $1 UNION SELECT o.id, o.parent_id FROM org_unit o JOIN up ON o.id = up.parent_id)
           SELECT 1 FROM up WHERE id = $2`,
          [b.parentId, id],
        );
        if (cycle.rowCount) throw new BadRequestException('Zirkuläre Zuordnung ist nicht erlaubt');
      }
      const r = await c.query(
        `UPDATE org_unit SET name = coalesce($2, name),
                parent_id = CASE WHEN $5 THEN $3 ELSE parent_id END,
                leiter_person_id = CASE WHEN $6 THEN $4 ELSE leiter_person_id END
          WHERE id = $1`,
        [id, b.name ?? null, b.parentId ?? null, b.leiterPersonId ?? null, b.parentId !== undefined, b.leiterPersonId !== undefined],
      );
      if (!r.rowCount) throw new NotFoundException('Org-Einheit nicht gefunden');
      await this.audit.record(c, { entity: 'org_unit', entityId: id, action: 'updated' });
      return { ok: true };
    });
  }

  @Delete('org-units/:id')
  @Roles('admin', 'verantwortlich')
  deleteOrgUnit(@Param('id', ParseUUIDPipe) id: string) {
    return this.db.tx(async (c) => {
      const r = await c.query('DELETE FROM org_unit WHERE id = $1', [id]);
      if (!r.rowCount) throw new NotFoundException('Org-Einheit nicht gefunden');
      await this.audit.record(c, { entity: 'org_unit', entityId: id, action: 'deleted' });
      return { ok: true };
    });
  }
}
