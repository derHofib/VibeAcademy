import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { DbService } from '../db/db.service';

@Controller('audit')
@Roles('admin', 'verantwortlich', 'auditor')
export class AuditController {
  constructor(private readonly db: DbService) {}

  @Get()
  list(@Query('entity') entity?: string, @Query('id') id?: string) {
    return this.db.tx(async (c) => {
      const r = await c.query(
        `SELECT id, seq, ts, actor_account_id, actor_person_id, entity, entity_id, action, payload, hash
           FROM audit_event
          WHERE ($1::text IS NULL OR entity = $1) AND ($2::text IS NULL OR entity_id = $2)
          ORDER BY seq DESC LIMIT 500`,
        [entity ?? null, id ?? null],
      );
      return r.rows;
    });
  }

  @Get('verify')
  verify() {
    return this.db.tx(async (c) => {
      const r = (await c.query('SELECT * FROM app.audit_verify()')).rows[0];
      return { ok: r.ok, checked: Number(r.checked), firstBadId: r.first_bad_id, firstBadSeq: r.first_bad_seq, reason: r.reason };
    });
  }
}
