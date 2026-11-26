import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { Roles } from '../auth/decorators';
import { ZodBody } from '../common/errors';
import { AttendanceService } from './attendance.service';

const iso = z.iso.datetime({ offset: true });
const CreateTermin = z
  .object({
    typ: z.enum(['termin', 'live_extern']),
    trainingId: z.uuid().nullish(),
    titel: z.string().trim().min(2).max(300).nullish(),
    provider: z.string().trim().max(300).nullish(),
    startAt: iso,
    endAt: iso,
    ort: z.string().trim().max(300).nullish(),
    trainerPersonId: z.uuid().nullish(),
    qrMode: z.enum(['rotierend', 'statisch']).default('rotierend'),
    completenessPct: z.number().int().min(1).max(100).nullish(),
    allowWalkIn: z.boolean().default(true),
    personIds: z.array(z.uuid()).max(5000).default([]),
    orgUnitIds: z.array(z.uuid()).max(500).default([]),
    sendMail: z.boolean().default(true),
  })
  .refine((b) => Date.parse(b.endAt) > Date.parse(b.startAt), { message: 'Das Ende muss nach dem Beginn liegen', path: ['endAt'] })
  .refine((b) => b.trainingId || b.titel, { message: 'Bitte eine Schulung wählen oder einen Titel angeben', path: ['titel'] })
  .refine((b) => b.typ === 'live_extern' || b.trainingId, { message: 'Für einen Präsenztermin bitte eine Schulung wählen', path: ['trainingId'] });

const Participants = z
  .object({
    personIds: z.array(z.uuid()).max(5000).default([]),
    orgUnitIds: z.array(z.uuid()).max(500).default([]),
    sendMail: z.boolean().default(true),
  })
  .refine((b) => b.personIds.length || b.orgUnitIds.length, { message: 'Bitte Personen oder Org-Einheiten auswählen' });
const StaffScan = z.object({ personId: z.uuid(), method: z.enum(['kiosk', 'trainer']).default('kiosk') });
const Review = z
  .object({ decision: z.enum(['akzeptiert', 'rueckfrage']), message: z.string().trim().max(1000).nullish() })
  .refine((b) => b.decision === 'akzeptiert' || (b.message?.length ?? 0) >= 3, { message: 'Bitte die Rückfrage formulieren', path: ['message'] });
const Release = z.object({ decision: z.enum(['freigegeben', 'abgelehnt']), note: z.string().trim().max(1000).nullish() });
const KioskConfirm = z.object({
  signaturePng: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, 'Unterschrift fehlt').max(300 * 1024 * 1.4),
});
const Countersign = z
  .object({ password: z.string().min(1).max(200).optional(), stepUpToken: z.string().min(20).max(100).optional() })
  .refine((b) => b.password || b.stepUpToken, { message: 'Bitte mit Passwort bestätigen', path: ['password'] });

const kindOf = (k: string | undefined) => {
  if (k !== 'start' && k !== 'end') throw new BadRequestException('kind muss start oder end sein');
  return k;
};

/** Organisator-/Trainersicht für Präsenz- und Live-Termine (Screens 7, 12a–12f). */
@Controller()
export class PresenceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post('runs/termin')
  @Roles('admin', 'verantwortlich')
  async create(@Body(new ZodBody(CreateTermin)) b: z.infer<typeof CreateTermin>) {
    const { id } = await this.attendance.createTermin(b);
    const invited =
      b.personIds.length || b.orgUnitIds.length
        ? await this.attendance.addParticipants(id, { personIds: b.personIds, orgUnitIds: b.orgUnitIds, sendMail: b.sendMail })
        : { created: 0, skipped: 0, mailsQueued: 0, withoutEmail: [] };
    return { id, invited };
  }

  @Get('termine')
  @Roles('admin', 'verantwortlich', 'trainer', 'auditor')
  list() {
    return this.attendance.list();
  }

  @Post('runs/:id/participants')
  @Roles('admin', 'verantwortlich', 'trainer')
  participants(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(Participants)) b: z.infer<typeof Participants>) {
    return this.attendance.addParticipants(id, b);
  }

  @Get('runs/:id/attendance')
  @Roles('admin', 'verantwortlich', 'trainer')
  overview(@Param('id', ParseUUIDPipe) id: string) {
    return this.attendance.organizerAttendance(id);
  }

  @Get('runs/:id/qr')
  @Roles('admin', 'verantwortlich', 'trainer')
  qr(@Param('id', ParseUUIDPipe) id: string, @Query('kind') kind?: string) {
    return this.attendance.qrCode(id, kindOf(kind), false);
  }

  @Get('runs/:id/qr/print')
  @Roles('admin', 'verantwortlich', 'trainer')
  qrPrint(@Param('id', ParseUUIDPipe) id: string, @Query('kind') kind?: string) {
    return this.attendance.qrCode(id, kindOf(kind), true);
  }

  @Post('runs/:id/start')
  @HttpCode(200)
  @Roles('admin', 'verantwortlich', 'trainer')
  start(@Param('id', ParseUUIDPipe) id: string) {
    return this.attendance.start(id);
  }

  @Post('runs/:id/end')
  @HttpCode(200)
  @Roles('admin', 'verantwortlich', 'trainer')
  end(@Param('id', ParseUUIDPipe) id: string) {
    return this.attendance.end(id);
  }

  @Post('runs/:id/attendance/checkin')
  @HttpCode(200)
  @Roles('admin', 'verantwortlich', 'trainer')
  async staffIn(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(StaffScan)) b: z.infer<typeof StaffScan>) {
    await this.attendance.staffScan(id, b.personId, b.method, 'in');
    return this.attendance.organizerAttendance(id);
  }

  @Post('runs/:id/attendance/checkout')
  @HttpCode(200)
  @Roles('admin', 'verantwortlich', 'trainer')
  async staffOut(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(StaffScan)) b: z.infer<typeof StaffScan>) {
    await this.attendance.staffScan(id, b.personId, b.method, 'out');
    return this.attendance.organizerAttendance(id);
  }

  @Post('attendance/:id/review')
  @HttpCode(200)
  @Roles('admin', 'verantwortlich', 'trainer')
  review(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(Review)) b: z.infer<typeof Review>) {
    return this.attendance.review(id, b.decision, b.message);
  }

  @Post('attendance/:id/release')
  @HttpCode(200)
  @Roles('admin', 'verantwortlich', 'trainer')
  release(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(Release)) b: z.infer<typeof Release>) {
    return this.attendance.release(id, b.decision, b.note);
  }

  @Post('attendance/:id/kiosk-confirm')
  @HttpCode(200)
  @Roles('admin', 'verantwortlich', 'trainer')
  kioskConfirm(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(KioskConfirm)) b: z.infer<typeof KioskConfirm>) {
    return this.attendance.kioskConfirm(id, b.signaturePng);
  }

  @Post('runs/:id/countersign')
  @HttpCode(200)
  @Roles('admin', 'verantwortlich', 'trainer')
  countersign(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(Countersign)) b: z.infer<typeof Countersign>) {
    return this.attendance.countersign(id, b);
  }
}
