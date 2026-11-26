import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import type pg from 'pg';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { DbService } from '../db/db.service';
import type { ParticipantCtx } from '../participant/participant.service';
import { AttendanceService } from '../presence/attendance.service';
import { RunAccess, type ManageCtx } from '../presence/run-access.service';
import { LiveBus } from './live-bus.service';

export type Viewer = { kind: 'organizer'; m: ManageCtx } | { kind: 'participant'; p: ParticipantCtx };

export interface PollInput {
  question?: string;
  options?: string[];
  correct?: number | null;
  explanation?: string | null;
  mode: 'stimmungsbild' | 'wissenscheck';
  sourceQuestionId?: string | null;
}

const shortName = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]![0]}.` : parts[0]!;
};

/**
 * Live-Fragen der Teilnehmer und Kontrollfragen des Organisators (Schritt 2.5, SPEZIFIKATION 4.9).
 * Anonyme Fragen und Stimmungsbilder werden ohne Personenbezug gespeichert (SPEZIFIKATION 7).
 */
@Injectable()
export class LiveService {
  constructor(
    private readonly db: DbService,
    private readonly access: RunAccess,
    private readonly attendance: AttendanceService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly bus: LiveBus,
  ) {}

  /** Organisator (bevorzugt) oder eingeladener Teilnehmer; `as=teilnehmer` erzwingt die Teilnehmersicht. */
  async viewer(runId: string, as?: string): Promise<Viewer> {
    if (as !== 'teilnehmer') {
      const m = await this.access.canManage(runId);
      if (m) return { kind: 'organizer', m };
    }
    const p = await this.access.participant(runId);
    if (p) return { kind: 'participant', p };
    return { kind: 'organizer', m: await this.access.manage(runId) };
  }

  ctxOf(v: Viewer) {
    return v.kind === 'organizer'
      ? { tenantId: v.m.tenantId, accountId: v.m.accountId, roles: ['system'] }
      : this.access.pctx(v.p);
  }

  private async checkedIn(c: pg.PoolClient, runId: string, personId: string) {
    const r = (
      await c.query(
        `SELECT r.status, EXISTS (SELECT 1 FROM attendance a JOIN attendance_interval i ON i.attendance_id = a.id
                                   WHERE a.run_id = r.id AND a.person_id = $2 AND i.out_at IS NULL) AS checked_in,
                EXISTS (SELECT 1 FROM attendance a JOIN attendance_interval i ON i.attendance_id = a.id
                         WHERE a.run_id = r.id AND a.person_id = $2) AS attended
           FROM run r WHERE r.id = $1`,
        [runId, personId],
      )
    ).rows[0];
    return { ended: r?.status === 'beendet', checkedIn: !!r?.checked_in && r?.status !== 'beendet', attended: !!r?.attended };
  }

  private async requireCheckedIn(p: ParticipantCtx, runId: string) {
    const s = await this.db.txAs(this.access.pctx(p), (c) => this.checkedIn(c, runId, p.personId));
    if (!s.checkedIn) throw new ForbiddenException({ code: 'nicht_eingecheckt', message: 'Das geht nur, solange Sie eingecheckt sind.' });
  }

  // ── Fragen an den Trainer ─────────────────────────────────

  async ask(runId: string, text: string, anonymous: boolean) {
    const p = await this.access.requireParticipant(runId);
    await this.requireCheckedIn(p, runId);
    // Anonym: Kontext OHNE Person → weder person_id noch Audit-Akteur (SPEZIFIKATION 7)
    const id = await this.db.txAs(this.access.pctx(p, !anonymous), async (c) => {
      const r = await c.query('INSERT INTO live_question (run_id, person_id, text, created_at) VALUES ($1, $2, $3, $4) RETURNING id', [
        runId, anonymous ? null : p.personId, text.trim(), this.clock.now(),
      ]);
      await this.audit.record(c, { entity: 'live_question', entityId: r.rows[0].id, action: 'asked', payload: { runId, anonymous } });
      return r.rows[0].id as string;
    });
    await this.bus.publish(runId, 'questions', ...(anonymous ? [] : (['attendance'] as const)));
    return { id, anonymous };
  }

  async vote(questionId: string, on: boolean) {
    const ref = await this.access.ref('question', questionId);
    const p = await this.access.requireParticipant(ref.runId);
    await this.requireCheckedIn(p, ref.runId);
    const votes = await this.db.txAs(this.access.pctx(p), async (c) => {
      const q = (await c.query('SELECT person_id, status FROM live_question WHERE id = $1', [questionId])).rows[0];
      if (on) {
        if (q.person_id === p.personId) throw new ConflictException('Die eigene Frage kann nicht unterstützt werden');
        if (q.status !== 'offen') throw new ConflictException('Die Frage ist bereits erledigt');
        const r = await c.query(
          'INSERT INTO live_question_vote (question_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING question_id',
          [questionId, p.personId],
        );
        if (!r.rowCount) throw new ConflictException({ code: 'bereits_abgestimmt', message: 'Sie haben diese Frage bereits unterstützt.' });
        await this.audit.record(c, { entity: 'live_question', entityId: questionId, action: 'voted', payload: {} });
      } else {
        const r = await c.query('DELETE FROM live_question_vote WHERE question_id = $1 AND person_id = $2', [questionId, p.personId]);
        if (r.rowCount) await this.audit.record(c, { entity: 'live_question', entityId: questionId, action: 'vote_withdrawn', payload: {} });
      }
      return Number((await c.query('SELECT count(*) AS n FROM live_question_vote WHERE question_id = $1', [questionId])).rows[0].n);
    });
    await this.bus.publish(ref.runId, 'questions');
    return { id: questionId, votes, voted: on };
  }

  async setQuestionStatus(questionId: string, status: 'offen' | 'beantwortet' | 'per_mail') {
    const ref = await this.access.ref('question', questionId);
    const m = await this.access.manage(ref.runId);
    await this.access.sys(m, async (c) => {
      await c.query('UPDATE live_question SET status = $2, status_at = $3 WHERE id = $1', [questionId, status, this.clock.now()]);
      await this.audit.record(c, { entity: 'live_question', entityId: questionId, action: 'status_changed', payload: { status } });
    });
    await this.bus.publish(ref.runId, 'questions');
    return { id: questionId, status };
  }

  async questionsIn(c: pg.PoolClient, runId: string, v: Viewer) {
    const me = v.kind === 'participant' ? v.p.personId : null;
    const rows = (
      await c.query(
        `SELECT q.id, q.text, q.status, q.created_at, q.status_at, q.person_id, p.name,
                (SELECT count(*) FROM live_question_vote x WHERE x.question_id = q.id)::int AS votes,
                EXISTS (SELECT 1 FROM live_question_vote x WHERE x.question_id = q.id AND x.person_id = $2) AS voted
           FROM live_question q LEFT JOIN person p ON p.id = q.person_id
          WHERE q.run_id = $1
          ORDER BY (q.status <> 'offen'), 8 DESC, q.created_at`,
        [runId, me],
      )
    ).rows;
    return rows.map((q) => {
      const base = { id: q.id as string, text: q.text as string, votes: q.votes as number, status: q.status as string, createdAt: q.created_at, statusAt: q.status_at, anonymous: !q.person_id };
      if (v.kind === 'organizer') return { ...base, author: (q.name as string | null) ?? null };
      const mine = !!q.person_id && q.person_id === me;
      return { ...base, author: mine ? 'du' : q.person_id ? shortName(q.name) : 'anonym', mine, voted: !!q.voted };
    });
  }

  async questions(runId: string, as?: string) {
    const v = await this.viewer(runId, as);
    return this.db.txAs(this.ctxOf(v), (c) => this.questionsIn(c, runId, v));
  }

  // ── Kontrollfragen ────────────────────────────────────────

  async pool(runId: string) {
    const m = await this.access.manage(runId);
    return this.access.sys(m, async (c) =>
      (
        await c.query(
          `SELECT q.id, q.text, q.options, q.correct, q.explanation,
                  EXISTS (SELECT 1 FROM live_poll lp WHERE lp.run_id = r.id AND lp.source_question_id = q.id) AS used
             FROM run r JOIN quiz_question q ON q.training_id = r.training_id
            WHERE r.id = $1 AND q.active ORDER BY q.created_at`,
          [runId],
        )
      ).rows,
    );
  }

  async createPoll(runId: string, b: PollInput) {
    const m = await this.access.manage(runId);
    const id = await this.access.sys(m, async (c) => {
      const run = (await c.query('SELECT status, training_id FROM run WHERE id = $1 FOR UPDATE', [runId])).rows[0];
      if (run.status === 'beendet') throw new ConflictException('Der Termin ist beendet');
      let q = { question: b.question, options: b.options, correct: b.correct ?? null, explanation: b.explanation ?? null };
      if (b.sourceQuestionId) {
        const src = (await c.query('SELECT text, options, correct, explanation FROM quiz_question WHERE id = $1 AND training_id = $2 AND active', [b.sourceQuestionId, run.training_id])).rows[0];
        if (!src) throw new BadRequestException('Frage nicht im Fragenpool dieser Schulung');
        q = { question: src.text, options: src.options, correct: src.correct, explanation: src.explanation };
      }
      if (!q.question || !q.options || q.options.length < 2) throw new BadRequestException('Bitte Frage und mindestens zwei Antworten angeben');
      if (b.mode === 'wissenscheck' && (q.correct === null || q.correct === undefined)) throw new BadRequestException('Für einen Wissenscheck bitte die richtige Antwort markieren');
      if (q.correct !== null && q.correct >= q.options.length) throw new BadRequestException('Richtige Antwort außerhalb der Optionen');
      if ((await c.query('SELECT 1 FROM live_poll WHERE run_id = $1 AND closed_at IS NULL', [runId])).rowCount) {
        throw new ConflictException('Es läuft bereits eine Kontrollfrage. Bitte zuerst schließen.');
      }
      const r = await c.query(
        `INSERT INTO live_poll (run_id, question, options, correct, explanation, mode, source_question_id, opened_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [runId, q.question, JSON.stringify(q.options), q.correct, q.explanation, b.mode, b.sourceQuestionId ?? null, this.clock.now()],
      );
      await this.audit.record(c, { entity: 'live_poll', entityId: r.rows[0].id, action: 'opened', payload: { runId, mode: b.mode, fromPool: !!b.sourceQuestionId } });
      return r.rows[0].id as string;
    });
    await this.bus.publish(runId, 'polls');
    return this.access.sys(m, async (c) => (await this.pollResults(c, runId, id))[0]);
  }

  async closePoll(pollId: string) {
    const ref = await this.access.ref('poll', pollId);
    const m = await this.access.manage(ref.runId);
    await this.access.sys(m, async (c) => {
      const r = await c.query('UPDATE live_poll SET closed_at = $2 WHERE id = $1 AND closed_at IS NULL RETURNING id', [pollId, this.clock.now()]);
      if (!r.rowCount) throw new ConflictException('Die Kontrollfrage ist bereits geschlossen');
      await this.audit.record(c, { entity: 'live_poll', entityId: pollId, action: 'closed', payload: {} });
    });
    await this.bus.publish(ref.runId, 'polls');
    return this.access.sys(m, async (c) => (await this.pollResults(c, ref.runId, pollId))[0]);
  }

  /**
   * Antwort eines Teilnehmers. Offene Frage: nur eingecheckt. Nach dem Ende: Wissenscheck nachholen (nur wer anwesend war).
   * Stimmungsbild: Antwort ohne Personenbezug; doppelte Antworten verhindert live_poll_participant (ohne Option).
   */
  async answer(pollId: string, option: number) {
    const ref = await this.access.ref('poll', pollId);
    const p = await this.access.requireParticipant(ref.runId);
    const res = await this.db.txAs(this.access.pctx(p), async (c) => {
      const poll = (await c.query('SELECT id, run_id, options, correct, explanation, mode, closed_at FROM live_poll WHERE id = $1 FOR SHARE', [pollId])).rows[0];
      if (!Number.isInteger(option) || option < 0 || option >= poll.options.length) throw new BadRequestException('Ungültige Antwort');
      const s = await this.checkedIn(c, ref.runId, p.personId);
      let late = false;
      if (!poll.closed_at && !s.ended) {
        if (!s.checkedIn) throw new ForbiddenException({ code: 'nicht_eingecheckt', message: 'Kontrollfragen beantworten nur eingecheckte Teilnehmer.' });
      } else if (s.ended && poll.mode === 'wissenscheck' && s.attended) {
        late = true;
      } else {
        throw new ConflictException({ code: 'geschlossen', message: 'Diese Kontrollfrage ist geschlossen.' });
      }
      const ins = await c.query('INSERT INTO live_poll_participant (poll_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING poll_id', [pollId, p.personId]);
      if (!ins.rowCount) throw new ConflictException({ code: 'bereits_beantwortet', message: 'Sie haben diese Frage bereits beantwortet.' });
      if (poll.mode === 'stimmungsbild') {
        await c.query('INSERT INTO live_poll_answer (poll_id, person_id, option, correct, answered_at) VALUES ($1, NULL, $2, NULL, NULL)', [pollId, option]);
        await this.audit.record(c, { entity: 'live_poll', entityId: pollId, action: 'participated', payload: {} });
        return { mode: poll.mode as 'stimmungsbild', option, late: false };
      }
      const correct = option === poll.correct;
      await c.query('INSERT INTO live_poll_answer (poll_id, person_id, option, correct, late, answered_at) VALUES ($1, $2, $3, $4, $5, $6)', [
        pollId, p.personId, option, correct, late, this.clock.now(),
      ]);
      await this.audit.record(c, { entity: 'live_poll', entityId: pollId, action: 'answered', payload: { correct, late } });
      return { mode: poll.mode as 'wissenscheck', option, correct, correctOption: poll.correct as number, explanation: poll.explanation as string | null, late };
    });
    await this.bus.publish(ref.runId, 'polls');
    return res;
  }

  /** Auswertung je Kontrollfrage: geantwortet / Verteilung / % richtig. */
  async pollResults(c: pg.PoolClient, runId: string, pollId?: string) {
    const polls = (
      await c.query(
        `SELECT p.*, (SELECT count(*) FROM live_poll_participant x WHERE x.poll_id = p.id)::int AS answered,
                (SELECT count(*) FROM live_poll_answer x WHERE x.poll_id = p.id AND x.late)::int AS late_answers,
                (SELECT count(*) FROM live_poll_answer x WHERE x.poll_id = p.id AND x.correct)::int AS right_count,
                (SELECT coalesce(jsonb_object_agg(o.option, o.n), '{}'::jsonb)
                   FROM (SELECT option, count(*) AS n FROM live_poll_answer x WHERE x.poll_id = p.id GROUP BY option) o) AS dist
           FROM live_poll p WHERE p.run_id = $1 AND ($2::uuid IS NULL OR p.id = $2) ORDER BY p.opened_at`,
        [runId, pollId ?? null],
      )
    ).rows;
    const eligible = Number(
      (
        await c.query(
          `SELECT count(DISTINCT a.person_id) AS n FROM attendance a JOIN attendance_interval i ON i.attendance_id = a.id
            WHERE a.run_id = $1 AND i.out_at IS NULL`,
          [runId],
        )
      ).rows[0].n,
    );
    return polls.map((p) => {
      const options = p.options as string[];
      const distribution = options.map((_, k) => Number((p.dist as Record<string, number>)[k] ?? 0));
      const total = distribution.reduce((a, b) => a + b, 0);
      return {
        id: p.id as string,
        question: p.question as string,
        options,
        correct: p.correct as number | null,
        explanation: p.explanation as string | null,
        mode: p.mode as 'stimmungsbild' | 'wissenscheck',
        sourceQuestionId: p.source_question_id as string | null,
        openedAt: p.opened_at,
        closedAt: p.closed_at,
        open: !p.closed_at,
        answered: p.answered as number,
        lateAnswers: p.late_answers as number,
        eligible,
        distribution,
        distributionPct: distribution.map((n) => (total ? Math.round((n / total) * 100) : 0)),
        rightPct: p.mode === 'wissenscheck' && total ? Math.round((p.right_count / total) * 100) : null,
      };
    });
  }

  /** Teilnehmersicht: offene Kontrollfrage (nur eingecheckt), nachzuholende Wissenschecks (nach dem Ende), eigene Ergebnisse. */
  async participantPollsIn(c: pg.PoolClient, runId: string, personId: string) {
    const s = await this.checkedIn(c, runId, personId);
    const polls = (
      await c.query(
        `SELECT p.id, p.question, p.options, p.mode, p.opened_at, p.closed_at, p.correct, p.explanation,
                EXISTS (SELECT 1 FROM live_poll_participant x WHERE x.poll_id = p.id AND x.person_id = $2) AS answered,
                a.option AS my_option, a.correct AS my_correct, a.late AS my_late
           FROM live_poll p LEFT JOIN live_poll_answer a ON a.poll_id = p.id AND a.person_id = $2
          WHERE p.run_id = $1 ORDER BY p.opened_at`,
        [runId, personId],
      )
    ).rows;
    const myAnswer = (p: (typeof polls)[number]) =>
      !p.answered
        ? null
        : p.mode === 'wissenscheck'
          ? { option: p.my_option as number, correct: p.my_correct as boolean, correctOption: p.correct as number, explanation: p.explanation as string | null, late: !!p.my_late }
          : { answered: true };
    const open = polls.find((p) => !p.closed_at);
    return {
      openPoll:
        open && s.checkedIn
          ? { id: open.id as string, question: open.question as string, options: open.options as string[], mode: open.mode as string, openedAt: open.opened_at, myAnswer: myAnswer(open) }
          : null,
      pendingPolls:
        s.ended && s.attended
          ? polls.filter((p) => p.mode === 'wissenscheck' && !p.answered).map((p) => ({ id: p.id as string, question: p.question as string, options: p.options as string[], mode: p.mode as string }))
          : [],
      myResults: polls.filter((p) => p.mode === 'wissenscheck' && p.answered).map((p) => ({ pollId: p.id as string, question: p.question as string, ...myAnswer(p) })),
    };
  }

  async polls(runId: string, as?: string) {
    const v = await this.viewer(runId, as);
    return this.db.txAs(this.ctxOf(v), (c) => this.pollsIn(c, runId, v));
  }

  async pollsIn(c: pg.PoolClient, runId: string, v: Viewer) {
    if (v.kind === 'participant') return this.participantPollsIn(c, runId, v.p.personId);
    const list = await this.pollResults(c, runId);
    return { active: list.find((p) => p.open) ?? null, list };
  }

  // ── Gesamtsicht für SSE ───────────────────────────────────

  async section(v: Viewer, runId: string, topic: 'snapshot' | 'run' | 'attendance' | 'questions' | 'polls') {
    return this.db.txAs(this.ctxOf(v), async (c) => {
      const run = async () => this.attendance.runView(await this.attendance.loadRun(c, runId));
      const att = async () =>
        v.kind === 'organizer' ? this.attendance.organizerAttendanceIn(c, runId) : this.attendance.participantMeIn(c, runId, v.p.personId);
      switch (topic) {
        case 'run':
          return run();
        case 'attendance':
          return att();
        case 'questions':
          return this.questionsIn(c, runId, v);
        case 'polls':
          return this.pollsIn(c, runId, v);
        case 'snapshot':
          return {
            role: v.kind,
            ...(v.kind === 'participant' ? { invitationId: v.p.invitationId } : {}),
            run: await run(),
            attendance: await att(),
            questions: await this.questionsIn(c, runId, v),
            polls: await this.pollsIn(c, runId, v),
          };
      }
    });
  }
}
