import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { cn } from '@/lib/cn';
import { tp } from '@/i18n/participant';

export interface ReaderSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Mobil: Bottom-Sheet über abgedunkeltem Inhalt. Desktop: schwebendes Panel ohne Abdunklung. */
  desktop: boolean;
  /** Desktop-Position: links neben der Kapitel-Leiste oder rechts oben */
  placement?: 'left' | 'right';
  children: ReactNode;
  className?: string;
}

/**
 * Bottom-Sheet (mobil) bzw. schwebendes Panel (Desktop) des Lese-Viewers nach Screens 5d/5e/5i:
 * Titel links, „Schließen“-Pille rechts. Radix Dialog übernimmt Fokusführung und Escape.
 * Desktop ist nicht-modal, damit die Seite daneben sichtbar und bedienbar bleibt.
 */
export function ReaderSheet({ open, onOpenChange, title, description, desktop, placement = 'left', children, className }: ReaderSheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={!desktop}>
      <Dialog.Portal>
        {!desktop && <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/30 animate-[sn-fade-in_150ms_ease-out]" />}
        <Dialog.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          onInteractOutside={(e) => {
            // Klick auf den Dock-Button, der das Panel umschaltet, nicht doppelt behandeln
            const t = e.target as Element | null;
            if (t?.closest?.('[data-viewer-toggle]')) e.preventDefault();
          }}
          className={cn(
            'fixed z-50 flex flex-col bg-surface text-ink outline-none',
            desktop
              ? cn(
                  'top-[92px] max-h-[calc(100dvh-120px)] w-[340px] rounded-card-lg shadow-[0_2px_6px_rgba(29,36,51,0.06),0_24px_56px_rgba(29,36,51,0.18)] animate-[sn-fade-in_150ms_ease-out]',
                  placement === 'left' ? 'left-[136px]' : 'right-7',
                )
              : 'inset-x-2.5 bottom-2.5 max-h-[80dvh] rounded-sheet shadow-sheet animate-[sn-sheet-up_200ms_ease-out]',
            className,
          )}
          data-variant={desktop ? 'panel' : 'sheet'}
        >
          <div className={cn('flex items-center justify-between gap-3', desktop ? 'px-5 pt-[18px] pb-1' : 'px-5 pt-[18px] pb-1')}>
            <Dialog.Title className={cn('font-heading font-bold text-ink', desktop ? 'text-[17px]' : 'text-[18px]')}>{title}</Dialog.Title>
            <Dialog.Close
              className={cn(
                'inline-flex h-11 shrink-0 cursor-pointer items-center rounded-pill bg-accent-soft px-4 font-semibold text-accent-text hover:bg-accent-ring/60',
                desktop ? 'text-[13px]' : 'text-[14px]',
              )}
            >
              {tp.common.close}
            </Dialog.Close>
          </div>
          {description && <Dialog.Description className="px-5 pb-1.5 text-[12.5px] text-muted">{description}</Dialog.Description>}
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
