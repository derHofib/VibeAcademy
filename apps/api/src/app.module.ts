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
import { APP_CONFIG, repoPath, type AppConfig } from './config';
import { DbService, PG_POOL } from './db/db.service';
import { HealthController } from './health.controller';
import { DevNotificationsController } from './notifications/dev.controller';
import { NotificationService } from './notifications/notification.service';
import { LogMailProvider, LogSmsProvider, MAIL_PROVIDER, SMS_PROVIDER, SmtpMailProvider } from './notifications/providers';
import { RedisService } from './redis/redis.service';
import { MembersController } from './tenant/members.controller';
import { PersonsController } from './persons/persons.controller';
import { ParticipantController } from './participant/participant.controller';
import { ParticipantService } from './participant/participant.service';
import { InvitationService } from './runs/invitation.service';
import { RunsController } from './runs/runs.controller';
import { SignedTokens } from './common/signed-token';
import { ReadingController } from './reading/reading.controller';
import { ReadingService } from './reading/reading.service';
import { RetentionService } from './retention/retention.service';
import { QuizController } from './quiz/quiz.controller';
import { SignatureController } from './signature/signature.controller';
import { EvidenceController } from './evidence/evidence.controller';
import { ReportsController } from './reports/reports.controller';
import { EvidenceService } from './evidence/evidence.service';
import { GotenbergRenderer, PDF_RENDERER, PlaywrightRenderer } from './evidence/pdf-renderer';
import { NoSealer, PyHankoSealer, SEALER } from './evidence/sealer';
import { FsStorage, OBJECT_STORAGE, S3Storage } from './storage/storage';
import { AnalysisService } from './trainings/analysis.service';
import { TrainingsController } from './trainings/trainings.controller';

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
      controllers: [
        HealthController, AuthController, AuditController, MembersController, DevNotificationsController,
        PersonsController, TrainingsController, RunsController, ParticipantController, ReadingController, QuizController, SignatureController, EvidenceController, ReportsController,
      ],
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
        {
          provide: OBJECT_STORAGE,
          useFactory: () =>
            config.STORAGE_DRIVER === 's3'
              ? new S3Storage(
                  { endpoint: config.S3_ENDPOINT!, region: config.S3_REGION, accessKeyId: config.S3_ACCESS_KEY!, secretAccessKey: config.S3_SECRET_KEY! },
                  { uploads: config.S3_BUCKET_UPLOADS, evidence: config.S3_BUCKET_EVIDENCE },
                )
              : new FsStorage(repoPath(config.STORAGE_DIR)),
        },
        {
          provide: PDF_RENDERER,
          useFactory: () => (config.PDF_RENDERER === 'gotenberg' ? new GotenbergRenderer(config.GOTENBERG_URL) : new PlaywrightRenderer()),
        },
        { provide: SEALER, useFactory: () => (config.SEAL_MODE === 'none' ? new NoSealer() : new PyHankoSealer(config)) },
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
        AnalysisService,
        InvitationService,
        ParticipantService,
        SignedTokens,
        ReadingService,
        RetentionService,
        EvidenceService,
        ...overrides,
      ],
    };
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SessionMiddleware).forRoutes('*path');
  }
}
