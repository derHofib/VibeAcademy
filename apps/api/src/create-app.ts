import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule, type AppModuleOptions } from './app.module';

export async function createApp(opts: AppModuleOptions): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(opts), {
    logger: opts.config.NODE_ENV === 'test' ? ['error'] : ['log', 'warn', 'error'],
  });
  app.set('trust proxy', 'loopback, uniquelocal');
  app.use(helmet());
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  return app;
}
