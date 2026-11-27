import type {} from 'multer';
import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, Inject, NotFoundException, Param, ParseIntPipe, ParseUUIDPipe,
  Patch, Post, Put, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { Roles } from '../auth/decorators';
import { APP_CONFIG, type AppConfig } from '../config';
import { sha256 } from '../common/crypto';
import { ZodBody } from '../common/errors';
import { DbService } from '../db/db.service';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage';
import { AnalysisService, versionPrefix } from './analysis.service';
import { isPdf } from './pdf-analysis';
import { parseSettings, TrainingSettings } from './settings';
import { ANLASS_TYPES, DELIVERY_TYPES, formatForDelivery, PLATFORMS } from '@sn/shared';

/** Felder ohne Standardwerte: In Zod 4 greifen Standardwerte auch in `.partial()` – ein PATCH würde sonst
 *  nicht genannte Felder (Bestätigungstext, Format, Quiz) zurücksetzen. */
const TrainingFields = z.object({
  titel: z.string().trim().min(2, 'Bitte einen Titel angeben').max(300),
  kategorie: z.string().trim().max(100).nullish(),
  rechtsgrundlage: z.string().trim().max(300).nullish(),
  format: z.enum(['online', 'praesenz', 'hybrid', 'extern']),
  quizRequired: z.boolean(),
  confirmText: z.string().trim().max(2000),
  ansprechpartner: z.string().trim().max(200).nullish(),
  /** E-51: Anlass, Standard-Durchführungsart, Live-Online-Vorgaben, Standard-Zielgruppe */
  anlassTyp: z.enum(ANLASS_TYPES),
  anlassText: z.string().trim().max(2000).nullish(),
  defaultDelivery: z.enum(DELIVERY_TYPES),
  defaultPlatform: z.enum(PLATFORMS).nullish(),
  defaultMeetingUrl: z
    .string().trim().max(1000)
    .refine((v) => v === '' || v.startsWith('https://'), 'Bitte einen Link mit https:// angeben')
    .transform((v) => (v === '' ? null : v))
    .nullish(),
  defaultOrgUnits: z.array(z.uuid()).max(200),
});
const TrainingInput = TrainingFields.extend({
  format: TrainingFields.shape.format.default('online'),
  quizRequired: TrainingFields.shape.quizRequired.default(true),
  confirmText: TrainingFields.shape.confirmText.default(''),
  anlassTyp: TrainingFields.shape.anlassTyp.default('erst'),
  defaultDelivery: TrainingFields.shape.defaultDelivery.optional(),
  defaultOrgUnits: TrainingFields.shape.defaultOrgUnits.optional(),
});
const TrainingPatch = TrainingFields.partial();

const COLUMNS: Record<string, string> = {
  titel: 'titel', kategorie: 'kategorie', rechtsgrundlage: 'rechtsgrundlage', format: 'format',
  quizRequired: 'quiz_required', confirmText: 'confirm_text', ansprechpartner: 'ansprechpartner',
  anlassTyp: 'anlass_typ', anlassText: 'anlass_text', defaultDelivery: 'default_delivery', defaultPlatform: 'default_platform',
  defaultMeetingUrl: 'default_meeting_url', defaultOrgUnits: 'default_org_units',
};

/** Vorher/Nachher je geänderter Eigenschaft fürs Protokoll (E-51). */
export function changeSet(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(after)) {
    if (JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)) out[k] = { from: before[k] ?? null, to: after[k] ?? null };
  }
  return out;
}
const SettingsPatch = z.record(z.string(), z.unknown());
const VersionMeta = z.object({
  changeKind: z.enum(['redaktionell', 'inhaltlich']).optional(),
  changeNote: z.string().trim().max(2000).optional(),
  /** Sprachfassung (E-39): „en“ = englische Fassung der aktuellen Versionsnummer */
  sprache: z.enum(['de', 'en']).default('de'),
});
const PagePatch = z.object({ tMinManual: z.number().int().min(1).max(1800).nullable() });
const Chapters = z
  .array(z.object({ title: z.string().trim().min(1).max(200), shortName: z.string().trim().min(1).max(24), fromPage: z.number().int().min(1), toPage: z.number().int().min(1) }))
  .max(50);
