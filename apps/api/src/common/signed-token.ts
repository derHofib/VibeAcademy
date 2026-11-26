import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config';
import { deriveKey, hmac, safeEqual } from './crypto';
import { Clock } from './clock';

/** Kurzlebige, signierte Tokens (Seiten-URLs, später QR-Codes). Format: base64url(JSON).hmac */
@Injectable()
export class SignedTokens {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {}

  private key(purpose: string) {
    return deriveKey(this.config.HMAC_MASTER_SECRET, `token:${purpose}`);
  }

  sign(purpose: string, payload: Record<string, unknown>, ttlSeconds: number): string {
    const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(this.clock.now().getTime() / 1000) + ttlSeconds })).toString('base64url');
    return `${body}.${hmac(this.key(purpose), body)}`;
  }

  verify<T extends Record<string, unknown>>(purpose: string, token: string): T | null {
    const [body, sig] = token.split('.');
    if (!body || !sig || !safeEqual(sig, hmac(this.key(purpose), body))) return null;
    try {
      const data = JSON.parse(Buffer.from(body, 'base64url').toString()) as T & { exp: number };
      if (data.exp * 1000 < this.clock.now().getTime()) return null;
      return data;
    } catch {
      return null;
    }
  }
}
