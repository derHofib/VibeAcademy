import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  BOOKING_STATUS_LABELS, bookingTotalCents, buildIcs, canTransition, dueBookingStages, formatEuro,
  type BookingReminderStage, type BookingStatus,
} from '@sn/shared';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { deriveKey, hmac, sha256 } from '../common/crypto';
import { currentRequest } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config';
import { DbService } from '../db/db.service';
import { PDF_RENDERER, type PdfRenderer } from '../evidence/pdf-renderer';
import { ExternalService } from '../external/external.service';
import { NotificationService } from '../notifications/notification.service';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage';

type Queued = { id: string; tenantId: string | null };

export interface BookingInput {
  titel: string;
  trainingId?: string | null;
  requirementId?: string | null;
  providerName: string;
  providerContact?: string | null;
  providerPhone?: string | null;
  providerEmail?: string | null;
  providerWeb?: string | null;
  bookingNo?: string | null;
  format: 'praesenz' | 'online';
  address?: string | null;
  room?: string | null;
  meetingPoint?: string | null;
  onlinePlatform?: string | null;
  onlineUrl?: string | null;
  travelMode?: 'firmenwagen' | 'bahn' | 'flug' | 'privat' | null;
  departure?: string | null;
  carpool?: string | null;
  hotelName?: string | null;
  hotelAddress?: string | null;
  hotelCheckIn?: string | null;
  hotelCheckOut?: string | null;
  hotelBookingNo?: string | null;
  catering?: string | null;
  bringAlong?: string | null;
  travelNotes?: string | null;
  internalContact?: string | null;
  feeCents: number;
  hotelCents: number;
  travelCents: number;
  costCenter?: string | null;
  approvalRequired: boolean;
  approverPersonId?: string | null;
  reminderDaysBefore: number;
  escalateAfterDays: number;
  days: Array<{ startAt: string; endAt: string }>;
  personIds: string[];
}

const COLS: Record<string, string> = {
  titel: 'titel', trainingId: 'training_id', requirementId: 'requirement_id', providerName: 'provider_name', providerContact: 'provider_contact',
  providerPhone: 'provider_phone', providerEmail: 'provider_email', providerWeb: 'provider_web', bookingNo: 'booking_no', format: 'format',
  address: 'address', room: 'room', meetingPoint: 'meeting_point', onlinePlatform: 'online_platform', onlineUrl: 'online_url',
  travelMode: 'travel_mode', departure: 'departure', carpool: 'carpool', hotelName: 'hotel_name', hotelAddress: 'hotel_address',
  hotelCheckIn: 'hotel_check_in', hotelCheckOut: 'hotel_check_out', hotelBookingNo: 'hotel_booking_no', catering: 'catering',
  bringAlong: 'bring_along', travelNotes: 'travel_notes', internalContact: 'internal_contact', feeCents: 'fee_cents', hotelCents: 'hotel_cents',
  travelCents: 'travel_cents', costCenter: 'cost_center', approvalRequired: 'approval_required', approverPersonId: 'approver_person_id',
  reminderDaysBefore: 'reminder_days_before', escalateAfterDays: 'escalate_after_days',
};

const TZ = 'Europe/Berlin';
const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('de-DE', { ...o, timeZone: TZ });
const dayLabel = (s: Date, e: Date) =>
  `${fmt({ weekday: 'short' }).format(s)} ${fmt({ day: '2-digit', month: '2-digit', year: 'numeric' }).format(s)}, ${fmt({ hour: '2-digit', minute: '2-digit' }).format(s)}–${fmt({ hour: '2-digit', minute: '2-digit' }).format(e)}`;
const dateDe = (d: Date | string) => fmt({ day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d));
const berlinIsoDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const TRAVEL: Record<string, string> = { firmenwagen: 'Firmenwagen', bahn: 'Bahn', flug: 'Flug', privat: 'privat' };
const FINAL: BookingStatus[] = ['freigegeben', 'abgesagt', 'nicht_erschienen'];
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

export interface BookingRow {
  id: string;
  tenant_id: string;
  titel: string;
  [k: string]: unknown;
}

/**
 * Externe Schulungen planen, buchen und nachverfolgen (E-55/E-56): Buchung → Freigabe → gebucht → Einladung (Mail + .ics,
 * ohne Mailversand als PDF/Link) → Bestätigung → Teilnahme → Bescheinigung (externer Nachweis) → Freigabe → Pflichtmatrix.
 */