const Publish = z.object({
  changeKind: z.enum(['redaktionell', 'inhaltlich']).optional(),
  changeNote: z.string().trim().max(2000).optional(),
  changedPages: z.array(z.number().int().min(1)).max(2000).optional(),
});
const Question = z
  .object({
    text: z.string().trim().min(3, 'Bitte eine Frage eingeben').max(1000),
    options: z.array(z.string().trim().min(1).max(300)).min(2, 'Mindestens zwei Antworten').max(6),
    correct: z.number().int().min(0),
    explanation: z.string().trim().max(2000).nullish(),
    active: z.boolean().default(true),
  })
  .refine((q) => q.correct < q.options.length, { message: 'Richtige Antwort fehlt', path: ['correct'] });

const STAFF = ['admin', 'verantwortlich'] as const;

@Controller('trainings')
@Roles('admin', 'verantwortlich', 'trainer', 'auditor', 'vorgesetzter')
export class TrainingsController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly analysis: AnalysisService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  @Get()
  list() {
    return this.db.tx(async (c) =>
      (
        await c.query(
          `SELECT t.id, t.titel, t.kategorie, t.format, t.created_at, t.archived_at,
                  lv.id AS latest_version_id, lv.version_no AS latest_version_no, lv.status AS latest_version_status,
                  lv.page_count, pv.version_no AS published_version_no, pv.published_at
             FROM training t
             LEFT JOIN LATERAL (SELECT * FROM training_version v WHERE v.training_id = t.id AND v.sprache = 'de' ORDER BY version_no DESC LIMIT 1) lv ON true
             LEFT JOIN LATERAL (SELECT * FROM training_version v WHERE v.training_id = t.id AND v.sprache = 'de' AND v.published_at IS NOT NULL ORDER BY version_no DESC LIMIT 1) pv ON true
            ORDER BY t.archived_at NULLS FIRST, t.created_at DESC`,
        )
      ).rows,
    );
  }

  @Post()
  @Roles(...STAFF)
  create(@Body(new ZodBody(TrainingInput)) b: z.infer<typeof TrainingInput>) {
    return this.db.tx(async (c) => {
      const r = await c.query(
        `INSERT INTO training (titel, kategorie, rechtsgrundlage, format, quiz_required, confirm_text, ansprechpartner, settings,
                               anlass_typ, anlass_text, default_delivery)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [
          b.titel, b.kategorie ?? null, b.rechtsgrundlage ?? null, b.defaultDelivery ? formatForDelivery(b.defaultDelivery) : b.format,
          b.quizRequired, b.confirmText, b.ansprechpartner ?? null, parseSettings({}), b.anlassTyp, b.anlassText ?? null,
          b.defaultDelivery ?? ({ online: 'online', praesenz: 'praesenz', hybrid: 'kombiniert', extern: 'extern' } as const)[b.format],
        ],
      );
      await this.audit.record(c, { entity: 'training', entityId: r.rows[0].id, action: 'created', payload: { titel: b.titel } });
      return { id: r.rows[0].id as string };
    });
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.db.tx(async (c) => {
      const t = (await c.query('SELECT * FROM training WHERE id = $1', [id])).rows[0];
      if (!t) throw new NotFoundException('Schulung nicht gefunden');
      const versions = (
        await c.query(
          `SELECT id, version_no, sprache, status, file_name, file_size, sha256, page_count, word_count, analysis_error,
                  change_kind, change_note, changed_pages, published_at, created_at
             FROM training_version WHERE training_id = $1 ORDER BY version_no DESC, sprache`,
          [id],
        )
      ).rows;
      return {
        id: t.id,
        titel: t.titel,
        kategorie: t.kategorie,
        rechtsgrundlage: t.rechtsgrundlage,
        format: t.format,
        quizRequired: t.quiz_required,
        confirmText: t.confirm_text,
        ansprechpartner: t.ansprechpartner,
        anlassTyp: t.anlass_typ,
        anlassText: t.anlass_text,
        defaultDelivery: t.default_delivery,
        defaultPlatform: t.default_platform,
        defaultMeetingUrl: t.default_meeting_url,
        defaultOrgUnits: t.default_org_units ?? [],
        updatedAt: t.updated_at,
        settings: parseSettings(t.settings),
        versions,
      };
    });
  }

  @Patch(':id')
  @Roles(...STAFF)
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(TrainingPatch)) b: z.infer<typeof TrainingPatch>) {
    // Durchführungsart bestimmt das bisherige Format (Fristen-Engine)
    const patch: Record<string, unknown> = { ...b };
    if (b.defaultDelivery) patch.format = formatForDelivery(b.defaultDelivery);
    const entries = Object.entries(patch).filter(([k, v]) => v !== undefined && COLUMNS[k]);
    if (!entries.length) throw new BadRequestException('Keine Änderungen');
    return this.db.tx(async (c) => {
      const cur = (await c.query('SELECT * FROM training WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!cur) throw new NotFoundException('Schulung nicht gefunden');
      const before = Object.fromEntries(Object.entries(COLUMNS).map(([k, col]) => [k, cur[col]]));
      const after = { ...before, ...Object.fromEntries(entries) };
      if (after.anlassTyp === 'anlass' && String(after.anlassText ?? '').trim().length < 3) {
        throw new BadRequestException({
          message: 'Eingaben unvollständig oder ungültig',
          fields: [{ path: 'anlassText', message: 'Bitte den Anlass bzw. das Ereignis beschreiben' }],
        });
      }
      if (b.defaultOrgUnits?.length) {
        const n = (await c.query('SELECT count(*)::int AS n FROM org_unit WHERE id = ANY($1::uuid[])', [b.defaultOrgUnits])).rows[0].n;
        if (n !== new Set(b.defaultOrgUnits).size) {
          throw new BadRequestException({ message: 'Unbekannte Org-Einheit', fields: [{ path: 'defaultOrgUnits', message: 'Unbekannte Org-Einheit' }] });
        }
      }
      const sets = entries.map(([k], i) => `${COLUMNS[k]} = $${i + 2}`).join(', ');
      await c.query(`UPDATE training SET ${sets} WHERE id = $1`, [id, ...entries.map(([, v]) => v)]);
      const changes = changeSet(before, after);
      if (Object.keys(changes).length) {
        await this.audit.record(c, { entity: 'training', entityId: id, action: 'updated', payload: { changes } });
      }
      return { ok: true, changed: Object.keys(changes) };
    });
  }

  @Patch(':id/settings')
  @Roles(...STAFF)
  updateSettings(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(SettingsPatch)) patch: Record<string, unknown>) {
    return this.db.tx(async (c) => {
      const t = (await c.query('SELECT settings FROM training WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!t) throw new NotFoundException('Schulung nicht gefunden');
      const parsed = TrainingSettings.safeParse({ ...parseSettings(t.settings), ...patch });
      if (!parsed.success) {
        throw new BadRequestException({
          message: 'Einstellungen ungültig',
          fields: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }
      const before = parseSettings(t.settings);
      await c.query('UPDATE training SET settings = $2 WHERE id = $1', [id, parsed.data]);
      await AnalysisService.recomputeTMin(c, id, parsed.data);
      const changes = changeSet(before as unknown as Record<string, unknown>, parsed.data as unknown as Record<string, unknown>);
      if (Object.keys(changes).length) {
        await this.audit.record(c, { entity: 'training', entityId: id, action: 'settings_changed', payload: { changes } });
      }
      return parsed.data;
    });
  }

  @Post(':id/versions')
  @Roles(...STAFF)
  @UseInterceptors(FileInterceptor('datei', { limits: { fileSize: 200 * 1024 * 1024, files: 1 } }))
  async upload(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodBody(VersionMeta)) meta: z.infer<typeof VersionMeta>,
  ) {
    if (!file) throw new BadRequestException('Bitte eine PDF-Datei auswählen');
    if (file.size > this.config.UPLOAD_MAX_MB * 1024 * 1024) {
      throw new BadRequestException(`Die Datei ist größer als ${this.config.UPLOAD_MAX_MB} MB`);
    }
    if (!isPdf(file.buffer)) throw new BadRequestException('Die Datei ist kein PDF');
    const hash = sha256(file.buffer);
    const fileName = file.originalname.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 200) || 'dokument.pdf';
    const res = await this.db.tx(async (c) => {
      const t = await c.query('SELECT id, tenant_id FROM training WHERE id = $1 FOR UPDATE', [id]);
      if (!t.rowCount) throw new NotFoundException('Schulung nicht gefunden');
      let no: number;
      if (meta.sprache === 'de') {
        no = (await c.query('SELECT coalesce(max(version_no), 0) + 1 AS n FROM training_version WHERE training_id = $1', [id])).rows[0].n;
      } else {
        // Sprachfassung zur aktuellen (neuesten) deutschen Versionsnummer (E-39)
        no = (await c.query(`SELECT max(version_no) AS n FROM training_version WHERE training_id = $1 AND sprache = 'de'`, [id])).rows[0].n;
        if (!no) throw new BadRequestException('Bitte zuerst die deutsche Fassung hochladen');
        const prev = (await c.query('SELECT id, published_at FROM training_version WHERE training_id = $1 AND version_no = $2 AND sprache = $3', [id, no, meta.sprache])).rows[0];
        if (prev?.published_at) {
          throw new ConflictException(`Die englische Fassung von Version ${no} ist bereits veröffentlicht. Für Änderungen zuerst eine neue deutsche Version hochladen.`);
        }
        // Noch nicht veröffentlichte Sprachfassung wird ersetzt
        if (prev) await c.query('DELETE FROM training_version WHERE id = $1', [prev.id]);
      }
      const versionId = (await c.query('SELECT gen_random_uuid() AS id')).rows[0].id as string;
      const key = `${versionPrefix(id, versionId)}/original-${hash.slice(0, 16)}.pdf`;
      await this.storage.put('uploads', key, file.buffer, { contentType: 'application/pdf' });
      await c.query(
        `INSERT INTO training_version (id, training_id, version_no, file_key, file_name, file_size, sha256, change_kind, change_note, sprache)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [versionId, id, no, key, fileName, file.size, hash, meta.changeKind ?? null, meta.changeNote ?? null, meta.sprache],
      );
      await this.audit.record(c, { entity: 'training_version', entityId: versionId, action: 'uploaded', payload: { sha256: hash, fileName, versionNo: no, sprache: meta.sprache } });
      return { id: versionId, versionNo: no as number, sha256: hash, tenantId: t.rows[0].tenant_id as string };
    });
    await this.analysis.enqueue(res.id, res.tenantId);
    return { id: res.id, versionNo: res.versionNo, sha256: res.sha256, status: 'hochgeladen', sprache: meta.sprache };
  }

  @Get(':id/versions/:vid')
  @Roles('admin', 'verantwortlich', 'trainer', 'auditor')
  version(@Param('id', ParseUUIDPipe) id: string, @Param('vid', ParseUUIDPipe) vid: string) {
    return this.db.tx(async (c) => {
      const v = (await c.query('SELECT * FROM training_version WHERE id = $1 AND training_id = $2', [vid, id])).rows[0];
      if (!v) throw new NotFoundException('Version nicht gefunden');
      const pages = (
        await c.query(
          `SELECT page_no, word_count, has_text, t_min_seconds, t_min_manual, coalesce(t_min_manual, t_min_seconds) AS t_min_effective,
                  title, thumb_key IS NOT NULL AS has_thumb
             FROM page_meta WHERE version_id = $1 ORDER BY page_no`,
          [vid],
        )
      ).rows;
      const chapters = (await c.query('SELECT idx, title, short_name, from_page, to_page, source FROM chapter WHERE version_id = $1 ORDER BY idx', [vid])).rows;
      return {
        id: v.id, versionNo: v.version_no, sprache: v.sprache, status: v.status, fileName: v.file_name, fileSize: Number(v.file_size), sha256: v.sha256,
        pageCount: v.page_count, analysisError: v.analysis_error, changeKind: v.change_kind, changeNote: v.change_note,
        changedPages: v.changed_pages, publishedAt: v.published_at, createdAt: v.created_at,
        totals: {
          words: pages.reduce((s, p) => s + p.word_count, 0),
          minReadingSeconds: pages.reduce((s, p) => s + p.t_min_effective, 0),
          pagesWithoutText: pages.filter((p) => !p.has_text).length,
        },
        pages, chapters,
      };
    });
  }

  @Patch(':id/versions/:vid/pages/:n')
  @Roles(...STAFF)
  patchPage(
    @Param('id', ParseUUIDPipe) id: string, @Param('vid', ParseUUIDPipe) vid: string, @Param('n', ParseIntPipe) n: number,
    @Body(new ZodBody(PagePatch)) b: z.infer<typeof PagePatch>,
  ) {
    return this.db.tx(async (c) => {
      const r = await c.query(
        `UPDATE page_meta pm SET t_min_manual = $4 FROM training_version v
          WHERE pm.version_id = $2 AND pm.page_no = $3 AND v.id = pm.version_id AND v.training_id = $1`,
        [id, vid, n, b.tMinManual],
      );
      if (!r.rowCount) throw new NotFoundException('Seite nicht gefunden');
      await this.audit.record(c, { entity: 'training_version', entityId: vid, action: 'page_t_min_set', payload: { page: n, tMinManual: b.tMinManual } });
      return { ok: true };
    });
  }

  @Put(':id/versions/:vid/chapters')
  @Roles(...STAFF)
  setChapters(@Param('id', ParseUUIDPipe) id: string, @Param('vid', ParseUUIDPipe) vid: string, @Body(new ZodBody(Chapters)) list: z.infer<typeof Chapters>) {
    return this.db.tx(async (c) => {
      const v = (await c.query('SELECT page_count FROM training_version WHERE id = $1 AND training_id = $2', [vid, id])).rows[0];
      if (!v) throw new NotFoundException('Version nicht gefunden');
      const sorted = [...list].sort((a, b) => a.fromPage - b.fromPage);
      let expected = 1;
      for (const ch of sorted) {
        if (ch.fromPage !== expected || ch.toPage < ch.fromPage) {
          throw new BadRequestException('Kapitel müssen lückenlos und ohne Überschneidung alle Seiten abdecken');
        }
        expected = ch.toPage + 1;
      }
      if (sorted.length && expected - 1 !== v.page_count) throw new BadRequestException('Kapitel müssen bis zur letzten Seite reichen');
      await c.query('DELETE FROM chapter WHERE version_id = $1', [vid]);
      for (const [i, ch] of sorted.entries()) {
        await c.query(
          `INSERT INTO chapter (version_id, idx, title, short_name, from_page, to_page, source) VALUES ($1, $2, $3, $4, $5, $6, 'manuell')`,
          [vid, i, ch.title, ch.shortName, ch.fromPage, ch.toPage],
        );
      }
      await this.audit.record(c, { entity: 'training_version', entityId: vid, action: 'chapters_set', payload: { count: sorted.length } });
      return { ok: true };
    });
  }

  @Post(':id/versions/:vid/publish')
  @Roles(...STAFF)
  publish(@Param('id', ParseUUIDPipe) id: string, @Param('vid', ParseUUIDPipe) vid: string, @Body(new ZodBody(Publish)) b: z.infer<typeof Publish>) {
    return this.db.tx(async (c) => {
      const v = (
        await c.query(
          `SELECT v.*, t.confirm_text AS training_confirm FROM training_version v JOIN training t ON t.id = v.training_id
            WHERE v.id = $1 AND v.training_id = $2 FOR UPDATE OF v`,
          [vid, id],
        )
      ).rows[0];
      if (!v) throw new NotFoundException('Version nicht gefunden');
      if (v.published_at) throw new BadRequestException('Version ist bereits veröffentlicht');
      if (v.status !== 'bereit') throw new BadRequestException('Die Seitenanalyse ist noch nicht abgeschlossen');
      // Sprachfassung übernimmt die Art der Änderung der deutschen Fassung derselben Versionsnummer (E-39)
      const deKind = v.sprache === 'de' ? null
        : (await c.query(`SELECT change_kind FROM training_version WHERE training_id = $1 AND version_no = $2 AND sprache = 'de'`, [id, v.version_no])).rows[0]?.change_kind;
      const kind = b.changeKind ?? v.change_kind ?? deKind ?? (v.version_no === 1 ? null : undefined);
      if (kind === undefined) throw new BadRequestException('Bitte die Art der Änderung angeben (inhaltlich oder redaktionell)');
      if (b.changedPages?.some((p) => p > v.page_count)) throw new BadRequestException('Geänderte Seite existiert nicht');
      await c.query(
        `UPDATE training_version SET status = 'veroeffentlicht', published_at = now(), change_kind = $2, change_note = coalesce($3, change_note),
                changed_pages = $4, confirm_text = $5 WHERE id = $1`,
        [vid, kind, b.changeNote ?? null, b.changedPages ?? null, v.training_confirm],
      );
      await this.audit.record(c, { entity: 'training_version', entityId: vid, action: 'published', payload: { versionNo: v.version_no, sprache: v.sprache, changeKind: kind, changedPages: b.changedPages ?? null, sha256: v.sha256 } });
      return { ok: true };
    });
  }

  @Get(':id/versions/:vid/pages/:n/thumb')
  @Roles(...STAFF, 'trainer', 'auditor')
  async thumb(
    @Param('id', ParseUUIDPipe) id: string, @Param('vid', ParseUUIDPipe) vid: string, @Param('n', ParseIntPipe) n: number,
    @Res() res: Response,
  ) {
    const key = await this.db.tx(async (c) =>
      (await c.query(
        `SELECT pm.thumb_key FROM page_meta pm JOIN training_version v ON v.id = pm.version_id
          WHERE v.training_id = $1 AND pm.version_id = $2 AND pm.page_no = $3`,
        [id, vid, n],
      )).rows[0]?.thumb_key as string | undefined,
    );
    if (!key) throw new NotFoundException('Kein Vorschaubild');
    res.setHeader('content-type', 'image/png');
    res.setHeader('cache-control', 'private, max-age=3600');
    res.send(await this.storage.get('uploads', key));
  }

  // ── Fragenpool ─────────────────────────────────────────────
  @Get(':id/questions')
  @Roles(...STAFF, 'auditor')
  questions(@Param('id', ParseUUIDPipe) id: string) {
    return this.db.tx(async (c) =>
      (await c.query('SELECT id, text, options, correct, explanation, active, created_at FROM quiz_question WHERE training_id = $1 ORDER BY created_at', [id])).rows,
    );
  }

  @Post(':id/questions')
  @Roles(...STAFF)
  addQuestion(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(Question)) q: z.infer<typeof Question>) {
    return this.db.tx(async (c) => {
      const r = await c.query(
        'INSERT INTO quiz_question (training_id, text, options, correct, explanation, active) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [id, q.text, JSON.stringify(q.options), q.correct, q.explanation ?? null, q.active],
      );
      await this.audit.record(c, { entity: 'quiz_question', entityId: r.rows[0].id, action: 'created', payload: { trainingId: id } });
      return { id: r.rows[0].id as string };
    });
  }

  @Patch(':id/questions/:qid')
  @Roles(...STAFF)
  updateQuestion(@Param('id', ParseUUIDPipe) id: string, @Param('qid', ParseUUIDPipe) qid: string, @Body(new ZodBody(Question)) q: z.infer<typeof Question>) {
    return this.db.tx(async (c) => {
      const r = await c.query(
        'UPDATE quiz_question SET text = $3, options = $4, correct = $5, explanation = $6, active = $7 WHERE id = $2 AND training_id = $1',
        [id, qid, q.text, JSON.stringify(q.options), q.correct, q.explanation ?? null, q.active],
      );
      if (!r.rowCount) throw new NotFoundException('Frage nicht gefunden');
      await this.audit.record(c, { entity: 'quiz_question', entityId: qid, action: 'updated' });
      return { ok: true };
    });
  }

  @Delete(':id/questions/:qid')
  @Roles(...STAFF)
  deleteQuestion(@Param('id', ParseUUIDPipe) id: string, @Param('qid', ParseUUIDPipe) qid: string) {
    // Fragen werden deaktiviert statt gelöscht (Nachvollziehbarkeit früherer Versuche).
    return this.db.tx(async (c) => {
      const r = await c.query('UPDATE quiz_question SET active = false WHERE id = $2 AND training_id = $1', [id, qid]);
      if (!r.rowCount) throw new NotFoundException('Frage nicht gefunden');
      await this.audit.record(c, { entity: 'quiz_question', entityId: qid, action: 'deactivated' });
      return { ok: true };
    });
  }
}
