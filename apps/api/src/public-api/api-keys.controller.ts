import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { ZodBody } from '../common/errors';
import { DbService } from '../db/db.service';
import { WEBHOOK_EVENT_DESCRIPTIONS, WEBHOOK_EVENTS } from '../webhooks/events';
import { ApiKeyInput, ApiKeyService, MAX_ACTIVE_KEYS } from './api-key.service';
import { API_SCOPES, SCOPE_DESCRIPTIONS } from './scopes';
import { Uuid } from './uuid.pipe';

/** API-Schlüssel in der Verwaltung („Schnittstellen“), nur Mandanten-Admin. */
@Controller('integrations')
@Roles('admin')
export class ApiKeysController {
  constructor(
    private readonly db: DbService,
    private readonly keys: ApiKeyService,
  ) {}

  /** Scopes und Ereignistypen für die Oberfläche. */
  @Get('meta')
  meta() {
    return {
      scopes: API_SCOPES.map((id) => ({ id, description: SCOPE_DESCRIPTIONS[id] })),
      events: WEBHOOK_EVENTS.map((id) => ({ id, description: WEBHOOK_EVENT_DESCRIPTIONS[id] })),
      openapiUrl: '/api/v1/openapi.json',
      baseUrl: '/api/v1',
      maxActiveKeys: MAX_ACTIVE_KEYS,
    };
  }

  @Get('api-keys')
  list() {
    return this.keys.list(this.db.requestContext());
  }

  /** Der vollständige Schlüssel steht nur in dieser Antwort. */
  @Post('api-keys')
  create(@Body(new ZodBody(ApiKeyInput)) b: ApiKeyInput) {
    return this.keys.create(this.db.requestContext(), b);
  }

  @Post('api-keys/:id/revoke')
  @HttpCode(200)
  revoke(@Param('id', Uuid) id: string) {
    return this.keys.revoke(this.db.requestContext(), id);
  }
}
