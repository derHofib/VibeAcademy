import { useParams } from 'react-router';
import { ErrorPanel, Loading } from '@/features/admin/components/common';
import { RequireOrganizer } from '@/features/live/organizer/RequireOrganizer';
import { useOrganizerLive } from '@/features/live/organizer/useOrganizerLive';
import { KioskView } from '@/features/presence/KioskView';

function Kiosk() {
  const { id = '' } = useParams();
  const live = useOrganizerLive(id);
  if (live.isError)
    return (
      <div className="mx-auto max-w-xl p-6">
        <ErrorPanel error={live.error} onRetry={() => live.refetch()} />
      </div>
    );
  if (!live.data) return <Loading className="min-h-dvh" />;
  return <KioskView snapshot={live.data} />;
}

/** `/verwaltung/termine/:id/kiosk` – Tablet-Modus (Check-in ohne Smartphone, Unterschrift zur Bestätigung). */
export default function KioskPage() {
  return (
    <RequireOrganizer>
      <Kiosk />
    </RequireOrganizer>
  );
}
