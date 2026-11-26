import { RequestMethod, type Provider } from '@nestjs/common';
import type { AppConfig } from '../config';
import { APP_CONFIG } from '../config';
import { WebhookDispatcher } from '../webhooks/webhook-dispatcher';
import { WEBHOOK_OPTIONS, webhookOptionsFrom } from '../webhooks/webhook-options';
import { WebhookService } from '../webhooks/webhook.service';
import { WebhooksController } from '../webhooks/webhooks.controller';
import { ApiContextMiddleware, ApiKeyGuard } from './api-key.guard';
import { ApiKeyService } from './api-key.service';
import { ApiKeysController } from './api-keys.controller';
import { V1ComplianceController } from './v1-compliance.controller';
import { V1EvidenceController } from './v1-evidence.controller';
import { V1ExternalController } from './v1-external.controller';
import { V1MetaController } from './v1-meta.controller';
import { V1PersonsController } from './v1-persons.controller';
import { V1RunsController } from './v1-runs.controller';
import { V1TrainingsController } from './v1-trainings.controller';
import { V1WebhooksController } from './v1-webhooks.controller';

/** Paket B (E-37): Controller und Provider für AppModule. */
export const PUBLIC_API_CONTROLLERS = [
  ApiKeysController, WebhooksController,
  V1MetaController, V1PersonsController, V1TrainingsController, V1RunsController, V1EvidenceController, V1ExternalController,
  V1ComplianceController, V1WebhooksController,
];

export const PUBLIC_API_PROVIDERS: Provider[] = [
  { provide: WEBHOOK_OPTIONS, inject: [APP_CONFIG], useFactory: (config: AppConfig) => webhookOptionsFrom(config) },
  ApiKeyService, ApiKeyGuard, ApiContextMiddleware, WebhookService, WebhookDispatcher,
];

/** /api/v1: eigene Middleware statt Sitzung + CSRF (Authentifizierung nur per API-Schlüssel). */
export const PUBLIC_API_ROUTES = { path: 'v1/{*path}', method: RequestMethod.ALL };
export { ApiContextMiddleware };
