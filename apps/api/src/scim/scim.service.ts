import { Inject, Injectable } from '@nestjs/common';
import type pg from 'pg';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../config';
import { DbService } from '../db/db.service';
import { FilterError, paging, parseEqFilter, parsePatchPath, scimBool, type PatchPath } from './filter';
import { SCHEMA, ScimError, type ScimAuth } from './scim-http';

const TODAY = `(now() AT TIME ZONE 'Europe/Berlin')::date`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const USER_SELECT = `
  SELECT p.id, p.name, p.personalnr, p.email, p.mobil, p.org_unit_id, p.austritt_am, p.account_id, p.external_id,
         p.scim_user_name, p.created_at, p.updated_at, o.name AS org_unit_name, l.id AS leader_id, l.name AS leader_name,
         (p.austritt_am IS NULL OR p.austritt_am > ${TODAY}) AS active
    FROM person p LEFT JOIN org_unit o ON o.id = p.org_unit_id
    LEFT JOIN person l ON l.id = o.leiter_person_id AND l.id <> p.id`;

interface PersonRow {
  id: string;
  name: string;
  personalnr: string | null;
  email: string | null;
  mobil: string | null;
  org_unit_id: string | null;
  austritt_am: string | null;
  account_id: string | null;
  external_id: string | null;
  scim_user_name: string | null;
  created_at: Date;
  updated_at: Date;
  org_unit_name: string | null;
  leader_id: string | null;
  leader_name: string | null;
  active: boolean;
}

/** Normalisierte Änderung einer Person; undefined = unverändert. */
interface UserFields {
  userName?: string;
  name?: string;
  email?: string | null;
  mobil?: string | null;
  personalnr?: string | null;
  externalId?: string | null;
  active?: boolean;
  department?: string | null;
  managerId?: string | null;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 255): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string' && typeof v !== 'number') throw new ScimError(400, 'Ungültiger Wert', 'invalidValue');
  const s = String(v).trim();
  if (s.length > max) throw new ScimError(400, 'Wert zu lang', 'invalidValue');
  return s || null;
};
const looksLikeEmail = (s: string | null | undefined) => !!s && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

/** Wert aus einem Mehrfachattribut (emails, phoneNumbers): bevorzugt passender Typ, dann primary, dann erster Eintrag. */
function pickMulti(v: unknown, type: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (!Array.isArray(v)) throw new ScimError(400, 'Mehrfachattribut erwartet', 'invalidValue');
  const items = v.filter(isObj);
  const hit = items.find((x) => String(x.type ?? '').toLowerCase() === type) ?? items.find((x) => scimBool(x.primary)) ?? items[0];
  return hit ? str(hit.value) : null;
}

function nameFrom(v: unknown): string | null | undefined {
  if (!isObj(v)) return undefined;
  const formatted = str(v.formatted, 200);
  if (formatted) return formatted;
  const parts = [str(v.givenName, 100), str(v.familyName, 100)].filter(Boolean);
  return parts.length ? parts.join(' ') : undefined;
}

/**
 * SCIM 2.0 je Mandant (E-36): Users ↔ Personen, Groups ↔ Org-Einheiten.
 * Kontext: Mandant aus dem Token, Rolle „scim“ (RLS-Policies person_scim, org_unit_scim, membership_scim_delete).
 * Löschen = deaktivieren (austritt_am, Mitgliedschaft lösen) – Nachweise bleiben (Aufbewahrung).
 */
