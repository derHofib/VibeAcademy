import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { ApiKey, ApiScoped } from './api-key.guard';
import type { ApiPrincipal } from './api-key.service';
import { buildOpenApi } from './openapi';

/** OpenAPI-Beschreibung (öffentlich) und Angaben zum Schlüssel. */
@Controller('v1')
export class V1MetaController {
  private readonly doc = buildOpenApi();

  @Get('openapi.json')
  @Public()
  @Header('cache-control', 'public, max-age=300')
  openapi() {
    return this.doc;
  }

  @Get('me')
  @ApiScoped(null)
  me(@ApiKey() k: ApiPrincipal) {
    return { keyId: k.keyId, name: k.name, tenantId: k.tenantId, scopes: k.scopes };
  }
}
