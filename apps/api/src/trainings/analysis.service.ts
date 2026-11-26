import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { minReadingSeconds, normalizePageText, pageFingerprint } from '@sn/shared';
import type pg from 'pg';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../config';
import { DbService } from '../db/db.service';
import { JobRunner } from '../jobs/job-runner';
import { RedisService } from '../redis/redis.service';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage';
import { analyzePdf, renderThumbnails, splitPages } from './pdf-analysis';
import { parseSettings, readingRule, type TrainingSettings } from './settings';

interface AnalysisJob {
  versionId: string;
  tenantId: string;
}

export const versionPrefix = (trainingId: string, versionId: string) => `trainings/${trainingId}/versions/${versionId}`;

/** Seitenanalyse nach dem Upload (Job „pdf-analysis“): Wörter, t_min, Kapitel, Einzelseiten, Vorschaubilder. */
@Injectable()
export class AnalysisService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AnalysisService.name);
  private runner!: JobRunner<AnalysisJob>;

  constructor(
    private readonly db: DbService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  onModuleInit() {
    this.runner = new JobRunner<AnalysisJob>('pdf-analysis', this.redis, this.config, (d) => this.analyze(d.versionId, d.tenantId));
  }
  onModuleDestroy() {
    return this.runner.close();
  }

  enqueue(versionId: string, tenantId: string) {
    return this.runner.add({ versionId, tenantId }, { jobId: `analysis-${versionId}`, attempts: 2 });
  }

  private sys(tenantId: string) {
    return { tenantId, roles: ['system'] };
  }

  async analyze(versionId: string, tenantId: string): Promise<void> {
    const v = await this.db.txAs(this.sys(tenantId), async (c) => {
      const r = await c.query(
        `UPDATE training_version v SET status = 'analyse', analysis_error = NULL
          FROM training t WHERE v.id = $1 AND t.id = v.training_id AND v.published_at IS NULL
          RETURNING v.id, v.training_id, v.file_key, t.settings`,
        [versionId],
      );
      return r.rows[0] as { id: string; training_id: string; file_key: string; settings: unknown } | undefined;
    });
    if (!v) return;
    try {
      const pdf = await this.storage.get('uploads', v.file_key);
      const analysis = await analyzePdf(pdf);
      const [singles, thumbs] = await Promise.all([splitPages(pdf), renderThumbnails(pdf)]);
      const prefix = versionPrefix(v.training_id, versionId);
      await Promise.all(
        singles.map((b, i) => this.storage.put('uploads', `${prefix}/pages/${i + 1}.pdf`, b, { contentType: 'application/pdf' })),
      );
      await Promise.all(
        thumbs.map((b, i) => this.storage.put('uploads', `${prefix}/thumbs/${i + 1}.png`, b, { contentType: 'image/png' })),
      );
      const settings = parseSettings(v.settings);
      await this.db.txAs(this.sys(tenantId), async (c) => {
        await c.query('DELETE FROM chapter WHERE version_id = $1', [versionId]);
        await c.query('DELETE FROM page_meta WHERE version_id = $1', [versionId]);
        await AnalysisService.storePageText(c, versionId, analysis.pages);
        for (const p of analysis.pages) {
          const hasText = p.wordCount >= 5;
          await c.query(
            `INSERT INTO page_meta (version_id, page_no, word_count, has_text, t_min_seconds, title, page_key, thumb_key)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              versionId,
              p.pageNo,
              p.wordCount,
              hasText,
              minReadingSeconds(p.wordCount, readingRule(settings)),
              p.title,
              `${prefix}/pages/${p.pageNo}.pdf`,
              thumbs[p.pageNo - 1] ? `${prefix}/thumbs/${p.pageNo}.png` : null,
            ],
          );
        }
        for (const ch of analysis.chapters) {
          await c.query(
            `INSERT INTO chapter (version_id, idx, title, short_name, from_page, to_page, source) VALUES ($1, $2, $3, $4, $5, $6, 'outline')`,
            [versionId, ch.idx, ch.title, ch.shortName, ch.fromPage, ch.toPage],
          );
        }
        await c.query(
          `UPDATE training_version SET status = 'bereit', page_count = $2, word_count = $3 WHERE id = $1`,
          [versionId, analysis.pageCount, analysis.pages.reduce((s, p) => s + p.wordCount, 0)],
        );
        await this.audit.record(c, {
          entity: 'training_version',
          entityId: versionId,
          action: 'analysed',
          payload: { pages: analysis.pageCount, chapters: analysis.chapters.length, thumbnails: thumbs.length },
        });
      });
    } catch (e) {
      this.log.warn(`Analyse ${versionId} fehlgeschlagen: ${(e as Error).message}`);
      await this.db.txAs(this.sys(tenantId), (c) =>
        c.query(`UPDATE training_version SET status = 'fehler', analysis_error = $2 WHERE id = $1`, [
          versionId,
          'Die PDF-Datei konnte nicht gelesen werden. Ist sie beschädigt oder passwortgeschützt?',
        ]),
      );
    }
  }

  /** Normalisierter Seitentext + Fingerabdruck für den Seiten-Diff (E-38); ersetzt vorhandene Einträge. */
  static async storePageText(c: pg.PoolClient, versionId: string, pages: Array<{ pageNo: number; text: string }>) {
    await c.query('DELETE FROM page_text WHERE version_id = $1', [versionId]);
    for (const p of pages) {
      const norm = normalizePageText(p.text).slice(0, 20000);
      await c.query('INSERT INTO page_text (version_id, page_no, fingerprint, text_norm) VALUES ($1, $2, $3, $4)', [
        versionId, p.pageNo, pageFingerprint(norm), norm,
      ]);
    }
  }

  /** Nach Regeländerung: t_min aller unveröffentlichten Versionen neu berechnen (manuelle Werte bleiben). */
  static async recomputeTMin(c: pg.PoolClient, trainingId: string, s: TrainingSettings) {
    const pages = await c.query(
      `SELECT pm.version_id, pm.page_no, pm.word_count FROM page_meta pm
         JOIN training_version v ON v.id = pm.version_id
        WHERE v.training_id = $1 AND v.published_at IS NULL`,
      [trainingId],
    );
    for (const p of pages.rows) {
      await c.query('UPDATE page_meta SET t_min_seconds = $3 WHERE version_id = $1 AND page_no = $2', [
        p.version_id,
        p.page_no,
        minReadingSeconds(p.word_count, readingRule(s)),
      ]);
    }
  }
}
