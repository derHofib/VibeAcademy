import { BadRequestException, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { diffPages } from '@sn/shared';
import type pg from 'pg';
import { Roles } from '../auth/decorators';
import { DbService } from '../db/db.service';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage';
import { AnalysisService } from '../trainings/analysis.service';
import { analyzePdf } from '../trainings/pdf-analysis';

interface VersionRow {
  id: string;
  training_id: string;
  version_no: number;
  sprache: string;
  status: string;
  file_key: string;
  published_at: Date | null;
  tenant_id: string;
}

/**
 * Seiten-Diff zwischen zwei Versionen (E-38): Vorschlag für „geänderte Seiten“ und die Art der Änderung.
 * Die Logik liegt als reine Funktion in @sn/shared (`diffPages`).
 */
@Controller('trainings')
@Roles('admin', 'verantwortlich', 'trainer', 'auditor')
export class DiffController {
  constructor(
    private readonly db: DbService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /**
   * `GET /api/trainings/:id/versions/:vid/diff?against=<versionId>` – ohne `against` gegen die zuletzt veröffentlichte
   * Version derselben Sprache mit kleinerer Versionsnummer.
   */
  @Get(':id/versions/:vid/diff')
  async diff(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('vid', ParseUUIDPipe) vid: string,
    @Query('against') against?: string,
  ) {
    if (against !== undefined && !/^[0-9a-f-]{36}$/i.test(against)) throw new BadRequestException('Ungültige Vergleichsversion');
    const { cur, base } = await this.db.tx(async (c) => {
      const cur = await this.version(c, id, vid);
      if (!cur) throw new NotFoundException('Version nicht gefunden');
      if (!['bereit', 'veroeffentlicht'].includes(cur.status)) {
        throw new BadRequestException('Die Seitenanalyse ist noch nicht abgeschlossen');
      }
      const baseId = against
        ?? ((
          await c.query(
            `SELECT id FROM training_version WHERE training_id = $1 AND sprache = $2 AND published_at IS NOT NULL
                AND version_no < $3 ORDER BY version_no DESC LIMIT 1`,
            [id, cur.sprache, cur.version_no],
          )
        ).rows[0]?.id as string | undefined);
      if (!baseId) throw new NotFoundException('Keine veröffentlichte Vorversion zum Vergleich vorhanden');
      const base = await this.version(c, id, baseId);
      if (!base) throw new NotFoundException('Vergleichsversion nicht gefunden');
      if (!base.published_at) throw new BadRequestException('Verglichen wird nur mit einer veröffentlichten Version');
      if (base.id === cur.id) throw new BadRequestException('Version kann nicht mit sich selbst verglichen werden');
      return { cur, base };
    });
    const [oldPages, newPages] = await Promise.all([this.pages(base), this.pages(cur)]);
    const result = diffPages(oldPages, newPages);
    return {
      versionId: cur.id,
      versionNo: cur.version_no,
      sprache: cur.sprache,
      against: { versionId: base.id, versionNo: base.version_no, sprache: base.sprache },
      pageCount: { old: oldPages.length, new: newPages.length },
      ...result,
    };
  }

  private async version(c: pg.PoolClient, trainingId: string, versionId: string): Promise<VersionRow | undefined> {
    return (
      await c.query(
        `SELECT id, training_id, version_no, sprache, status, file_key, published_at, tenant_id
           FROM training_version WHERE id = $1 AND training_id = $2`,
        [versionId, trainingId],
      )
    ).rows[0];
  }

  /** Gespeicherter Seitentext; für Versionen vor Migration 017 einmalig aus dem Original-PDF nachgezogen. */
  private async pages(v: VersionRow): Promise<Array<{ pageNo: number; text: string }>> {
    const sys = { tenantId: v.tenant_id, roles: ['system'] };
    const stored = await this.db.txAs(sys, (c) =>
      c.query('SELECT page_no, text_norm FROM page_text WHERE version_id = $1 ORDER BY page_no', [v.id]),
    );
    if (stored.rowCount) return stored.rows.map((r) => ({ pageNo: r.page_no as number, text: r.text_norm as string }));
    const analysis = await analyzePdf(await this.storage.get('uploads', v.file_key));
    await this.db.txAs(sys, (c) => AnalysisService.storePageText(c, v.id, analysis.pages));
    return analysis.pages.map((p) => ({ pageNo: p.pageNo, text: p.text }));
  }
}
