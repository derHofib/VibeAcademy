import { Link, useParams, useSearchParams } from 'react-router';
import { Button } from '@/components/ui';
import { ErrorPanel, Loading } from '@/features/admin/components/common';
import { RequireOrganizer } from '@/features/live/organizer/RequireOrganizer';
import { tl } from '@/i18n/live';
import { livePath } from '@/features/live/api';
import { useOrganizerLive } from '@/features/live/organizer/useOrganizerLive';
import { LiveOrganizerView } from '@/features/live/organizer/LiveOrganizerView';
import { PresenceOrganizerView } from '@/features/presence/PresenceOrganizerView';

function OrganizerLive() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const live = useOrganizerLive(id);
  if (live.isError)
    return (
      <div className="min-h-dvh bg-bg p-6">
        <div className="mx-auto max-w-xl">
          <ErrorPanel error={live.error} onRetry={() => live.refetch()} />
          <Button asChild variant="ghost" className="mt-4">
            <Link to={livePath.list}>{tl.org.backToList}</Link>
          </Button>
        </div>
      </div>
    );
  if (!live.data) return <Loading className="min-h-dvh" />;
  const tab = params.get('reiter');
  return live.data.run.typ === 'termin' ? (
    <PresenceOrganizerView snapshot={live.data} mode={live.mode} />
  ) : (
    <LiveOrganizerView
      snapshot={live.data}
      mode={live.mode}
      initialTab={tab === 'fragen' || tab === 'kontrollfragen' ? tab : 'anwesenheit'}
    />
  );
}

/** `/verwaltung/termine/:id` – Live-Ansicht (12a–12f) bzw. Präsenz-Trainer-Ansicht (Screen 7). */
export default function OrganizerLivePage() {
  return (
    <RequireOrganizer>
      <OrganizerLive />
    </RequireOrganizer>
  );
}
