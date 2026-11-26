import { Navigate } from 'react-router';
import { Loading } from '@/features/admin/components/common';
import { adm } from '@/i18n/admin';
import { homePathFor } from '@/features/account/model';
import { useMe } from './session';

/** `/`: angemeldet → Verwaltung bzw. (reines Teilnehmerkonto) „Meine Nachweise“, sonst Anmeldung. */
export default function HomeRedirect() {
  const me = useMe();
  if (me.isPending) return <Loading label={adm.auth.checking} className="min-h-dvh" />;
  return <Navigate to={me.data ? homePathFor(me.data) : '/anmelden'} replace />;
}
