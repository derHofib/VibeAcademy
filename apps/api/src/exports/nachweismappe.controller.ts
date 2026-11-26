import { BadRequestException, Body, Controller, HttpCode, Inject, NotFoundException, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import JSZip from 'jszip';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { Roles } from '../auth/decorators';
import { Clock } from '../common/clock';
import { sha256 } from '../common/crypto';
import { ZodBody } from '../common/errors';
import { APP_CONFIG, repoPath, type AppConfig } from '../config';
import { DbService } from '../db/db.service';
import { dt } from '../evidence/evidence.service';
import { PDF_RENDERER, type PdfRenderer } from '../evidence/pdf-renderer';
import { SEALER, type Sealer } from '../evidence/sealer';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage';
import { renderIndexHtml, type IndexRow } from './index-template';

const Export = z
  .object({
    from: z.iso.date('Datum im Format JJJJ-MM-TT'),
    to: z.iso.date('Datum im Format JJJJ-MM-TT'),
    orgUnitId: z.uuid().nullish(),
    trainingId: z.uuid().nullish(),
    personId: z.uuid().nullish(),
  })
  .refine((b) => b.from <= b.to, { message: '„Von“ muss vor „bis“ liegen', path: ['to'] });

const KIND: Record<string, string> = { online: 'Online', praesenz: 'Präsenz', live: 'Live', extern: 'Extern' };
const de = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '–');
const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/** Nachweismappe (Schritt 2.7): ZIP mit Verzeichnis-PDF (Prüfcodes, SHA-256) und allen versiegelten Nachweis-PDFs. */
@Controller()
export class NachweismappeController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(PDF_RENDERER) private readonly renderer: PdfRenderer,
    @Inject(SEALER) private readonly sealer: Sealer,
  ) {}

  @Post('exports/nachweismappe')
  @Roles('admin', 'verantwortlich', 'auditor')
  @HttpCode(200)
  async export(@Body(new ZodBody(Export)) b: z.infer<typeof Export>, @Res() res: Response) {
    const data = await this.db.tx(async (c) => {
      const rows = (
        await c.query(
          `WITH RECURSIVE units AS (
             SELECT id FROM org_unit WHERE id = $3::uuid
             UNION SELECT o.id FROM org_unit o JOIN units u ON o.parent_id = u.id)
           SELECT e.id, e.nachweis_nr, e.verify_code, e.pdf_key, e.pdf_sha256, e.seal_ts, e.kind,
                  ix.titel, ix.completed_on::text AS completed_on, p.name AS person_name, p.personalnr, o.name AS org_unit
             FROM app.evidence_index ix JOIN evidence e ON e.id = ix.evidence_id
             JOIN person p ON p.id = ix.person_id LEFT JOIN org_unit o ON o.id = p.org_unit_id
            WHERE e.status = 'erzeugt' AND e.revoked_at IS NULL
              AND coalesce(ix.completed_on, (e.created_at AT TIME ZONE 'Europe/Berlin')::date) BETWEEN $1::date AND $2::date
              AND ($3::uuid IS NULL OR p.org_unit_id IN (SELECT id FROM units))
              AND ($4::uuid IS NULL OR ix.training_id = $4)
              AND ($5::uuid IS NULL OR ix.person_id = $5)
            ORDER BY ix.completed_on, p.name, e.nachweis_nr`,
          [b.from, b.to, b.orgUnitId ?? null, b.trainingId ?? null, b.personId ?? null],
        )
      ).rows;
      const tenant = (await c.query('SELECT name FROM tenant WHERE id = app.tenant_id()')).rows[0]?.name ?? '';
      const filter = [
        b.orgUnitId ? `Org-Einheit: ${(await c.query('SELECT name FROM org_unit WHERE id = $1', [b.orgUnitId])).rows[0]?.name ?? '–'}` : null,
        b.trainingId ? `Schulung: ${(await c.query('SELECT titel FROM training WHERE id = $1', [b.trainingId])).rows[0]?.titel ?? '–'}` : null,
        b.personId ? `Person: ${(await c.query('SELECT name FROM person WHERE id = $1', [b.personId])).rows[0]?.name ?? '–'}` : null,
      ].filter(Boolean) as string[];
      return { rows, tenant, filter };
    });
    if (!data.rows.length) throw new NotFoundException('Im gewählten Zeitraum gibt es keine Nachweise');
    if (data.rows.length > 5000) throw new BadRequestException('Mehr als 5.000 Nachweise – bitte den Zeitraum verkleinern');

    const zip = new JSZip();
    const index: IndexRow[] = [];
    for (const r of data.rows) {
      const pdf = await this.storage.get('evidence', r.pdf_key);
      const actual = sha256(pdf);
      const file = `nachweise/${r.nachweis_nr}.pdf`;
      zip.file(file, pdf, { binary: true });
      index.push({
        nachweisNr: r.nachweis_nr, person: r.person_name, personalnr: r.personalnr, orgUnit: r.org_unit, titel: r.titel ?? '–', art: KIND[r.kind] ?? r.kind,
        datum: de(r.completed_on), versiegelt: r.seal_ts ? dt(r.seal_ts) : '–', verifyCode: r.verify_code, sha256: r.pdf_sha256, intact: actual === r.pdf_sha256, file,
      });
    }
    const now = this.clock.now();
    const html = renderIndexHtml(
      { tenantName: data.tenant, from: de(b.from), to: de(b.to), createdAt: dt(now), filter: data.filter, rows: index, verifyBase: `${this.config.PUBLIC_BASE_URL}/verify/` },
      repoPath(this.config.FONT_DIR),
    );
    const sealed = await this.sealer.seal(await this.renderer.render(html));
    zip.file('00_Verzeichnis.pdf', sealed.pdf, { binary: true });
    zip.file(
      'verzeichnis.csv',
      '﻿' + ['Nachweis-Nr;Person;Personalnr;Org-Einheit;Schulung;Art;Datum;Erstellt;Prüfcode;SHA-256;Datei']
        .concat(index.map((r) => [r.nachweisNr, r.person, r.personalnr, r.orgUnit, r.titel, r.art, r.datum, r.versiegelt, r.verifyCode, r.sha256, r.file].map(csvCell).join(';')))
        .join('\r\n'),
    );
    const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    const hash = sha256(out);
    await this.db.tx((c) =>
      this.audit.record(c, {
        entity: 'export', action: 'nachweismappe',
        payload: { from: b.from, to: b.to, orgUnitId: b.orgUnitId ?? null, trainingId: b.trainingId ?? null, personId: b.personId ?? null, count: index.length, sha256: hash, indexSha256: sha256(sealed.pdf) },
      }),
    );
    res.setHeader('content-type', 'application/zip');
    res.setHeader('content-disposition', `attachment; filename="Nachweismappe_${b.from}_${b.to}.zip"`);
    res.setHeader('cache-control', 'private, no-store');
    res.setHeader('x-evidence-count', String(index.length));
    res.setHeader('x-content-sha256', hash);
    res.send(out);
  }
}
