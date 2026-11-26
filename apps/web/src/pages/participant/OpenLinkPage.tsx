import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Link2Off } from 'lucide-react';
import { ApiError, post } from '@/lib/api';
import { ParticipantLayout } from '@/components/layout/ParticipantLayout';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { tp } from '@/i18n/participant';
import { participantPath } from '@/features/participant/api';
import { LoadingScreen } from '@/features/participant/ScreenStates';
import { invitationKind, isLiveTyp, livePath } from '@/features/live/api';

/** Persönlicher Einladungslink `/s/:token` → Sitzung für diese Einladung → Startbildschirm. */
export default function OpenLinkPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  const opened = useRef(false);

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    (async () => {
      try {
        const { invitationId } = await post<{ invitationId: string }>('/participant/session', { token });
        // Frische Sitzung: zwischengespeicherte Daten einer früheren Einladung verwerfen
        qc.removeQueries({ queryKey: ['teilnahme'] });
        // Präsenz-/Live-Termine haben keinen Lese-Start → direkt zur Live-Ansicht
        const kind = await invitationKind(invitationId).catch(() => null);
        navigate(isLiveTyp(kind?.typ) ? livePath.participant(invitationId) : participantPath.start(invitationId), { replace: true });
      } catch (e) {
        const status = e instanceof ApiError ? e.status : 0;
        setError({
          title: status === 410 ? tp.link.expiredTitle : tp.link.invalidTitle,
          message: e instanceof ApiError ? e.message : tp.link.hint,
        });
      }
    })();
  }, [token, navigate, qc]);

  if (!error) return <LoadingScreen label={tp.link.opening} />;
  return (
    <ParticipantLayout className="justify-center">
      <Card>
        <EmptyState
          icon={<Link2Off />}
          title={<span role="alert">{error.title}</span>}
          description={error.message}
        />
      </Card>
    </ParticipantLayout>
  );
}
