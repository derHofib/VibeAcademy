import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

export const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-pill font-semibold select-none',
    'cursor-pointer transition-[background-color,color,box-shadow,transform] duration-150',
    'not-disabled:active:translate-y-px [&_svg]:shrink-0',
    'disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-text disabled:shadow-none',
    'aria-disabled:cursor-not-allowed aria-disabled:bg-disabled aria-disabled:text-disabled-text aria-disabled:shadow-none',
  ],
  {
    variants: {
      variant: {
        /** Primäraktion: Akzent, weißer Text, blauer Schatten */
        primary: 'bg-accent text-white shadow-primary not-disabled:hover:bg-accent-hover',
        /** Sekundär: weiße Pille mit weichem Schatten (z. B. „Als Entwurf speichern“) */
        secondary: 'bg-surface text-ink shadow-soft not-disabled:hover:bg-surface-hover',
        /** Tonal: graue Pille auf weißer Karte (z. B. „Vollbild für Beamer“) */
        tonal: 'bg-bg text-ink not-disabled:hover:bg-neutral-soft',
        /** Soft: Akzent-Fläche (z. B. „Löschen“ im Unterschriftsfeld) */
        soft: 'bg-accent-soft text-accent-text not-disabled:hover:bg-accent-ring/60',
        ghost: 'bg-transparent text-ink-2 not-disabled:hover:bg-ink/5',
        /** Dunkel: endgültige Aktion (z. B. „Schulung offiziell beenden“) */
        dark: 'bg-ink text-white shadow-dark not-disabled:hover:bg-ink-2',
        success: 'bg-success text-white shadow-success not-disabled:hover:bg-success-hover',
        'danger-soft': 'bg-danger-soft text-danger-text not-disabled:hover:bg-[#fadcd8]',
      },
      size: {
        /** Mindestens 44 px Touch-Ziel auch in klein */
        sm: 'h-11 px-4 text-[13.5px]',
        md: 'h-12 px-5 text-[14.5px]',
        /** Mobile Primärbuttons 56 px */
        lg: 'h-14 px-7 text-base',
      },
      fullWidth: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', fullWidth: false },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Rendert das Kind (z. B. einen Link) mit Button-Stil statt eines <button>. */
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, fullWidth, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, fullWidth }), className)}
        {...(asChild ? {} : { type: type ?? 'button' })}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
