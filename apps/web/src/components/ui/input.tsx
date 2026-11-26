import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useFieldControl } from './field';

/** Eingabefelder: ohne Rahmen, Fläche `bg` (auf Karten) oder weiß mit Schatten (auf Seitenhintergrund). */
export const inputVariants = cva(
  [
    'w-full min-w-0 rounded-input border-0 text-[15px] text-ink outline-none',
    'placeholder:text-muted transition-[background-color,box-shadow] duration-150',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
    'disabled:cursor-not-allowed disabled:opacity-60',
    'aria-invalid:bg-danger-soft aria-invalid:shadow-[inset_0_0_0_1.5px_var(--color-danger-text)]',
  ],
  {
    variants: {
      tone: {
        /** Auf weißen Karten */
        muted: 'bg-bg',
        /** Auf dem Seitenhintergrund (z. B. Passwortfeld in Screen 6) */
        surface: 'bg-surface shadow-soft',
      },
      size: {
        md: 'h-12 px-3.5',
        lg: 'h-14 px-4 text-base',
      },
    },
    defaultVariants: { tone: 'muted', size: 'md' },
  },
);

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof inputVariants> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, tone, size, ...props }, ref) => {
  const controlProps = useFieldControl(props);
  return <input ref={ref} className={cn(inputVariants({ tone, size }), className)} {...controlProps} />;
});
Input.displayName = 'Input';

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement>,
    Pick<VariantProps<typeof inputVariants>, 'tone'> {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, tone, rows = 4, ...props }, ref) => {
  const controlProps = useFieldControl(props);
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(inputVariants({ tone }), 'min-h-24 resize-y px-3.5 py-3 leading-normal', className)}
      {...controlProps}
    />
  );
});
Textarea.displayName = 'Textarea';

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'>,
    VariantProps<typeof inputVariants> {}

/** Natives <select> im Feldstil (zuverlässig auf Mobilgeräten und für Screenreader). */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, tone, size, children, ...props }, ref) => {
    const controlProps = useFieldControl(props);
    return (
      <div className="relative min-w-0">
        <select
          ref={ref}
          className={cn(inputVariants({ tone, size }), 'cursor-pointer appearance-none truncate pr-11', className)}
          {...controlProps}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-4 size-[18px] -translate-y-1/2 text-ink-2"
        />
      </div>
    );
  },
);
Select.displayName = 'Select';
