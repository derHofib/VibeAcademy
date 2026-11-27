import type {} from 'multer';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PLATFORMS } from '@sn/shared';
import { z } from 'zod';
import { Roles } from '../auth/decorators';
import { ZodBody } from '../common/errors';
import { AttendanceService } from './attendance.service';
import { BackdatedService } from './backdated.service';

const iso = z.iso.datetime({ offset: true });
const CreateBackdated = z
  .object({
    trainingId: z.uuid(),
    delivery: z.enum(['praesenz', 'live_online']),
    kombiniert: z.boolean().default(false),
    startAt: iso,
    endAt: iso,
    platform: z.enum(PLATFORMS).nullish(),
    meetingUrl: z.string().trim().max(1000).refine((v) => v === '' || v.startsWith('https://'), 'Bitte einen Link mit https:// angeben').transform((v) => v || null).nullish(),
    ort: z.string().trim().max(300).nullish(),
    trainerPersonId: z.uuid().nullish(),
    completenessPct: z.number().int().min(1).max(100).nullish(),
    reason: z.string().trim().min(10, 'Bitte die nachträgliche Erfassung begründen (mindestens 10 Zeichen)').max(1000),
  })
  .refine((b) => Date.parse(b.endAt) > Date.parse(b.startAt), { message: 'Das Ende muss nach dem Beginn liegen', path: ['endAt'] })
  .refine((b) => b.delivery !== 'live_online' || b.platform, { message: 'Bitte die Plattform angeben', path: ['platform'] });

const Apply = z.object({
  importId: z.uuid().nullish(),
  entries: z
    .array(
      z
        .object({
          index: z.number().int().min(0).max(5000).nullish(),
          personId: z.uuid().nullish(),
          newPerson: z.object({ name: z.string().trim().min(2).max(200), email: z.email().nullish() }).nullish(),
          credit: z.boolean().default(false),
        })
        .refine((e) => e.personId || e.newPerson, { message: 'Bitte eine Person zuordnen oder neu anlegen', path: ['personId'] }),
    )
    .min(1, 'Bitte mindestens eine Person übernehmen')
    .max(2000),
});
const Countersign = z
  .object({ password: z.string().min(1).max(200).optional(), stepUpToken: z.string().min(20).max(100).optional() })
  .refine((b) => b.password || b.stepUpToken, { message: 'Bitte mit Passwort bestätigen', path: ['password'] });

/** Nachträgliche Erfassung stattgefundener Termine (Präsenz, Live-Online, Kombiniert – E-53/E-54). */
@Controller()
@Roles('admin', 'verantwortlich')
export class BackdatedController {
  constructor(
    private readonly backdated: BackdatedService,
    private readonly attendance: AttendanceService,
  ) {}

  @Post('runs/nachtraeglich')
  create(@Body(new ZodBody(CreateBackdated)) b: z.infer<typeof CreateBackdated>) {
    return this.backdated.create(b);
  }

  @Get('runs/:id/nachtraeglich')
  state(@Param('id', ParseUUIDPipe) id: string) {
    return this.backdated.state(id);
  }

  @Post('runs/:id/nachtraeglich/import')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('datei', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  import(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File) {
    return this.backdated.importFile(id, file);
  }

  @Post('runs/:id/nachtraeglich/anwesenheit')
  @HttpCode(200)
  apply(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(Apply)) b: z.infer<typeof Apply>) {
    return this.backdated.applyAttendance(id, b);
  }

  @Post('runs/:id/nachtraeglich/belege')
  @UseInterceptors(FileInterceptor('datei', { limits: { fileSize: 20 * 1024 * 1024, files: 1 } }))
  receipt(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File) {
    return this.backdated.uploadReceipt(id, file);
  }

  @Get('runs/:id/nachtraeglich/dokumente')
  documents(@Param('id', ParseUUIDPipe) id: string) {
    return this.backdated.documents(id);
  }

  /** Gegenzeichnung: bestätigt die Liste, erzeugt die Nachweise; bei „Kombiniert“ folgt die Online-Bestätigung. */
  @Post('runs/:id/nachtraeglich/gegenzeichnen')
  @HttpCode(200)
  async countersign(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(Countersign)) b: z.infer<typeof Countersign>) {
    const r = await this.attendance.countersign(id, b);
    const f = await this.backdated.createFollowup(id);
    return { ...r, followupRunId: f.followupRunId, followupInvited: f.invited };
  }
}
