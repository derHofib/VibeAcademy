import { Inject, Injectable } from '@nestjs/common';
import type pg from 'pg';
import { APP_CONFIG, type AppConfig } from '../config';
import { randomToken, sha256 } from '../common/crypto';
import { NotificationService } from '../notifications/notification.service';
import { parseSettings, quizRequiredFor } from '../trainings/settings';
import { formatDate, participantLanguage } from '../i18n/language';
import { pageList } from '../evidence/evidence-template';

const LINK_VALID_DAYS_AFTER_DUE = 90;
export const formatDateDe = (d: Date | string) =>
  new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d));

/** Persönliche Einladungslinks und Einladungs-/Erinnerungsmails (SPEZIFIKATION 4.5, E-12). */
@Injectable()
export class InvitationService {
  constructor(
    private readonly notifications: NotificationService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Erzeugt einen neuen Link (der alte wird ungültig). Gespeichert wird nur der Hash. */
  async issueLink(c: pg.PoolClient, invitationId: string): Promise<string> {
    const token = randomToken();
    await c.query(
      `UPDATE invitation SET token_hash = $2,
              token_expires_at = coalesce(due_at, now()) + make_interval(days => $3)
        WHERE id = $1`,
      [invitationId, sha256(token), LINK_VALID_DAYS_AFTER_DUE],
    );
    return `${this.config.PUBLIC_BASE_URL}/s/${token}`;
  }

  /** Einladung oder Erinnerung per Mail einreihen. Liefert null, wenn die Person keine E-Mail-Adresse hat. */
  async enqueueMail(c: pg.PoolClient, invitationId: string, reminder = false) {
    const r = (
      await c.query(
        `SELECT i.id, i.tenant_id, i.due_at, i.reading_time_factor, p.name AS person_name, p.email, p.sprache, t.titel, t.ansprechpartner,
                t.quiz_required, t.settings, v.page_count, te.name AS tenant_name,
                (SELECT array_agg(pm.page_no ORDER BY pm.page_no) FROM page_meta pm WHERE pm.version_id = v.id AND pm.page_no = ANY (i.changed_pages)) AS only_pages,
                (SELECT sum(coalesce(pm.t_min_manual, pm.t_min_seconds)) FROM page_meta pm WHERE pm.version_id = v.id
                    AND (coalesce(cardinality(i.changed_pages), 0) = 0 OR pm.page_no = ANY (i.changed_pages)
                         OR NOT EXISTS (SELECT 1 FROM page_meta x WHERE x.version_id = v.id AND x.page_no = ANY (i.changed_pages)))) AS t_min_total,
                (SELECT count(*) FROM quiz_question q WHERE q.training_id = t.id AND q.active) AS question_pool
           FROM invitation i JOIN person p ON p.id = i.person_id JOIN run r ON r.id = i.run_id
           JOIN training t ON t.id = r.training_id JOIN training_version v ON v.id = coalesce(i.training_version_id, r.training_version_id)
           JOIN tenant te ON te.id = i.tenant_id
          WHERE i.id = $1`,
        [invitationId],
      )
    ).rows[0];
    if (!r?.email) return null;
    const settings = parseSettings(r.settings);
    const lang = participantLanguage(r.sprache);
    const onlyPages = (r.only_pages ?? []) as number[];
    const link = await this.issueLink(c, invitationId);
    const n = await this.notifications.enqueue(c, {
      tenantId: r.tenant_id,
      channel: 'mail',
      recipient: r.email,
      template: 'invitation',
      data: {
        personName: r.person_name,
        trainingTitle: r.titel,
        dueDate: r.due_at ? (lang === 'en' ? formatDate('en', r.due_at, false) : formatDateDe(r.due_at)) : lang === 'en' ? 'soon' : 'bald',
        pages: r.page_count,
        minutes: Math.max(1, Math.ceil((Number(r.t_min_total ?? 0) * Number(r.reading_time_factor)) / 60)),
        questions: quizRequiredFor(r.quiz_required, settings, onlyPages) ? Math.min(settings.quizQuestionCount, Number(r.question_pool)) : 0,
        contact: r.ansprechpartner,
        tenantName: r.tenant_name,
        reminder,
        // E-38/E-39: nur geänderte Seiten; Sprache der Person
        ...(onlyPages.length ? { onlyPages: pageList(onlyPages) } : {}),
        ...(lang === 'en' ? { lang } : {}),
      },
      secret: { link },
    });
    await c.query('UPDATE invitation SET sent_at = now() WHERE id = $1', [invitationId]);
    return n;
  }
}
