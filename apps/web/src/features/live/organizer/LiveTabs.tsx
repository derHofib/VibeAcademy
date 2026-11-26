import type { ReactNode } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { cn } from '@/lib/cn';

export interface LiveTab<V extends string> {
  value: V;
  label: string;
  count: ReactNode;
  countTone?: 'soft' | 'live';
  content: ReactNode;
}

/** Reiter im Stil des Segment-Umschalters (Pillen auf `bg`, aktive weiß mit Schatten) – semantisch Tabs. */
export function LiveTabs<V extends string>({
  tabs,
  value,
  onValueChange,
  label,
}: {
  tabs: LiveTab<V>[];
  value: V;
  onValueChange: (v: V) => void;
  label: string;
}) {
  return (
    <Tabs.Root value={value} onValueChange={(v) => onValueChange(v as V)} className="flex flex-col gap-5">
      <Tabs.List aria-label={label} className="inline-flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-pill bg-bg p-1 [scrollbar-width:none]">
        {tabs.map((t) => (
          <Tabs.Trigger
            key={t.value}
            value={t.value}
            className={cn(
              'inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-pill px-[18px] text-[15px] font-semibold whitespace-nowrap text-muted',
              'transition-[background-color,color,box-shadow] duration-150 hover:text-ink',
              'data-[state=active]:bg-surface data-[state=active]:text-ink data-[state=active]:shadow-soft',
            )}
          >
            {t.label}{' '}
            <span
              className={cn(
                'rounded-pill px-2 py-0.5 text-[12px] font-bold tabular-nums',
                t.countTone === 'live' ? 'bg-accent text-white' : 'bg-accent-soft text-accent-text',
              )}
            >
              {t.count}
            </span>
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {tabs.map((t) => (
        <Tabs.Content key={t.value} value={t.value} className="outline-none">
          {t.content}
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}
