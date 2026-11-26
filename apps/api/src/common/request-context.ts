import { AsyncLocalStorage } from 'node:async_hooks';
import type { Role } from '@sn/shared';

export interface AccountSession {
  kind: 'account';
  accountId: string;
  /** aktiver Mandant (optional: Teilnehmerkonten ohne Mitgliedschaft) */
  tenantId: string | null;
  createdAt: number;
}
/** Sitzung über den persönlichen Einladungslink (Teilnehmer ohne Konto), auf genau eine Einladung beschränkt. */
export interface InvitationSession {
  kind: 'invitation';
  accountId?: undefined;
  tenantId: string;
  personId: string;
  invitationId: string;
  createdAt: number;
}
export type SessionData = AccountSession | InvitationSession;

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
