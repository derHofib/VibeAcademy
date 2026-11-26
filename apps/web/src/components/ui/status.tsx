import type { HTMLAttributes, ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

export type StatusTone = 'success' | 'info' | 'warn' | 'danger' | 'neutral';

export const statusChipVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-chip font-semibold [&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      tone: {
        /** erledigt, erfasst, bestanden */
        success: 'bg-success-soft text-success-text',
        /** läuft, offen, geplant */
        info: 'bg-accent-soft text-accent-text',
        /** prüfen, teilweise, Frist */
        warn: 'bg-warn-soft text-warn-text',
        /** abgelaufen, überfällig */
        danger: 'bg-danger-soft text-danger-text',
        neutral: 'bg-neutral-soft text-ink-2',
      },
      size: {
        sm: 'px-2.5 py-1 text-[12px]',
        md: 'px-3 py-1.5 text-[12.5px]',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'sm' },
  },
);

export interface StatusChipProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusChipVariants> {
  icon?: ReactNode;
}

/** Farbcodierter Status: grün erledigt, blau läuft/offen, gelb prüfen/teilweise, rot abgelaufen, grau neutral. */
export function StatusChip({ className, tone, size, icon, children, ...props }: StatusChipProps) {
  return (
    <span className={cn(statusChipVariants({ tone, size }), className)} {...props}>
      {icon}
      {children}
    </span>
  );
}

const dotTone: Record<StatusPillTone, string> = {
  accent: 'bg-accent',
  success: 'bg-success',
  warn: 'bg-warn',
  danger: 'bg-danger-text',
  muted: 'bg-muted',
};

const textTone: Record<StatusPillTone, string> = {
  accent: 'text-ink-2',
  success: 'text-success-text',
  warn: 'text-warn-text',
  danger: 'text-danger-text',
  muted: 'text-muted',
};

export type StatusPillTone = 'accent' | 'success' | 'warn' | 'danger' | 'muted';

export interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusPillTone;
  /** Pulsierender Punkt für laufende Erfassung / Live-Zustand */
  pulse?: boolean;
  /** `soft`: getönte Fläche statt weiß (z. B. „Läuft · 15:28 Uhr“ im Kopf) */
  appearance?: 'floating' | 'soft';
}

/** Kleine Pille mit Punkt: „Seite wird erfasst“, „Pausiert – Fenster nicht aktiv“, „Bestanden“. */
export function StatusPill({
  className,
  tone = 'accent',
  pulse = false,
  appearance = 'floating',
  children,
  ...props
}: StatusPillProps) {
  const softBg: Record<StatusPillTone, string> = {
    accent: 'bg-accent-soft',
    success: 'bg-success-soft',
    warn: 'bg-warn-soft',
    danger: 'bg-danger-soft',
    muted: 'bg-neutral-soft',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 whitespace-nowrap rounded-pill font-medium tabular-nums',
        appearance === 'floating'
          ? 'bg-surface/95 px-3.5 py-[7px] text-[12.5px] shadow-pill'
          : cn(softBg[tone], 'px-4 py-2.5 text-[14px] font-semibold'),
        textTone[tone],
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-2 shrink-0 rounded-full',
          dotTone[tone],
          pulse && 'animate-[sn-pulse-dot_1.6s_ease-in-out_infinite]',
        )}
      />
      {children}
    </span>
  );
}
