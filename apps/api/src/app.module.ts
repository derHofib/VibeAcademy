import { MiddlewareConsumer, Module, NestModule, type DynamicModule, type Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import pg from 'pg';
import { AuditController } from './audit/audit.controller';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { OtpService } from './auth/otp.service';
import { PasswordService } from './auth/password.service';
import { SessionMiddleware } from './auth/session.middleware';
import { SessionService } from './auth/session.service';
import { StepUpService } from './auth/step-up.service';
import { Clock } from './common/clock';
import { RateLimitService } from './common/rate-limit.service';
import { APP_CONFIG, type AppConfig } from './config';
import { DbService, PG_POOL } from './db/db.service';
import { HealthController } from './health.controller';
import { DevNotificationsController } from './notifications/dev.controller';
import { NotificationService } from './notifications/notification.service';
import { LogMailProvider, LogSmsProvider, MAIL_PROVIDER, SMS_PROVIDER, SmtpMailProvider } from './notifications/providers';
import { RedisService } from './redis/redis.service';
import { MembersController } from './tenant/members.controller';

export interface AppModuleOptions {
  config: AppConfig;
  /** Für Tests: Provider ersetzen (z. B. Clock → FakeClock) */
  overrides?: Provider[];
}

@Module({})
export class AppModule implements NestModule {
  static forRoot({ config, overrides = [] }: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, AuthController, AuditController, MembersController, DevNotificationsController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: PG_POOL, useFactory: () => new pg.Pool({ connectionString: config.DATABASE_URL, max: 20 }) },
        {
          provide: MAIL_PROVIDER,
          useFactory: () =>
            config.MAIL_PROVIDER === 'smtp'
              ? new SmtpMailProvider(config.SMTP_URL ?? 'smtp://127.0.0.1:1025', config.MAIL_FROM)
              : new LogMailProvider(config.NODE_ENV !== 'production'),
        },
        { provide: SMS_PROVIDER, useFactory: () => new LogSmsProvider() },
        { provide: APP_GUARD, useClass: AuthGuard },
        Clock,
        DbService,
        RedisService,
        RateLimitService,
        AuditService,
        PasswordService,
        SessionService,
        OtpService,
        StepUpService,
        AuthService,
        NotificationService,
        ...overrides,
      ],
    };
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SessionMiddleware).forRoutes('*path');
  }
}
