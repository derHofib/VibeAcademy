/** API-Anbindung „Meine Nachweise“ (apps/api/src/account/my-account.controller.ts, auth/register-account). */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { del, get, post } from '@/lib/api';
import { meKey } from '@/features/auth/session';
import type { LinkCandidate, MyEvidence } from './model';

export const accountKeys = {
  all: ['konto'] as const,
  evidence: ['konto', 'nachweise'] as const,
  candidates: ['konto', 'verknuepfung'] as const,
};

export const evidencePdfUrl = (invitationId: string) => `/api/me/invitations/${invitationId}/evidence/pdf`;

export function useMyEvidence() {
  return useQuery({
    queryKey: accountKeys.evidence,
    queryFn: () => get<MyEvidence[]>('/me/evidence'),
    // Solange ein Nachweis noch versiegelt wird, alle 4 s nachsehen
    refetchInterval: (q) => (q.state.data?.some((e) => e.status === 'bestaetigt' && e.evidence_status === 'ausstehend') ? 4000 : false),
  });
}

/** Personen mit derselben bestätigten E-Mail-Adresse (nur nach Bestätigung abfragen). */
export function useLinkCandidates(enabled: boolean) {
  return useQuery({
    queryKey: accountKeys.candidates,
    queryFn: () => get<LinkCandidate[]>('/me/link-candidates'),
    enabled,
  });
}

export function useRequestEmailCode() {
  return useMutation({ mutationFn: () => post<{ sent: boolean }>('/auth/email/verify-request') });
}

export function useVerifyEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => post<{ verified: boolean }>('/auth/email/verify', { code }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: meKey });
      await qc.invalidateQueries({ queryKey: accountKeys.candidates });
    },
  });
}

export function useLinkPersons() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (personIds: string[]) => post<{ linked: number }>('/me/link', { personIds }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: accountKeys.candidates }),
        qc.invalidateQueries({ queryKey: accountKeys.evidence }),
      ]);
    },
  });
}

/**
 * Konto löschen. Den Sitzungs-Cache räumt erst die Bestätigungsseite ab (`clearAccountSession`) –
 * sonst leitet `RequireAuth` auf `/konto` schon vorher zur Anmeldung um.
 */
export function useDeleteAccount() {
  return useMutation({ mutationFn: () => del<{ deleted: boolean }>('/me/account') });
}

/** Nach Löschen/Abmelden: zwischengespeicherte Konto-, Verwaltungs- und Teilnahmedaten verwerfen. */
export function clearAccountSession(qc: QueryClient) {
  qc.setQueryData(meKey, null);
  qc.removeQueries({ queryKey: accountKeys.all });
  qc.removeQueries({ queryKey: ['admin'] });
  qc.removeQueries({ queryKey: ['teilnahme'] });
}

/** Teilnehmerkonto ohne Organisation (E-25). Aus einer Einladungslink-Sitzung heraus wird die Person direkt verknüpft. */
export function useRegisterAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { name: string; email: string; password: string }) => post('/auth/register-account', v),
    onSuccess: async () => {
      qc.removeQueries({ queryKey: ['admin'] });
      qc.removeQueries({ queryKey: accountKeys.all });
      qc.removeQueries({ queryKey: ['teilnahme'] });
      await qc.invalidateQueries({ queryKey: meKey });
    },
  });
}
