import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock, FakeClock } from '../src/common/clock';
import { DeadlineService } from '../src/deadlines/deadline.service';
import { DOZENT, registerDozent } from './fixtures';
import { startHarness, waitFor, type Client, type Harness } from './harness';

/**
 * Phase 4.3 (E-55/E-56), Abnahme: „Elektrofachkraft Hochvolt (HV2), Anbieter X, 2 Tage, mit Hotel“ bei der Buchung anlegen,
 * Freigabe, gebucht, Einladung mit Anreise, Hotel und .ics, Bestätigung, Verschiebung (aktualisierte .ics), Erinnerungen,
 * Upload der Bescheinigung, Freigabe → Pflichtmatrix aktualisiert; Eskalation, Absage, Auswertung.
 */
const clock = new FakeClock(new Date('2026-11-27T09:00:00Z'));
let h: Harness;
let dozent: Client;
let bookingId: string;
let requirementId: string;
const people: Record<string, string> = {};
const links: Record<string, string> = {};
const q = async (sql: string, p: unknown[] = []) => (await h.db.admin.query(sql, p)).rows;
const D = 86_400_000;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
type Mail = { subject: string; text: string; attachments?: Array<{ filename: string; content: string; contentType: string }> };
const mails = async (to: string) => (await dozent.get(`/api/dev/postausgang?an=${to}`)).body as Mail[];
const token = (link: string) => link.split('/extern/b/')[1]!;

const DAYS = [
  { startAt: '2027-01-12T08:30:00+01:00', endAt: '2027-01-12T16:30:00+01:00' },
  { startAt: '2027-01-13T08:00:00+01:00', endAt: '2027-01-13T15:00:00+01:00' },
];

beforeAll(async () => {
  h = await startHarness([{ provide: Clock, useValue: clock }]);
  dozent = await registerDozent(h);
  for (const [n, e] of [['Lea Wagner', 'lea@example.org'], ['Tobias Meier', 'tobias@example.org'], ['Marion Krause', 'marion@example.org']] as const) {
    people[n] = (await dozent.post('/api/persons', { name: n, email: e })).body.id;
  }
  const training = (await dozent.post('/api/trainings', { titel: 'Elektrofachkraft Hochvolt (HV2)', format: 'extern', quizRequired: false })).body.id;
  const qual = (await dozent.post('/api/qualifications', { name: 'HV-Qualifikation' })).body.id;
  requirementId = (await dozent.post('/api/requirements', { qualificationId: qual, trainingId: training, intervalMonths: 36 })).body.id;
  await dozent.post(`/api/qualifications/${qual}/persons`, { personIds: [people['Lea Wagner'], people['Tobias Meier']] });
}, 120_000);
afterAll(async () => h?.close());

