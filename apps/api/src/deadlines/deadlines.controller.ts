import { BadRequestException, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { Roles } from '../auth/decorators';
import { currentRequest } from '../common/request-context';
import { DbService } from '../db/db.service';
import { DeadlineService } from './deadline.service';

@Controller()
export class DeadlinesController {
  constructor(
    private readonly deadlines: DeadlineService,
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** Fristen-Scan für den eigenen Mandanten sofort auslösen (idempotent). Sonst nächtlich 02:00 Europe/Berlin für alle. */
  @Post('admin/deadlines/run')
  @Roles('admin', 'verantwortlich')
  @HttpCode(200)
  async run() {
    const report = await this.deadlines.runOne(currentRequest()!.session!.tenantId!);
    await this.db.tx((c) => this.audit.record(c, { entity: 'deadlines', action: 'run_manual', payload: { ...report } }));
    return report;
  }

  /** Fristen-Protokoll (Erinnerungen, Eskalationen, Wiedereinladungen), optional je Einladung oder Person. */
  @Get('deadlines/notices')
  @Roles('admin', 'verantwortlich', 'auditor')
  notices(@Query('invitation') invitation?: string, @Query('person') person?: string) {
    for (const v of [invitation, person]) if (v && !z.uuid().safeParse(v).success) throw new BadRequestException('Ungültiger Filter');
    return this.db.tx(async (c) =>
      (
        await c.query(
          `SELECT key, kind, stage, invitation_id, person_id, requirement_id, cardinality(notification_ids) AS messages, created_at
             FROM deadline_notice
            WHERE ($1::uuid IS NULL OR invitation_id = $1) AND ($2::uuid IS NULL OR person_id = $2)
            ORDER BY created_at DESC LIMIT 500`,
          [invitation ?? null, person ?? null],
        )
      ).rows,
    );
  }
}