@Injectable()
export class ExternalBookingService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly notifications: NotificationService,
    private readonly external: ExternalService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(PDF_RENDERER) private readonly pdf: PdfRenderer,
  ) {}

  // ── Persönlicher Link (reproduzierbar, nur der Hash liegt in der Datenbank) ──
  tokenFor(participantId: string) {
    return hmac(deriveKey(this.config.HMAC_MASTER_SECRET, 'external-booking'), participantId).slice(0, 43);
  }
  linkFor(participantId: string) {
    return `${this.config.PUBLIC_BASE_URL}/extern/b/${this.tokenFor(participantId)}`;
  }

  // ── Laden ──────────────────────────────────────────────────
  async load(c: pg.PoolClient, id: string) {
    const b = (await c.query('SELECT * FROM external_booking WHERE id = $1', [id])).rows[0] as BookingRow | undefined;
    if (!b) throw new NotFoundException('Externe Schulung nicht gefunden');
    const days = (await c.query('SELECT day_no, start_at, end_at FROM external_booking_day WHERE booking_id = $1 ORDER BY day_no', [id])).rows as Array<{ day_no: number; start_at: Date; end_at: Date }>;
    const participants = (
      await c.query(
        `SELECT bp.*, p.name AS person_name, p.email AS person_email, o.name AS org_unit,
                x.status AS record_status, x.valid_until AS record_valid_until
           FROM external_booking_participant bp JOIN person p ON p.id = bp.person_id LEFT JOIN org_unit o ON o.id = p.org_unit_id
           LEFT JOIN external_record x ON x.id = bp.external_record_id
          WHERE bp.booking_id = $1 ORDER BY p.name`,
        [id],
      )
    ).rows;
    const files = (await c.query('SELECT id, file_name, content_type, size_bytes, sha256, created_at FROM external_booking_file WHERE booking_id = $1 ORDER BY created_at', [id])).rows;
    return { b, days, participants, files };
  }

  view(x: Awaited<ReturnType<ExternalBookingService['load']>>) {
    const { b, days, participants, files } = x;
    const active = participants.filter((p) => p.status !== 'abgesagt').length;
    return {
      id: b.id, titel: b.titel, trainingId: b.training_id, requirementId: b.requirement_id,
      provider: { name: b.provider_name, contact: b.provider_contact, phone: b.provider_phone, email: b.provider_email, web: b.provider_web },
      bookingNo: b.booking_no, format: b.format, address: b.address, room: b.room, meetingPoint: b.meeting_point,
      onlinePlatform: b.online_platform, onlineUrl: b.online_url,
      travel: { mode: b.travel_mode, departure: b.departure, carpool: b.carpool, notes: b.travel_notes, catering: b.catering, bringAlong: b.bring_along },
      hotel: { name: b.hotel_name, address: b.hotel_address, checkIn: b.hotel_check_in, checkOut: b.hotel_check_out, bookingNo: b.hotel_booking_no },
      internalContact: b.internal_contact,
      costs: {
        feeCents: b.fee_cents, hotelCents: b.hotel_cents, travelCents: b.travel_cents, costCenter: b.cost_center,
        totalCents: bookingTotalCents({ feeCents: Number(b.fee_cents), hotelCents: Number(b.hotel_cents), travelCents: Number(b.travel_cents) }, active),
        cancelCostCents: b.cancel_cost_cents,
      },
      approval: { required: b.approval_required, approverPersonId: b.approver_person_id, approvedAt: b.approved_at },
      cancelled: b.cancelled_at ? { at: b.cancelled_at, reason: b.cancel_reason } : null,
      reminders: { daysBefore: b.reminder_days_before, escalateAfterDays: b.escalate_after_days },
      days: days.map((d) => ({ dayNo: d.day_no, startAt: d.start_at, endAt: d.end_at, label: dayLabel(d.start_at, d.end_at) })),
      participants: participants.map((p) => ({
        id: p.id, personId: p.person_id, name: p.person_name, email: p.person_email, orgUnit: p.org_unit, status: p.status as BookingStatus,
        statusLabel: BOOKING_STATUS_LABELS[p.status as BookingStatus], statusAt: p.status_at, statusReason: p.status_reason,
        invitedAt: p.invited_at, confirmedAt: p.confirmed_at, problem: p.problem_note ? { note: p.problem_note, at: p.problem_at } : null,
        externalRecordId: p.external_record_id, recordStatus: p.record_status, validUntil: p.record_valid_until,
      })),
      files,
      createdAt: b.created_at,
    };
  }

  // ── Anlegen und ändern ─────────────────────────────────────
  private async validateRefs(c: pg.PoolClient, i: Partial<BookingInput>) {
    if (i.requirementId) {
      const r = (await c.query('SELECT training_id FROM requirement WHERE id = $1', [i.requirementId])).rows[0];
      if (!r) throw new BadRequestException('Anforderung nicht gefunden');
      i.trainingId = i.trainingId ?? r.training_id;
    }
    if (i.approvalRequired && !i.approverPersonId) {
      throw new BadRequestException({ message: 'Eingaben unvollständig oder ungültig', fields: [{ path: 'approverPersonId', message: 'Bitte die freigebende Person wählen' }] });
    }
  }

  async create(i: BookingInput) {
    return this.db.tx(async (c) => {
      await this.validateRefs(c, i);
      const keys = Object.keys(COLS).filter((k) => (i as unknown as Record<string, unknown>)[k] !== undefined);
      const r = await c.query(
        `INSERT INTO external_booking (${keys.map((k) => COLS[k]).join(', ')}) VALUES (${keys.map((_, n) => `$${n + 1}`).join(', ')}) RETURNING id`,
        keys.map((k) => (i as unknown as Record<string, unknown>)[k] ?? null),
      );
      const id = r.rows[0].id as string;
      await this.saveDays(c, id, i.days);
      for (const pid of new Set(i.personIds)) {
        await c.query('INSERT INTO external_booking_participant (booking_id, person_id) VALUES ($1, $2)', [id, pid]);
      }
      await this.audit.record(c, { entity: 'external_booking', entityId: id, action: 'created', payload: { titel: i.titel, persons: i.personIds.length, days: i.days.length } });
      return { id };
    });
  }

  private async saveDays(c: pg.PoolClient, id: string, days: BookingInput['days']) {
    await c.query('DELETE FROM external_booking_day WHERE booking_id = $1', [id]);
    const sorted = [...days].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
    for (const [n, d] of sorted.entries()) {
      await c.query('INSERT INTO external_booking_day (booking_id, day_no, start_at, end_at) VALUES ($1, $2, $3, $4)', [id, n + 1, d.startAt, d.endAt]);
    }
  }

  /** Ändern; neue Termine bei bereits Eingeladenen → „verschoben“ und aktualisierte Einladung (SEQUENCE+1). */
  async update(id: string, i: Partial<BookingInput>) {
    const queued = await this.db.tx(async (c) => {
      const cur = await this.load(c, id);
      if (cur.b.cancelled_at) throw new ConflictException('Die Schulung ist abgesagt');
      await this.validateRefs(c, { ...i, approverPersonId: i.approverPersonId ?? (cur.b.approver_person_id as string | null), approvalRequired: i.approvalRequired ?? (cur.b.approval_required as boolean) });
      const keys = Object.keys(COLS).filter((k) => (i as Record<string, unknown>)[k] !== undefined);
      if (keys.length) {
        await c.query(`UPDATE external_booking SET ${keys.map((k, n) => `${COLS[k]} = $${n + 2}`).join(', ')} WHERE id = $1`, [id, ...keys.map((k) => (i as Record<string, unknown>)[k] ?? null)]);
      }
      const out: Queued[] = [];
      let rescheduled = false;
      if (i.days) {
        const before = JSON.stringify(cur.days.map((d) => [new Date(d.start_at).getTime(), new Date(d.end_at).getTime()]));
        const after = JSON.stringify([...i.days].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)).map((d) => [Date.parse(d.startAt), Date.parse(d.endAt)]));
        await this.saveDays(c, id, i.days);
        rescheduled = before !== after;
      }
      if (rescheduled) {
        const invited = cur.participants.filter((p) => ['eingeladen', 'bestaetigt', 'verschoben'].includes(p.status));
        for (const p of invited) {
          await c.query(
            `UPDATE external_booking_participant SET status = 'verschoben', status_at = $2, ics_sequence = ics_sequence + 1, confirmed_at = NULL, reminders_sent = '{}' WHERE id = $1`,
            [p.id, this.clock.now()],
          );
        }
        const fresh = await this.load(c, id);
        for (const p of fresh.participants.filter((x) => x.status === 'verschoben')) {
          const q = await this.enqueueInvitation(c, fresh, p, { update: true });
          if (q) out.push(q);
        }
      }
      await this.audit.record(c, { entity: 'external_booking', entityId: id, action: 'updated', payload: { fields: keys, rescheduled } });
      return out;
    });
    await this.notifications.dispatch(queued);
    return { ok: true, updatesSent: queued.length };
  }

  async addParticipants(id: string, personIds: string[]) {
    return this.db.tx(async (c) => {
      const { b } = await this.load(c, id);
      if (b.cancelled_at) throw new ConflictException('Die Schulung ist abgesagt');
      let added = 0;
      for (const pid of new Set(personIds)) {
        const r = await c.query('INSERT INTO external_booking_participant (booking_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, pid]);
        added += r.rowCount ?? 0;
      }
      await this.audit.record(c, { entity: 'external_booking', entityId: id, action: 'participants_added', payload: { added } });
      return { added };
    });
  }

  // ── Statuswechsel ──────────────────────────────────────────
  private async setStatus(c: pg.PoolClient, p: { id: string; status: string }, to: BookingStatus, reason: string | null = null) {
    if (!canTransition(p.status as BookingStatus, to)) {
      throw new ConflictException(`Wechsel von „${BOOKING_STATUS_LABELS[p.status as BookingStatus]}“ zu „${BOOKING_STATUS_LABELS[to]}“ ist nicht möglich`);
    }
    await c.query('UPDATE external_booking_participant SET status = $2, status_at = $3, status_reason = $4 WHERE id = $1', [p.id, to, this.clock.now(), reason]);
    await this.audit.record(c, { entity: 'external_booking_participant', entityId: p.id, action: 'status', payload: { from: p.status, to, reason } });
  }

  async requestApproval(id: string) {
    const queued = await this.db.tx(async (c) => {
      const x = await this.load(c, id);
      if (!x.b.approval_required || !x.b.approver_person_id) throw new ConflictException('Für diese Schulung ist keine Freigabe vorgesehen');
      for (const p of x.participants.filter((p) => p.status === 'geplant')) await this.setStatus(c, p, 'zur_freigabe');
      const approver = (await c.query('SELECT name, email FROM person WHERE id = $1', [x.b.approver_person_id])).rows[0];
      const tenantName = (await c.query('SELECT name FROM tenant WHERE id = $1', [x.b.tenant_id])).rows[0]?.name ?? '';
      const v = this.view(x);
      if (!approver?.email) return [];
      return [
        await this.notifications.enqueue(c, {
          tenantId: x.b.tenant_id, channel: 'mail', recipient: approver.email, template: 'external-booking-approval',
          data: {
            approverName: approver.name, title: x.b.titel, providerName: x.b.provider_name, dates: v.days.map((d) => d.label.split(',')[0]).join(' und '),
            persons: v.participants.map((p) => p.name).join(', '), total: formatEuro(v.costs.totalCents),
            url: `${this.config.PUBLIC_BASE_URL}/verwaltung/externe-schulungen/${id}`, tenantName,
          },
        }),
      ];
    });
    await this.notifications.dispatch(queued);
    return { ok: true, mails: queued.length };
  }

  /** Freigabe durch Admin/Verantwortliche oder die eingetragene Person (Vorgesetzte). */
  async approve(id: string) {
    const req = currentRequest()!;
    const s = req.session!;
    const accountId = s.kind === 'account' ? s.accountId : null;
    const staff = req.roles.includes('admin') || req.roles.includes('verantwortlich');
    return this.db.txAs({ tenantId: s.kind === 'account' ? s.tenantId : null, accountId, roles: ['system'] }, async (c) => {
      const x = await this.load(c, id);
      if (!x.b.approval_required) throw new ConflictException('Für diese Schulung ist keine Freigabe vorgesehen');
      if (!staff) {
        const mine = (await c.query('SELECT 1 FROM person WHERE id = $1 AND account_id = $2', [x.b.approver_person_id, accountId])).rowCount;
        if (!mine) throw new ConflictException('Nur die eingetragene Person kann freigeben');
      }
      await c.query('UPDATE external_booking SET approved_at = $2, approved_by = $3 WHERE id = $1', [id, this.clock.now(), accountId]);
      for (const p of x.participants.filter((p) => p.status === 'zur_freigabe')) await this.setStatus(c, p, 'geplant', 'freigegeben');
      await this.audit.record(c, { entity: 'external_booking', entityId: id, action: 'approved', payload: {} });
      return { ok: true };
    });
  }

  async markBooked(id: string, bookingNo?: string | null) {
    return this.db.tx(async (c) => {
      const x = await this.load(c, id);
      if (x.b.approval_required && !x.b.approved_at) throw new ConflictException('Bitte zuerst die Freigabe einholen');
      if (bookingNo) await c.query('UPDATE external_booking SET booking_no = $2 WHERE id = $1', [id, bookingNo]);
      let n = 0;
      for (const p of x.participants.filter((p) => ['geplant', 'zur_freigabe'].includes(p.status))) {
        await this.setStatus(c, p, 'gebucht');
        n++;
      }
      await this.audit.record(c, { entity: 'external_booking', entityId: id, action: 'booked', payload: { participants: n, bookingNo: bookingNo ?? null } });
      return { booked: n };
    });
  }

  /** Einladung (Mail + .ics). Ohne E-Mail-Adresse bzw. ohne Mailversand: persönlicher Link / PDF zum Weitergeben. */
  async invite(id: string, sendMail: boolean) {
    const res = await this.db.tx(async (c) => {
      const x = await this.load(c, id);
      if (!x.days.length) throw new BadRequestException('Bitte zuerst die Termine eintragen');
      if (x.b.cancelled_at) throw new ConflictException('Die Schulung ist abgesagt');
      const now = this.clock.now();
      const queued: Queued[] = [];
      const links: Array<{ participantId: string; name: string; link: string; mailed: boolean }> = [];
      for (const p of x.participants.filter((p) => ['gebucht', 'verschoben'].includes(p.status))) {
        await c.query('UPDATE external_booking_participant SET token_hash = $2, invited_at = coalesce(invited_at, $3) WHERE id = $1', [p.id, sha256(this.tokenFor(p.id)), now]);
        await this.setStatus(c, p, 'eingeladen');
        const q = sendMail ? await this.enqueueInvitation(c, x, p, { update: p.status === 'verschoben' }) : null;
        if (q) queued.push(q);
        links.push({ participantId: p.id, name: p.person_name, link: this.linkFor(p.id), mailed: !!q });
      }
      await this.audit.record(c, { entity: 'external_booking', entityId: id, action: 'invited', payload: { invited: links.length, mails: queued.length } });
      return { queued, links };
    });
    await this.notifications.dispatch(res.queued);
    return { invited: res.links.length, mailsQueued: res.queued.length, links: res.links };
  }

  private invitationData(x: Awaited<ReturnType<ExternalBookingService['load']>>, p: { id: string; person_name: string; person_email: string | null; ics_sequence: number }, tenantName: string) {
    const b = x.b;
    const rows: Array<[string, string]> = [];
    const location = b.format === 'online' ? null : [b.address, b.room].filter(Boolean).join(' · ') || null;
    if (location) rows.push(['Ort', String(location)]);
    if (b.meeting_point) rows.push(['Treffpunkt', String(b.meeting_point)]);
    if (b.format === 'online' && b.online_url) rows.push(['Online', `${b.online_platform ?? ''} ${b.online_url}`.trim()]);
    if (b.travel_mode) rows.push(['Anreise', [TRAVEL[String(b.travel_mode)], b.departure, b.carpool].filter(Boolean).join(' · ')]);
    if (b.hotel_name) rows.push(['Hotel', [b.hotel_name, b.hotel_address, b.hotel_check_in && b.hotel_check_out ? `${dateDe(b.hotel_check_in as string)}–${dateDe(b.hotel_check_out as string)}` : null, b.hotel_booking_no ? `Buchung ${b.hotel_booking_no}` : null].filter(Boolean).join(' · ')]);
    if (b.bring_along) rows.push(['Mitbringen', String(b.bring_along)]);
    if (b.catering) rows.push(['Verpflegung', String(b.catering)]);
    if (b.internal_contact) rows.push(['Ansprechpartner intern', String(b.internal_contact)]);
    const provider = [b.provider_contact, b.provider_phone, b.provider_email].filter(Boolean).join(' · ');
    if (provider) rows.push([`Ansprechpartner ${b.provider_name}`, provider]);
    return {
      personName: p.person_name, personEmail: p.person_email, title: b.titel, providerName: b.provider_name, bookingNo: b.booking_no,
      participantId: p.id, sequence: p.ics_sequence, now: this.clock.now().toISOString(), tenantName,
      days: x.days.map((d) => ({ label: dayLabel(d.start_at, d.end_at) })),
      icsDays: x.days.map((d) => ({ dayNo: d.day_no, start: new Date(d.start_at).toISOString(), end: new Date(d.end_at).toISOString() })),
      location, onlineUrl: b.format === 'online' ? b.online_url : null, rows,
    };
  }

  private async enqueueInvitation(c: pg.PoolClient, x: Awaited<ReturnType<ExternalBookingService['load']>>, p: { id: string; person_name: string; person_email: string | null; ics_sequence: number }, o: { update?: boolean; cancel?: boolean; reason?: string | null }) {
    if (!p.person_email) return null;
    const tenantName = (await c.query('SELECT name FROM tenant WHERE id = $1', [x.b.tenant_id])).rows[0]?.name ?? '';
    return this.notifications.enqueue(c, {
      tenantId: x.b.tenant_id, channel: 'mail', recipient: p.person_email, template: 'external-booking-invitation',
      data: { ...this.invitationData(x, p, tenantName), update: !!o.update, method: o.cancel ? 'CANCEL' : 'REQUEST', reason: o.reason ?? null },
      secret: { link: this.linkFor(p.id) },
    });
  }

  async setParticipantStatus(id: string, participantId: string, to: BookingStatus, reason: string | null) {
    return this.db.tx(async (c) => {
      const p = (await c.query('SELECT * FROM external_booking_participant WHERE id = $1 AND booking_id = $2 FOR UPDATE', [participantId, id])).rows[0];
      if (!p) throw new NotFoundException('Teilnehmer nicht gefunden');
      if (['abgesagt', 'nicht_erschienen'].includes(to) && !reason) throw new BadRequestException('Bitte einen Grund angeben');
      await this.setStatus(c, p, to, reason);
      return { ok: true };
    });
  }

  /** Absage der ganzen Buchung: Grund, Stornokosten, Kalender-Absage an alle Eingeladenen. */
  async cancel(id: string, reason: string, cancelCostCents: number | null) {
    const queued = await this.db.tx(async (c) => {
      const x = await this.load(c, id);
      if (x.b.cancelled_at) throw new ConflictException('Bereits abgesagt');
      await c.query('UPDATE external_booking SET cancelled_at = $2, cancel_reason = $3, cancel_cost_cents = $4 WHERE id = $1', [id, this.clock.now(), reason, cancelCostCents]);
      const out: Queued[] = [];
      for (const p of x.participants.filter((p) => !FINAL.includes(p.status) && !['teilgenommen', 'eingereicht'].includes(p.status))) {
        const wasInvited = ['eingeladen', 'bestaetigt', 'verschoben'].includes(p.status);
        await this.setStatus(c, p, 'abgesagt', reason);
        if (wasInvited) {
          await c.query('UPDATE external_booking_participant SET ics_sequence = ics_sequence + 1 WHERE id = $1', [p.id]);
          const q = await this.enqueueInvitation(c, x, { ...p, ics_sequence: p.ics_sequence + 1 }, { cancel: true, reason });
          if (q) out.push(q);
        }
      }
      await this.audit.record(c, { entity: 'external_booking', entityId: id, action: 'cancelled', payload: { reason, cancelCostCents } });
      return out;
    });
    await this.notifications.dispatch(queued);
    return { ok: true, cancellationsSent: queued.length };
  }

  // ── Anhänge ────────────────────────────────────────────────
  async addFile(id: string, file: { buffer: Buffer; originalname: string; mimetype: string }) {
    if (!file?.buffer?.length) throw new BadRequestException('Bitte eine Datei auswählen');
    if (file.buffer.length > 20 * 1024 * 1024) throw new BadRequestException('Datei ist größer als 20 MB');
    const isPdf = file.buffer.subarray(0, 5).toString() === '%PDF-';
    const isPng = file.buffer.subarray(1, 4).toString() === 'PNG';
    const isJpg = file.buffer[0] === 0xff && file.buffer[1] === 0xd8;
    if (!isPdf && !isPng && !isJpg) throw new BadRequestException('Bitte ein PDF, PNG oder JPG hochladen');
    const type = isPdf ? 'application/pdf' : isPng ? 'image/png' : 'image/jpeg';
    return this.db.tx(async (c) => {
      const { b } = await this.load(c, id);
      const hash = sha256(file.buffer);
      const key = `external-bookings/${b.tenant_id}/${id}/${randomUUID()}.${isPdf ? 'pdf' : isPng ? 'png' : 'jpg'}`;
      await this.storage.put('uploads', key, file.buffer, { contentType: type });
      const r = await c.query(
        `INSERT INTO external_booking_file (booking_id, file_key, file_name, content_type, size_bytes, sha256) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, file_name, content_type, size_bytes, sha256, created_at`,
        [id, key, (file.originalname || 'anhang').slice(0, 200), type, file.buffer.length, hash],
      );
      await this.audit.record(c, { entity: 'external_booking', entityId: id, action: 'file_added', payload: { fileId: r.rows[0].id, sha256: hash } });
      return r.rows[0];
    });
  }

  async fileContent(c: pg.PoolClient, bookingId: string, fileId: string) {
    const f = (await c.query('SELECT file_key, file_name, content_type FROM external_booking_file WHERE id = $1 AND booking_id = $2', [fileId, bookingId])).rows[0];
    if (!f) throw new NotFoundException('Anhang nicht gefunden');
    return { data: await this.storage.get('uploads', f.file_key), name: f.file_name as string, type: f.content_type as string };
  }

  // ── Einladung als PDF (ohne Mailversand zum Weitergeben) ──
  async invitationPdf(id: string, participantId: string): Promise<{ pdf: Buffer; name: string }> {
    const html = await this.db.tx(async (c) => {
      const x = await this.load(c, id);
      const p = x.participants.find((q) => q.id === participantId);
      if (!p) throw new NotFoundException('Teilnehmer nicht gefunden');
      const tenantName = (await c.query('SELECT name FROM tenant WHERE id = $1', [x.b.tenant_id])).rows[0]?.name ?? '';
      const d = this.invitationData(x, p, tenantName);
      const link = this.linkFor(p.id);
      return `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@page{size:A4;margin:18mm}body{font-family:Inter,Arial,sans-serif;color:#1D2433;font-size:11pt;line-height:1.5}
h1{font-size:18pt;margin:0 0 4px}.m{color:#5F6B7D}.box{background:#EAF0FE;color:#223C8F;border-radius:12px;padding:10px 14px;margin:14px 0}
td{padding:3px 14px 3px 0;vertical-align:top}td:first-child{color:#5F6B7D;white-space:nowrap}</style></head><body>
<div class="m">${esc(tenantName)}</div><h1>Einladung: ${esc(d.title)}</h1><div class="m">${esc(d.providerName)}${d.bookingNo ? ` · Buchung ${esc(d.bookingNo)}` : ''}</div>
<p>Hallo ${esc(d.personName)},<br>Sie sind zu dieser externen Schulung angemeldet.</p>
<div class="box">${d.days.map((x) => esc(x.label)).join('<br>')}</div>
<table>${d.rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
<p>Teilnahme bestätigen, Kalendereintrag und nach dem Termin die Bescheinigung hochladen:<br><b>${esc(link)}</b></p>
<p class="m">Dieser Link ist persönlich – bitte nicht weitergeben.</p></body></html>`;
    });
    return { pdf: await this.pdf.render(html), name: `Einladung-${participantId.slice(0, 8)}.pdf` };
  }

  // ── Sammelbescheinigung durch die Verwaltung ──
  async groupCertificate(id: string, personIds: string[], file: { buffer: Buffer; originalname: string }) {
    const tenantId = (currentRequest()?.session as { tenantId?: string } | undefined)?.tenantId;
    if (!tenantId) throw new BadRequestException('Mandant fehlt');
    const receipt = await this.external.storeReceipt(tenantId, file.buffer, file.originalname || 'bescheinigung.pdf');
    const res = await this.db.tx(async (c) => {
      const x = await this.load(c, id);
      const groupId = randomUUID();
      const created: string[] = [];
      for (const p of x.participants.filter((q) => personIds.includes(q.person_id))) {
        if (!['teilgenommen', 'eingeladen', 'bestaetigt'].includes(p.status)) throw new ConflictException(`${p.person_name}: Status „${BOOKING_STATUS_LABELS[p.status as BookingStatus]}“`);
        if (p.status !== 'teilgenommen') await this.setStatus(c, p, 'teilgenommen');
        const recId = await this.external.insertRecord(c, {
          personId: p.person_id, groupId, fields: this.recordFields(x), files: [receipt], source: 'verwaltung', status: 'eingereicht',
        });
        await c.query('UPDATE external_booking_participant SET external_record_id = $2 WHERE id = $1', [p.id, recId]);
        await this.setStatus(c, { ...p, status: 'teilgenommen' }, 'eingereicht');
        created.push(recId);
      }
      await this.audit.record(c, { entity: 'external_booking', entityId: id, action: 'group_certificate', payload: { records: created.length, sha256: receipt.sha256 } });
      return { created, tenantId: x.b.tenant_id };
    });
    await this.external.enqueueOcr(res.tenantId, res.created);
    return { records: res.created.length, recordIds: res.created };
  }

  recordFields(x: Awaited<ReturnType<ExternalBookingService['load']>>) {
    const first = x.days[0];
    return {
      requirementId: (x.b.requirement_id as string | null) ?? null,
      trainingId: x.b.requirement_id ? null : ((x.b.training_id as string | null) ?? null),
      freeTitle: x.b.requirement_id || x.b.training_id ? null : x.b.titel,
      provider: String(x.b.provider_name),
      heldOn: first ? berlinIsoDate(new Date(x.days.at(-1)!.end_at)) : null,
      durationLabel: x.days.length > 1 ? `${x.days.length} Tage` : '1 Tag',
      location: (x.b.address as string | null) ?? (x.b.format === 'online' ? 'online' : null),
    };
  }

  // ── Teilnehmer über den persönlichen Link ──
  async byToken(token: string) {
    if (!/^[0-9a-f]{43}$/.test(token)) throw new NotFoundException('Link ungültig');
    const r = (await this.db.txAs({}, (c) => c.query('SELECT * FROM app.external_booking_by_token($1)', [sha256(token)]))).rows[0];
    if (!r) throw new NotFoundException('Link ungültig oder abgelaufen');
    return { participantId: r.participant_id as string, tenantId: r.tenant_id as string };
  }

  async participantView(token: string) {
    const t = await this.byToken(token);
    return this.db.txAs({ tenantId: t.tenantId, roles: ['system'] }, async (c) => {
      const p = (await c.query('SELECT booking_id FROM external_booking_participant WHERE id = $1', [t.participantId])).rows[0];
      const x = await this.load(c, p.booking_id);
      const v = this.view(x);
      const me = v.participants.find((q) => q.id === t.participantId)!;
      const tenantName = (await c.query('SELECT name FROM tenant WHERE id = $1', [t.tenantId])).rows[0]?.name ?? '';
      const now = this.clock.now().getTime();
      const started = x.days.length ? new Date(x.days[0]!.start_at).getTime() <= now : false;
      return {
        tenantName,
        booking: { ...v, participants: undefined, costs: undefined, approval: undefined, reminders: undefined },
        me: { name: me.name, status: me.status, statusLabel: me.statusLabel, confirmedAt: me.confirmedAt, problem: me.problem, recordStatus: me.recordStatus },
        can: {
          confirm: ['eingeladen', 'verschoben'].includes(me.status),
          problem: !FINAL.includes(me.status) && me.status !== 'eingereicht',
          upload: started && ['eingeladen', 'bestaetigt', 'teilgenommen'].includes(me.status),
        },
      };
    });
  }

  async confirm(token: string) {
    const t = await this.byToken(token);
    return this.db.txAs({ tenantId: t.tenantId, roles: ['system'] }, async (c) => {
      const p = (await c.query('SELECT * FROM external_booking_participant WHERE id = $1 FOR UPDATE', [t.participantId])).rows[0];
      await this.setStatus(c, p, 'bestaetigt');
      await c.query('UPDATE external_booking_participant SET confirmed_at = $2 WHERE id = $1', [p.id, this.clock.now()]);
      return { ok: true };
    });
  }

  async reportProblem(token: string, note: string) {
    const t = await this.byToken(token);
    const queued = await this.db.txAs({ tenantId: t.tenantId, roles: ['system'] }, async (c) => {
      const p = (await c.query('SELECT bp.*, pe.name FROM external_booking_participant bp JOIN person pe ON pe.id = bp.person_id WHERE bp.id = $1', [t.participantId])).rows[0];
      await c.query('UPDATE external_booking_participant SET problem_note = $2, problem_at = $3 WHERE id = $1', [p.id, note, this.clock.now()]);
      await this.audit.record(c, { entity: 'external_booking_participant', entityId: p.id, action: 'problem_reported', payload: { note } });
      const b = (await c.query('SELECT b.titel, a.email FROM external_booking b LEFT JOIN account a ON a.id = b.created_by WHERE b.id = $1', [p.booking_id])).rows[0];
      if (!b?.email) return [];
      const tenantName = (await c.query('SELECT name FROM tenant WHERE id = $1', [t.tenantId])).rows[0]?.name ?? '';
      return [
        await this.notifications.enqueue(c, {
          tenantId: t.tenantId, channel: 'mail', recipient: b.email, template: 'external-booking-problem',
          data: { personName: p.name, title: b.titel, note, url: `${this.config.PUBLIC_BASE_URL}/verwaltung/externe-schulungen/${p.booking_id}`, tenantName },
        }),
      ];
    });
    await this.notifications.dispatch(queued);
    return { ok: true };
  }

  async participantIcs(token: string) {
    const t = await this.byToken(token);
    return this.db.txAs({ tenantId: t.tenantId, roles: ['system'] }, async (c) => {
      const p = (await c.query('SELECT bp.*, pe.name AS person_name, pe.email AS person_email FROM external_booking_participant bp JOIN person pe ON pe.id = bp.person_id WHERE bp.id = $1', [t.participantId])).rows[0];
      const x = await this.load(c, p.booking_id);
      const d = this.invitationData(x, p, '');
      return buildIcs({
        method: 'PUBLISH', sequence: p.ics_sequence, now: this.clock.now(),
        events: d.icsDays.map((y) => ({
          uid: `${p.id}-${y.dayNo}@schulungsnachweis`, start: new Date(y.start), end: new Date(y.end),
          summary: d.icsDays.length > 1 ? `${d.title} (Tag ${y.dayNo})` : d.title,
          location: (d.location ?? d.onlineUrl ?? null) as string | null, url: (d.onlineUrl ?? null) as string | null,
        })),
      });
    });
  }

  async participantFile(token: string, fileId: string) {
    const t = await this.byToken(token);
    return this.db.txAs({ tenantId: t.tenantId, roles: ['system'] }, async (c) => {
      const p = (await c.query('SELECT booking_id FROM external_booking_participant WHERE id = $1', [t.participantId])).rows[0];
      return this.fileContent(c, p.booking_id, fileId);
    });
  }

  /** Bescheinigung hochladen (Foto/PDF vom Handy): externer Nachweis „eingereicht“, Texterkennung wie bisher. */
  async uploadCertificate(token: string, file: { buffer: Buffer; originalname: string }) {
    const t = await this.byToken(token);
    const receipt = await this.external.storeReceipt(t.tenantId, file.buffer, file.originalname || 'bescheinigung');
    const recId = await this.db.txAs({ tenantId: t.tenantId, roles: ['system'] }, async (c) => {
      const p = (await c.query('SELECT * FROM external_booking_participant WHERE id = $1 FOR UPDATE', [t.participantId])).rows[0];
      const x = await this.load(c, p.booking_id);
      if (!x.days.length || new Date(x.days[0]!.start_at).getTime() > this.clock.now().getTime()) {
        throw new ConflictException('Die Bescheinigung kann erst nach Beginn der Schulung hochgeladen werden');
      }
      if (!['eingeladen', 'bestaetigt', 'teilgenommen'].includes(p.status)) throw new ConflictException('Für diesen Status ist kein Upload vorgesehen');
      if (p.status !== 'teilgenommen') await this.setStatus(c, p, 'teilgenommen');
      const id = await this.external.insertRecord(c, {
        personId: p.person_id, groupId: null, fields: this.recordFields(x), files: [receipt], source: 'selbst', status: 'eingereicht', submittedByPerson: p.person_id,
      });
      await c.query('UPDATE external_booking_participant SET external_record_id = $2 WHERE id = $1', [p.id, id]);
      await this.setStatus(c, { ...p, status: 'teilgenommen' }, 'eingereicht');
      return id;
    });
    await this.external.enqueueOcr(t.tenantId, [recId]);
    return { ok: true, externalRecordId: recId };
  }

  // ── Fristen-Engine: automatisch „teilgenommen“, Erinnerungen, Upload-Aufforderung, Eskalation (E-56) ──
  async stages(c: pg.PoolClient, tenantId: string, tenantName: string, now: Date, queued: Queued[]): Promise<number> {
    const rows = (
      await c.query(
        `SELECT bp.id, bp.status, bp.reminders_sent, bp.person_id, pe.name AS person_name, pe.email AS person_email, b.id AS booking_id, b.titel,
                b.reminder_days_before, b.escalate_after_days, b.bring_along, b.travel_mode, b.departure, a.email AS staff_email,
                (SELECT min(start_at) FROM external_booking_day d WHERE d.booking_id = b.id) AS first_start,
                (SELECT max(end_at) FROM external_booking_day d WHERE d.booking_id = b.id) AS last_end
           FROM external_booking_participant bp JOIN external_booking b ON b.id = bp.booking_id JOIN person pe ON pe.id = bp.person_id
           LEFT JOIN account a ON a.id = b.created_by
          WHERE b.cancelled_at IS NULL AND bp.status IN ('eingeladen','bestaetigt','verschoben','teilgenommen')`,
      )
    ).rows;
    let sent = 0;
    for (const r of rows) {
      if (!r.first_start) continue;
      let status = r.status as BookingStatus;
      if (['eingeladen', 'bestaetigt', 'verschoben'].includes(status) && new Date(r.last_end).getTime() <= now.getTime()) {
        await this.setStatus(c, { id: r.id, status }, 'teilgenommen', 'automatisch nach dem Termin');
        status = 'teilgenommen';
      }
      const due = dueBookingStages(
        { status, firstStart: new Date(r.first_start), lastEnd: new Date(r.last_end), sent: r.reminders_sent as BookingReminderStage[] },
        { daysBefore: r.reminder_days_before, escalateAfterDays: r.escalate_after_days },
        now,
      );
      for (const stage of due) {
        if (stage === 'eskalation') {
          if (r.staff_email) {
            queued.push(await this.notifications.enqueue(c, {
              tenantId, channel: 'mail', recipient: r.staff_email, template: 'external-booking-escalation',
              data: { personName: r.person_name, title: r.titel, lastDay: dateDe(r.last_end), days: r.escalate_after_days, url: `${this.config.PUBLIC_BASE_URL}/verwaltung/externe-schulungen/${r.booking_id}`, tenantName },
            }));
          }
        } else if (r.person_email) {
          queued.push(await this.notifications.enqueue(c, {
            tenantId, channel: 'mail', recipient: r.person_email, template: 'external-booking-reminder',
            data: {
              personName: r.person_name, title: r.titel, stage, firstDay: dateDe(r.first_start), bring: r.bring_along,
              travel: [r.travel_mode ? TRAVEL[r.travel_mode] : null, r.departure].filter(Boolean).join(', '), tenantName,
            },
            secret: { link: this.linkFor(r.id) },
          }));
        }
        await c.query('UPDATE external_booking_participant SET reminders_sent = array_append(reminders_sent, $2) WHERE id = $1', [r.id, stage]);
        await this.audit.record(c, { entity: 'external_booking_participant', entityId: r.id, action: 'reminder_sent', payload: { stage } });
        sent++;
      }
    }
    return sent;
  }

  // ── Auswertung ─────────────────────────────────────────────
  async report(from: string | null, to: string | null) {
    return this.db.tx(async (c) => {
      const rows = (
        await c.query(
          `SELECT b.id, b.titel, b.cost_center, b.fee_cents, b.hotel_cents, b.travel_cents, b.cancelled_at, b.cancel_cost_cents,
                  (SELECT min(start_at) FROM external_booking_day d WHERE d.booking_id = b.id) AS first_start,
                  (SELECT count(*)::int FROM external_booking_participant bp WHERE bp.booking_id = b.id AND bp.status <> 'abgesagt') AS persons
             FROM external_booking b`,
        )
      ).rows.filter((r) => {
        const d = r.first_start ? berlinIsoDate(new Date(r.first_start)) : null;
        return (!from || (d && d >= from)) && (!to || (d && d <= to));
      });
      const byCenter = new Map<string, number>();
      let total = 0;
      for (const r of rows) {
        const cents = r.cancelled_at ? Number(r.cancel_cost_cents ?? 0) : bookingTotalCents({ feeCents: r.fee_cents, hotelCents: r.hotel_cents, travelCents: r.travel_cents }, r.persons);
        total += cents;
        const k = r.cost_center || 'ohne Kostenstelle';
        byCenter.set(k, (byCenter.get(k) ?? 0) + cents);
      }
      const perPerson = (
        await c.query(
          `SELECT pe.name, sum(b.fee_cents + b.hotel_cents)::int AS cents, count(*)::int AS bookings
             FROM external_booking_participant bp JOIN external_booking b ON b.id = bp.booking_id JOIN person pe ON pe.id = bp.person_id
            WHERE bp.status <> 'abgesagt' AND b.id = ANY($1::uuid[]) GROUP BY pe.name ORDER BY cents DESC`,
          [rows.map((r) => r.id)],
        )
      ).rows;
      const open = (
        await c.query(
          `SELECT count(*)::int AS n FROM external_booking_participant bp WHERE bp.status IN ('teilgenommen') AND bp.booking_id = ANY($1::uuid[])`,
          [rows.map((r) => r.id)],
        )
      ).rows[0].n;
      return {
        totalCents: total,
        byCostCenter: [...byCenter.entries()].map(([costCenter, cents]) => ({ costCenter, cents })).sort((a, b) => b.cents - a.cents),
        perPerson,
        openCertificates: open,
        bookings: rows.length,
      };
    });
  }

  /** Detail: Verwaltung/Auditor alles; Vorgesetzte nur Buchungen, die sie freigeben sollen. */
  async getForViewer(id: string) {
    const req = currentRequest()!;
    const s = req.session!;
    if (req.roles.some((r) => ['admin', 'verantwortlich', 'auditor'].includes(r))) return this.db.tx(async (c) => this.view(await this.load(c, id)));
    const accountId = s.kind === 'account' ? s.accountId : null;
    return this.db.txAs({ tenantId: s.kind === 'account' ? s.tenantId : null, accountId, roles: ['system'] }, async (c) => {
      const x = await this.load(c, id);
      const mine = (await c.query('SELECT 1 FROM person WHERE id = $1 AND account_id = $2', [x.b.approver_person_id, accountId])).rowCount;
      if (!mine) throw new NotFoundException('Externe Schulung nicht gefunden');
      return this.view(x);
    });
  }

  async list() {
    return this.db.tx(async (c) => {
      const ids = (await c.query('SELECT id FROM external_booking ORDER BY created_at DESC')).rows.map((r) => r.id as string);
      const out = [];
      for (const id of ids) out.push(this.view(await this.load(c, id)));
      return out;
    });
  }
}
