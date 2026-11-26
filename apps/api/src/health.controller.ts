import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/decorators';
import { DbService } from './db/db.service';
import { RedisService } from './redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly db: DbService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  async health() {
    const [db, redis] = await Promise.all([
      this.db.txAs({}, (c) => c.query('SELECT 1')).then(() => 'ok', () => 'fehler'),
      this.redis.client.ping().then(() => 'ok', () => 'fehler'),
    ]);
    return { status: db === 'ok' && redis === 'ok' ? 'ok' : 'eingeschränkt', db, redis };
  }
}
