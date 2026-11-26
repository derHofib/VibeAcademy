import { useState, type ComponentType, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import {
  CalendarDays,
  FileCheck2,
  GraduationCap,
  Grid3x3,
  LayoutDashboard,
  LogOut,
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
  /** Nur bei exakt gleicher URL aktiv (z. B. Dashboard unter `/verwaltung`) */
  exact?: boolean;
}

export function adminNavItems(externalCount?: number): AdminNavItem[] {
  return [
    { to: '/', label: de.nav.dashboard, icon: LayoutDashboard },
    { to: '/schulungen', label: de.nav.trainings, icon: GraduationCap },
    { to: '/termine', label: de.nav.appointments, icon: CalendarDays },
    { to: '/externe-nachweise', label: de.nav.externalRecords, icon: FileCheck2, count: externalCount },
    { to: '/pflichtmatrix', label: de.nav.matrix, icon: Grid3x3 },
    { to: '/personen', label: de.nav.people, icon: Users },
  ];
}

function isActive(itemPath: string, currentPath: string, exact = false) {
  if (itemPath === '/' || exact) return currentPath === itemPath;
  return currentPath === itemPath || currentPath.startsWith(`${itemPath}/`);
}

function Brand({ className, to = '/' }: { className?: string; to?: string }) {
  return (
    <Link to={to} className={cn('inline-flex items-center gap-2.5 rounded-pill', className)}>
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
        const active = isActive(item.to, currentPath, item.exact);
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

function TenantBox({
  tenantName,
  userName,
  onLogout,
  logoutLabel,
  settingsHref,
  settingsActive,
  onNavigate,
}: {
  tenantName?: string;
  userName?: string;
  onLogout?: () => void;
  logoutLabel?: string;
  settingsHref?: string;
  settingsActive?: boolean;
  onNavigate?: () => void;
}) {
  if (!tenantName && !userName) return null;
  const who = (
    <>
      {userName && <Avatar name={userName} size="lg" tone="surface" />}
      <div className="min-w-0 flex-1">
        {userName && <p className="truncate text-[14px] font-semibold text-ink">{userName}</p>}
        {tenantName && (
          <p className="truncate text-[12.5px] text-muted">
            <span className="sr-only">{de.app.tenantLabel}: </span>
            {tenantName}
          </p>
        )}
      </div>
    </>
  );
  return (
    <div
      className={cn(
        'flex items-center gap-1 rounded-box py-1.5 pr-1.5 pl-1.5 transition-colors',
        settingsActive ? 'bg-accent-soft' : 'bg-bg',
        settingsHref && !settingsActive && 'has-[a:hover]:bg-line/60',
      )}
    >
      {settingsHref ? (
        <Link
          to={settingsHref}
          onClick={onNavigate}
          aria-current={settingsActive ? 'page' : undefined}
          title={de.nav.settings}
          className="group flex min-w-0 flex-1 items-center gap-3 rounded-box py-1.5 pr-2 pl-1.5 focus-visible:outline-2 focus-visible:outline-accent"
        >
          {who}
          <Settings
            className={cn(
              'size-[17px] shrink-0 transition-colors',
              settingsActive ? 'text-accent-text-strong' : 'text-muted group-hover:text-ink',
            )}
            aria-hidden="true"
          />
          <span className="sr-only">, {de.nav.settings}</span>
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 py-1.5 pr-2 pl-1.5">{who}</div>
      )}
      {onLogout && (
        <IconButton aria-label={logoutLabel ?? 'Abmelden'} variant="ghost" onClick={onLogout}>
          <LogOut aria-hidden="true" />
        </IconButton>
      )}
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
  /** Eigene Menüpunkte (Standard: `adminNavItems`) */
  navItems?: AdminNavItem[];
  /** Zeigt „Abmelden“ in der Nutzerbox */
  onLogout?: () => void;
  logoutLabel?: string;
  /** Ziel des Logos (Standard „/“) */
  homeHref?: string;
  /** Klick auf die Konto-Karte unten öffnet die Einstellungen (ohne: Karte nicht klickbar) */
  settingsHref?: string;
}

/**
 * Verwaltungsrahmen im weichen Stil: Desktop mit schwebender weißer Navigation links,
 * mobil/Tablet kompakte Kopfzeile mit Menü als Bottom-Sheet. Keine dunkle Seitenleiste (E-20).
 */
export function AdminLayout({
  children,
  externalCount,
  tenantName,
  userName,
  currentPath,
  navItems,
  onLogout,
  logoutLabel,
  homeHref,
  settingsHref,
}: AdminLayoutProps) {
  const location = useLocation();
  const path = currentPath ?? location.pathname;
  const items = navItems ?? adminNavItems(externalCount);
  const settingsActive = settingsHref ? isActive(settingsHref, path) : false;
  const box = { tenantName, userName, onLogout, logoutLabel, settingsHref, settingsActive };
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
        <Brand className="px-1.5 pt-1 pb-5" to={homeHref} />
        <nav aria-label={de.nav.label} className="min-h-0 flex-1 overflow-y-auto">
          <NavList items={items} currentPath={path} />
        </nav>
        <TenantBox {...box} />
      </aside>

      {/* Mobil/Tablet: Kopfzeile + Menü-Sheet */}
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 bg-bg/90 px-4 py-3 backdrop-blur-md md:px-7 lg:hidden">
        <Brand to={homeHref} />
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
            <TenantBox {...box} onNavigate={() => setMenuOpen(false)} />
          </div>
        </Sheet>
      </header>

      <main id="inhalt" tabIndex={-1} className="outline-none lg:pl-[296px]">
        <div className="mx-auto w-full max-w-[1400px] px-4 pt-2 pb-10 md:px-7 lg:pt-7">{children}</div>
      </main>
    </div>
  );
}
