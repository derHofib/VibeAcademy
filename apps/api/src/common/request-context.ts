import { AsyncLocalStorage } from 'node:async_hooks';
import type { Role } from '@sn/shared';

export interface SessionData {
  kind: 'account';
  accountId: string;
  /** aktiver Mandant (optional: Teilnehmerkonten ohne Mitgliedschaft) */
  tenantId: string | null;
  createdAt: number;
}

export interface RequestState {
  sessionId: string | null;
  session: SessionData | null;
  /** Rollen im aktiven Mandanten, je Request frisch aus der Datenbank */
  roles: Role[];
  ipHash: string;
  userAgent: string;
}

export const requestStore = new AsyncLocalStorage<RequestState>();

export function currentRequest(): RequestState | undefined {
  return requestStore.getStore();
}
