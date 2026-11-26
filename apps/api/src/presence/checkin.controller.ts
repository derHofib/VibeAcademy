import { BadRequestException, Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ParticipantRoute, Public } from '../auth/decorators';
import { SESSION_COOKIE, SessionService } from '../auth/session.service';
import { ZodBody } from '../common/errors';
import { RateLimitService } from '../common/rate-limit.service';
import { currentRequest } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config';
import { LiveService } from '../live/live.service';
import { ParticipantService } from '../participant/participant.service';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage';
import { AttendanceService } from './attendance.service';
import { RunAccess } from './run-access.service';

const Scan = z.object({
  token: z.string().min(20).max(300),
  /** offline gepufferter Scan (Scanzeit = signierter Slot-Beginn) */
  offline: z.boolean().default(false),
  /** Geräteuhrzeit beim Scan – nur zur Information, zählt nie */
  deviceTime: z.iso.datetime({ offset: true }).nullish(),
  /** Check-in ohne Einladung (Start-QR + Name/E-Mail, E-07) */
  name: z.string().trim().min(2).max(200).nullish(),
  email: z.email().trim().toLowerCase().max(254).nullish(),
});
const Manual = z.object({
  invitationId: z.uuid().nullish(),
  reason: z.string().max(40),
  note: z.string().max(2000),
});
const Confirm = z.object({ confirmed: z.literal(true, { error: 'Bitte die Teilnahme bestätigen (Häkchen setzen)' }) });

/** Teilnehmersicht Präsenz/Live (Screens 13a–13i): QR-Scan, ohne QR beenden, bestätigen, Nachweis. */
@Controller()
export class CheckinController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly live: LiveService,
    private readonly access: RunAccess,
    private readonly participants: ParticipantService,
    private readonly sessions: SessionService,
    private readonly rate: RateLimitService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  private async scan(kind: 'start' | 'end', b: z.infer<typeof Scan>, res: Response) {
    // großzügig: alle Teilnehmer eines Raums teilen sich oft eine IP (Firmen-WLAN)
    await this.rate.hit(`scan:${currentRequest()?.ipHash}`, 600, 600);
    const r = await this.attendance.scan(kind, b);
    if (r.newSession) {
      const s = r.newSession;
      const id = await this.sessions.create({ kind: 'invitation', tenantId: s.tenantId, personId: s.personId, invitationId: s.invitationId });
      res.cookie(SESSION_COOKIE, id, this.sessions.cookieOptions(this.config.NODE_ENV === 'production'));
    }
    const state = await this.attendance.participantState(r.participant, r.runId);
    return { ...state, alreadyCheckedIn: !!r.already, newSession: !!r.newSession };
  }

  /** Start-QR scannen. Ohne Sitzung: 401 {code:'anmeldung_noetig'} → erneut mit name + email. */
  @Public()
  @Post('checkin')
  @HttpCode(200)
  checkin(@Body(new ZodBody(Scan)) b: z.infer<typeof Scan>, @Res({ passthrough: true }) res: Response) {
    return this.scan('start', b, res);
  }

  @ParticipantRoute()
  @Post('checkout')
  @HttpCode(200)
  checkout(@Body(new ZodBody(Scan)) b: z.infer<typeof Scan>, @Res({ passthrough: true }) res: Response) {
    return this.scan('end', b, res);
  }

  private async resolve(invitationId?: string | null) {
    const s = currentRequest()?.session;
    const id = invitationId ?? (s?.kind === 'invitation' ? s.invitationId : null);
    if (!id) throw new BadRequestException('invitationId fehlt');
    return this.participants.resolve(id);
  }

  @ParticipantRoute()
  @Post('checkout/manual')
  @HttpCode(200)
  async manual(@Body(new ZodBody(Manual)) b: z.infer<typeof Manual>) {
    const p = await this.resolve(b.invitationId);
    const runId = await this.attendance.manualCheckout(p, b.reason, b.note);
    return this.attendance.participantState(p, runId);
  }

  @ParticipantRoute()
  @Post('attendance/:id/confirm')
  @HttpCode(200)
  async confirm(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(Confirm)) _b: z.infer<typeof Confirm>) {
    const runId = await this.attendance.confirm(id);
    return this.attendance.participantState(await this.access.requireParticipant(runId), runId);
  }

  /** Gesamtsicht des Teilnehmers (wie der SSE-Snapshot): Termin, eigener Status, Fragen, Kontrollfragen. */
  @ParticipantRoute()
  @Get('me/invitations/:id/live')
  async state(@Param('id', ParseUUIDPipe) id: string) {
    const p = await this.participants.resolve(id);
    const runId = await this.attendance.runOfInvitation(p);
    return this.live.section({ kind: 'participant', p }, runId, 'snapshot');
  }

  private async myEvidence(invitationId: string) {
    const p = await this.participants.resolve(invitationId);
    return this.participants.read(p, async (c) =>
      (
        await c.query(
          `SELECT e.id, e.status, e.verify_code, e.nachweis_nr, e.pdf_sha256, e.seal_ts, e.pdf_key
             FROM evidence e JOIN attendance a ON a.id = e.attendance_id JOIN invitation i ON i.run_id = a.run_id AND i.person_id = a.person_id
            WHERE i.id = $1`,
          [invitationId],
        )
      ).rows[0],
    );
  }

  @ParticipantRoute()
  @Get('me/invitations/:id/attendance/evidence')
  async evidence(@Param('id', ParseUUIDPipe) id: string) {
    const r = await this.myEvidence(id);
    if (!r) throw new NotFoundException('Noch kein Nachweis vorhanden');
    return { status: r.status, verifyCode: r.verify_code, nachweisNr: r.nachweis_nr, sha256: r.pdf_sha256, sealedAt: r.seal_ts };
  }

  @ParticipantRoute()
  @Get('me/invitations/:id/attendance/evidence/pdf')
  async evidencePdf(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const r = await this.myEvidence(id);
    if (!r || r.status !== 'erzeugt') throw new NotFoundException('Nachweis wird noch erstellt');
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="${r.nachweis_nr}.pdf"`);
    res.setHeader('cache-control', 'private, no-store');
    res.send(await this.storage.get('evidence', r.pdf_key));
  }
}