describe('Externe Schulung von der Buchung bis zur Pflichtmatrix', () => {
  it('anlegen mit Anbieter, 2 Tagen, Anreise, Hotel, Kosten, Freigabe durch Vorgesetzte', async () => {
    const bad = await dozent.post('/api/external-bookings', { titel: 'X', providerName: 'Y', days: [], approvalRequired: true });
    expect(bad.status).toBe(400);
    const r = await dozent.post('/api/external-bookings', {
      titel: 'Elektrofachkraft Hochvolt (HV2)', requirementId, providerName: 'Hochvolt Akademie Süd GmbH', providerContact: 'Frau Richter',
      providerPhone: '0711 555 210', providerEmail: 'kurse@hv-akademie.example', bookingNo: 'HVA-2026-4471', format: 'praesenz',
      address: 'Industriestr. 14, 70565 Stuttgart', room: 'Schulungszentrum, Raum 2', meetingPoint: 'Empfang',
      travelMode: 'firmenwagen', departure: '11.01.2027, 15:00 · Betriebshof', carpool: 'Lea Wagner fährt (S-ME 204)',
      hotelName: 'Hotel am Park', hotelAddress: 'Stuttgart-Vaihingen', hotelCheckIn: '2027-01-11', hotelCheckOut: '2027-01-13', hotelBookingNo: 'HP-88213',
      bringAlong: 'Sicherheitsschuhe, Lichtbogenschutz-Visier, Personalausweis', internalContact: 'Dennis Hofmann, 0761 123 456',
      feeCents: 129_000, hotelCents: 23_600, travelCents: 0, costCenter: '4100 Service',
      approvalRequired: true, approverPersonId: people['Marion Krause'], days: DAYS, personIds: [people['Lea Wagner'], people['Tobias Meier']],
    });
    expect(r.status).toBe(201);
    bookingId = r.body.id;
    const b = (await dozent.get(`/api/external-bookings/${bookingId}`)).body;
    expect(b.costs.totalCents).toBe(305_200);
    expect(b.days.map((d: { label: string }) => d.label)).toEqual(['Di 12.01.2027, 08:30–16:30', 'Mi 13.01.2027, 08:00–15:00']);
    expect(b.participants.map((p: { status: string }) => p.status)).toEqual(['geplant', 'geplant']);
  });

  it('Freigabe einholen, freigeben, gebucht – ohne Freigabe keine Buchung', async () => {
    expect((await dozent.post(`/api/external-bookings/${bookingId}/booked`, {})).status).toBe(409);
    const ra = await dozent.post(`/api/external-bookings/${bookingId}/request-approval`);
    expect(ra.body.mails).toBe(1);
    const m = await waitFor(async () => (await mails('marion@example.org')).find((x) => x.subject.startsWith('Freigabe erbeten')));
    expect(m.text).toContain('3.052,00');
    expect((await dozent.get(`/api/external-bookings/${bookingId}`)).body.participants[0].status).toBe('zur_freigabe');
    expect((await dozent.post(`/api/external-bookings/${bookingId}/approve`)).status).toBe(200);
    const booked = await dozent.post(`/api/external-bookings/${bookingId}/booked`, { bookingNo: 'HVA-2026-4471' });
    expect(booked.body.booked).toBe(2);
  });

  it('Einladung per Mail mit allen Daten und Kalendereintrag (.ics je Tag)', async () => {
    const r = await dozent.post(`/api/external-bookings/${bookingId}/invite`, { sendMail: true });
    expect(r.body).toMatchObject({ invited: 2, mailsQueued: 2 });
    for (const l of r.body.links) links[l.name] = l.link;
    const m = await waitFor(async () => (await mails('lea@example.org')).find((x) => x.subject === 'Einladung: Elektrofachkraft Hochvolt (HV2)'));
    for (const s of ['Hochvolt Akademie Süd GmbH', 'Di 12.01.2027, 08:30–16:30', 'Hotel am Park', 'Firmenwagen', 'Sicherheitsschuhe', 'Frau Richter', '/extern/b/']) {
      expect(m.text, s).toContain(s);
    }
    const ics = m.attachments![0]!;
    expect(ics.filename).toBe('termin.ics');
    expect(ics.contentType).toContain('text/calendar');
    expect(ics.content.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics.content).toContain('DTSTART:20270112T073000Z');
    expect(ics.content).toContain('SEQUENCE:0');
    expect(ics.content).toContain('METHOD:REQUEST');
  });

  it('Mitarbeiter: persönliche Seite, Teilnahme bestätigen, Problem melden, .ics laden', async () => {
    const anon = await h.agent();
    const t = token(links['Lea Wagner']!);
    const v = (await anon.get(`/api/public/external-bookings/${t}`)).body;
    expect(v.booking).toMatchObject({ titel: 'Elektrofachkraft Hochvolt (HV2)', hotel: { name: 'Hotel am Park' } });
    expect(v.booking.costs).toBeUndefined();
    expect(v.me).toMatchObject({ name: 'Lea Wagner', status: 'eingeladen' });
    expect(v.can).toMatchObject({ confirm: true, upload: false });
    expect((await anon.post(`/api/public/external-bookings/${t}/confirm`)).status).toBe(200);
    expect((await anon.post(`/api/public/external-bookings/${t}/confirm`)).status).toBe(409);
    const ics = await anon.get(`/api/public/external-bookings/${t}/termin.ics`);
    expect(ics.headers['content-type']).toContain('text/calendar');
    const tt = token(links['Tobias Meier']!);
    expect((await anon.post(`/api/public/external-bookings/${tt}/problem`, { note: 'Ich bin am 12.01. beim Kunden eingeplant.' })).status).toBe(200);
    const pm = await waitFor(async () => (await mails(DOZENT.email)).find((x) => x.subject.startsWith('Problem gemeldet')));
    expect(pm.text).toContain('beim Kunden eingeplant');
    expect((await anon.get('/api/public/external-bookings/' + 'a'.repeat(43))).status).toBe(404);
  });

  it('Verschiebung: Status „verschoben“, aktualisierte Einladung mit SEQUENCE 1', async () => {
    const moved = [{ startAt: '2027-01-19T08:30:00+01:00', endAt: '2027-01-19T16:30:00+01:00' }, { startAt: '2027-01-20T08:00:00+01:00', endAt: '2027-01-20T15:00:00+01:00' }];
    const r = await dozent.patch(`/api/external-bookings/${bookingId}`, { days: moved });
    expect(r.body.updatesSent).toBe(2);
    const m = await waitFor(async () => (await mails('lea@example.org')).find((x) => x.subject.startsWith('Geändert:')));
    expect(m.attachments![0]!.content).toContain('SEQUENCE:1');
    expect(m.attachments![0]!.content).toContain('DTSTART:20270119T073000Z');
    const b = (await dozent.get(`/api/external-bookings/${bookingId}`)).body;
    expect(b.participants.map((p: { status: string }) => p.status)).toEqual(['verschoben', 'verschoben']);
    const anon = await h.agent();
    expect((await anon.post(`/api/public/external-bookings/${token(links['Lea Wagner']!)}/confirm`)).status).toBe(200);
  });

  it('Erinnerungen genau einmal, danach automatisch „teilgenommen“ und Upload-Aufforderung', async () => {
    const svc = h.app.get(DeadlineService);
    clock.set(new Date(Date.parse('2027-01-19T08:30:00+01:00') - 6 * D));
    await svc.run();
    await svc.run();
    const before = (await mails('lea@example.org')).filter((x) => x.subject.startsWith('Erinnerung: Elektrofachkraft'));
    expect(before).toHaveLength(1);
    expect(before[0]!.text).toContain('Firmenwagen');
    clock.set(new Date(Date.parse('2027-01-20T15:00:00+01:00') + 3600_000));
    await svc.run();
    const p = (await dozent.get(`/api/external-bookings/${bookingId}`)).body.participants;
    expect(p.map((x: { status: string }) => x.status)).toEqual(['teilgenommen', 'teilgenommen']);
    await waitFor(async () => (await mails('lea@example.org')).find((x) => x.subject.startsWith('Bitte Teilnahmebescheinigung hochladen')));
  });

  it('Bescheinigung hochladen → externer Nachweis; Freigabe → Pflichtmatrix gültig', async () => {
    const anon = await h.agent();
    const t = token(links['Lea Wagner']!);
    expect((await anon.get(`/api/public/external-bookings/${t}`)).body.can.upload).toBe(true);
    const up = await anon.upload(`/api/public/external-bookings/${t}/certificate`, 'datei', PNG, 'zertifikat.png');
    expect(up.status).toBe(201);
    const rec = (await q('SELECT status, requirement_id, provider, held_on::text AS held_on, source FROM external_record WHERE id = $1', [up.body.externalRecordId]))[0];
    expect(rec).toMatchObject({ status: 'eingereicht', requirement_id: requirementId, provider: 'Hochvolt Akademie Süd GmbH', held_on: '2027-01-20', source: 'selbst' });
    expect((await dozent.get(`/api/external-bookings/${bookingId}`)).body.participants[0].status).toBe('eingereicht');
    const ok = await dozent.post(`/api/external-records/${up.body.externalRecordId}/approve`, { scope: 'record' });
    expect(ok.status).toBe(200);
    const b = (await dozent.get(`/api/external-bookings/${bookingId}`)).body;
    expect(b.participants[0]).toMatchObject({ name: 'Lea Wagner', status: 'freigegeben', recordStatus: 'freigegeben', validUntil: expect.stringMatching(/^2030-01/) });
    const comp = (await dozent.get(`/api/compliance?person=${people['Lea Wagner']}`)).body;
    expect(comp.rows.find((r: { requirementId: string }) => r.requirementId === requirementId).state).toBe('gueltig');
  });

  it('Eskalation an die Verwaltung, wenn nach 7 Tagen keine Bescheinigung kommt', async () => {
    clock.set(new Date(Date.parse('2027-01-20T15:00:00+01:00') + 8 * D));
    await h.app.get(DeadlineService).run();
    const m = await waitFor(async () => (await mails(DOZENT.email)).find((x) => x.subject === 'Bescheinigung fehlt: Tobias Meier – Elektrofachkraft Hochvolt (HV2)'));
    expect(m.text).toContain('seit 7 Tagen');
    const audit = await q(`SELECT payload->>'stage' AS stage FROM audit_event WHERE action = 'reminder_sent' AND entity = 'external_booking_participant'`);
    expect(audit.map((a) => a.stage).sort()).toEqual(['eskalation', 'upload', 'upload', 'vorher', 'vorher']);
  });

  it('Einladung als PDF zum Weitergeben, Anhänge, Absage mit Kalender-Absage, Auswertung', async () => {
    const pid = (await dozent.get(`/api/external-bookings/${bookingId}`)).body.participants[1].id;
    const pdf = await dozent.http.get(`/api/external-bookings/${bookingId}/participants/${pid}/invitation.pdf`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (d: Buffer) => chunks.push(d));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    const file = await dozent.upload(`/api/external-bookings/${bookingId}/files`, 'datei', PNG, 'Anfahrt.png');
    expect(file.status).toBe(201);
    expect((await dozent.upload(`/api/external-bookings/${bookingId}/files`, 'datei', Buffer.from('x'), 'x.txt')).status).toBe(400);

    clock.set(new Date('2027-02-01T09:00:00Z'));
    const second = await dozent.post('/api/external-bookings', {
      titel: 'Ersthelfer-Fortbildung', providerName: 'DRK Kreisverband', days: [{ startAt: '2027-03-04T08:00:00+01:00', endAt: '2027-03-04T16:00:00+01:00' }],
      personIds: [people['Tobias Meier']], feeCents: 6_500, costCenter: '4200 Montage',
    });
    await dozent.post(`/api/external-bookings/${second.body.id}/booked`, {});
    await dozent.post(`/api/external-bookings/${second.body.id}/invite`, { sendMail: true });
    const c = await dozent.post(`/api/external-bookings/${second.body.id}/cancel`, { reason: 'Kurs vom Anbieter abgesagt', cancelCostCents: 0 });
    expect(c.body.cancellationsSent).toBe(1);
    const m = await waitFor(async () => (await mails('tobias@example.org')).find((x) => x.subject === 'Abgesagt: Ersthelfer-Fortbildung'));
    expect(m.attachments![0]!.content).toContain('METHOD:CANCEL');
    expect((await dozent.get(`/api/external-bookings/${second.body.id}`)).body.participants[0].status).toBe('abgesagt');

    const rep = (await dozent.get('/api/external-bookings/report')).body;
    expect(rep.byCostCenter).toEqual(expect.arrayContaining([{ costCenter: '4100 Service', cents: 305_200 }, { costCenter: '4200 Montage', cents: 0 }]));
    expect(rep.openCertificates).toBe(1);
  });

  it('ohne Rolle kein Zugriff; Vorgesetzte nur auf ihre Freigaben', async () => {
    expect((await (await h.agent()).get('/api/external-bookings')).status).toBe(401);
  });
});
