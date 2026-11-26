import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config';
import { DbService } from '../db/db.service';
import { JobRunner } from '../jobs/job-runner';
import { RedisService } from '../redis/redis.service';

export const HEARTBEAT_RETENTION_DAYS = 90;

/** Datenschutz-Job (Schritt 1.10): Roh-Heartbeats nach 90 Tagen löschen, täglich 03:15 Europe/Berlin. */
@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(RetentionService.name);
  private runner!: JobRunner<Record<string, never>>;

  constructor(
    private readonly db: DbService,
    private readonly redis: RedisService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onModuleInit() {
    this.runner = new JobRunner('retention', this.redis, this.config, () => this.purge());
    if (this.config.RUN_WORKERS && this.config.NODE_ENV !== 'test') {
      await this.runner.queue.upsertJobScheduler('retention-daily', { pattern: '15 3 * * *', tz: 'Europe/Berlin' }, { name: 'retention' });
    }
  }
  onModuleDestroy() {
    return this.runner.close();
  }

  async purge(): Promise<number> {
    const r = await this.db.txAs({ roles: ['system'] }, (c) =>
      c.query('SELECT app.purge_heartbeats(make_interval(days => $1)) AS n', [HEARTBEAT_RETENTION_DAYS]),
    );
    const n = Number(r.rows[0].n);
    if (n) this.log.log(`${n} Roh-Heartbeats älter als ${HEARTBEAT_RETENTION_DAYS} Tage gelöscht`);
    return n;
  }
}
