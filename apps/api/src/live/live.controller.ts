import {
  Body, Controller, Delete, Get, HttpCode, Logger, OnModuleDestroy, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ParticipantRoute, Roles } from '../auth/decorators';
import { SessionService } from '../auth/session.service';
import { ZodBody } from '../common/errors';
import { currentRequest } from '../common/request-context';
import { LiveBus, type LiveTopic } from './live-bus.service';
import { LiveService } from './live.service';

const Ask = z.object({ text: z.string().trim().min(3, 'Bitte eine Frage eingeben').max(1000), anonymous: z.boolean().default(false) });
const QuestionStatus = z.object({ status: z.enum(['offen', 'beantwortet', 'per_mail']) });
const Poll = z
  .object({
    mode: z.enum(['stimmungsbild', 'wissenscheck']).default('wissenscheck'),
    sourceQuestionId: z.uuid().nullish(),
    question: z.string().trim().min(3).max(1000).optional(),
    options: z.array(z.string().trim().min(1).max(300)).min(2).max(6).optional(),
    correct: z.number().int().min(0).max(5).nullish(),
    explanation: z.string().trim().max(1000).nullish(),
  })
  .refine((b) => b.sourceQuestionId || (b.question && b.options), { message: 'Frage aus dem Pool wählen oder Frage + Antworten angeben', path: ['question'] });
const Answer = z.object({ option: z.number().int().min(0).max(5) });

const HEARTBEAT_MS = 15_000;

/**
 * Live-Kanal (E-15) per Server-Sent Events: GET /runs/:id/live. Nach dem Verbinden ein „snapshot“, danach je Änderung
 * das betroffene Teilstück (run | attendance | questions | polls) – jeweils in der Sicht der Verbindung
 * (Organisator: alle; Teilnehmer: nur eigene Daten). Verteilung zwischen Instanzen über Redis Pub/Sub.
 */
@Controller()
export class LiveController implements OnModuleDestroy {
  private readonly log = new Logger(LiveController.name);
  private readonly streams = new Set<() => void>();

  constructor(
    private readonly live: LiveService,
    private readonly bus: LiveBus,
    private readonly sessions: SessionService,
  ) {}

  onModuleDestroy() {
    for (const end of [...this.streams]) end();
  }

  @ParticipantRoute()
  @Get('runs/:id/live')
  async stream(@Param('id', ParseUUIDPipe) id: string, @Query('as') as: string | undefined, @Req() req: Request, @Res() res: Response) {
    const v = await this.live.viewer(id, as);
    const sessionId = currentRequest()?.sessionId ?? null;
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let closed = false;
    let seq = 0;
    let timer: NodeJS.Timeout | undefined;
    const pending = new Set<LiveTopic>();
    const write = (s: string) => {
      if (!closed) res.write(s);
    };
    const send = (event: string, data: unknown) => write(`id: ${seq}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const flush = async () => {
      timer = undefined;
      const topics = [...pending];
      pending.clear();
      for (const t of topics) {
        try {
          send(t, await this.live.section(v, id, t));
        } catch (e) {
          this.log.warn(`Live ${id}/${t}: ${(e as Error).message}`);
        }
      }
    };
    const unsubscribe = await this.bus.subscribe(id, (e) => {
      seq = Math.max(seq, e.seq);
      pending.add(e.topic);
      timer ??= setTimeout(() => void flush(), 30);
    });
    const end = () => {
      if (closed) return;
      closed = true;
      clearInterval(hb);
      if (timer) clearTimeout(timer);
      unsubscribe();
      this.streams.delete(end);
      res.end();
    };
    const hb = setInterval(() => {
      write(`: ping\n\n`);
      // Abgemeldet oder Sitzung abgelaufen → Strom beenden
      if (sessionId) void this.sessions.get(sessionId).then((s) => (s ? undefined : end()), () => undefined);
    }, HEARTBEAT_MS);
    this.streams.add(end);
    req.on('close', end);

    seq = Math.max(seq, await this.bus.currentSeq(id));
    // Wiederverbindung mit Last-Event-ID: der Zustand wird vollständig neu gesendet (kein Nachspielen einzelner Ereignisse nötig).
    write(`retry: 3000\n\n`);
    send('snapshot', { ...(await this.live.section(v, id, 'snapshot')), resumedFrom: req.header('last-event-id') ?? null });
  }

  // ── Fragen ───────────────────────────────────────────────

  @ParticipantRoute()
  @Get('runs/:id/questions')
  questions(@Param('id', ParseUUIDPipe) id: string, @Query('as') as?: string) {
    return this.live.questions(id, as);
  }

  @ParticipantRoute()
  @Post('runs/:id/questions')
  ask(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(Ask)) b: z.infer<typeof Ask>) {
    return this.live.ask(id, b.text, b.anonymous);
  }

  @ParticipantRoute()
  @Post('questions/:id/vote')
  @HttpCode(200)
  vote(@Param('id', ParseUUIDPipe) id: string) {
    return this.live.vote(id, true);
  }

  @ParticipantRoute()
  @Delete('questions/:id/vote')
  unvote(@Param('id', ParseUUIDPipe) id: string) {
    return this.live.vote(id, false);
  }

  @Patch('questions/:id')
  @Roles('admin', 'verantwortlich', 'trainer')
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(QuestionStatus)) b: z.infer<typeof QuestionStatus>) {
    return this.live.setQuestionStatus(id, b.status);
  }

  // ── Kontrollfragen ───────────────────────────────────────

  @ParticipantRoute()
  @Get('runs/:id/polls')
  polls(@Param('id', ParseUUIDPipe) id: string, @Query('as') as?: string) {
    return this.live.polls(id, as);
  }

  @Get('runs/:id/poll-pool')
  @Roles('admin', 'verantwortlich', 'trainer')
  pool(@Param('id', ParseUUIDPipe) id: string) {
    return this.live.pool(id);
  }

  @Post('runs/:id/polls')
  @Roles('admin', 'verantwortlich', 'trainer')
  createPoll(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(Poll)) b: z.infer<typeof Poll>) {
    return this.live.createPoll(id, b);
  }

  @ParticipantRoute()
  @Post('polls/:id/answers')
  answer(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(Answer)) b: z.infer<typeof Answer>) {
    return this.live.answer(id, b.option);
  }

  @Post('polls/:id/close')
  @HttpCode(200)
  @Roles('admin', 'verantwortlich', 'trainer')
  close(@Param('id', ParseUUIDPipe) id: string) {
    return this.live.closePoll(id);
  }
}
