import type {} from 'multer';
import { BadRequestException, Body, Controller, Post, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import JSZip from 'jszip';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { Roles } from '../auth/decorators';
import { currentRequest } from '../common/request-context';
import { DbService } from '../db/db.service';
import { parseCsv } from '../persons/persons.controller';
import { ExternalService, type RecordFields } from './external.service';
import { normalize, parseGermanDate } from './ocr';
import type { ReceiptFile } from './receipts';
import { WebhookEmitter } from '../webhooks/webhook-emitter';

const HEADERS: Record<string, string[]> = {
  personalnr: ['personalnr', 'personalnummer', 'pers_nr', 'persnr'],
  email: ['email', 'e_mail', 'mail'],
  name: ['name', 'person', 'teilnehmer', 'teilnehmerin', 'mitarbeiter'],
  kurs: ['kurs', 'schulung', 'training', 'titel', 'thema'],
  qualifikation: ['qualifikation', 'pflichtschulung'],
  anbieter: ['anbieter', 'veranstalter', 'provider'],
  datum: ['datum', 'schulungsdatum', 'am'],
  umfang: ['umfang', 'dauer'],
  ort: ['ort', 'location'],
  gueltig_bis: ['gueltig_bis', 'gueltig', 'gueltigkeit'],
  beleg: ['beleg', 'datei', 'dateiname', 'bescheinigung'],
  arbeitsmedizin: ['arbeitsmedizin', 'vorsorge', 'arbeitsmedizinische_vorsorge'],
};
const normHeader = (h: string) =>
  h.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

function pick(row: Record<string, string>, key: string): string | null {
  for (const [h, v] of Object.entries(row)) if (HEADERS[key]!.includes(normHeader(h)) && v?.trim()) return v.trim();
  return null;
}
const toIso = (s: string | null) => (s ? (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : parseGermanDate(s)) : null);
function hours(label: string | null): number | null {
  const m = label ? /(\d+(?:[.,]\d+)?)\s*(UE|LE|Std|Stunden|h)?/i.exec(label) : null;
  if (!m) return null;
  const n = Number(m[1]!.replace(',', '.'));
  return /^(UE|LE)$/i.test(m[2] ?? '') ? n * 0.75 : n;
}

/** Import (SPEZIFIKATION 4.7, dritter Weg): CSV + ZIP mit Belegen. Alles oder nichts; dryRun prüft nur. */
@Controller()
export class ExternalImportController {
  constructor(
    private readonly db: DbService,
    private readonly ext: ExternalService,
    private readonly audit: AuditService,
  ) {}

  @Post('imports/external')
  @Roles('admin', 'verantwortlich')
  @UseInterceptors(FileFieldsInterceptor([{ name: 'csv', maxCount: 1 }, { name: 'zip', maxCount: 1 }], { limits: { fileSize: 200 * 1024 * 1024 } }))
  async import(
    @UploadedFiles() files: { csv?: Express.Multer.File[]; zip?: Express.Multer.File[] } = {},
    @Body() body: { csv?: string; mode?: string; dryRun?: string },
  ) {
    const csvText = files.csv?.[0]?.buffer.toString('utf8') ?? body.csv;
    if (!csvText) throw new BadRequestException('Bitte eine CSV-Datei (Feld „csv“) senden');
    const mode = body.mode === 'freigeben' ? 'freigeben' : 'pruefen';
    const dryRun = body.dryRun === 'true';
    const rows = parseCsv(csvText);
    if (!rows.length) throw new BadRequestException('Die CSV-Datei enthält keine Zeilen');
    if (rows.length > 5000) throw new BadRequestException('Höchstens 5.000 Zeilen je Import');
    const zipFiles = new Map<string, { name: string; data: () => Promise<Buffer> }>();
    if (files.zip?.[0]) {
      let zip: JSZip;
      try {
        zip = await JSZip.loadAsync(files.zip[0].buffer);
      } catch {
        throw new BadRequestException('Die ZIP-Datei kann nicht gelesen werden');
      }
      zip.forEach((path, entry) => {
        if (entry.dir || path.startsWith('__MACOSX/')) return;
        const base = path.split('/').pop()!;
        zipFiles.set(base.toLowerCase(), { name: base, data: () => entry.async('nodebuffer') });
      });
    }
    const tenantId = currentRequest()!.session!.tenantId!;
    const status = mode === 'freigeben' ? 'freigegeben' : 'eingereicht';
    const stored = new Map<string, ReceiptFile>();

    const result = await this.db.tx(async (c) => {
      const persons = (await c.query('SELECT id, name, personalnr, lower(email::text) AS email FROM person')).rows;
      const trainings = (await c.query('SELECT id, titel FROM training WHERE archived_at IS NULL')).rows;
      const reqs = (
        await c.query('SELECT r.id, r.training_id, q.name AS qname FROM requirement r JOIN qualification q ON q.id = r.qualification_id WHERE r.active')
      ).rows;
      const report: Array<{ line: number; ok: boolean; personName?: string; recordId?: string; errors?: string[] }> = [];
      const prepared: Array<{ line: number; personId: string; personName: string; fields: RecordFields; validUntil: string | null; beleg: string | null; key: string }> = [];
      rows.forEach((row, i) => {
        const line = i + 2;
        const errors: string[] = [];
        const nr = pick(row, 'personalnr');
        const mail = pick(row, 'email')?.toLowerCase();
        const name = pick(row, 'name');
        const matches = nr ? persons.filter((p) => p.personalnr === nr) : mail ? persons.filter((p) => p.email === mail) : name ? persons.filter((p) => normalize(p.name) === normalize(name)) : [];
        if (!nr && !mail && !name) errors.push('Person fehlt (Personalnr, E-Mail oder Name)');
        else if (!matches.length) errors.push(`Person nicht gefunden: ${nr ?? mail ?? name}`);
        else if (matches.length > 1) errors.push(`Name nicht eindeutig: ${name}`);
        const kurs = pick(row, 'kurs');
        const qual = pick(row, 'qualifikation');
        const training = kurs ? trainings.find((t) => normalize(t.titel) === normalize(kurs)) : undefined;
        const reqCands = reqs.filter((r) => (!training || r.training_id === training.id) && (!qual || normalize(r.qname) === normalize(qual)));
        const requirement = (training || qual) && reqCands.length === 1 ? reqCands[0] : undefined;
        if (qual && !requirement) errors.push(`Pflichtschulung nicht gefunden: ${qual}${kurs ? ` / ${kurs}` : ''}`);
        if (!kurs && !requirement) errors.push('Kurs fehlt');
        const datumRaw = pick(row, 'datum');
        const heldOn = toIso(datumRaw);
        if (!datumRaw && status === 'freigegeben') errors.push('Datum fehlt');
        if (datumRaw && !heldOn) errors.push(`Datum ungültig: ${datumRaw}`);
        const gRaw = pick(row, 'gueltig_bis');
        const validUntil = toIso(gRaw);
        if (gRaw && !validUntil) errors.push(`„Gültig bis“ ungültig: ${gRaw}`);
        const beleg = pick(row, 'beleg');
        if (beleg && !zipFiles.has(beleg.toLowerCase())) errors.push(`Beleg nicht in der ZIP-Datei: ${beleg}`);
        const umfang = pick(row, 'umfang');
        const isMedical = /^(ja|x|1|true|wahr)$/i.test(pick(row, 'arbeitsmedizin') ?? '');
        if (errors.length || matches.length !== 1) {
          report.push({ line, ok: false, errors });
          return;
        }
        const p = matches[0];
        const fields: RecordFields = {
          requirementId: requirement?.id ?? null, trainingId: requirement ? null : (training?.id ?? null), freeTitle: requirement || training ? null : kurs,
          provider: pick(row, 'anbieter'), heldOn, durationLabel: umfang, durationHours: hours(umfang), location: pick(row, 'ort'), isMedical,
        };
        prepared.push({ line, personId: p.id, personName: p.name, fields, validUntil, beleg, key: `${beleg ?? ''}|${kurs ?? qual}|${heldOn ?? ''}` });
        report.push({ line, ok: true, personName: p.name });
      });
      const failed = report.filter((r) => !r.ok).length;
      if (dryRun || failed) return { report, created: [] as string[], failed };
      // Belege speichern (je Datei einmal)
      for (const p of prepared) {
        if (!p.beleg || stored.has(p.beleg.toLowerCase())) continue;
        const z = zipFiles.get(p.beleg.toLowerCase())!;
        stored.set(p.beleg.toLowerCase(), await this.ext.storeReceipt(tenantId, await z.data(), z.name));
      }
      const groups = new Map<string, string>();
      const created: string[] = [];
      for (const p of prepared) {
        const sameKey = prepared.filter((x) => x.key === p.key).length > 1;
        if (sameKey && !groups.has(p.key)) groups.set(p.key, randomUUID());
        let validUntil = p.validUntil;
        if (status === 'freigegeben' && !validUntil) {
          const asg = await this.ext.resolveAssignment(c, p.fields);
          validUntil = (await this.ext.proposal(c, asg.requirementId, asg.trainingId, p.fields.heldOn ?? null)).validUntil;
        }
        const id = await this.ext.insertRecord(c, {
          personId: p.personId, groupId: sameKey ? groups.get(p.key)! : null, fields: p.fields, source: 'import', status,
          files: p.beleg ? [stored.get(p.beleg.toLowerCase())!] : [], validUntil, reviewed: status === 'freigegeben',
        });
        report.find((r) => r.line === p.line)!.recordId = id;
        if (status === 'freigegeben') await WebhookEmitter.emit(c, tenantId, 'external_record.approved', { externalRecordId: id }); // E-37
        created.push(id);
      }
      await this.audit.record(c, { entity: 'external_record', action: 'imported', payload: { rows: rows.length, created: created.length, mode, receipts: stored.size } });
      return { report, created, failed: 0 };
    });
    if (!dryRun && result.failed) {
      throw new BadRequestException({ message: `${result.failed} von ${rows.length} Zeilen fehlerhaft – nichts importiert`, rows: result.report });
    }
    if (!dryRun && result.created.length) {
      if (status === 'freigegeben') await this.ext.sealApproved(tenantId, result.created);
      else await this.ext.enqueueOcr(tenantId, result.created);
    }
    return { dryRun, mode, status, rows: result.report, created: result.created.length, receipts: stored.size };
  }
}
