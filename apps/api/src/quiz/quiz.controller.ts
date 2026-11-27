import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { ParticipantRoute } from '../auth/decorators';
import { ZodBody } from '../common/errors';
import { NotificationService } from '../notifications/notification.service';
import { ParticipantService, type ParticipantCtx } from '../participant/participant.service';
import { parseSettings } from '../trainings/settings';

const Answer = z.object({ attemptId: z.uuid(), questionId: z.uuid(), option: z.number().int().min(0).max(5) });
const Finish = z.object({ attemptId: z.uuid() });

function shuffle<T>(a: T[]): T[] {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [x[i], x[j]] = [x[j]!, x[i]!];
  }
  return x;
}

/**
 * Wissenscheck (SPEZIFIKATION 4.2): zufällige Auswahl aus dem Pool, sofortiges Feedback je Frage,
 * Bestehensgrenze und max. Versuche serverseitig. Lösungen gehen erst nach der Antwort an den Client.
 */
@Controller('me/invitations/:id/quiz')
export class QuizController {
  constructor(
    private readonly participants: ParticipantService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  private async state(p: ParticipantCtx) {
    return this.participants.write(p, async (c) => {
      const inv = (
        await c.query(
          `SELECT i.status, t.id AS training_id, t.quiz_required AND (coalesce(cardinality(i.changed_pages), 0) = 0
                  OR coalesce((coalesce(r.settings_snapshot, t.settings)->>'quizOnReinvite')::boolean, true)) AS quiz_required, coalesce(r.settings_snapshot, t.settings) AS settings FROM invitation i JOIN run r ON r.id = i.run_id
             JOIN training t ON t.id = r.training_id WHERE i.id = $1`,
          [p.invitationId],
        )
      ).rows[0];
      if (!inv) throw new NotFoundException('Einladung nicht gefunden');
      const attempts = (await c.query('SELECT * FROM quiz_attempt WHERE invitation_id = $1 ORDER BY attempt_no', [p.invitationId])).rows;
      return { inv, settings: parseSettings(inv.settings), attempts };
    });
  }

  @ParticipantRoute()
  @Get()
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const p = await this.participants.resolve(id);
    const { inv, settings, attempts } = await this.state(p);
    if (!inv.quiz_required) return { required: false };
    if (['offen', 'geoeffnet', 'ueberfaellig'].includes(inv.status)) {
      throw new ConflictException({ code: 'lesen_offen', message: 'Bitte zuerst alle Seiten lesen.' });
    }
    const passed = attempts.find((a) => a.passed);
    const used = attempts.filter((a) => a.submitted_at).length;
    const base = { required: true, passPct: settings.passPct, maxAttempts: settings.maxAttempts, attemptsUsed: used, passed: !!passed };
    if (passed) return { ...base, result: { scorePct: passed.score_pct, attemptNo: passed.attempt_no } };
    let open = attempts.find((a) => !a.submitted_at);
    if (!open) {
      if (used >= settings.maxAttempts) return { ...base, locked: true };
      open = await this.participants.write(p, async (c) => {
        const pool = (await c.query('SELECT id FROM quiz_question WHERE training_id = $1 AND active', [inv.training_id])).rows.map((r) => r.id as string);
        if (!pool.length) throw new ConflictException('Für diese Schulung sind noch keine Fragen hinterlegt.');
        const pick = shuffle(pool).slice(0, settings.quizQuestionCount);
        const r = await c.query(
          'INSERT INTO quiz_attempt (invitation_id, attempt_no, question_ids) VALUES ($1, $2, $3) RETURNING *',
          [id, attempts.length + 1, pick],
        );
        await this.audit.record(c, { entity: 'quiz_attempt', entityId: r.rows[0].id, action: 'started', payload: { invitationId: id, attemptNo: attempts.length + 1 } });
        return r.rows[0];
      });
    }
    const qs = await this.participants.write(p, async (c) =>
      (await c.query('SELECT id, text, options, correct, explanation FROM quiz_question WHERE id = ANY($1)', [open!.question_ids])).rows,
    );
    const byId = new Map(qs.map((q) => [q.id as string, q]));
    return {
      ...base,
      attempt: {
        id: open.id,
        attemptNo: open.attempt_no,
        questions: (open.question_ids as string[]).map((qid) => {
          const q = byId.get(qid)!;
          const a = open!.answers[qid];
          // Lösung nur für bereits beantwortete Fragen
          return { id: qid, text: q.text, options: q.options, ...(a ? { answer: { option: a.option, correct: q.correct, isCorrect: a.correct, explanation: q.explanation } } : {}) };
        }),
      },
    };
  }

