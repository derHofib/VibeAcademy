import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

export const iconButtonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center rounded-full cursor-pointer select-none',
    'transition-[background-color,color,box-shadow] duration-150 [&_svg]:shrink-0',
    'disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-text disabled:shadow-none',
  ],
  {
    variants: {
      variant: {
        /** Weißer Kreis mit weichem Schatten (Zurück/Schließen im Kopf) */
        surface: 'bg-surface text-ink shadow-soft not-disabled:hover:bg-surface-hover',
        tonal: 'bg-bg text-ink not-disabled:hover:bg-neutral-soft',
        soft: 'bg-accent-soft text-accent-text not-disabled:hover:bg-accent-ring/60',
        ghost: 'bg-transparent text-ink-2 not-disabled:hover:bg-ink/5',
        primary: 'bg-accent text-white shadow-primary not-disabled:hover:bg-accent-hover',
      },
      size: {
        sm: 'size-11 [&_svg]:size-[18px]',
        md: 'size-12 [&_svg]:size-5',
        lg: 'size-14 [&_svg]:size-6',
      },
    },
    defaultVariants: { variant: 'surface', size: 'sm' },
  },
);

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof iconButtonVariants> {
  /** Pflicht: Icon-Buttons brauchen einen zugänglichen Namen. */
  'aria-label': string;
  asChild?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(iconButtonVariants({ variant, size }), className)}
        {...(asChild ? {} : { type: type ?? 'button' })}
        {...props}
      />
    );
  },
);
IconButton.displayName = 'IconButton';
