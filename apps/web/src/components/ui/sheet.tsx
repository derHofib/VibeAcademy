import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { de } from '@/i18n/de';
import { useMediaQuery, DESKTOP_QUERY } from '@/hooks/useMediaQuery';
import { IconButton } from './icon-button';

export interface SheetProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Element, das das Sheet öffnet (wird per asChild verwendet) */
  trigger?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Aktionen unten (z. B. Primärbutton) */
  footer?: ReactNode;
  children?: ReactNode;
  /** Desktop-Position des schwebenden Panels */
  desktopPlacement?: 'center' | 'right';
  className?: string;
}

/**
 * Mobil: Bottom-Sheet (unten, 10 px Abstand, Radius 30 px).
 * Ab 768 px: schwebendes Panel (Radius 28 px, Schwebe-Schatten).
 * Fokusfalle, Escape und Klick außerhalb schließen – über Radix Dialog.
 */
export function Sheet({
  open,
  defaultOpen,
  onOpenChange,
  trigger,
  title,
  description,
  footer,
  children,
  desktopPlacement = 'center',
  className,
}: SheetProps) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  return (
    <Dialog.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/25 animate-[sn-fade-in_150ms_ease-out]" />
        <Dialog.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(
            'fixed z-50 flex flex-col bg-surface text-ink outline-none',
            isDesktop
              ? desktopPlacement === 'right'
                ? 'top-4 right-4 bottom-4 w-[420px] rounded-card-lg shadow-float animate-[sn-fade-in_180ms_ease-out]'
                : 'top-1/2 left-1/2 max-h-[min(720px,calc(100dvh-48px))] w-[min(480px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 rounded-card-lg shadow-float animate-[sn-pop-in_180ms_ease-out]'
              : 'inset-x-2.5 bottom-2.5 max-h-[85dvh] rounded-sheet shadow-sheet animate-[sn-sheet-up_200ms_ease-out]',
            className,
          )}
          data-variant={isDesktop ? 'panel' : 'sheet'}
        >
          {!isDesktop && (
            <div aria-hidden="true" className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-line" />
          )}
          <div className={cn('flex items-start gap-3 px-5 md:px-6', isDesktop ? 'pt-5' : 'pt-3')}>
            <div className="min-w-0 flex-1 pt-2">
              <Dialog.Title className="font-heading text-[19px] font-bold text-ink">{title}</Dialog.Title>
              {description && (
                <Dialog.Description className="mt-1 text-[13.5px] text-muted">{description}</Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <IconButton aria-label={de.common.close} variant="tonal">
                <X aria-hidden="true" />
              </IconButton>
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-5 md:px-6">{children}</div>
          {footer && <div className="flex flex-col gap-2.5 px-5 pb-5 md:flex-row md:justify-end md:px-6">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Schließt das umgebende Sheet (für Buttons im Footer). */
export const SheetClose = Dialog.Close;
