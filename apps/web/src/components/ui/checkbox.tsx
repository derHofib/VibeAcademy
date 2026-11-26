import { forwardRef, useId, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

export const Checkbox = forwardRef<
  ElementRef<typeof CheckboxPrimitive.Root>,
  ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      // 24 px sichtbar, Trefferfläche per ::after auf 44 px
      'relative inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-[7px] bg-surface',
      'shadow-[inset_0_0_0_2px_var(--color-control)] transition-[background-color,box-shadow] duration-150',
      'after:absolute after:-inset-2.5 after:rounded-full',
      'data-[state=checked]:bg-accent data-[state=checked]:shadow-none',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="text-white">
      <Check className="size-4" strokeWidth={3} aria-hidden="true" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = 'Checkbox';

export interface CheckboxFieldProps extends ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> {
  label: ReactNode;
  description?: ReactNode;
}

/** Checkbox mit klickbarem Text daneben. */
export function CheckboxField({ label, description, id, className, ...props }: CheckboxFieldProps) {
  const autoId = useId();
  const controlId = id ?? `checkbox-${autoId}`;
  const descId = description ? `${controlId}-beschreibung` : undefined;
  return (
    <div className={cn('flex items-start gap-3.5', className)}>
      <Checkbox id={controlId} aria-describedby={descId} className="mt-0.5" {...props} />
      <div className="min-w-0 flex-1">
        <label htmlFor={controlId} className="cursor-pointer text-[15px] leading-[1.55] text-ink">
          {label}
        </label>
        {description && (
          <p id={descId} className="mt-0.5 text-[13px] text-muted">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
