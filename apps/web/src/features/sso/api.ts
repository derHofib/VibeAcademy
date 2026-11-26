import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { del, get, post, put } from '@/lib/api';
import { emailDomain } from './model';

export interface ScimToken {
  id: string;
  prefix: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface SsoSettings {
  enabled: boolean;
  slug: string | null;
  issuer: string;
  clientId: string;
  hasClientSecret: boolean;
  scopes: string;
  emailDomains: string[];
  ssoOnly: boolean;
  emergencyAdminAccountId: string | null;
  jitEnabled: boolean;
  defaultRoles: string[];
  updatedAt: string | null;
  redirectUri: string;
  loginUrl: string;
  scimBaseUrl: string;
  scimTokens: ScimToken[];
}

export interface SsoTestResult {
  ok: boolean;
  issuer?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  jwksUri?: string;
  warnings?: string[];
  error?: string;
}

export interface StepUpOptions {
  sso: boolean;
  required: boolean;
  startUrl: string | null;
}

export const ssoKeys = {
  settings: ['admin', 'sso'] as const,
  stepUp: (invitationId: string) => ['participant', 'sso-step-up', invitationId] as const,
};

export function useSsoSettings(enabled = true) {
  return useQuery({ queryKey: ssoKeys.settings, queryFn: () => get<SsoSettings>('/tenant/sso'), enabled });
}

export function useSaveSso() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: object) => put<SsoSettings>('/tenant/sso', body),
    onSuccess: (data) => qc.setQueryData(ssoKeys.settings, data),
  });
}

export function useTestSso() {
  return useMutation({ mutationFn: (issuer?: string) => post<SsoTestResult>('/tenant/sso/test', issuer ? { issuer } : {}) });
}

export function useCreateScimToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (label: string) => post<{ id: string; token: string; prefix: string; scimBaseUrl: string }>('/tenant/sso/scim-tokens', { label }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ssoKeys.settings }),
  });
}

export function useRevokeScimToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/tenant/sso/scim-tokens/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ssoKeys.settings }),
  });
}

/** Step-up per Firmenkonto möglich/verlangt? (Unterschriftsseite) */
export function useStepUpOptions(invitationId: string) {
  return useQuery({
    queryKey: ssoKeys.stepUp(invitationId),
    queryFn: () => get<StepUpOptions>(`/auth/sso/step-up/options?invitationId=${encodeURIComponent(invitationId)}`),
    staleTime: 60_000,
    retry: false,
  });
}

export interface SsoDiscovery {
  sso: boolean;
  tenantName?: string;
  ssoOnly?: boolean;
  startUrl?: string;
}

/**
 * Erkennt beim Tippen der E-Mail-Adresse, ob die Domain eine Firmenanmeldung hat (entprellt, je Domain einmal).
 * Bewusst ohne React Query, damit die Anmeldeseite auch ohne Provider (Tests, Galerie) funktioniert.
 */
export function useSsoDiscovery(email: string, delayMs = 350): { domain: string | null; result: SsoDiscovery | null; loading: boolean } {
  const domain = emailDomain(email);
  const [state, setState] = useState<{ domain: string; result: SsoDiscovery } | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!domain || state?.domain === domain) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setLoading(true);
      fetch(`/api/auth/sso/discover?email=${encodeURIComponent(email.trim())}`, { credentials: 'same-origin' })
        .then((r) => (r.ok ? (r.json() as Promise<SsoDiscovery>) : { sso: false }))
        .catch(() => ({ sso: false }))
        .then((result) => {
          if (!cancelled) setState({ domain, result });
        })
        .finally(() => !cancelled && setLoading(false));
    }, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // Die Adresse zählt nur über ihre Domain (state bewusst nicht als Abhängigkeit: je Domain eine Abfrage).
  }, [domain, delayMs]);
  return { domain, result: state && state.domain === domain ? state.result : null, loading };
}
