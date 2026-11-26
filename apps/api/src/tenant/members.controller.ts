import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ROLES, type Role } from '@sn/shared';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { Roles } from '../auth/decorators';
import { displayName, email, mapDbError, ZodBody } from '../common/errors';
import { currentRequest } from '../common/request-context';
import { DbService } from '../db/db.service';
import { NotificationService } from '../notifications/notification.service';

const roleList = z
  .array(z.enum(ROLES))
  .min(1, 'Mindestens eine Rolle wählen')
  .transform((r) => [...new Set(r)] as Role[]);
const AddMember = z.object({ email, name: displayName, roles: roleList });
const UpdateRoles = z.object({ roles: roleList });

/** Mitglieder (Kollegen) des Mandanten verwalten – nur Mandanten-Admin. */
@Controller('tenant/members')
@Roles('admin')
export class MembersController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly notifications: NotificationService,
  ) {}

  @Get()
  list() {
    return this.db.tx(async (c) =>
      (
        await c.query(
          `SELECT m.id, m.account_id, a.email, a.display_name AS name, m.roles, m.created_at,
                  (a.email_verified_at IS NOT NULL) AS active
             FROM membership m JOIN account a ON a.id = m.account_id
            WHERE m.tenant_id = app.tenant_id() ORDER BY a.display_name`,
        )
      ).rows,
    );
  }

  @Post()
  async add(@Body(new ZodBody(AddMember)) body: z.infer<typeof AddMember>) {
    const s = currentRequest()!.session!;
    const result = await this.db
      .tx(async (c) => {
        const r = (await c.query('SELECT * FROM app.admin_add_member($1, $2, $3)', [body.email, body.name, body.roles]))
          .rows[0] as { account_id: string; created: boolean };
        const meta = (
          await c.query(
            `SELECT t.name AS tenant_name, a.display_name AS inviter FROM tenant t, account a WHERE t.id = $1 AND a.id = $2`,
            [s.tenantId, s.accountId],
          )
        ).rows[0];
        const data = { tenantName: meta.tenant_name, inviterName: meta.inviter, rolesLabel: AuthService.rolesLabel(body.roles) };
        const n = r.created
          ? await this.notifications.enqueue(c, {
              tenantId: s.tenantId,
              accountId: r.account_id,
              channel: 'mail',
              recipient: body.email,
              template: 'member-invite',
              data,
              secret: { link: this.auth.passwordSetLink(await this.auth.createPasswordSetToken(r.account_id)) },
            })
          : await this.notifications.enqueue(c, {
              tenantId: s.tenantId,
              accountId: r.account_id,
              channel: 'mail',
              recipient: body.email,
              template: 'member-added',
              data: { ...data, loginUrl: this.auth.passwordSetLink('').replace('/passwort-festlegen#token=', '/anmelden') },
            });
        await this.audit.record(c, { entity: 'membership', entityId: r.account_id, action: 'added', payload: { roles: body.roles } });
        return { ...r, notification: n };
      })
      .catch(mapDbError);
    await this.notifications.dispatch([result.notification]);
    return { accountId: result.account_id, invited: result.created };
  }

  @Patch(':id')
  async updateRoles(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(UpdateRoles)) body: z.infer<typeof UpdateRoles>) {
    return this.db.tx(async (c) => {
      await this.assertNotLastAdmin(c, id, body.roles);
      const r = await c.query('UPDATE membership SET roles = $2 WHERE id = $1 RETURNING id, account_id, roles', [id, body.roles]);
      if (!r.rowCount) throw new NotFoundException('Mitglied nicht gefunden');
      await this.audit.record(c, { entity: 'membership', entityId: r.rows[0].account_id, action: 'roles_changed', payload: { roles: body.roles } });
      return r.rows[0];
    });
  }

  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.db.tx(async (c) => {
      await this.assertNotLastAdmin(c, id, []);
      const r = await c.query('DELETE FROM membership WHERE id = $1 RETURNING account_id', [id]);
      if (!r.rowCount) throw new NotFoundException('Mitglied nicht gefunden');
      await this.audit.record(c, { entity: 'membership', entityId: r.rows[0].account_id, action: 'removed' });
      return { ok: true };
    });
  }

  /** Der Mandant muss immer mindestens einen Admin behalten. */
  private async assertNotLastAdmin(c: import('pg').PoolClient, membershipId: string, newRoles: Role[]) {
    if (newRoles.includes('admin')) return;
    const r = await c.query(
      `SELECT (SELECT 'admin' = ANY(roles) FROM membership WHERE id = $1) AS is_admin,
              (SELECT count(*) FROM membership WHERE tenant_id = app.tenant_id() AND 'admin' = ANY(roles))::int AS admins`,
      [membershipId],
    );
    if (r.rows[0].is_admin && r.rows[0].admins <= 1) {
      throw new BadRequestException('Der letzte Admin kann nicht entfernt werden');
    }
  }
}
