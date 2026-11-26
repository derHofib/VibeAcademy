import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;
  constructor(@Inject(APP_CONFIG) readonly config: AppConfig) {
    this.client = new Redis(config.REDIS_URL, { keyPrefix: config.REDIS_PREFIX, maxRetriesPerRequest: null });
  }
  /** Verbindungsoptionen für BullMQ (eigene Verbindungen, eigener Präfix). */
  bullConnection() {
    const u = new URL(this.config.REDIS_URL);
    return { host: u.hostname, port: Number(u.port || 6379), password: u.password || undefined, maxRetriesPerRequest: null };
  }
  async onModuleDestroy() {
    await this.client.quit().catch(() => undefined);
  }
}
