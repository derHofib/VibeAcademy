import { Body, Controller, Delete, Get, HttpCode, Inject, Post, UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';
import { ParticipantRoute, Public } from '../auth/decorators';
import { APP_CONFIG, type AppConfig } from '../config';
import { ZodBody } from '../common/errors';
import { currentRequest } from '../common/request-context';
import { DbService } from '../db/db.service';

const Subscription = z.object({
  endpoint: z.url().startsWith('https://', 'Push-Endpunkt muss HTTPS verwenden').max(2000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});
const Unsubscribe = z.object({ endpoint: z.string().min(1).max(2000) });

/** Web-Push-Abos (E-12): Konto (mandantenübergreifend) oder Einladungslink-Sitzung (Person im Mandanten). */
@Controller()
export class PushController {
  constructor(
    private readonly db: DbService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Get('push/key')
  key() {
    const enabled = !!(this.config.VAPID_PUBLIC_KEY && this.config.VAPID_PRIVATE_KEY);
    return { enabled, publicKey: enabled ? this.config.VAPID_PUBLIC_KEY : null };
  }

  private who() {
    const s = currentRequest()?.session;
    if (s?.kind === 'account') return { account: s.accountId, tenant: null, person: null };
    if (s?.kind === 'invitation') return { account: null, tenant: s.tenantId, person: s.personId };
    throw new UnauthorizedException('Bitte anmelden');
  }

  @ParticipantRoute()
  @Post('me/push-subscriptions')
  async subscribe(@Body(new ZodBody(Subscription)) b: z.infer<typeof Subscription>) {
    const w = this.who();
    const r = await this.db.txAs({}, (c) =>
      c.query('SELECT app.push_subscribe($1, $2, $3, $4, $5, $6, $7) AS id', [
        w.account, w.tenant, w.person, b.endpoint, b.keys.p256dh, b.keys.auth, currentRequest()?.userAgent ?? null,
      ]),
    );
    return { id: r.rows[0].id as string };
  }

  @ParticipantRoute()
  @Delete('me/push-subscriptions')
  @HttpCode(200)
  async unsubscribe(@Body(new ZodBody(Unsubscribe)) b: z.infer<typeof Unsubscribe>) {
    const w = this.who();
    const r = await this.db.txAs({}, (c) =>
      c.query('SELECT app.push_unsubscribe($1, $2, $3, $4) AS n', [w.account, w.tenant, w.person, b.endpoint]),
    );
    return { removed: Number(r.rows[0].n) };
  }
}
