import type { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/** „Anna Schulz“ -> „AS“, „Mehmet Aydın“ -> „MA“, „Lea“ -> „LE“. */
export function getInitials(name: string): string {
  const parts = name.trim().split(/[\s-]+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toLocaleUpperCase('de-DE');
  const first = parts[0]!.charAt(0);
  const last = parts[parts.length - 1]!.charAt(0);
  return (first + last).toLocaleUpperCase('de-DE');
}

export const avatarVariants = cva(
  'inline-flex shrink-0 select-none items-center justify-center rounded-full font-bold tabular-nums',
  {
    variants: {
      tone: {
        accent: 'bg-accent-soft text-accent-text',
        surface: 'bg-surface text-accent-text-strong',
        success: 'bg-success-soft text-success-text',
        neutral: 'bg-neutral-soft text-ink-2',
      },
      size: {
        sm: 'size-7 text-[11px]',
        md: 'size-8 text-[11.5px]',
        lg: 'size-10 text-[13px]',
        xl: 'size-12 text-[15px]',
      },
    },
    defaultVariants: { tone: 'accent', size: 'md' },
  },
);

export interface AvatarProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'>,
    VariantProps<typeof avatarVariants> {
  name: string;
  /** Standard: dekorativ (Name steht daneben). Mit `labelled` wird der Name vorgelesen. */
  labelled?: boolean;
}

/** Initialen-Kreis. */
export function Avatar({ name, tone, size, labelled = false, className, ...props }: AvatarProps) {
  return (
    <span
      className={cn(avatarVariants({ tone, size }), className)}
      {...(labelled ? { role: 'img', 'aria-label': name } : { 'aria-hidden': true })}
      {...props}
    >
      {getInitials(name)}
    </span>
  );
}
