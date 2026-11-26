import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  applyHeartbeat, isComplete, isPageAllowed, isRequiredPage, remainingMs, requiredPageNos, withRequiredPages, type Heartbeat,
  type PageRule, type ProgressSnapshot, type SessionTrackState,
} from '@sn/shared';
import type pg from 'pg';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { currentRequest } from '../common/request-context';
import { DbService } from '../db/db.service';
import { ParticipantService, type ParticipantCtx } from '../participant/participant.service';
import { RedisService } from '../redis/redis.service';
import { parseSettings } from '../trainings/settings';

const LEASE_TTL_S = 15;

export interface ReadingModel {
  pages: PageRule[];
  progress: ProgressSnapshot;
  strictMode: boolean;
  versionId: string;
  status: string;
  /** Neueinladung „nur geänderte Seiten“ (E-38): Pflichtseiten, sonst null (alle Seiten Pflicht) */
  onlyPages: number[] | null;
}

/**
 * Tracking-Ingest (Schritt 1.5): eine aktive Sitzung je Einladung (Lease), Heartbeats werden mit der reinen
 * Regel-Engine aus @sn/shared bewertet; gezählt wird nur Serverzeit (E-06).
 */
@Injectable()
export class ReadingService {
  constructor(
    private readonly db: DbService,
    private readonly participants: ParticipantService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  private leaseKey(invitationId: string) {
    return `lease:${invitationId}`;
  }

  /** Seiten-Regeln (t_min inkl. persönlicher Verlängerung) und kumulierter Fortschritt aller Sitzungen. */
  async model(c: pg.PoolClient, invitationId: string): Promise<ReadingModel> {
    const inv = (
      await c.query(
        `SELECT i.status, i.reading_time_factor, coalesce(i.training_version_id, r.training_version_id) AS training_version_id,
                i.changed_pages, t.settings
           FROM invitation i JOIN run r ON r.id = i.run_id JOIN training t ON t.id = r.training_id WHERE i.id = $1`,
        [invitationId],
      )
    ).rows[0];
    if (!inv) throw new NotFoundException('Einladung nicht gefunden');
    const factor = Math.max(1, Number(inv.reading_time_factor));
    const allPages = (
      await c.query('SELECT page_no, coalesce(t_min_manual, t_min_seconds) AS t FROM page_meta WHERE version_id = $1 ORDER BY page_no', [
        inv.training_version_id,
      ])
    ).rows.map((p) => ({ pageNo: p.page_no as number, tMinMs: Math.round(p.t * factor) * 1000 }));
    // E-38: Neueinladung nach inhaltlicher Änderung → nur die geänderten Seiten sind Pflicht
    const pages = withRequiredPages(allPages, inv.changed_pages as number[] | null);
    const partial = pages.some((p) => !isRequiredPage(p));
    const rows = (await c.query('SELECT page_no, dwell_ms, fulfilled_at FROM page_progress WHERE invitation_id = $1', [invitationId])).rows;
    const progress: ProgressSnapshot = {
      dwellMs: Object.fromEntries(rows.map((r) => [r.page_no, Number(r.dwell_ms)])),
      fulfilled: rows.filter((r) => r.fulfilled_at).map((r) => r.page_no as number).sort((a, b) => a - b),
    };
    return {
      pages, progress, strictMode: parseSettings(inv.settings).strictMode, versionId: inv.training_version_id, status: inv.status,
      onlyPages: partial ? requiredPageNos(pages) : null,
    };
  }

  summary(m: ReadingModel, currentPage?: number) {
    return {
      complete: isComplete(m.pages, m.progress),
      strictMode: m.strictMode,
      onlyPages: m.onlyPages,
      pages: m.pages.map((p) => ({
        pageNo: p.pageNo,
        required: isRequiredPage(p),
        tMinMs: p.tMinMs,
        dwellMs: Math.min(m.progress.dwellMs[p.pageNo] ?? 0, p.tMinMs),
        fulfilled: m.progress.fulfilled.includes(p.pageNo),
        allowed: isPageAllowed(p.pageNo, m.pages, m.progress.fulfilled, m.strictMode),
      })),
      ...(currentPage && m.pages.some((p) => p.pageNo === currentPage)
        ? { current: { pageNo: currentPage, remainingMs: remainingMs(currentPage, m.pages, m.progress) } }
        : {}),
    };
  }

  /** Neue Lesesitzung; übernimmt die Lease – eine ältere Sitzung (anderes Fenster/Gerät) erhält ab jetzt 409. */
  async startSession(invitationId: string) {
    const p = await this.participants.resolve(invitationId);
    const req = currentRequest();
    const now = this.clock.now();
    const id = await this.participants.write(p, async (c) => {
      const inv = (await c.query('SELECT status FROM invitation WHERE id = $1', [invitationId])).rows[0];
      if (['befreit'].includes(inv?.status)) throw new ConflictException('Für diese Einladung ist nichts mehr zu tun');
      await c.query(
        `UPDATE read_session SET ended_at = $2, end_reason = 'abgeloest' WHERE invitation_id = $1 AND ended_at IS NULL`,
        [invitationId, now],
      );
      const r = await c.query(
        'INSERT INTO read_session (invitation_id, started_at, user_agent, ip_hash) VALUES ($1, $2, $3, $4) RETURNING id',
        [invitationId, now, req?.userAgent ?? null, req?.ipHash ?? null],
      );
      await c.query(`UPDATE invitation SET status = 'geoeffnet', opened_at = coalesce(opened_at, $2) WHERE id = $1 AND status = 'offen'`, [invitationId, now]);
      await this.audit.record(c, { entity: 'read_session', entityId: r.rows[0].id, action: 'started', payload: { invitationId } });
      return r.rows[0].id as string;
    });
    await this.redis.client.set(this.leaseKey(invitationId), id, 'EX', LEASE_TTL_S);
    const m = await this.participants.read(p, (c) => this.model(c, invitationId));
    return { sessionId: id, heartbeatIntervalMs: 5000, ...this.summary(m) };
  }

  async heartbeat(sessionId: string, hb: Heartbeat & { offline?: boolean }) {
    const sess = await this.findSession(sessionId);
    const p = await this.participants.resolve(sess.invitation_id);
    const lease = await this.redis.client.get(this.leaseKey(p.invitationId));
    if (lease && lease !== sessionId) {
      throw new ConflictException({ code: 'abgeloest', message: 'Die Schulung ist in einem anderen Fenster geöffnet. Erfassung läuft dort weiter.' });
    }
    const now = this.clock.now();
    const result = await this.participants.write(p, async (c) => {
      const s = (await c.query('SELECT state, ended_at FROM read_session WHERE id = $1 FOR UPDATE', [sessionId])).rows[0];
      if (s.ended_at) throw new ConflictException({ code: 'abgeloest', message: 'Diese Lesesitzung ist beendet.' });
      const m = await this.model(c, p.invitationId);
      const raw = (reason: string, credited: number) =>
        c.query(
          `INSERT INTO heartbeat_raw (session_id, seq, page_no, visible_ratio, focused, last_input_age_ms, client_ts, server_ts, offline, reason, credited_ms)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [sessionId, hb.seq, hb.page, hb.visibleRatio, hb.focused, Math.min(hb.lastInputAgeMs, 2_000_000_000), hb.clientTs ?? null, now, !!hb.offline, reason, credited],
        );
      // Offline gepufferte Heartbeats: speichern, aber nie gutschreiben (E-06)
      if (hb.offline) {
        await raw('offline', 0);
        return { accepted: false, reason: 'offline' as const, m, newlyFulfilled: [] as number[] };
      }
      const d = applyHeartbeat({
        state: s.state as SessionTrackState,
        hb,
        serverTs: now.getTime(),
        pages: m.pages,
        progress: m.progress,
        strictMode: m.strictMode,
      });
      await raw(d.reason, d.credit?.ms ?? 0);
      if (!d.accepted) return { accepted: false, reason: d.reason, m, newlyFulfilled: [] };
      await c.query('UPDATE read_session SET state = $2, last_seen_at = $3 WHERE id = $1', [sessionId, d.state, now]);
      if (m.pages.some((x) => x.pageNo === hb.page)) {
        await c.query(
          `INSERT INTO page_progress (invitation_id, page_no, first_seen_at, dwell_ms) VALUES ($1, $2, $3, 0)
           ON CONFLICT (invitation_id, page_no) DO NOTHING`,
          [p.invitationId, hb.page, now],
        );
      }
      if (d.credit) {
        await c.query(
          `UPDATE page_progress SET dwell_ms = dwell_ms + $3,
                  fulfilled_at = CASE WHEN fulfilled_at IS NULL AND $4 THEN $5::timestamptz ELSE fulfilled_at END
            WHERE invitation_id = $1 AND page_no = $2`,
          [p.invitationId, d.credit.page, d.credit.ms, d.newlyFulfilled.includes(d.credit.page), now],
        );
      }
      const next = { ...m, progress: d.progress };
      if (d.newlyFulfilled.length && isComplete(next.pages, next.progress)) {
        const upd = await c.query(
          `UPDATE invitation i SET status = CASE WHEN t.quiz_required AND (coalesce(cardinality(i.changed_pages), 0) = 0
                                     OR coalesce((t.settings->>'quizOnReinvite')::boolean, true)) THEN 'gelesen' ELSE 'bestanden' END,
                  read_completed_at = $2
             FROM run r JOIN training t ON t.id = r.training_id
            WHERE i.id = $1 AND r.id = i.run_id AND i.status IN ('offen','geoeffnet','ueberfaellig') RETURNING i.id`,
          [p.invitationId, now],
        );
        if (upd.rowCount) await this.audit.record(c, { entity: 'invitation', entityId: p.invitationId, action: 'reading_completed' });
      }
      return { accepted: true, reason: d.reason, m: next, newlyFulfilled: d.newlyFulfilled };
    });
    await this.redis.client.set(this.leaseKey(p.invitationId), sessionId, 'EX', LEASE_TTL_S);
    return { accepted: result.accepted, reason: result.reason, newlyFulfilled: result.newlyFulfilled, ...this.summary(result.m, hb.page) };
  }

  async progress(invitationId: string) {
    const p = await this.participants.resolve(invitationId);
    return this.summary(await this.participants.read(p, (c) => this.model(c, invitationId)));
  }

  /** Prüft, ob die Seite abgerufen werden darf (strenger Modus), und liefert den Objektschlüssel. */
  async pageKey(p: ParticipantCtx, pageNo: number): Promise<string> {
    return this.participants.read(p, async (c) => {
      const m = await this.model(c, p.invitationId);
      if (!m.pages.some((x) => x.pageNo === pageNo)) throw new NotFoundException('Seite nicht gefunden');
      if (!isPageAllowed(pageNo, m.pages, m.progress.fulfilled, m.strictMode)) {
        throw new ConflictException({ code: 'gesperrt', message: 'Bitte zuerst die vorherigen Seiten lesen.' });
      }
      const k = (await c.query('SELECT page_key FROM page_meta WHERE version_id = $1 AND page_no = $2', [m.versionId, pageNo])).rows[0];
      if (!k?.page_key) throw new NotFoundException('Seite nicht gefunden');
      return k.page_key as string;
    });
  }

  private async findSession(sessionId: string): Promise<{ invitation_id: string }> {
    const s = currentRequest()?.session;
    // Sitzung über den Mandanten der Anfrage auflösen (Link-Sitzung) bzw. über die Konto-Verknüpfung
    const tenantId = s?.kind === 'invitation' ? s.tenantId : null;
    const r = await this.db.txAs({ tenantId, roles: ['system'] }, (c) => c.query('SELECT invitation_id FROM read_session WHERE id = $1', [sessionId]));
    if (r.rowCount) return r.rows[0];
    if (s?.kind === 'account') {
      const viaAccount = await this.db.txAs({}, (c) => c.query('SELECT * FROM app.read_session_for_account($1, $2)', [sessionId, s.accountId]));
      if (viaAccount.rowCount) return viaAccount.rows[0];
    }
    throw new NotFoundException('Lesesitzung nicht gefunden');
  }
}
