import { Controller, Get, Header, Inject, NotFoundException, Param, Query } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config';
import { Public, Roles } from '../auth/decorators';
import { DbService } from '../db/db.service';
import { LogMailProvider, MAIL_PROVIDER, type MailProvider } from './providers';
import { render, SAMPLE_DATA, TEMPLATES } from './templates';

/** Nur außerhalb von Produktion: Vorlagen-Vorschau, Outbox, zuletzt „versendete“ Mails (E-12). */
@Controller('dev')
export class DevNotificationsController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
    private readonly db: DbService,
  ) {}

  private guard() {
    if (this.config.NODE_ENV === 'production') throw new NotFoundException();
  }

  @Public()
  @Get('mail-vorlagen')
  templates() {
    this.guard();
    return Object.keys(TEMPLATES);
  }

  @Public()
  @Get('mail-vorlagen/:name')
  @Header('content-type', 'text/html; charset=utf-8')
  preview(@Param('name') name: string) {
    this.guard();
    const sample = SAMPLE_DATA[name as keyof typeof SAMPLE_DATA];
    if (!sample) throw new NotFoundException('Unbekannte Vorlage');
    return render(name, sample.data, sample.secret).html;
  }

  @Public()
  @Get('postausgang')
  recent(@Query('an') to?: string) {
    this.guard();
    if (!(this.mail instanceof LogMailProvider)) return [];
    return this.mail.recent.filter((m) => !to || m.to.toLowerCase() === to.toLowerCase()).slice(0, 20);
  }

  @Roles('admin')
  @Get('outbox')
  outbox() {
    this.guard();
    return this.db.tx(async (c) =>
      (await c.query('SELECT id, channel, recipient, template, status, attempts, last_error, created_at, sent_at FROM notification ORDER BY created_at DESC LIMIT 50')).rows,
    );
  }
}
