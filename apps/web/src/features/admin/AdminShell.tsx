import { FileCheck2, GraduationCap, LayoutDashboard, Settings, ShieldOff, Users } from 'lucide-react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { AdminLayout, type AdminNavItem } from '@/components/layout/AdminLayout';
import { Button, Card, EmptyState } from '@/components/ui';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { activeTenantName, hasRole, STAFF_ROLES, useLogout, type Me } from '@/features/auth/session';
import { adm } from '@/i18n/admin';
import { ta } from '@/i18n/account';

export const ADMIN_NAV: AdminNavItem[] = [
  { to: '/verwaltung', label: adm.nav.dashboard, icon: LayoutDashboard, exact: true },
  { to: '/verwaltung/schulungen', label: adm.nav.trainings, icon: GraduationCap },
  { to: '/verwaltung/personen', label: adm.nav.people, icon: Users },
  { to: '/verwaltung/einstellungen', label: adm.nav.settings, icon: Settings },
  // Eigene Nachweise als Teilnehmer anderer Schulungen (E-25)
  { to: '/konto', label: ta.nav.myEvidence, icon: FileCheck2 },
];

const MY_EVIDENCE_NAV = ADMIN_NAV.filter((i) => i.to === '/konto');

/** Durchführungen und Nachweise gehören fachlich zu „Schulungen“. */
export function navPathFor(pathname: string): string {
  if (pathname.startsWith('/verwaltung/durchfuehrungen') || pathname.startsWith('/verwaltung/nachweise')) {
    return '/verwaltung/schulungen';
  }
  return pathname;
}

function Shell({ me }: { me: Me }) {
  const location = useLocation();
  const navigate = useNavigate();
  const logout = useLogout();
  const onLogout = () =>
    logout.mutate(undefined, { onSettled: () => navigate('/anmelden', { replace: true }) });
  const layout = {
    navItems: ADMIN_NAV,
    userName: me.account.name,
    tenantName: activeTenantName(me),
    onLogout,
    logoutLabel: adm.auth.logout,
    homeHref: '/verwaltung',
    currentPath: navPathFor(location.pathname),
  };

  // Reines Teilnehmerkonto (keine Organisation) → „Meine Nachweise“
  if (me.memberships.length === 0) return <Navigate to="/konto" replace />;

  if (!hasRole(me, ...STAFF_ROLES)) {
    return (
      <AdminLayout {...layout} navItems={MY_EVIDENCE_NAV}>
        <Card className="mx-auto mt-10 max-w-xl">
          <EmptyState
            icon={<ShieldOff />}
            title={adm.auth.noAccessTitle}
            description={adm.auth.noAccessText}
            action={<Button onClick={onLogout}>{adm.auth.logout}</Button>}
          />
        </Card>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout {...layout}>
      <Outlet context={me} />
    </AdminLayout>
  );
}

/** Layout-Route für `/verwaltung/*`: Anmeldung prüfen, Rahmen mit Nutzer/Mandant/Abmelden. */
export default function AdminShell() {
  return <RequireAuth>{(me) => <Shell me={me} />}</RequireAuth>;
}
