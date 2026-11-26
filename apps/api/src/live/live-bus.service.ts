import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config';
import { RedisService } from '../redis/redis.service';

/** Was sich geändert hat – jede Verbindung baut daraus ihre eigene (rollenabhängige) Sicht neu auf. */
export type LiveTopic = 'run' | 'attendance' | 'questions' | 'polls';
export interface LiveEvent {
  runId: string;
  topic: LiveTopic;
  /** fortlaufende Ereignisnummer je Termin (SSE `id`, Last-Event-ID) */
  seq: number;
}
type Listener = (e: LiveEvent) => void;

/**
 * Verteilung von Live-Ereignissen zwischen API-Instanzen über Redis Pub/Sub (E-15).
 * Übertragen werden nur „Thema geändert“-Signale, keine Personendaten.
 */
@Injectable()
export class LiveBus implements OnModuleDestroy {
  private readonly log = new Logger(LiveBus.name);
  private sub?: Redis;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly channelPrefix: string;

  constructor(
    private readonly redis: RedisService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    // Pub/Sub-Kanäle bekommen den keyPrefix von ioredis nicht → selbst präfixieren (Testisolation, mehrere Umgebungen)
    this.channelPrefix = `${config.REDIS_PREFIX}live:`;
  }

  private async subscriber(): Promise<Redis> {
    if (this.sub) return this.sub;
    const sub = new Redis(this.config.REDIS_URL, { maxRetriesPerRequest: null });
    this.sub = sub;
    sub.on('pmessage', (_pattern, channel: string, message: string) => {
      const runId = channel.slice(this.channelPrefix.length);
      const set = this.listeners.get(runId);
      if (!set?.size) return;
      try {
        const e = JSON.parse(message) as LiveEvent;
        for (const l of set) l(e);
      } catch (err) {
        this.log.warn(`Ungültiges Live-Ereignis: ${(err as Error).message}`);
      }
    });
    sub.on('error', (err) => this.log.warn(`Redis (Live): ${err.message}`));
    await sub.psubscribe(`${this.channelPrefix}*`);
    return sub;
  }

  async publish(runId: string, ...topics: LiveTopic[]) {
    for (const topic of new Set(topics)) {
      const seq = await this.redis.client.incr(`live:seq:${runId}`);
      await this.redis.client.expire(`live:seq:${runId}`, 7 * 86400);
      await this.redis.client.publish(`${this.channelPrefix}${runId}`, JSON.stringify({ runId, topic, seq } satisfies LiveEvent));
    }
  }

  async currentSeq(runId: string): Promise<number> {
    return Number((await this.redis.client.get(`live:seq:${runId}`)) ?? 0);
  }

  async subscribe(runId: string, l: Listener): Promise<() => void> {
    await this.subscriber();
    let set = this.listeners.get(runId);
    if (!set) this.listeners.set(runId, (set = new Set()));
    set.add(l);
    return () => {
      set.delete(l);
      if (!set.size) this.listeners.delete(runId);
    };
  }

  async onModuleDestroy() {
    this.listeners.clear();
    await this.sub?.quit().catch(() => undefined);
  }
}