  /** Antwort auf eine Frage – endgültig, sofortiges Feedback mit Erklärung. */
  @ParticipantRoute()
  @Post('answers')
  @HttpCode(200)
  async answer(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(Answer)) b: z.infer<typeof Answer>) {
    const p = await this.participants.resolve(id);
    return this.participants.write(p, async (c) => {
      const a = (await c.query('SELECT * FROM quiz_attempt WHERE id = $1 AND invitation_id = $2 FOR UPDATE', [b.attemptId, id])).rows[0];
      if (!a || a.submitted_at) throw new ConflictException('Dieser Versuch ist abgeschlossen');
      if (!(a.question_ids as string[]).includes(b.questionId)) throw new BadRequestException('Frage gehört nicht zu diesem Versuch');
      if (a.answers[b.questionId]) throw new ConflictException('Diese Frage ist bereits beantwortet');
      const q = (await c.query('SELECT options, correct, explanation FROM quiz_question WHERE id = $1', [b.questionId])).rows[0];
      if (b.option >= q.options.length) throw new BadRequestException('Ungültige Antwort');
      const isCorrect = b.option === q.correct;
      await c.query(`UPDATE quiz_attempt SET answers = answers || jsonb_build_object($2::text, $3::jsonb) WHERE id = $1`, [
        b.attemptId, b.questionId, JSON.stringify({ option: b.option, correct: isCorrect, at: new Date().toISOString() }),
      ]);
      return { isCorrect, correct: q.correct, explanation: q.explanation };
    });
  }

  /** Versuch abschließen: Bewertung, ggf. „bestanden“; nach dem letzten Fehlversuch Info an den Verantwortlichen. */
  @ParticipantRoute()
  @Post('finish')
  @HttpCode(200)
  async finish(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(Finish)) b: z.infer<typeof Finish>) {
    const p = await this.participants.resolve(id);
    const { settings } = await this.state(p);
    const res = await this.participants.write(p, async (c) => {
      const a = (await c.query('SELECT * FROM quiz_attempt WHERE id = $1 AND invitation_id = $2 FOR UPDATE', [b.attemptId, id])).rows[0];
      if (!a || a.submitted_at) throw new ConflictException('Dieser Versuch ist abgeschlossen');
      const total = (a.question_ids as string[]).length;
      const answered = Object.keys(a.answers).length;
      if (answered < total) throw new BadRequestException(`Bitte alle Fragen beantworten (${answered} von ${total})`);
      const right = Object.values(a.answers as Record<string, { correct: boolean }>).filter((x) => x.correct).length;
      const score = Math.round((right / total) * 100);
      const passed = score >= settings.passPct;
      await c.query('UPDATE quiz_attempt SET score_pct = $2, passed = $3, submitted_at = now() WHERE id = $1', [a.id, score, passed]);
      if (passed) await c.query(`UPDATE invitation SET status = 'bestanden' WHERE id = $1 AND status = 'gelesen'`, [id]);
      await this.audit.record(c, { entity: 'quiz_attempt', entityId: a.id, action: passed ? 'passed' : 'failed', payload: { invitationId: id, scorePct: score, attemptNo: a.attempt_no } });
      const exhausted = !passed && a.attempt_no >= settings.maxAttempts;
      let note = null;
      if (exhausted) {
        const info = (
          await c.query(
            `SELECT acc.email, p.name AS person_name, t.titel FROM invitation i JOIN person p ON p.id = i.person_id JOIN run r ON r.id = i.run_id
               JOIN training t ON t.id = r.training_id LEFT JOIN account acc ON acc.id = coalesce(r.created_by, t.created_by) WHERE i.id = $1`,
            [id],
          )
        ).rows[0];
        if (info?.email) {
          note = await this.notifications.enqueue(c, {
            tenantId: p.tenantId, channel: 'mail', recipient: info.email, template: 'quiz-failed',
            data: { personName: info.person_name, trainingTitle: info.titel, attempts: settings.maxAttempts },
          });
        }
      }
      return { scorePct: score, passed, correct: right, total, attemptNo: a.attempt_no, attemptsLeft: Math.max(0, settings.maxAttempts - a.attempt_no), locked: exhausted, note };
    });
    if (res.note) await this.notifications.dispatch([res.note]);
    const { note: _n, ...out } = res;
    return out;
  }
}