@Injectable()
export class ScimService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get base() {
    return `${this.config.PUBLIC_BASE_URL}/api/scim/v2`;
  }

  private tx<T>(a: ScimAuth, fn: (c: pg.PoolClient) => Promise<T>) {
    return this.db.txAs({ tenantId: a.tenantId, roles: ['scim'] }, fn);
  }

  private record(c: pg.PoolClient, a: ScimAuth, entity: string, entityId: string, action: string, payload: Json = {}) {
    return this.audit.record(c, { entity, entityId, action, payload: { ...payload, via: 'scim', tokenId: a.tokenId } });
  }

  // ── Users ──────────────────────────────────────────────────
  toUser(p: PersonRow): Json {
    const ent: Json = {};
    if (p.personalnr) ent.employeeNumber = p.personalnr;
    if (p.org_unit_name) ent.department = p.org_unit_name;
    if (p.leader_id) ent.manager = { value: p.leader_id, $ref: `${this.base}/Users/${p.leader_id}`, displayName: p.leader_name };
    return {
      schemas: [SCHEMA.user, ...(Object.keys(ent).length ? [SCHEMA.enterprise] : [])],
      id: p.id,
      ...(p.external_id ? { externalId: p.external_id } : {}),
      userName: p.scim_user_name ?? p.email ?? p.personalnr ?? p.id,
      name: { formatted: p.name },
      displayName: p.name,
      active: p.active,
      ...(p.email ? { emails: [{ value: p.email, type: 'work', primary: true }] } : {}),
      ...(p.mobil ? { phoneNumbers: [{ value: p.mobil, type: 'mobile' }] } : {}),
      ...(p.org_unit_id ? { groups: [{ value: p.org_unit_id, display: p.org_unit_name, $ref: `${this.base}/Groups/${p.org_unit_id}` }] } : {}),
      ...(Object.keys(ent).length ? { [SCHEMA.enterprise]: ent } : {}),
      meta: {
        resourceType: 'User',
        created: new Date(p.created_at).toISOString(),
        lastModified: new Date(p.updated_at).toISOString(),
        location: `${this.base}/Users/${p.id}`,
        version: `W/"${new Date(p.updated_at).getTime()}"`,
      },
    };
  }

  private async loadUser(c: pg.PoolClient, id: string): Promise<PersonRow> {
    if (!UUID.test(id)) throw new ScimError(404, 'Benutzer nicht gefunden');
    const r = (await c.query(`${USER_SELECT} WHERE p.id = $1`, [id])).rows[0] as PersonRow | undefined;
    if (!r) throw new ScimError(404, 'Benutzer nicht gefunden');
    return r;
  }

  async listUsers(a: ScimAuth, q: { filter?: string; startIndex?: unknown; count?: unknown }) {
    const pg_ = paging(q.startIndex, q.count);
    let where = 'TRUE';
    const args: unknown[] = [];
    if (q.filter) {
      let f;
      try {
        f = parseEqFilter(q.filter, ['username', 'externalid', 'emails.value', 'emails', 'id', 'displayname']);
      } catch (e) {
        throw new ScimError(400, (e as Error).message, 'invalidFilter');
      }
      const v = String(f.value);
      args.push(v);
      where = {
        username: 'coalesce(p.scim_user_name, p.email) = $1::citext',
        externalid: 'p.external_id = $1',
        'emails.value': 'p.email = $1::citext',
        emails: 'p.email = $1::citext',
        id: UUID.test(v) ? 'p.id = $1::uuid' : 'FALSE',
        displayname: 'p.name = $1',
      }[f.attr]!;
    }
    return this.tx(a, async (c) => {
      const total = Number((await c.query(`SELECT count(*) AS n FROM person p WHERE ${where}`, args)).rows[0].n);
      const rows = pg_.limit
        ? ((await c.query(`${USER_SELECT} WHERE ${where} ORDER BY p.created_at, p.id LIMIT ${pg_.limit} OFFSET ${pg_.offset}`, args)).rows as PersonRow[])
        : [];
      return { schemas: [SCHEMA.list], totalResults: total, startIndex: pg_.startIndex, itemsPerPage: rows.length, Resources: rows.map((r) => this.toUser(r)) };
    });
  }

  async getUser(a: ScimAuth, id: string) {
    return this.tx(a, async (c) => this.toUser(await this.loadUser(c, id)));
  }

  /** POST/PUT: vollständige Darstellung → Felder (PUT ersetzt; department nur, wenn angegeben). */
  private fieldsFromResource(body: unknown): UserFields {
    if (!isObj(body)) throw new ScimError(400, 'Ungültiger Inhalt', 'invalidSyntax');
    const userName = str(body.userName);
    if (!userName) throw new ScimError(400, 'userName ist erforderlich', 'invalidValue');
    const ent = isObj(body[SCHEMA.enterprise]) ? (body[SCHEMA.enterprise] as Json) : {};
    const email = pickMulti(body.emails, 'work') ?? (looksLikeEmail(userName) ? userName : null);
    const manager = ent.manager;
    return {
      userName,
      name: str(body.displayName, 200) ?? nameFrom(body.name) ?? userName,
      email: email?.toLowerCase() ?? null,
      mobil: pickMulti(body.phoneNumbers, 'mobile') ?? null,
      personalnr: str(ent.employeeNumber, 50) ?? null,
      externalId: str(body.externalId) ?? null,
      active: scimBool(body.active) ?? true,
      ...(ent.department !== undefined ? { department: str(ent.department, 200) ?? null } : {}),
      ...(manager !== undefined ? { managerId: str(isObj(manager) ? manager.value : manager) ?? null } : {}),
    };
  }

  async createUser(a: ScimAuth, body: unknown) {
    const f = this.fieldsFromResource(body);
    return this.tx(a, async (c) => {
      const dup = await c.query('SELECT 1 FROM person WHERE coalesce(scim_user_name, email) = $1::citext', [f.userName]);
      if (dup.rowCount) throw new ScimError(409, 'Ein Benutzer mit diesem userName existiert bereits', 'uniqueness');
      const id = (
        await c.query(
          `INSERT INTO person (name, scim_user_name, email, mobil, personalnr, external_id, austritt_am)
           VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7 THEN NULL ELSE ${TODAY} END) RETURNING id`,
          [f.name, f.userName, f.email, f.mobil, f.personalnr, f.externalId, f.active !== false],
        )
      ).rows[0].id as string;
      await this.applyOrg(c, a, id, f);
      await this.record(c, a, 'person', id, 'scim_created', { userName: f.userName, active: f.active !== false });
      return this.toUser(await this.loadUser(c, id));
    });
  }

  async replaceUser(a: ScimAuth, id: string, body: unknown) {
    const f = this.fieldsFromResource(body);
    return this.tx(a, async (c) => this.update(c, a, await this.loadUser(c, id), f));
  }

  async patchUser(a: ScimAuth, id: string, body: unknown) {
    const ops = this.patchOps(body);
    return this.tx(a, async (c) => {
      const cur = await this.loadUser(c, id);
      const f: UserFields = {};
      let name = cur.name;
      const setAttr = (path: PatchPath, op: string, value: unknown) => {
        const remove = op === 'remove';
        const v = remove ? null : value;
        switch (path.attr) {
          case 'username':
            if (remove || !str(v)) throw new ScimError(400, 'userName kann nicht entfernt werden', 'mutability');
            f.userName = str(v)!;
            return;
          case 'displayname':
          case 'name.formatted':
            if (str(v, 200)) name = f.name = str(v, 200)!;
            return;
          case 'name': {
            const n = nameFrom(v);
            if (n) name = f.name = n;
            return;
          }
          case 'name.givenname':
          case 'name.familyname': {
            const [given, ...rest] = name.split(' ');
            const part = str(v, 100) ?? '';
            const next = path.attr === 'name.givenname' ? [part, rest.join(' ')] : [given, part];
            const joined = next.filter(Boolean).join(' ');
            if (joined) name = f.name = joined;
            return;
          }
          case 'externalid':
            f.externalId = str(v) ?? null;
            return;
          case 'active': {
            const b = remove ? false : scimBool(v);
            if (b === undefined) throw new ScimError(400, 'active muss true oder false sein', 'invalidValue');
            f.active = b;
            return;
          }
          case 'emails':
            f.email = (path.where || path.sub ? (remove ? null : str(v)) : pickMulti(v, 'work'))?.toLowerCase() ?? null;
            return;
          case 'phonenumbers':
            f.mobil = (path.where || path.sub ? (remove ? null : str(v, 50)) : pickMulti(v, 'mobile')) ?? null;
            return;
          case 'enterprise:department':
            f.department = str(v, 200) ?? null;
            return;
          case 'enterprise:employeenumber':
            f.personalnr = str(v, 50) ?? null;
            return;
          case 'enterprise:manager':
            f.managerId = str(isObj(v) ? v.value : v) ?? null;
            return;
          default:
            // Nicht abgebildete Attribute (z. B. title, preferredLanguage, addresses) werden ignoriert.
            return;
        }
      };
      for (const op of ops) {
        if (op.path) {
          setAttr(this.path(op.path), op.op, op.value);
        } else {
          if (op.op === 'remove') throw new ScimError(400, 'remove ohne path', 'noTarget');
          if (!isObj(op.value)) throw new ScimError(400, 'value muss ein Objekt sein', 'invalidValue');
          for (const [k, v] of Object.entries(op.value)) {
            if (k.toLowerCase() === SCHEMA.enterprise.toLowerCase() && isObj(v)) {
              for (const [ek, ev] of Object.entries(v)) setAttr(this.path(`${SCHEMA.enterprise}:${ek}`), op.op, ev);
            } else if (k !== 'schemas' && k !== 'id' && k !== 'meta') setAttr(this.path(k), op.op, v);
          }
        }
      }
      return this.update(c, a, cur, f);
    });
  }

  private path(p: string): PatchPath {
    try {
      return parsePatchPath(p);
    } catch (e) {
      if (e instanceof FilterError) throw new ScimError(400, e.message, 'invalidPath');
      throw e;
    }
  }

  private patchOps(body: unknown): Array<{ op: 'add' | 'replace' | 'remove'; path?: string; value?: unknown }> {
    if (!isObj(body) || !Array.isArray(body.Operations) || !body.Operations.length) {
      throw new ScimError(400, 'PatchOp mit Operations erwartet', 'invalidSyntax');
    }
    if (body.Operations.length > 100) throw new ScimError(400, 'Zu viele Operationen', 'tooMany');
    return body.Operations.map((o) => {
      if (!isObj(o)) throw new ScimError(400, 'Ungültige Operation', 'invalidSyntax');
      const op = String(o.op ?? '').toLowerCase();
      if (op !== 'add' && op !== 'replace' && op !== 'remove') throw new ScimError(400, `Unbekannte Operation „${String(o.op)}“`, 'invalidSyntax');
      if (o.path !== undefined && typeof o.path !== 'string') throw new ScimError(400, 'path muss eine Zeichenkette sein', 'invalidPath');
      return { op, path: o.path as string | undefined, value: o.value };
    });
  }

  private async update(c: pg.PoolClient, a: ScimAuth, cur: PersonRow, f: UserFields) {
    const sets: string[] = [];
    const args: unknown[] = [cur.id];
    const changed: string[] = [];
    const set = (col: string, key: string, v: unknown, prev: unknown) => {
      if (v === undefined || v === prev) return;
      args.push(v);
      sets.push(`${col} = $${args.length}`);
      changed.push(key);
    };
    if (f.userName !== undefined && f.userName !== (cur.scim_user_name ?? cur.email)) {
      const dup = await c.query('SELECT 1 FROM person WHERE coalesce(scim_user_name, email) = $1::citext AND id <> $2', [f.userName, cur.id]);
      if (dup.rowCount) throw new ScimError(409, 'Ein Benutzer mit diesem userName existiert bereits', 'uniqueness');
    }
    set('scim_user_name', 'userName', f.userName, cur.scim_user_name);
    set('name', 'name', f.name, cur.name);
    set('email', 'email', f.email, cur.email);
    set('mobil', 'mobil', f.mobil, cur.mobil);
    set('personalnr', 'personalnr', f.personalnr, cur.personalnr);
    set('external_id', 'externalId', f.externalId, cur.external_id);
    if (f.active === true && !cur.active) {
      sets.push('austritt_am = NULL');
      changed.push('active');
    }
    if (sets.length) await c.query(`UPDATE person SET ${sets.join(', ')} WHERE id = $1`, args);
    if (await this.applyOrg(c, a, cur.id, f)) changed.push('department');
    if (f.active === false && cur.active) {
      await this.deactivate(c, a, cur);
    } else if (changed.length) {
      await this.record(c, a, 'person', cur.id, changed.includes('active') ? 'scim_reactivated' : 'scim_updated', { fields: changed });
    }
    return this.toUser(await this.loadUser(c, cur.id));
  }

  /** department → Org-Einheit (nach Name, sonst neu); manager → Leitung der Org-Einheit, wenn noch keine gesetzt ist. */
  private async applyOrg(c: pg.PoolClient, a: ScimAuth, personId: string, f: UserFields): Promise<boolean> {
    let changed = false;
    if (f.department !== undefined) {
      let orgId: string | null = null;
      if (f.department) {
        orgId = (await c.query('SELECT id FROM org_unit WHERE lower(name) = lower($1) ORDER BY created_at LIMIT 1', [f.department])).rows[0]?.id ?? null;
        if (!orgId) {
          orgId = (await c.query('INSERT INTO org_unit (name) VALUES ($1) RETURNING id', [f.department])).rows[0].id as string;
          await this.record(c, a, 'org_unit', orgId, 'scim_created', { name: f.department, from: 'department' });
        }
      }
      const r = await c.query('UPDATE person SET org_unit_id = $2 WHERE id = $1 AND org_unit_id IS DISTINCT FROM $2', [personId, orgId]);
      changed = !!r.rowCount;
    }
    if (f.managerId && UUID.test(f.managerId) && f.managerId !== personId) {
      const r = await c.query(
        `UPDATE org_unit o SET leiter_person_id = $2 FROM person p
          WHERE p.id = $1 AND o.id = p.org_unit_id AND o.leiter_person_id IS NULL AND EXISTS (SELECT 1 FROM person m WHERE m.id = $2)
          RETURNING o.id`,
        [personId, f.managerId],
      );
      if (r.rowCount) await this.record(c, a, 'org_unit', r.rows[0].id, 'scim_leader_set', { leaderPersonId: f.managerId });
    }
    return changed;
  }

  /** Deaktivieren statt Löschen: Austrittsdatum setzen und die Mitgliedschaft des verknüpften Kontos lösen. */
  private async deactivate(c: pg.PoolClient, a: ScimAuth, p: PersonRow) {
    await c.query(`UPDATE person SET austritt_am = coalesce(austritt_am, ${TODAY}) WHERE id = $1`, [p.id]);
    let membership: 'removed' | 'kept_last_admin' | 'none' = 'none';
    if (p.account_id) {
      const m = (
        await c.query(
          `SELECT m.id, 'admin' = ANY(m.roles) AS is_admin,
                  (SELECT count(*) FROM membership x WHERE x.tenant_id = app.tenant_id() AND 'admin' = ANY(x.roles))::int AS admins
             FROM membership m WHERE m.tenant_id = app.tenant_id() AND m.account_id = $1`,
          [p.account_id],
        )
      ).rows[0];
      if (m) {
        if (m.is_admin && m.admins <= 1) membership = 'kept_last_admin';
        else {
          await c.query('DELETE FROM membership WHERE id = $1', [m.id]);
          await this.record(c, a, 'membership', p.account_id, 'removed', { personId: p.id });
          membership = 'removed';
        }
      }
    }
    await this.record(c, a, 'person', p.id, 'scim_deactivated', { membership });
  }

  async deleteUser(a: ScimAuth, id: string) {
    await this.tx(a, async (c) => {
      const p = await this.loadUser(c, id);
      if (p.active) await this.deactivate(c, a, p);
    });
  }

  // ── Groups ─────────────────────────────────────────────────
  private async toGroup(c: pg.PoolClient, o: { id: string; name: string; external_id: string | null; created_at: Date }, withMembers: boolean): Promise<Json> {
    const members = withMembers
      ? (await c.query('SELECT id, name FROM person WHERE org_unit_id = $1 ORDER BY name, id', [o.id])).rows.map((m) => ({
          value: m.id,
          display: m.name,
          $ref: `${this.base}/Users/${m.id}`,
        }))
      : undefined;
    return {
      schemas: [SCHEMA.group],
      id: o.id,
      ...(o.external_id ? { externalId: o.external_id } : {}),
      displayName: o.name,
      ...(members ? { members } : {}),
      meta: {
        resourceType: 'Group',
        created: new Date(o.created_at).toISOString(),
        lastModified: new Date(o.created_at).toISOString(),
        location: `${this.base}/Groups/${o.id}`,
      },
    };
  }

  private async loadGroup(c: pg.PoolClient, id: string) {
    if (!UUID.test(id)) throw new ScimError(404, 'Gruppe nicht gefunden');
    const r = (await c.query('SELECT id, name, external_id, created_at FROM org_unit WHERE id = $1', [id])).rows[0];
    if (!r) throw new ScimError(404, 'Gruppe nicht gefunden');
    return r as { id: string; name: string; external_id: string | null; created_at: Date };
  }

  async listGroups(a: ScimAuth, q: { filter?: string; startIndex?: unknown; count?: unknown; excludedAttributes?: string }) {
    const pg_ = paging(q.startIndex, q.count);
    const withMembers = !(q.excludedAttributes ?? '').toLowerCase().split(',').map((s) => s.trim()).includes('members');
    let where = 'TRUE';
    const args: unknown[] = [];
    if (q.filter) {
      let f;
      try {
        f = parseEqFilter(q.filter, ['displayname', 'externalid', 'id']);
      } catch (e) {
        throw new ScimError(400, (e as Error).message, 'invalidFilter');
      }
      const v = String(f.value);
      args.push(v);
      where = { displayname: 'lower(o.name) = lower($1)', externalid: 'o.external_id = $1', id: UUID.test(v) ? 'o.id = $1::uuid' : 'FALSE' }[f.attr]!;
    }
    return this.tx(a, async (c) => {
      const total = Number((await c.query(`SELECT count(*) AS n FROM org_unit o WHERE ${where}`, args)).rows[0].n);
      const rows = pg_.limit
        ? (await c.query(`SELECT o.id, o.name, o.external_id, o.created_at FROM org_unit o WHERE ${where} ORDER BY o.created_at, o.id LIMIT ${pg_.limit} OFFSET ${pg_.offset}`, args)).rows
        : [];
      const resources = [];
      for (const r of rows) resources.push(await this.toGroup(c, r, withMembers));
      return { schemas: [SCHEMA.list], totalResults: total, startIndex: pg_.startIndex, itemsPerPage: rows.length, Resources: resources };
    });
  }

  async getGroup(a: ScimAuth, id: string, excludedAttributes?: string) {
    const withMembers = !(excludedAttributes ?? '').toLowerCase().includes('members');
    return this.tx(a, async (c) => this.toGroup(c, await this.loadGroup(c, id), withMembers));
  }

  private memberIds(v: unknown): string[] {
    if (v === undefined || v === null) return [];
    const list = Array.isArray(v) ? v : [v];
    return list.map((m) => (isObj(m) ? String(m.value ?? '') : String(m))).filter((id) => UUID.test(id));
  }

  /** Mitglieder setzen/ergänzen/entfernen. Eine Person gehört zu genau einer Org-Einheit (Hinzufügen verschiebt sie). */
  private async setMembers(c: pg.PoolClient, a: ScimAuth, groupId: string, mode: 'add' | 'remove' | 'replace', ids: string[]) {
    let n = 0;
    if (mode === 'replace' || mode === 'remove') {
      const r = await c.query(
        `UPDATE person SET org_unit_id = NULL WHERE org_unit_id = $1 AND ${mode === 'replace' ? 'NOT (id = ANY($2::uuid[]))' : 'id = ANY($2::uuid[])'}`,
        [groupId, ids],
      );
      n += r.rowCount ?? 0;
    }
    if ((mode === 'replace' || mode === 'add') && ids.length) {
      const r = await c.query('UPDATE person SET org_unit_id = $1 WHERE id = ANY($2::uuid[]) AND org_unit_id IS DISTINCT FROM $1', [groupId, ids]);
      n += r.rowCount ?? 0;
    }
    if (n) await this.record(c, a, 'org_unit', groupId, 'scim_members_changed', { mode, count: ids.length });
  }

  private groupFields(body: unknown) {
    if (!isObj(body)) throw new ScimError(400, 'Ungültiger Inhalt', 'invalidSyntax');
    const displayName = str(body.displayName, 200);
    if (!displayName) throw new ScimError(400, 'displayName ist erforderlich', 'invalidValue');
    return { displayName, externalId: str(body.externalId) ?? null, members: body.members };
  }

  async createGroup(a: ScimAuth, body: unknown) {
    const g = this.groupFields(body);
    return this.tx(a, async (c) => {
      const dup = await c.query('SELECT 1 FROM org_unit WHERE lower(name) = lower($1)', [g.displayName]);
      if (dup.rowCount) throw new ScimError(409, 'Eine Gruppe mit diesem Namen existiert bereits', 'uniqueness');
      const id = (await c.query('INSERT INTO org_unit (name, external_id) VALUES ($1, $2) RETURNING id', [g.displayName, g.externalId])).rows[0].id;
      await this.record(c, a, 'org_unit', id, 'scim_created', { name: g.displayName });
      await this.setMembers(c, a, id, 'add', this.memberIds(g.members));
      return this.toGroup(c, await this.loadGroup(c, id), true);
    });
  }

  async replaceGroup(a: ScimAuth, id: string, body: unknown) {
    const g = this.groupFields(body);
    return this.tx(a, async (c) => {
      const cur = await this.loadGroup(c, id);
      if (cur.name !== g.displayName || cur.external_id !== g.externalId) {
        await c.query('UPDATE org_unit SET name = $2, external_id = $3 WHERE id = $1', [id, g.displayName, g.externalId]);
        await this.record(c, a, 'org_unit', id, 'scim_updated', { name: g.displayName });
      }
      await this.setMembers(c, a, id, 'replace', this.memberIds(g.members));
      return this.toGroup(c, await this.loadGroup(c, id), true);
    });
  }

  async patchGroup(a: ScimAuth, id: string, body: unknown) {
    const ops = this.patchOps(body);
    return this.tx(a, async (c) => {
      const cur = await this.loadGroup(c, id);
      let name = cur.name;
      let externalId = cur.external_id;
      const attr = async (attrName: string, op: string, value: unknown, where?: PatchPath['where']) => {
        if (attrName === 'displayname') {
          if (op === 'remove' || !str(value, 200)) throw new ScimError(400, 'displayName ist erforderlich', 'mutability');
          name = str(value, 200)!;
        } else if (attrName === 'externalid') {
          externalId = op === 'remove' ? null : (str(value) ?? null);
        } else if (attrName === 'members') {
          if (op === 'remove' && where) {
            if (where.attr !== 'value') throw new ScimError(400, 'Nur members[value eq "…"] wird unterstützt', 'invalidFilter');
            await this.setMembers(c, a, id, 'remove', this.memberIds(String(where.value)));
          } else if (op === 'remove') {
            const ids = this.memberIds(value);
            if (value === undefined) await this.setMembers(c, a, id, 'replace', []);
            else await this.setMembers(c, a, id, 'remove', ids);
          } else {
            await this.setMembers(c, a, id, op === 'replace' ? 'replace' : 'add', this.memberIds(value));
          }
        }
        // andere Attribute werden ignoriert
      };
      for (const op of ops) {
        if (op.path) {
          const p = this.path(op.path);
          await attr(p.attr, op.op, op.value, p.where);
        } else {
          if (op.op === 'remove' || !isObj(op.value)) throw new ScimError(400, 'value muss ein Objekt sein', 'noTarget');
          for (const [k, v] of Object.entries(op.value)) await attr(k.toLowerCase(), op.op, v);
        }
      }
      if (name !== cur.name || externalId !== cur.external_id) {
        await c.query('UPDATE org_unit SET name = $2, external_id = $3 WHERE id = $1', [id, name, externalId]);
        await this.record(c, a, 'org_unit', id, 'scim_updated', { name });
      }
      return this.toGroup(c, await this.loadGroup(c, id), true);
    });
  }

  async deleteGroup(a: ScimAuth, id: string) {
    await this.tx(a, async (c) => {
      const g = await this.loadGroup(c, id);
      await c.query('DELETE FROM org_unit WHERE id = $1', [id]);
      await this.record(c, a, 'org_unit', id, 'scim_deleted', { name: g.name });
    });
  }
}
