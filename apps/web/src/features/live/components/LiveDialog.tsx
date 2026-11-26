import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { cn } from '@/lib/cn';

/**
 * Zentrierter Bestätigungsdialog wie in 12c (weiße Karte, Radius 30 px, zwei Pillen-Buttons).
 * Fokusfalle, Escape und Klick außerhalb über Radix Dialog.
 */
export function LiveDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  actions,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  actions: ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/30 animate-[sn-fade-in_150ms_ease-out]" />
        <Dialog.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[min(520px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto',
            'rounded-sheet bg-surface p-6 text-ink shadow-float outline-none animate-[sn-pop-in_180ms_ease-out] md:p-7',
            className,
          )}
        >
          <Dialog.Title className="font-heading text-[21px] leading-tight font-bold md:text-[22px]">{title}</Dialog.Title>
          {description && (
            <Dialog.Description className="text-[15px] leading-[1.6] text-ink-2">{description}</Dialog.Description>
          )}
          {children}
          <div className="mt-1 flex flex-col-reverse gap-2.5 sm:flex-row [&>*]:sm:flex-1">{actions}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const LiveDialogClose = Dialog.Close;
