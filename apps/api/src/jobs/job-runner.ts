import { Logger } from '@nestjs/common';
import { Queue, Worker, type JobsOptions } from 'bullmq';
import type { AppConfig } from '../config';
import type { RedisService } from '../redis/redis.service';

/** Kleine Hülle um BullMQ: Queue immer, Worker nur wenn RUN_WORKERS (E-13). */
export class JobRunner<T extends object> {
  private readonly log: Logger;
  readonly queue: Queue;
  private worker?: Worker;

  constructor(
    readonly name: string,
    redis: RedisService,
    config: AppConfig,
    process: (data: T) => Promise<unknown>,
    concurrency = 2,
  ) {
    this.log = new Logger(`Job:${name}`);
    const prefix = `${config.REDIS_PREFIX}bull`;
    this.queue = new Queue(name, { connection: redis.bullConnection(), prefix });
    if (config.RUN_WORKERS) {
      this.worker = new Worker(name, (job) => process(job.data as T), { connection: redis.bullConnection(), prefix, concurrency });
      this.worker.on('failed', (job, err) => this.log.warn(`${job?.id} fehlgeschlagen: ${err.message}`));
    }
  }

  add(data: T, opts: JobsOptions = {}) {
    return this.queue.add(this.name, data, { removeOnComplete: 1000, removeOnFail: 5000, ...opts });
  }

  async close() {
    await this.worker?.close();
    await this.queue.close();
  }
}
