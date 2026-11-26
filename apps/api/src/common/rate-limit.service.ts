import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

/** Einfaches Fenster-Rate-Limit in Redis (Login, Registrierung, OTP). */
@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<void> {
    const k = `rl:${key}`;
    const n = await this.redis.client.incr(k);
    if (n === 1) await this.redis.client.expire(k, windowSeconds);
    if (n > limit) {
      throw new HttpException('Zu viele Versuche. Bitte später erneut versuchen.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
