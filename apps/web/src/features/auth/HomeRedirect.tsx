import { Navigate } from 'react-router';
import { Loading } from '@/features/admin/components/common';
import { adm } from '@/i18n/admin';
import { useMe } from './session';

/** `/`: angemeldet → Verwaltung, sonst Anmeldung. */
export default function HomeRedirect() {
  const me = useMe();
  if (me.isPending) return <Loading label={adm.auth.checking} className="min-h-dvh" />;
  return <Navigate to={me.data ? '/verwaltung' : '/anmelden'} replace />;
}
