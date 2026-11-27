import type {} from 'multer';
import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BOOKING_STATUSES, PLATFORMS } from '@sn/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { Public, Roles } from '../auth/decorators';
import { ZodBody } from '../common/errors';
import { DbService } from '../db/db.service';
import { ExternalBookingService } from './bookings.service';

const iso = z.iso.datetime({ offset: true });
const opt = (max = 300) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const cents = z.number().int().min(0).max(100_000_000);
const day = z.object({ startAt: iso, endAt: iso }).refine((d) => Date.parse(d.endAt) > Date.parse(d.startAt), { message: 'Das Ende muss nach dem Beginn liegen', path: ['endAt'] });
const Fields = z.object({
  titel: z.string().trim().min(2, 'Bitte die Schulung benennen').max(300),
  trainingId: z.uuid().nullish(),
  requirementId: z.uuid().nullish(),
  providerName: z.string().trim().min(2, 'Bitte den Anbieter angeben').max(300),
  providerContact: opt(), providerPhone: opt(60), providerEmail: z.email().nullish().or(z.literal('').transform(() => null)), providerWeb: opt(300),
  bookingNo: opt(100),
  format: z.enum(['praesenz', 'online']),
  address: opt(), room: opt(), meetingPoint: opt(),
  onlinePlatform: z.enum(PLATFORMS).nullish(),
  onlineUrl: z.string().trim().max(1000).refine((v) => v === '' || v.startsWith('https://'), 'Bitte einen Link mit https:// angeben').transform((v) => v || null).nullish(),
  travelMode: z.enum(['firmenwagen', 'bahn', 'flug', 'privat']).nullish(),
  departure: opt(), carpool: opt(), hotelName: opt(), hotelAddress: opt(),
  hotelCheckIn: z.iso.date().nullish(), hotelCheckOut: z.iso.date().nullish(), hotelBookingNo: opt(100),
  catering: opt(500), bringAlong: opt(1000), travelNotes: opt(2000), internalContact: opt(),
  feeCents: cents, hotelCents: cents, travelCents: cents, costCenter: opt(100),
  approvalRequired: z.boolean(), approverPersonId: z.uuid().nullish(),
  reminderDaysBefore: z.number().int().min(0).max(60), escalateAfterDays: z.number().int().min(1).max(90),
  days: z.array(day).min(1, 'Bitte mindestens einen Termin eintragen').max(30),
  personIds: z.array(z.uuid()).max(500),
});
const Create = Fields.extend({
  format: Fields.shape.format.default('praesenz'),
  feeCents: cents.default(0), hotelCents: cents.default(0), travelCents: cents.default(0),
  approvalRequired: z.boolean().default(false), reminderDaysBefore: Fields.shape.reminderDaysBefore.default(7),
  escalateAfterDays: Fields.shape.escalateAfterDays.default(7), personIds: Fields.shape.personIds.default([]),
});
const Update = Fields.omit({ personIds: true }).partial();
const Persons = z.object({ personIds: z.array(z.uuid()).min(1).max(500) });
const Booked = z.object({ bookingNo: opt(100) });
const Invite = z.object({ sendMail: z.boolean().default(true) });
const Status = z.object({ status: z.enum(BOOKING_STATUSES), reason: opt(1000) });
const Cancel = z.object({ reason: z.string().trim().min(3, 'Bitte den Grund angeben').max(1000), cancelCostCents: cents.nullish() });
const Problem = z.object({ note: z.string().trim().min(5, 'Bitte kurz beschreiben').max(2000) });

/** Verwaltung externer Schulungen (E-55). */
@Controller('external-bookings')
@Roles('admin', 'verantwortlich')
export class ExternalBookingsController {
  constructor(
    private readonly bookings: ExternalBookingService,
    private readonly db: DbService,
  ) {}

  @Get()
  @Roles('admin', 'verantwortlich', 'auditor')
  list() {
    return this.bookings.list();
  }

  @Get('report')
  @Roles('admin', 'verantwortlich', 'auditor')
  report(@Query('from') from?: string, @Query('to') to?: string) {
    const ok = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    return this.bookings.report(ok(from), ok(to));
  }

  @Post()
  create(@Body(new ZodBody(Create)) b: z.infer<typeof Create>) {
    return this.bookings.create(b);
  }

