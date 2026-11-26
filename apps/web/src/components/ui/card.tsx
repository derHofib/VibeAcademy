import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

export const cardVariants = cva('bg-surface text-ink', {
  variants: {
    elevation: {
      /** Standard-Karte auf dem Seitenhintergrund */
      card: 'shadow-card',
      /** Schwebend: Dock, Dialog, Panel über Inhalt */
      float: 'shadow-float',
      flat: 'shadow-none',
    },
    radius: {
      md: 'rounded-card',
      lg: 'rounded-card-lg',
    },
    padding: {
      none: 'p-0',
      sm: 'p-4',
      md: 'p-5 md:p-6',
      lg: 'p-6 md:p-7',
    },
  },
  defaultVariants: { elevation: 'card', radius: 'md', padding: 'md' },
});

export interface CardProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {}

/** Weiße Fläche mit Kartenradius und weichem Schatten, ohne Rahmen. */
export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, elevation, radius, padding, ...props }, ref) => (
    <div ref={ref} className={cn(cardVariants({ elevation, radius, padding }), className)} {...props} />
  ),
);
Card.displayName = 'Card';

export const CardHeader = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('mb-4 flex flex-wrap items-center justify-between gap-3', className)} {...props} />
);

export const CardTitle = ({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
  <h2 className={cn('font-heading text-[17px] font-bold text-ink', className)} {...props} />
);

export const CardDescription = ({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn('text-[13.5px] text-muted', className)} {...props} />
);

export const panelVariants = cva('rounded-box px-[18px] py-4 text-[14px] leading-[1.55]', {
  variants: {
    tone: {
      neutral: 'bg-bg text-ink-2',
      accent: 'bg-accent-soft text-accent-text-strong',
      success: 'bg-success-soft text-success-text-strong',
      warn: 'bg-warn-soft text-warn-text-strong',
      danger: 'bg-danger-soft text-danger-text',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export interface PanelProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof panelVariants> {}

/**
 * Getönte Fläche innerhalb einer Karte oder neben ihr (Info-Box, Hinweis, „Was sich ändert“).
 * Trennung nur über Fläche, kein Rahmen.
 */
export const Panel = forwardRef<HTMLDivElement, PanelProps>(({ className, tone, ...props }, ref) => (
  <div ref={ref} className={cn(panelVariants({ tone }), className)} {...props} />
));
Panel.displayName = 'Panel';
