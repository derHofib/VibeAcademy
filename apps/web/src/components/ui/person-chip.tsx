import type { HTMLAttributes } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { de } from '@/i18n/de';
import { Avatar } from './avatar';

export interface PersonChipProps extends HTMLAttributes<HTMLSpanElement> {
  name: string;
  /** Ohne Callback kein ×-Button. */
  onRemove?: () => void;
  removeLabel?: string;
}

/** Initialen-Kreis + Name + ×. */
export function PersonChip({ name, onRemove, removeLabel, className, ...props }: PersonChipProps) {
  return (
    <span
      className={cn(
        'inline-flex h-11 max-w-full items-center gap-2 rounded-pill bg-accent-soft pl-1.5 text-[14px] font-medium text-accent-text-strong',
        onRemove ? 'pr-1' : 'pr-4',
        className,
      )}
      {...props}
    >
      <Avatar name={name} tone="surface" size="md" />
      <span className="truncate">{name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel ?? de.common.removeNamed(name)}
          // 36 px sichtbar, Trefferfläche per ::after auf 44 px erweitert
          className="relative inline-flex size-9 shrink-0 after:absolute after:-inset-1 after:rounded-full cursor-pointer items-center justify-center rounded-full text-accent-text-strong transition-colors hover:bg-surface/70"
        >
          <X className="size-4" strokeWidth={2.25} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}
