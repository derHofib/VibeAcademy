import type { ReactNode } from 'react';
import { ChevronLeft, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { de } from '@/i18n/de';
import { IconButton } from '@/components/ui/icon-button';

export interface ParticipantLayoutProps {
  children: ReactNode;
  title?: ReactNode;
  /** Kleine Zeile über dem Titel, z. B. „Kapitel 2 von 4“ */
  eyebrow?: ReactNode;
  /** Zurück-Kreis links */
  onBack?: () => void;
  /** Schließen-Kreis links (statt Zurück) */
  onClose?: () => void;
  /** Rechts im Kopf (z. B. Fortschrittsring) */
  headerAside?: ReactNode;
  /** Unten fixierter Aktionsbereich (Primärbutton) */
  footer?: ReactNode;
  /** `narrow`: 480 px (Standard), `wide`: bis 720 px auf Desktop */
  width?: 'narrow' | 'wide';
  className?: string;
}

/** Minimaler Teilnehmer-Rahmen: zentriert, mobile-first, Karten-Fluss auf `bg`. */
export function ParticipantLayout({
  children,
  title,
  eyebrow,
  onBack,
  onClose,
  headerAside,
  footer,
  width = 'narrow',
  className,
}: ParticipantLayoutProps) {
  const hasHeader = title || eyebrow || onBack || onClose || headerAside;
  return (
    <div className="min-h-dvh bg-bg">
      <div
        className={cn(
          'mx-auto flex min-h-dvh w-full flex-col px-4 pt-4 md:px-6 md:pt-8',
          width === 'narrow' ? 'max-w-[480px] md:max-w-[560px]' : 'max-w-[480px] md:max-w-[720px]',
          footer ? 'pb-0' : 'pb-8',
        )}
      >
        {hasHeader && (
          <header className="mb-4 flex items-center gap-3.5">
            {onClose ? (
              <IconButton aria-label={de.common.close} onClick={onClose}>
                <X aria-hidden="true" />
              </IconButton>
            ) : onBack ? (
              <IconButton aria-label={de.common.back} onClick={onBack}>
                <ChevronLeft aria-hidden="true" />
              </IconButton>
            ) : null}
            <div className="min-w-0 flex-1">
              {eyebrow && <p className="truncate text-[13px] text-muted">{eyebrow}</p>}
              {title && <h1 className="font-heading text-[22px] leading-tight font-bold text-ink md:text-[24px]">{title}</h1>}
            </div>
            {headerAside}
          </header>
        )}
        <main className={cn('flex flex-1 flex-col gap-3.5', className)}>{children}</main>
        {footer && (
          <div className="sticky bottom-0 mt-6 flex flex-col gap-2.5 bg-bg pt-3 pb-[max(16px,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
