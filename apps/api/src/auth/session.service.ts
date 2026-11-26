import { Injectable } from '@nestjs/common';
import { randomToken, sha256 } from '../common/crypto';
import type { AccountSession as AccountSessionInput, InvitationSession, SessionData } from '../common/request-context';
import { RedisService } from '../redis/redis.service';

export const SESSION_COOKIE = 'sn_session';
export const CSRF_COOKIE = 'sn_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const IDLE_TTL_S = 8 * 3600; // gleitend
const ABSOLUTE_MAX_MS = 24 * 3600 * 1000;

/** Server-Sitzungen in Redis; im Cookie steht nur eine Zufalls-ID, in Redis nur deren Hash (E-07). */
@Injectable()
export class SessionService {
  constructor(private readonly redis: RedisService) {}

  private key(id: string) {
    return `sess:${sha256(id)}`;
  }

  async create(data: Omit<AccountSessionInput, 'createdAt'> | Omit<InvitationSession, 'createdAt'>): Promise<string> {
    const id = randomToken();
    const full = { ...data, createdAt: Date.now() } as SessionData;
    await this.redis.client.set(this.key(id), JSON.stringify(full), 'EX', IDLE_TTL_S);
    return id;
  }

  async get(id: string | undefined): Promise<SessionData | null> {
    if (!id || id.length > 100) return null;
    const raw = await this.redis.client.get(this.key(id));
    if (!raw) return null;
    const s = JSON.parse(raw) as SessionData;
    if (Date.now() - s.createdAt > ABSOLUTE_MAX_MS) {
      await this.destroy(id);
      return null;
    }
    await this.redis.client.expire(this.key(id), IDLE_TTL_S);
    return s;
  }

  async update(id: string, patch: Partial<AccountSessionInput>): Promise<void> {
    const s = await this.get(id);
    if (!s || s.kind !== 'account') return;
    await this.redis.client.set(this.key(id), JSON.stringify({ ...s, ...patch }), 'EX', IDLE_TTL_S);
  }

  async destroy(id: string): Promise<void> {
    await this.redis.client.del(this.key(id));
  }

  cookieOptions(secure: boolean) {
    return { httpOnly: true, sameSite: 'lax' as const, secure, path: '/', maxAge: ABSOLUTE_MAX_MS };
  }
}
