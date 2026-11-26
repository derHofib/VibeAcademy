import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Loading, ErrorPanel } from '@/features/admin/components/common';
import { adm } from '@/i18n/admin';
import { useMe, type Me } from './session';

/**
 * Schützt Verwaltungsseiten: ohne Anmeldung → `/anmelden?weiter=<aktueller Pfad>`.
 * Die Kinder bekommen das geladene Konto.
 */
export function RequireAuth({ children }: { children: (me: Me) => ReactNode }) {
  const location = useLocation();
  const me = useMe();
  if (me.isPending) {
    return (
      <div className="min-h-dvh bg-bg">
        <Loading label={adm.auth.checking} className="min-h-dvh" />
      </div>
    );
  }
  if (me.isError) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <ErrorPanel error={me.error} onRetry={() => me.refetch()} />
      </div>
    );
  }
  if (!me.data) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/anmelden?weiter=${encodeURIComponent(next)}`} replace />;
  }
  return <>{children(me.data)}</>;
}
