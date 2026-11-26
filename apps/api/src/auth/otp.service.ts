import { Injectable } from '@nestjs/common';
import { safeEqual, sha256, sixDigitCode } from '../common/crypto';
import { RedisService } from '../redis/redis.service';

const TTL_S = 10 * 60;
const MAX_ATTEMPTS = 5;

/** Einmalcodes (6-stellig, 10 min, max. 5 Versuche). Gespeichert wird nur der Hash. */
@Injectable()
export class OtpService {
  constructor(private readonly redis: RedisService) {}

  async issue(purposeKey: string): Promise<string> {
    const code = sixDigitCode();
    await this.redis.client.set(`otp:${purposeKey}`, JSON.stringify({ h: sha256(code), a: 0 }), 'EX', TTL_S);
    return code;
  }

  async verify(purposeKey: string, code: string): Promise<boolean> {
    const k = `otp:${purposeKey}`;
    const raw = await this.redis.client.get(k);
    if (!raw) return false;
    const s = JSON.parse(raw) as { h: string; a: number };
    if (s.a >= MAX_ATTEMPTS) {
      await this.redis.client.del(k);
      return false;
    }
    if (/^\d{6}$/.test(code) && safeEqual(s.h, sha256(code))) {
      await this.redis.client.del(k);
      return true;
    }
    const ttl = await this.redis.client.ttl(k);
    await this.redis.client.set(k, JSON.stringify({ ...s, a: s.a + 1 }), 'EX', Math.max(ttl, 1));
    return false;
  }
}
