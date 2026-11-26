import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Leerer Zustand: Icon im weichen Kreis, Titel, Erklärung, optionale Aktion. */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-10 text-center', className)}>
      {icon && (
        <div
          aria-hidden="true"
          className="mb-1 flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent-text [&_svg]:size-6"
        >
          {icon}
        </div>
      )}
      <h3 className="font-heading text-[17px] font-bold text-ink">{title}</h3>
      {description && <p className="max-w-sm text-[14px] leading-[1.55] text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
