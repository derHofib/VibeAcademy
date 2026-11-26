import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Card } from './card';

const valueTone = {
  default: 'text-ink',
  danger: 'text-danger-text',
  warn: 'text-warn-strong',
  success: 'text-success',
  accent: 'text-accent-text',
} as const;

export interface KpiTileProps {
  label: ReactNode;
  value: ReactNode;
  tone?: keyof typeof valueTone;
  hint?: ReactNode;
  /** z. B. ein <LinearProgress> unter dem Wert */
  children?: ReactNode;
  className?: string;
}

/** Kennzahl-Kachel (Dashboard): Label, große Zahl, Hinweis. */
export function KpiTile({ label, value, tone = 'default', hint, children, className }: KpiTileProps) {
  return (
    <Card padding="md" className={cn('flex min-w-0 flex-col gap-2', className)}>
      <p className="text-[13.5px] font-medium text-muted">{label}</p>
      <p className={cn('font-heading text-[32px] leading-[1.1] font-bold tracking-[-0.01em] tabular-nums', valueTone[tone])}>
        {value}
      </p>
      {children}
      {hint && <p className="text-[13.5px] text-muted">{hint}</p>}
    </Card>
  );
}
