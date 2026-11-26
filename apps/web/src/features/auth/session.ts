/** Sitzung des angemeldeten Kontos (Dozent/Verwaltung): `/api/auth/me` + An-/Abmelden. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, get, post } from '@/lib/api';

export interface Me {
  account: { id: string; email: string; name: string; emailVerified: boolean; hasPassword?: boolean };
  activeTenantId: string | null;
  roles: string[];
  memberships: Array<{ tenantId: string; tenantName: string; roles: string[] }>;
}

export const meKey = ['auth', 'me'] as const;

/** null = nicht angemeldet (401/403), sonst das Konto. */
export async function fetchMe(): Promise<Me | null> {
  try {
    return await get<Me>('/auth/me');
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null;
    throw e;
  }
}

export function useMe() {
  return useQuery({ queryKey: meKey, queryFn: fetchMe, staleTime: 60_000, retry: false });
}

export function activeTenantName(me: Me | null | undefined): string | undefined {
  if (!me) return undefined;
  return me.memberships.find((m) => m.tenantId === me.activeTenantId)?.tenantName;
}

/** Rollen mit Zugang zur Verwaltung. */
export const STAFF_ROLES = ['admin', 'verantwortlich', 'trainer', 'auditor', 'vorgesetzter'];
export const hasRole = (me: Me | null | undefined, ...roles: string[]) =>
  !!me && me.roles.some((r) => roles.includes(r));
export const canManage = (me: Me | null | undefined) => hasRole(me, 'admin', 'verantwortlich');

/** Feldfehler der API ({path, message}) als Map. */
export function fieldErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError)) return {};
  const out: Record<string, string> = {};
  for (const f of e.fields) if (f.path && !out[f.path]) out[f.path] = f.message;
  return out;
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { email: string; password: string }) => post('/auth/login', v),
    onSuccess: async () => {
      qc.removeQueries({ queryKey: ['admin'] });
      await qc.invalidateQueries({ queryKey: meKey });
    },
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { name: string; organisation: string; email: string; password: string }) =>
      post('/auth/register', v),
    onSuccess: async () => {
      qc.removeQueries({ queryKey: ['admin'] });
      await qc.invalidateQueries({ queryKey: meKey });
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post('/auth/logout'),
    onSettled: () => {
      qc.setQueryData(meKey, null);
      qc.removeQueries({ queryKey: ['admin'] });
    },
  });
}

export function useSwitchTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tenantId: string) => post('/auth/tenant', { tenantId }),
    onSuccess: async () => {
      qc.removeQueries({ queryKey: ['admin'] });
      await qc.invalidateQueries({ queryKey: meKey });
    },
  });
}

/** Nur relative, interne Ziele erlauben (kein offener Redirect). */
export function safeNext(raw: string | null | undefined, fallback = '/verwaltung'): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  return raw;
}
