import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { DbContext } from '@sn/db';
import { randomBytes, randomInt } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { sha256 } from '../common/crypto';
import { DbService } from '../db/db.service';
import { API_SCOPES, scopeRole, type ApiScope } from './scopes';

export const KEY_PREFIX = 'sn_live_';
const KEY_RE = /^sn_live_([a-z0-9]{12})_([A-Za-z0-9_-]{43})$/;
const PREFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const MAX_ACTIVE_KEYS = 50;

export const ApiKeyInput = z.object({
  name: z.string().trim().min(1, 'Bitte einen Namen angeben').max(100, 'Der Name ist zu lang'),
  scopes: z.array(z.enum(API_SCOPES, { error: 'Unbekannte Berechtigung' })).min(1, 'Bitte mindestens eine Berechtigung auswählen'),
  expiresAt: z.iso.datetime({ offset: true, error: 'Ablaufdatum im Format ISO 8601' }).or(z.iso.date()).nullish(),
});
export type ApiKeyInput = z.infer<typeof ApiKeyInput>;

/** Angemeldeter API-Schlüssel (nur im Request, nie gespeichert). */
export interface ApiPrincipal {
  keyId: string;
  tenantId: string;
  name: string;
  scopes: ApiScope[];
}

export function generateApiKey() {
  const prefix = Array.from({ length: 12 }, () => PREFIX_ALPHABET[randomInt(0, PREFIX_ALPHABET.length)]).join('');
  const secret = randomBytes(32).toString('base64url');
  return { prefix, secret, key: `${KEY_PREFIX}${prefix}_${secret}`, hash: sha256(secret) };
}

export function parseApiKey(token: string): { prefix: string; hash: string } | null {
  const m = KEY_RE.exec(token);
  return m ? { prefix: m[1]!, hash: sha256(m[2]!) } : null;
}

/** RLS-Kontext eines Schlüssels: Mandant + Rolle „api“ + je Scope eine Rolle (Policies in Migration 016). */
export const apiContext = (p: ApiPrincipal): DbContext => ({ tenantId: p.tenantId, roles: ['api', ...p.scopes.map(scopeRole)] });
/** Systemkontext im Mandanten des Schlüssels – nur nach geprüftem Scope (schreibende Abläufe, Pflichtmatrix). */
export const systemContext = (p: ApiPrincipal): DbContext => ({ tenantId: p.tenantId, roles: ['system'] });

interface KeyRow {
  id: string; name: string; prefix: string; scopes: ApiScope[]; created_at: Date; created_by_name: string | null; last_used_at: Date | null;
  expires_at: Date | null; revoked_at: Date | null;
}
const keyDto = (r: KeyRow, now = Date.now()) => ({
  id: r.id,
  name: r.name,
  prefix: r.prefix,
  preview: `${KEY_PREFIX}${r.prefix}_…`,
  scopes: r.scopes,
  createdAt: r.created_at,
  createdByName: r.created_by_name,
  lastUsedAt: r.last_used_at,
  expiresAt: r.expires_at,
  revokedAt: r.revoked_at,
  status: r.revoked_at ? 'widerrufen' : r.expires_at && new Date(r.expires_at).getTime() <= now ? 'abgelaufen' : 'aktiv',
});
export type ApiKeyDto = ReturnType<typeof keyDto>;

const SELECT = `SELECT k.id, k.name, k.prefix, k.scopes, k.created_at, k.last_used_at, k.expires_at, k.revoked_at,
                       (SELECT a.display_name FROM account a WHERE a.id = k.created_by) AS created_by_name
                  FROM api_key k`;

/** API-Schlüssel je Mandant: Anlegen (Geheimnis nur einmal sichtbar), Auflisten, Widerrufen, Anmelden. */
@Injectable()
export class ApiKeyService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  list(ctx: DbContext): Promise<ApiKeyDto[]> {
    return this.db.txAs(ctx, async (c) => (await c.query(`${SELECT} ORDER BY k.revoked_at NULLS FIRST, k.created_at DESC`)).rows.map((r) => keyDto(r)));
  }

  async create(ctx: DbContext, b: ApiKeyInput): Promise<{ apiKey: ApiKeyDto; key: string }> {
    const expiresAt = b.expiresAt ? new Date(b.expiresAt.length === 10 ? `${b.expiresAt}T23:59:59+01:00` : b.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException({ message: 'Das Ablaufdatum muss in der Zukunft liegen', fields: [{ path: 'expiresAt', message: 'Das Ablaufdatum muss in der Zukunft liegen' }] });
    }
    const g = generateApiKey();
    return this.db.txAs(ctx, async (c) => {
      const active = Number((await c.query('SELECT count(*) AS n FROM api_key WHERE revoked_at IS NULL')).rows[0].n);
      if (active >= MAX_ACTIVE_KEYS) throw new ConflictException(`Höchstens ${MAX_ACTIVE_KEYS} aktive API-Schlüssel je Organisation`);
      const r = await c.query(
        'INSERT INTO api_key (name, prefix, secret_hash, scopes, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [b.name, g.prefix, g.hash, [...new Set(b.scopes)], expiresAt],
      );
      const id = r.rows[0].id as string;
      await this.audit.record(c, { entity: 'api_key', entityId: id, action: 'created', payload: { name: b.name, scopes: b.scopes, prefix: g.prefix, expiresAt } });
      const row = (await c.query(`${SELECT} WHERE k.id = $1`, [id])).rows[0];
      return { apiKey: keyDto(row), key: g.key };
    });
  }

  async revoke(ctx: DbContext, id: string): Promise<ApiKeyDto> {
    return this.db.txAs(ctx, async (c) => {
      const r = await c.query('UPDATE api_key SET revoked_at = now(), revoked_by = app.account_id() WHERE id = $1 AND revoked_at IS NULL', [id]);
      if (!r.rowCount) {
        const exists = await c.query('SELECT 1 FROM api_key WHERE id = $1', [id]);
        if (!exists.rowCount) throw new NotFoundException('API-Schlüssel nicht gefunden');
      } else {
        await this.audit.record(c, { entity: 'api_key', entityId: id, action: 'revoked' });
      }
      return keyDto((await c.query(`${SELECT} WHERE k.id = $1`, [id])).rows[0]);
    });
  }

  /** Bearer-Token prüfen. null = unbekannt; sonst Status (widerrufen/abgelaufen) und Kontext. */
  async authenticate(token: string): Promise<(ApiPrincipal & { revoked: boolean; expired: boolean }) | null> {
    const parsed = parseApiKey(token);
    if (!parsed) return null;
    const r = (await this.db.txAs({}, (c) => c.query('SELECT * FROM app.api_key_authenticate($1, $2)', [parsed.prefix, parsed.hash]))).rows[0];
    if (!r) return null;
    return { keyId: r.id, tenantId: r.tenant_id, name: r.name, scopes: r.scopes, revoked: r.revoked, expired: r.expired };
  }
}
