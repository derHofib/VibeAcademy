import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule, type AppModuleOptions } from './app.module';
import { PgExceptionFilter } from './common/pg-exception.filter';
import { RetryAfterFilter } from './common/retry-after.filter';
import { HttpAdapterHost } from '@nestjs/core';

export async function createApp(opts: AppModuleOptions): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(opts), {
    logger: opts.config.NODE_ENV === 'test' ? ['error'] : ['log', 'warn', 'error'],
  });
  app.set('trust proxy', 'loopback, uniquelocal');
  app.use(helmet());
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new PgExceptionFilter(app.get(HttpAdapterHost).httpAdapter), new RetryAfterFilter());
  app.enableShutdownHooks();
  return app;
}
