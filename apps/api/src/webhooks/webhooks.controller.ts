import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { ZodBody } from '../common/errors';
import { DbService } from '../db/db.service';
import { parsePage } from '../public-api/pagination';
import { Uuid } from '../public-api/uuid.pipe';
import { SESSION_ACTOR } from './actor';
import { EndpointInput, EndpointPatch, WebhookService } from './webhook.service';

/** Webhooks in der Verwaltung („Einstellungen → Schnittstellen“), nur Mandanten-Admin. */
@Controller('integrations/webhooks')
@Roles('admin')
export class WebhooksController {
  constructor(
    private readonly db: DbService,
    private readonly webhooks: WebhookService,
  ) {}

  private ctx() {
    return this.db.requestContext();
  }

  @Get()
  list() {
    return this.webhooks.list(this.ctx());
  }

  @Post()
  create(@Body(new ZodBody(EndpointInput)) b: EndpointInput) {
    return this.webhooks.create(this.ctx(), b, SESSION_ACTOR);
  }

  @Get(':id')
  get(@Param('id', Uuid) id: string) {
    return this.webhooks.get(this.ctx(), id);
  }

  @Patch(':id')
  update(@Param('id', Uuid) id: string, @Body(new ZodBody(EndpointPatch)) b: EndpointPatch) {
    return this.webhooks.update(this.ctx(), id, b, SESSION_ACTOR);
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id', Uuid) id: string) {
    await this.webhooks.remove(this.ctx(), id, SESSION_ACTOR);
    return { ok: true };
  }

  @Post(':id/rotate-secret')
  @HttpCode(200)
  rotate(@Param('id', Uuid) id: string) {
    return this.webhooks.rotateSecret(this.ctx(), id, SESSION_ACTOR);
  }

  @Post(':id/ping')
  @HttpCode(202)
  ping(@Param('id', Uuid) id: string) {
    return this.webhooks.ping(this.ctx(), id, SESSION_ACTOR);
  }

  @Get(':id/deliveries')
  deliveries(@Param('id', Uuid) id: string, @Query() q: Record<string, string>) {
    return this.webhooks.deliveries(this.ctx(), id, parsePage(q), q.status || undefined);
  }

  @Post(':id/deliveries/:deliveryId/redeliver')
  @HttpCode(202)
  redeliver(@Param('id', Uuid) id: string, @Param('deliveryId', Uuid) deliveryId: string) {
    return this.webhooks.redeliver(this.ctx(), id, deliveryId, SESSION_ACTOR);
  }
}
