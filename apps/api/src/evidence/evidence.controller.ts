import { Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ParticipantRoute, Public, Roles } from '../auth/decorators';
import { RateLimitService } from '../common/rate-limit.service';
import { currentRequest } from '../common/request-context';
import { DbService } from '../db/db.service';
import { ParticipantService } from '../participant/participant.service';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage';

@Controller()
export class EvidenceController {
  constructor(
    private readonly db: DbService,
    private readonly participants: ParticipantService,
    private readonly rate: RateLimitService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** Öffentliche Echtheitsprüfung: nur Status, Nr., Hash, Datum, Schulung und Initialen (E-10). */
  @Public()
  @Get('verify/:code')
  async verify(@Param('code') code: string) {
    await this.rate.hit(`verify:${currentRequest()?.ipHash}`, 60, 600);
    if (!/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/.test(code)) throw new NotFoundException('Nachweis nicht gefunden');
    const r = (await this.db.txAs({}, (c) => c.query('SELECT * FROM app.verify_evidence($1)', [code]))).rows[0];
    if (!r) throw new NotFoundException('Nachweis nicht gefunden');
    return {
      status: r.status === 'erzeugt' ? 'gueltig' : r.status,
      nachweisNr: r.nachweis_nr,
      sha256: r.pdf_sha256,
      versiegeltAm: r.seal_ts,
      schulung: r.training_titel,
      version: r.version_no,
      teilnehmer: r.person_initialen,
      aussteller: r.tenant_name,
      art: r.kind,
    };
  }

  private async send(res: Response, key: string, name: string) {
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="${name}.pdf"`);
    res.setHeader('cache-control', 'private, no-store');
    res.send(await this.storage.get('evidence', key));
  }

  @ParticipantRoute()
  @Get('me/invitations/:id/evidence')
  async mine(@Param('id', ParseUUIDPipe) id: string) {
    const p = await this.participants.resolve(id);
    const r = await this.participants.read(p, async (c) =>
      (await c.query('SELECT id, status, verify_code, nachweis_nr, pdf_sha256, seal_ts FROM evidence WHERE invitation_id = $1', [id])).rows[0],
    );
    if (!r) throw new NotFoundException('Noch kein Nachweis vorhanden');
    return { status: r.status, verifyCode: r.verify_code, nachweisNr: r.nachweis_nr, sha256: r.pdf_sha256, sealedAt: r.seal_ts };
  }

  @ParticipantRoute()
  @Get('me/invitations/:id/evidence/pdf')
  async minePdf(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const p = await this.participants.resolve(id);
    const r = await this.participants.read(p, async (c) =>
      (await c.query(`SELECT pdf_key, nachweis_nr FROM evidence WHERE invitation_id = $1 AND status = 'erzeugt'`, [id])).rows[0],
    );
    if (!r) throw new NotFoundException('Nachweis wird noch erstellt');
    await this.send(res, r.pdf_key, r.nachweis_nr);
  }

  @Roles('admin', 'verantwortlich', 'auditor')
  @Get('evidence/:id/pdf')
  async pdf(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const r = await this.db.tx(async (c) => (await c.query(`SELECT pdf_key, nachweis_nr FROM evidence WHERE id = $1 AND status = 'erzeugt'`, [id])).rows[0]);
    if (!r) throw new NotFoundException('Nachweis nicht gefunden');
    await this.send(res, r.pdf_key, r.nachweis_nr);
  }
}
