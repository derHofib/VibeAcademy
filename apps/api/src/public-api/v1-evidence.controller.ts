import { Controller, Get, Inject, NotFoundException, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DbService } from '../db/db.service';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage';
import { ApiKey, ApiScoped } from './api-key.guard';
import { apiContext, type ApiPrincipal } from './api-key.service';
import { EVIDENCE_SELECT, evidenceDto } from './dto';
import { keysetPage, parsePage } from './pagination';
import { dateTimeFilter, enumFilter, Uuid, uuidFilter } from './uuid.pipe';

const KINDS = ['online', 'praesenz', 'live', 'extern'] as const;
const STATUS = ['ausstehend', 'erzeugt', 'fehler', 'widerrufen'] as const;

/** Nachweise (Metadaten, versiegeltes PDF, Prüfcode) – Scope evidence:read. */
@Controller('v1')
export class V1EvidenceController {
  constructor(
    private readonly db: DbService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  @Get('evidence')
  @ApiScoped('evidence:read')
  list(@ApiKey() k: ApiPrincipal, @Query() q: Record<string, string>) {
    const page = parsePage(q);
    const status = enumFilter(q.status, 'status', STATUS);
    const p = [
      uuidFilter(q.personId, 'personId'), enumFilter(q.kind, 'kind', KINDS), uuidFilter(q.invitationId, 'invitationId'),
      uuidFilter(q.externalRecordId, 'externalRecordId'), dateTimeFilter(q.createdSince, 'createdSince'), status,
    ];
    return this.db.txAs(apiContext(k), async (c) => {
      const r = await keysetPage(c, {
        select: EVIDENCE_SELECT,
        from: 'evidence e',
        where: [
          '($1::uuid IS NULL OR app.evidence_person_id(e.id) = $1)', '($2::text IS NULL OR e.kind = $2)', '($3::uuid IS NULL OR e.invitation_id = $3)',
          '($4::uuid IS NULL OR e.external_record_id = $4)', '($5::timestamptz IS NULL OR e.created_at >= $5)',
          `($6::text IS NULL OR ($6 = 'widerrufen' AND e.revoked_at IS NOT NULL) OR ($6 <> 'widerrufen' AND e.revoked_at IS NULL AND e.status = $6))`,
        ],
        params: p,
        keys: [['e.created_at', 'timestamptz'], ['e.id', 'uuid']],
        page,
      });
      return { data: r.rows.map(evidenceDto), nextCursor: r.nextCursor };
    });
  }

  /** Prüfcode (wie auf dem Nachweis gedruckt) im eigenen Mandanten auflösen. */
  @Get('evidence/verify/:code')
  @ApiScoped('evidence:read')
  verify(@ApiKey() k: ApiPrincipal, @Param('code') code: string) {
    if (!/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/.test(code)) throw new NotFoundException('Nachweis nicht gefunden');
    return this.db.txAs(apiContext(k), async (c) => {
      const r = (await c.query(`SELECT ${EVIDENCE_SELECT} FROM evidence e WHERE e.verify_code = upper($1)`, [code])).rows[0];
      if (!r) throw new NotFoundException('Nachweis nicht gefunden');
      const dto = evidenceDto(r);
      return { valid: dto.status === 'erzeugt', ...dto };
    });
  }

  @Get('evidence/:id')
  @ApiScoped('evidence:read')
  get(@ApiKey() k: ApiPrincipal, @Param('id', Uuid) id: string) {
    return this.db.txAs(apiContext(k), async (c) => {
      const r = (await c.query(`SELECT ${EVIDENCE_SELECT} FROM evidence e WHERE e.id = $1`, [id])).rows[0];
      if (!r) throw new NotFoundException('Nachweis nicht gefunden');
      return evidenceDto(r);
    });
  }

  /** Versiegeltes PDF (unverändert aus dem WORM-Speicher; SHA-256 = sha256 der Metadaten). */
  @Get('evidence/:id/pdf')
  @ApiScoped('evidence:read')
  async pdf(@ApiKey() k: ApiPrincipal, @Param('id', Uuid) id: string, @Res() res: Response) {
    const r = await this.db.txAs(apiContext(k), async (c) => (await c.query(`SELECT pdf_key, nachweis_nr, pdf_sha256 FROM evidence WHERE id = $1 AND status = 'erzeugt'`, [id])).rows[0]);
    if (!r) throw new NotFoundException('Nachweis nicht gefunden oder noch nicht erzeugt');
    const pdf = await this.storage.get('evidence', r.pdf_key);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="${r.nachweis_nr}.pdf"`);
    res.setHeader('cache-control', 'private, no-store');
    res.setHeader('x-content-sha256', r.pdf_sha256);
    res.send(pdf);
  }
}
