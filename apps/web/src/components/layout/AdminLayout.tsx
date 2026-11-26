import { useState, type ComponentType, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import {
  CalendarDays,
  FileCheck2,
  GraduationCap,
  Grid3x3,
  LayoutDashboard,
  Menu,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { de } from '@/i18n/de';
import { Avatar } from '@/components/ui/avatar';
import { IconButton } from '@/components/ui/icon-button';
import { Sheet } from '@/components/ui/sheet';

export interface AdminNavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>;
  count?: number;
}

export function adminNavItems(externalCount?: number): AdminNavItem[] {
  return [
    { to: '/', label: de.nav.dashboard, icon: LayoutDashboard },
    { to: '/schulungen', label: de.nav.trainings, icon: GraduationCap },
    { to: '/termine', label: de.nav.appointments, icon: CalendarDays },
    { to: '/externe-nachweise', label: de.nav.externalRecords, icon: FileCheck2, count: externalCount },
    { to: '/pflichtmatrix', label: de.nav.matrix, icon: Grid3x3 },
    { to: '/personen', label: de.nav.people, icon: Users },
    { to: '/einstellungen', label: de.nav.settings, icon: Settings },
  ];
}

function isActive(itemPath: string, currentPath: string) {
  if (itemPath === '/') return currentPath === '/';
  return currentPath === itemPath || currentPath.startsWith(`${itemPath}/`);
}

function Brand({ className }: { className?: string }) {
  return (
    <Link to="/" className={cn('inline-flex items-center gap-2.5 rounded-pill', className)}>
      <span
        aria-hidden="true"
        className="flex size-9 items-center justify-center rounded-full bg-accent text-white shadow-primary"
      >
        <ShieldCheck className="size-[18px]" strokeWidth={2.25} />
      </span>
      <span className="font-heading text-[16.5px] font-bold tracking-[-0.01em] text-ink">{de.app.name}</span>
    </Link>
  );
}

function NavList({
  items,
  currentPath,
  onNavigate,
}: {
  items: AdminNavItem[];
  currentPath: string;
  onNavigate?: () => void;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => {
        const active = isActive(item.to, currentPath);
        const Icon = item.icon;
        return (
          <li key={item.to}>
            <Link
              to={item.to}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex h-11 items-center gap-3 rounded-pill px-3.5 text-[14px] font-medium transition-colors',
                active
                  ? 'bg-accent-soft font-semibold text-accent-text-strong'
                  : 'text-ink-2 hover:bg-bg hover:text-ink',
              )}
            >
              <Icon className="size-[18px] shrink-0" aria-hidden="true" />
              <span className="flex-1 truncate">{item.label}</span>
              {item.count !== undefined && item.count > 0 && (
                <>
                  <span
                    aria-hidden="true"
                    className="rounded-pill bg-warn-soft px-2 py-0.5 text-[12px] font-bold text-warn-text tabular-nums"
                  >
                    {item.count}
                  </span>
                  <span className="sr-only">, {de.nav.openCount(item.count)}</span>
                </>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function TenantBox({ tenantName, userName }: { tenantName?: string; userName?: string }) {
  if (!tenantName && !userName) return null;
  return (
    <div className="flex items-center gap-3 rounded-box bg-bg px-3 py-3">
      {userName && <Avatar name={userName} size="lg" tone="surface" />}
      <div className="min-w-0">
        {userName && <p className="truncate text-[14px] font-semibold text-ink">{userName}</p>}
        {tenantName && (
          <p className="truncate text-[12.5px] text-muted">
            <span className="sr-only">{de.app.tenantLabel}: </span>
            {tenantName}
          </p>
        )}
      </div>
    </div>
  );
}

export interface AdminLayoutProps {
  children: ReactNode;
  /** Zähler am Menüpunkt „Externe Nachweise“ */
  externalCount?: number;
  tenantName?: string;
  userName?: string;
  /** Überschreibt den aktiven Menüpunkt (sonst aus der URL) */
  currentPath?: string;
}

/**
 * Verwaltungsrahmen im weichen Stil: Desktop mit schwebender weißer Navigation links,
 * mobil/Tablet kompakte Kopfzeile mit Menü als Bottom-Sheet. Keine dunkle Seitenleiste (E-20).
 */
export function AdminLayout({ children, externalCount, tenantName, userName, currentPath }: AdminLayoutProps) {
  const location = useLocation();
  const path = currentPath ?? location.pathname;
  const items = adminNavItems(externalCount);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-bg">
      <a
        href="#inhalt"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-pill focus:bg-surface focus:px-4 focus:py-2.5 focus:shadow-float"
      >
        {de.app.skipToContent}
      </a>

      {/* Desktop: schwebende Navigation */}
      <aside className="fixed inset-y-4 left-4 z-20 hidden w-[264px] flex-col rounded-card-lg bg-surface p-4 shadow-card lg:flex">
        <Brand className="px-1.5 pt-1 pb-5" />
        <nav aria-label={de.nav.label} className="min-h-0 flex-1 overflow-y-auto">
          <NavList items={items} currentPath={path} />
        </nav>
        <TenantBox tenantName={tenantName} userName={userName} />
      </aside>

      {/* Mobil/Tablet: Kopfzeile + Menü-Sheet */}
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 bg-bg/90 px-4 py-3 backdrop-blur-md md:px-7 lg:hidden">
        <Brand />
        <Sheet
          open={menuOpen}
          onOpenChange={setMenuOpen}
          title={de.common.menu}
          desktopPlacement="right"
          trigger={
            <IconButton aria-label={de.common.openMenu} variant="surface">
              <Menu aria-hidden="true" />
            </IconButton>
          }
        >
          <nav aria-label={de.nav.label}>
            <NavList items={items} currentPath={path} onNavigate={() => setMenuOpen(false)} />
          </nav>
          <div className="mt-4">
            <TenantBox tenantName={tenantName} userName={userName} />
          </div>
        </Sheet>
      </header>

      <main id="inhalt" tabIndex={-1} className="outline-none lg:pl-[296px]">
        <div className="mx-auto w-full max-w-[1400px] px-4 pt-2 pb-10 md:px-7 lg:pt-7">{children}</div>
      </main>
    </div>
  );
}
