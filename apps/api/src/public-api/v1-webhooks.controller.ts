import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ZodBody } from '../common/errors';
import { EndpointInput, EndpointPatch, WebhookService } from '../webhooks/webhook.service';
import { ApiKey, ApiScoped } from './api-key.guard';
import { apiContext, type ApiPrincipal } from './api-key.service';
import { parsePage } from './pagination';
import { Uuid } from './uuid.pipe';

const actor = (k: ApiPrincipal) => ({ kind: 'api-key' as const, keyId: k.keyId });

/** Webhooks über die API verwalten – Scope webhooks:manage. */
@Controller('v1/webhooks')
export class V1WebhooksController {
  constructor(private readonly webhooks: WebhookService) {}

  @Get()
  @ApiScoped('webhooks:manage')
  async list(@ApiKey() k: ApiPrincipal) {
    return { data: await this.webhooks.list(apiContext(k)), nextCursor: null };
  }

  @Post()
  @ApiScoped('webhooks:manage')
  async create(@ApiKey() k: ApiPrincipal, @Body(new ZodBody(EndpointInput)) b: EndpointInput) {
    const r = await this.webhooks.create(apiContext(k), b, actor(k));
    return { ...r.endpoint, secret: r.secret };
  }

  @Get(':id')
  @ApiScoped('webhooks:manage')
  get(@ApiKey() k: ApiPrincipal, @Param('id', Uuid) id: string) {
    return this.webhooks.get(apiContext(k), id);
  }

  @Patch(':id')
  @ApiScoped('webhooks:manage')
  update(@ApiKey() k: ApiPrincipal, @Param('id', Uuid) id: string, @Body(new ZodBody(EndpointPatch)) b: EndpointPatch) {
    return this.webhooks.update(apiContext(k), id, b, actor(k));
  }

  @Delete(':id')
  @ApiScoped('webhooks:manage')
  @HttpCode(204)
  async remove(@ApiKey() k: ApiPrincipal, @Param('id', Uuid) id: string) {
    await this.webhooks.remove(apiContext(k), id, actor(k));
  }

  @Post(':id/rotate-secret')
  @ApiScoped('webhooks:manage')
  @HttpCode(200)
  rotate(@ApiKey() k: ApiPrincipal, @Param('id', Uuid) id: string) {
    return this.webhooks.rotateSecret(apiContext(k), id, actor(k));
  }

  @Post(':id/ping')
  @ApiScoped('webhooks:manage')
  @HttpCode(202)
  ping(@ApiKey() k: ApiPrincipal, @Param('id', Uuid) id: string) {
    return this.webhooks.ping(apiContext(k), id, actor(k));
  }

  @Get(':id/deliveries')
  @ApiScoped('webhooks:manage')
  deliveries(@ApiKey() k: ApiPrincipal, @Param('id', Uuid) id: string, @Query() q: Record<string, string>) {
    return this.webhooks.deliveries(apiContext(k), id, parsePage(q), q.status || undefined);
  }

  @Post(':id/deliveries/:deliveryId/redeliver')
  @ApiScoped('webhooks:manage')
  @HttpCode(202)
  redeliver(@ApiKey() k: ApiPrincipal, @Param('id', Uuid) id: string, @Param('deliveryId', Uuid) deliveryId: string) {
    return this.webhooks.redeliver(apiContext(k), id, deliveryId, actor(k));
  }
}
