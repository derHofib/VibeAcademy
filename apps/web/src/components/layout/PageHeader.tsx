import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/cn';
import { de } from '@/i18n/de';
import { IconButton } from '@/components/ui/icon-button';

export interface PageHeaderProps {
  title: ReactNode;
  /** Kleine Zeile über dem Titel (Bereich, Breadcrumb, Metadaten) */
  eyebrow?: ReactNode;
  description?: ReactNode;
  /** Zurück-Button links (runder weißer Icon-Button) */
  onBack?: () => void;
  backLabel?: string;
  actions?: ReactNode;
  className?: string;
}

/** Seitenkopf wie in Screens 9–12: optional Zurück-Kreis, Eyebrow, großer Titel, Aktionen rechts. */
export function PageHeader({ title, eyebrow, description, onBack, backLabel, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-5 flex flex-wrap items-center justify-between gap-4 md:mb-6', className)}>
      <div className="flex min-w-0 items-center gap-3.5">
        {onBack && (
          <IconButton aria-label={backLabel ?? de.common.back} onClick={onBack}>
            <ChevronLeft aria-hidden="true" />
          </IconButton>
        )}
        <div className="min-w-0">
          {eyebrow && <p className="truncate text-[13px] text-muted">{eyebrow}</p>}
          <h1 className="font-heading text-[24px] leading-tight font-bold text-ink md:text-[28px]">{title}</h1>
          {description && <p className="mt-1 text-[14px] text-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  );
}
