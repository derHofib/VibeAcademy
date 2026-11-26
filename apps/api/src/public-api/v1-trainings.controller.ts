import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { ApiKey, ApiScoped } from './api-key.guard';
import { apiContext, type ApiPrincipal } from './api-key.service';
import { TRAINING_FROM, TRAINING_SELECT, trainingDto, VERSION_SELECT, versionDto } from './dto';
import { keysetPage, parsePage } from './pagination';
import { dateTimeFilter, enumFilter, Uuid } from './uuid.pipe';

/** Schulungen und Versionen (nur Metadaten, keine Inhalte) – Scope trainings:read. */
@Controller('v1')
export class V1TrainingsController {
  constructor(private readonly db: DbService) {}

  @Get('trainings')
  @ApiScoped('trainings:read')
  list(@ApiKey() k: ApiPrincipal, @Query() q: Record<string, string>) {
    const page = parsePage(q);
    const format = enumFilter(q.format, 'format', ['online', 'praesenz', 'hybrid', 'extern'] as const);
    const archived = enumFilter(q.archived, 'archived', ['true', 'false'] as const);
    const updatedSince = dateTimeFilter(q.updatedSince, 'updatedSince');
    return this.db.txAs(apiContext(k), async (c) => {
      const r = await keysetPage(c, {
        select: TRAINING_SELECT,
        from: TRAINING_FROM,
        where: [
          '($1::text IS NULL OR t.format = $1)',
          `($2::text IS NULL OR ($2 = 'true') = (t.archived_at IS NOT NULL))`,
          '($3::timestamptz IS NULL OR t.updated_at >= $3)',
        ],
        params: [format, archived, updatedSince],
        keys: [['t.updated_at', 'timestamptz'], ['t.id', 'uuid']],
        page,
      });
      return { data: r.rows.map(trainingDto), nextCursor: r.nextCursor };
    });
  }

  @Get('trainings/:id')
  @ApiScoped('trainings:read')
  get(@ApiKey() k: ApiPrincipal, @Param('id', Uuid) id: string) {
    return this.db.txAs(apiContext(k), async (c) => {
      const r = (await c.query(`SELECT ${TRAINING_SELECT} FROM ${TRAINING_FROM} WHERE t.id = $1`, [id])).rows[0];
      if (!r) throw new NotFoundException('Schulung nicht gefunden');
      const versions = (await c.query(`SELECT ${VERSION_SELECT} FROM training_version v WHERE v.training_id = $1 ORDER BY v.version_no, v.created_at`, [id])).rows;
      return { ...trainingDto(r), versions: versions.map(versionDto) };
    });
  }

  @Get('trainings/:id/versions')
  @ApiScoped('trainings:read')
  versions(@ApiKey() k: ApiPrincipal, @Param('id', Uuid) id: string) {
    return this.db.txAs(apiContext(k), async (c) => {
      const t = await c.query('SELECT 1 FROM training WHERE id = $1', [id]);
      if (!t.rowCount) throw new NotFoundException('Schulung nicht gefunden');
      const rows = (await c.query(`SELECT ${VERSION_SELECT} FROM training_version v WHERE v.training_id = $1 ORDER BY v.version_no, v.created_at`, [id])).rows;
      return { data: rows.map(versionDto), nextCursor: null };
    });
  }
}
