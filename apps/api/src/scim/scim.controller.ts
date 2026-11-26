import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, UseFilters, UseGuards, UseInterceptors } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { ScimService } from './scim.service';
import { SCHEMA, ScimAuthGuard, ScimContentType, ScimError, ScimExceptionFilter, ScimTenant, type ScimAuth } from './scim-http';
import { RESOURCE_TYPES, SCHEMAS, serviceProviderConfig } from './scim-schemas';

type ListQuery = { filter?: string; startIndex?: string; count?: string; excludedAttributes?: string };

/**
 * SCIM 2.0 (RFC 7643/7644, Teilmenge) unter /api/scim/v2 – ohne Sitzung/CSRF (Session-Middleware ausgenommen),
 * Authentifizierung per Bearer-Token des Mandanten. Der RLS-Kontext kommt ausschließlich aus dem Token.
 */
@Controller('scim/v2')
@Public()
@UseGuards(ScimAuthGuard)
@UseFilters(ScimExceptionFilter)
@UseInterceptors(ScimContentType)
export class ScimController {
  constructor(private readonly scim: ScimService) {}

  @Get('ServiceProviderConfig')
  spc() {
    return serviceProviderConfig(this.scim.base);
  }

  @Get('Schemas')
  schemas() {
    return { schemas: [SCHEMA.list], totalResults: SCHEMAS.length, startIndex: 1, itemsPerPage: SCHEMAS.length, Resources: SCHEMAS.map((s) => this.withMeta(s, 'Schema', `Schemas/${s.id}`)) };
  }

  @Get('Schemas/:id')
  schema(@Param('id') id: string) {
    const s = SCHEMAS.find((x) => x.id === id);
    if (!s) throw new ScimError(404, 'Schema nicht gefunden');
    return this.withMeta(s, 'Schema', `Schemas/${s.id}`);
  }

  @Get('ResourceTypes')
  resourceTypes() {
    return {
      schemas: [SCHEMA.list],
      totalResults: RESOURCE_TYPES.length,
      startIndex: 1,
      itemsPerPage: RESOURCE_TYPES.length,
      Resources: RESOURCE_TYPES.map((r) => this.withMeta(r, 'ResourceType', `ResourceTypes/${r.id}`)),
    };
  }

  @Get('ResourceTypes/:id')
  resourceType(@Param('id') id: string) {
    const r = RESOURCE_TYPES.find((x) => x.id === id);
    if (!r) throw new ScimError(404, 'Ressourcentyp nicht gefunden');
    return this.withMeta(r, 'ResourceType', `ResourceTypes/${r.id}`);
  }

  private withMeta<T extends object>(o: T, resourceType: string, path: string) {
    return { ...o, meta: { resourceType, location: `${this.scim.base}/${path}` } };
  }

  // ── Users ──
  @Get('Users')
  listUsers(@ScimTenant() a: ScimAuth, @Query() q: ListQuery) {
    return this.scim.listUsers(a, q);
  }
  @Get('Users/:id')
  getUser(@ScimTenant() a: ScimAuth, @Param('id') id: string) {
    return this.scim.getUser(a, id);
  }
  @Post('Users')
  @HttpCode(201)
  createUser(@ScimTenant() a: ScimAuth, @Body() body: unknown) {
    return this.scim.createUser(a, body);
  }
  @Put('Users/:id')
  replaceUser(@ScimTenant() a: ScimAuth, @Param('id') id: string, @Body() body: unknown) {
    return this.scim.replaceUser(a, id, body);
  }
  @Patch('Users/:id')
  patchUser(@ScimTenant() a: ScimAuth, @Param('id') id: string, @Body() body: unknown) {
    return this.scim.patchUser(a, id, body);
  }
  /** Löschen = deaktivieren (Austritt, Mitgliedschaft lösen); die Person bleibt wegen der Aufbewahrungspflicht erhalten. */
  @Delete('Users/:id')
  @HttpCode(204)
  async deleteUser(@ScimTenant() a: ScimAuth, @Param('id') id: string) {
    await this.scim.deleteUser(a, id);
  }

  // ── Groups ──
  @Get('Groups')
  listGroups(@ScimTenant() a: ScimAuth, @Query() q: ListQuery) {
    return this.scim.listGroups(a, q);
  }
  @Get('Groups/:id')
  getGroup(@ScimTenant() a: ScimAuth, @Param('id') id: string, @Query('excludedAttributes') ex?: string) {
    return this.scim.getGroup(a, id, ex);
  }
  @Post('Groups')
  @HttpCode(201)
  createGroup(@ScimTenant() a: ScimAuth, @Body() body: unknown) {
    return this.scim.createGroup(a, body);
  }
  @Put('Groups/:id')
  replaceGroup(@ScimTenant() a: ScimAuth, @Param('id') id: string, @Body() body: unknown) {
    return this.scim.replaceGroup(a, id, body);
  }
  @Patch('Groups/:id')
  patchGroup(@ScimTenant() a: ScimAuth, @Param('id') id: string, @Body() body: unknown) {
    return this.scim.patchGroup(a, id, body);
  }
  @Delete('Groups/:id')
  @HttpCode(204)
  async deleteGroup(@ScimTenant() a: ScimAuth, @Param('id') id: string) {
    await this.scim.deleteGroup(a, id);
  }
}