  @Get(':id')
  @Roles('admin', 'verantwortlich', 'auditor', 'vorgesetzter')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.getForViewer(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(Update)) b: z.infer<typeof Update>) {
    return this.bookings.update(id, b);
  }

  @Post(':id/participants')
  add(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(Persons)) b: z.infer<typeof Persons>) {
    return this.bookings.addParticipants(id, b.personIds);
  }

  @Post(':id/request-approval')
  @HttpCode(200)
  requestApproval(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.requestApproval(id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Roles('admin', 'verantwortlich', 'vorgesetzter')
  approve(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.approve(id);
  }

  @Post(':id/booked')
  @HttpCode(200)
  booked(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(Booked)) b: z.infer<typeof Booked>) {
    return this.bookings.markBooked(id, b.bookingNo);
  }

  @Post(':id/invite')
  @HttpCode(200)
  invite(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(Invite)) b: z.infer<typeof Invite>) {
    return this.bookings.invite(id, b.sendMail);
  }

  @Get(':id/participants/:pid/invitation.pdf')
  async invitationPdf(@Param('id', ParseUUIDPipe) id: string, @Param('pid', ParseUUIDPipe) pid: string, @Res() res: Response) {
    const r = await this.bookings.invitationPdf(id, pid);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="${r.name}"`);
    res.setHeader('cache-control', 'private, no-store');
    res.send(r.pdf);
  }

  @Post(':id/participants/:pid/status')
  @HttpCode(200)
  status(@Param('id', ParseUUIDPipe) id: string, @Param('pid', ParseUUIDPipe) pid: string, @Body(new ZodBody(Status)) b: z.infer<typeof Status>) {
    return this.bookings.setParticipantStatus(id, pid, b.status, b.reason ?? null);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(Cancel)) b: z.infer<typeof Cancel>) {
    return this.bookings.cancel(id, b.reason, b.cancelCostCents ?? null);
  }

  @Post(':id/files')
  @UseInterceptors(FileInterceptor('datei', { limits: { fileSize: 20 * 1024 * 1024, files: 1 } }))
  file(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File) {
    return this.bookings.addFile(id, file);
  }

  @Get(':id/files/:fileId')
  @Roles('admin', 'verantwortlich', 'auditor')
  async download(@Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string, @Res() res: Response) {
    const f = await this.db.tx((c) => this.bookings.fileContent(c, id, fileId));
    res.setHeader('content-type', f.type);
    res.setHeader('content-disposition', `attachment; filename="${encodeURIComponent(f.name)}"`);
    res.send(f.data);
  }

  /** Sammelbescheinigung: ein Beleg für mehrere Teilnehmer → je Person ein externer Nachweis zur Prüfung. */
  @Post(':id/certificate')
  @UseInterceptors(FileInterceptor('datei', { limits: { fileSize: 20 * 1024 * 1024, files: 1 } }))
  certificate(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File, @Body('personIds') personIds: string | string[]) {
    const ids = (Array.isArray(personIds) ? personIds : String(personIds ?? '').split(',')).map((s) => s.trim()).filter((s) => /^[0-9a-f-]{36}$/.test(s));
    return this.bookings.groupCertificate(id, ids, file);
  }
}

/** Teilnehmer über den persönlichen Link (ohne Konto, E-55). */
@Controller('public/external-bookings')
@Public()
export class PublicExternalBookingsController {
  constructor(private readonly bookings: ExternalBookingService) {}

  @Get(':token')
  view(@Param('token') token: string) {
    return this.bookings.participantView(token);
  }

  @Post(':token/confirm')
  @HttpCode(200)
  confirm(@Param('token') token: string) {
    return this.bookings.confirm(token);
  }

  @Post(':token/problem')
  @HttpCode(200)
  problem(@Param('token') token: string, @Body(new ZodBody(Problem)) b: z.infer<typeof Problem>) {
    return this.bookings.reportProblem(token, b.note);
  }

  @Get(':token/termin.ics')
  async ics(@Param('token') token: string, @Res() res: Response) {
    const ics = await this.bookings.participantIcs(token);
    res.setHeader('content-type', 'text/calendar; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="termin.ics"');
    res.send(ics);
  }

  @Get(':token/files/:fileId')
  async file(@Param('token') token: string, @Param('fileId', ParseUUIDPipe) fileId: string, @Res() res: Response) {
    const f = await this.bookings.participantFile(token, fileId);
    res.setHeader('content-type', f.type);
    res.setHeader('content-disposition', `attachment; filename="${encodeURIComponent(f.name)}"`);
    res.send(f.data);
  }

  @Post(':token/certificate')
  @UseInterceptors(FileInterceptor('datei', { limits: { fileSize: 20 * 1024 * 1024, files: 1 } }))
  certificate(@Param('token') token: string, @UploadedFile() file: Express.Multer.File) {
    return this.bookings.uploadCertificate(token, file);
  }
}
