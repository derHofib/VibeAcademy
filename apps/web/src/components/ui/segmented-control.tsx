import type { ReactNode } from 'react';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { cn } from '@/lib/cn';

export interface SegmentedOption<V extends string = string> {
  value: V;
  label: ReactNode;
  /** Optionaler Zähler, z. B. „Anwesenheit 8“ */
  count?: ReactNode;
  /** `live`: gefüllte Akzent-Pille statt weicher Zählerfläche */
  countTone?: 'soft' | 'live';
  disabled?: boolean;
}

export interface SegmentedControlProps<V extends string = string> {
  options: SegmentedOption<V>[];
  value: V;
  onValueChange: (value: V) => void;
  /** Zugänglicher Name der Gruppe */
  'aria-label': string;
  /** Volle Breite, Segmente gleich breit */
  fullWidth?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Pillen-Gruppe auf `bg`, aktive Pille weiß mit Schatten.
 * Tastatur: Pfeiltasten bewegen den Fokus, Leertaste/Enter wählt aus.
 */
export function SegmentedControl<V extends string = string>({
  options,
  value,
  onValueChange,
  fullWidth = false,
  size = 'md',
  className,
  'aria-label': ariaLabel,
}: SegmentedControlProps<V>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      // Radix erlaubt Abwählen (leerer Wert) – ein Segment bleibt immer aktiv.
      onValueChange={(next) => {
        if (next) onValueChange(next as V);
      }}
      aria-label={ariaLabel}
      className={cn(
        'max-w-full gap-0.5 rounded-pill bg-bg p-1',
        // Zu schmal: Breite Gruppen scrollen horizontal statt Beschriftungen abzuschneiden
        fullWidth ? 'flex w-full' : 'inline-flex w-fit overflow-x-auto [scrollbar-width:none]',
        className,
      )}
    >
      {options.map((opt) => (
        <ToggleGroup.Item
          key={opt.value}
          value={opt.value}
          disabled={opt.disabled}
          className={cn(
            'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-pill font-semibold text-muted',
            'transition-[background-color,color,box-shadow] duration-150',
            'hover:text-ink data-[state=on]:bg-surface data-[state=on]:text-ink data-[state=on]:shadow-soft',
            'disabled:cursor-not-allowed disabled:opacity-60',
            size === 'sm' ? 'px-3.5 text-[13.5px]' : 'px-[18px] text-[14px]',
            // volle Breite: gleich breite Segmente, Text darf umbrechen
            fullWidth ? 'min-w-0 flex-1 px-2.5 py-1.5 text-center leading-tight' : 'shrink-0 whitespace-nowrap',
          )}
        >
          <span>{opt.label}</span>
          {/* Leerzeichen trennt Label und Zähler im zugänglichen Namen („Anwesenheit 8“) */}
          {opt.count !== undefined && ' '}
          {opt.count !== undefined && (
            <span
              className={cn(
                'rounded-pill px-2 py-0.5 text-[11.5px] font-bold tabular-nums',
                opt.countTone === 'live' ? 'bg-accent text-white' : 'bg-accent-soft text-accent-text',
              )}
            >
              {opt.count}
            </span>
          )}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
