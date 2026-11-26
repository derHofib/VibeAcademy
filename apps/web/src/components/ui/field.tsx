import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type ReactNode,
} from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cn } from '@/lib/cn';

interface FieldContextValue {
  id: string;
  hintId?: string;
  errorId?: string;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/**
 * Verbindet ein Eingabeelement mit dem umgebenden <Field>: id, aria-describedby, aria-invalid.
 * Explizit übergebene Props haben Vorrang.
 */
export function useFieldControl<P extends { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: unknown; required?: boolean }>(
  props: P,
): P {
  const ctx = useContext(FieldContext);
  if (!ctx) return props;
  const describedBy = [props['aria-describedby'], ctx.hintId, ctx.errorId].filter(Boolean).join(' ') || undefined;
  return {
    ...props,
    id: props.id ?? ctx.id,
    'aria-describedby': describedBy,
    'aria-invalid': props['aria-invalid'] ?? (ctx.invalid || undefined),
    required: props.required ?? (ctx.required || undefined),
  };
}

export const Label = forwardRef<
  ElementRef<typeof LabelPrimitive.Root>,
  ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn('text-[13px] font-medium leading-tight text-muted', className)}
    {...props}
  />
));
Label.displayName = 'Label';

export interface FieldProps {
  label: ReactNode;
  /** Zusatztext unter dem Feld */
  hint?: ReactNode;
  /** Fehlermeldung; setzt aria-invalid am Eingabeelement */
  error?: ReactNode;
  required?: boolean;
  /** Text rechts neben dem Label (z. B. „4 Personen“) */
  aside?: ReactNode;
  id?: string;
  className?: string;
  children: ReactNode;
}

/** Label + Eingabe + Hinweis + Fehler. Eingabekomponenten verbinden sich automatisch. */
export function Field({ label, hint, error, required = false, aside, id, className, children }: FieldProps) {
  const autoId = useId();
  const controlId = id ?? `feld-${autoId}`;
  const hintId = hint ? `${controlId}-hinweis` : undefined;
  const errorId = error ? `${controlId}-fehler` : undefined;
  return (
    <FieldContext.Provider value={{ id: controlId, hintId, errorId, invalid: !!error, required }}>
      <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor={controlId}>{label}</Label>
          {aside && <span className="text-[13px] text-muted">{aside}</span>}
        </div>
        {children}
        {hint && !error && (
          <p id={hintId} className="text-[12.5px] text-muted">
            {hint}
          </p>
        )}
        {hint && error && (
          <p id={hintId} className="sr-only">
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} className="text-[12.5px] font-medium text-danger-text">
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}
