import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config';
import { RedisService } from '../redis/redis.service';

/** Einfaches Fenster-Rate-Limit in Redis (Login, Registrierung, OTP). */
@Injectable()
export class RateLimitService {
  /** In der Entwicklung großzügiger (E2E-Läufe, Demo-Daten); Produktion und Tests mit den echten Grenzen. */
  private readonly scale: number;
  constructor(
    private readonly redis: RedisService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.scale = config.NODE_ENV === 'development' ? 20 : 1;
  }

  async hit(key: string, baseLimit: number, windowSeconds: number): Promise<void> {
    const limit = baseLimit * this.scale;
    const k = `rl:${key}`;
    const n = await this.redis.client.incr(k);
    if (n === 1) await this.redis.client.expire(k, windowSeconds);
    if (n > limit) {
      throw new HttpException('Zu viele Versuche. Bitte später erneut versuchen.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
