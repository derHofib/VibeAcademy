import { get, patch, post, del } from '@/lib/api';

export interface IntegrationsMeta {
  scopes: Array<{ id: string; description: string }>;
  events: Array<{ id: string; description: string }>;
  openapiUrl: string;
  baseUrl: string;
  maxActiveKeys: number;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  preview: string;
  scopes: string[];
  createdAt: string;
  createdByName: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  status: 'aktiv' | 'abgelaufen' | 'widerrufen';
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  active: boolean;
  failureCount: number;
  disabledAt: string | null;
  disabledReason: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDelivery {
  id: string;
  eventId: string;
  eventType: string;
  status: 'pending' | 'sending' | 'succeeded' | 'failed';
  attempts: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  responseCode: number | null;
  lastError: string | null;
  durationMs: number | null;
  deliveredAt: string | null;
  redeliveryOf: string | null;
  createdAt: string;
  data: Record<string, unknown>;
}

export const iqk = {
  meta: ['integrations', 'meta'] as const,
  keys: ['integrations', 'api-keys'] as const,
  webhooks: ['integrations', 'webhooks'] as const,
  deliveries: (id: string) => ['integrations', 'webhooks', id, 'deliveries'] as const,
};

export const integrationsApi = {
  meta: () => get<IntegrationsMeta>('/integrations/meta'),
  keys: () => get<ApiKey[]>('/integrations/api-keys'),
  createKey: (b: { name: string; scopes: string[]; expiresAt: string | null }) => post<{ apiKey: ApiKey; key: string }>('/integrations/api-keys', b),
  revokeKey: (id: string) => post<ApiKey>(`/integrations/api-keys/${id}/revoke`),
  webhooks: () => get<WebhookEndpoint[]>('/integrations/webhooks'),
  createWebhook: (b: { url: string; description: string | null; events: string[] }) =>
    post<{ endpoint: WebhookEndpoint; secret: string }>('/integrations/webhooks', b),
  updateWebhook: (id: string, b: Partial<Pick<WebhookEndpoint, 'url' | 'description' | 'events' | 'active'>>) =>
    patch<WebhookEndpoint>(`/integrations/webhooks/${id}`, b),
  deleteWebhook: (id: string) => del(`/integrations/webhooks/${id}`),
  rotateSecret: (id: string) => post<{ secret: string }>(`/integrations/webhooks/${id}/rotate-secret`),
  ping: (id: string) => post<{ eventId: string; deliveryId: string }>(`/integrations/webhooks/${id}/ping`),
  deliveries: (id: string) => get<{ data: WebhookDelivery[]; nextCursor: string | null }>(`/integrations/webhooks/${id}/deliveries?limit=30`),
  redeliver: (id: string, deliveryId: string) => post<WebhookDelivery>(`/integrations/webhooks/${id}/deliveries/${deliveryId}/redeliver`),
};
