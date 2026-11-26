import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ParticipantRoute, Public } from '../auth/decorators';
import { ZodBody } from '../common/errors';
import { SignedTokens } from '../common/signed-token';
import { ParticipantService } from '../participant/participant.service';
import { Inject } from '@nestjs/common';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage';
import { ReadingService } from './reading.service';

const PAGE_URL_TTL_S = 60;

const HeartbeatBody = z.object({
  seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  page: z.number().int().min(1).max(100000),
  visibleRatio: z.number().min(0).max(1),
  focused: z.boolean(),
  lastInputAgeMs: z.number().int().min(0).max(1e10),
  clientTs: z.number().int().optional(),
  offline: z.boolean().optional(),
});

@Controller()
export class ReadingController {
  constructor(
    private readonly reading: ReadingService,
    private readonly participants: ParticipantService,
    private readonly tokens: SignedTokens,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  @ParticipantRoute()
  @Post('me/invitations/:id/sessions')
  start(@Param('id', ParseUUIDPipe) id: string) {
    return this.reading.startSession(id);
  }

  @ParticipantRoute()
  @Post('me/reading-sessions/:sid/heartbeat')
  @HttpCode(200)
  heartbeat(@Param('sid', ParseUUIDPipe) sid: string, @Body(new ZodBody(HeartbeatBody)) b: z.infer<typeof HeartbeatBody>) {
    return this.reading.heartbeat(sid, b);
  }

  @ParticipantRoute()
  @Get('me/invitations/:id/progress')
  progress(@Param('id', ParseUUIDPipe) id: string) {
    return this.reading.progress(id);
  }

  /** Kurzlebige, signierte URL auf genau eine Seite (E-05). Strenger Modus wird hier serverseitig erzwungen. */
  @ParticipantRoute()
  @Get('me/invitations/:id/pages/:n')
  async pageUrl(@Param('id', ParseUUIDPipe) id: string, @Param('n', ParseIntPipe) n: number) {
    const p = await this.participants.resolve(id);
    const key = await this.reading.pageKey(p, n);
    const t = this.tokens.sign('page', { k: key, i: id }, PAGE_URL_TTL_S);
    return { url: `/api/files/page?t=${encodeURIComponent(t)}`, expiresInSeconds: PAGE_URL_TTL_S };
  }

  @Public()
  @Get('files/page')
  async page(@Query('t') t: string | undefined, @Res() res: Response) {
    const data = t ? this.tokens.verify<{ k: string; i: string }>('page', t) : null;
    if (!data) throw new NotFoundException('Link abgelaufen');
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('content-disposition', 'inline');
    res.setHeader('x-robots-tag', 'noindex');
    res.send(await this.storage.get('uploads', data.k));
  }
}
