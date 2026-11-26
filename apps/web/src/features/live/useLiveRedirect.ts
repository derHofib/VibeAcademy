import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';
import { invitationKind, isLiveTyp, liveKeys, livePath } from './api';

/**
 * Präsenz-/Live-Einladungen haben keinen Lese-Startbildschirm (`GET /me/invitations/:id` → 404). Ist die Einladung
 * ein Termin, liefert der Hook das Ziel `/teilnahme/:id/live`. Nur aktiv, wenn `error` ein 404 ist.
 */
export function useLiveInvitationRedirect(invitationId: string, error: unknown) {
  const enabled = error instanceof ApiError && error.status === 404;
  const q = useQuery({
    queryKey: [...liveKeys.myInvitations, invitationId],
    queryFn: () => invitationKind(invitationId),
    enabled,
    retry: false,
  });
  return {
    checking: enabled && q.isPending,
    target: enabled && isLiveTyp(q.data?.typ) ? livePath.participant(invitationId) : null,
  };
}
