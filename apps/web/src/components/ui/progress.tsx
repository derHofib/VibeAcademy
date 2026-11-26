import type { ReactNode, SVGAttributes } from 'react';
import { cn } from '@/lib/cn';
import { de } from '@/i18n/de';

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

const ringColor = {
  accent: 'var(--color-accent)',
  success: 'var(--color-success)',
  warn: 'var(--color-warn)',
  muted: 'var(--color-muted)',
} as const;

export interface ProgressRingProps {
  /** Fortschritt 0–1 */
  value: number;
  /** Außendurchmesser in px */
  size?: number;
  /** Strichstärke in px */
  stroke?: number;
  tone?: keyof typeof ringColor;
  /** Farbe des Tracks (Standard `line`) */
  trackColor?: string;
  /** Füllung innen (z. B. weiß im Ring-Button) */
  fill?: string;
  /** Zugänglicher Name; ohne Label ist der Ring dekorativ */
  label?: string;
  /** Vorgelesener Wert, z. B. „noch 5 Sekunden“ */
  valueText?: string;
  /** Inhalt in der Mitte (Prozent, Kapitelnummer, Countdown, Icon) */
  children?: ReactNode;
  className?: string;
  svgProps?: SVGAttributes<SVGSVGElement>;
}

/** SVG-Fortschrittsring (Kapitel-Ringe, Gesamtfortschritt, Ring-Button). */
export function ProgressRing({
  value,
  size = 44,
  stroke = 4,
  tone = 'accent',
  trackColor = 'var(--color-line)',
  fill = 'none',
  label,
  valueText,
  children,
  className,
  svgProps,
}: ProgressRingProps) {
  const v = clamp01(value);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const percent = Math.round(v * 100);
  const a11y = label
    ? {
        role: 'progressbar' as const,
        'aria-label': label,
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': percent,
        'aria-valuetext': valueText ?? de.progress.percent(percent),
      }
    : { 'aria-hidden': true as const };
  return (
    <span
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
      {...a11y}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" {...svgProps}>
        <circle cx={size / 2} cy={size / 2} r={r} fill={fill} stroke={trackColor} strokeWidth={stroke} />
        {v > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={ringColor[tone]}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - v)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke-dashoffset 0.6s ease' }}
          />
        )}
      </svg>
      {children !== undefined && (
        <span className="absolute inset-0 flex items-center justify-center tabular-nums">{children}</span>
      )}
    </span>
  );
}

export interface SegmentProgressProps {
  /** Füllstand je Seite, 0–1 */
  segments: number[];
  /** Index der aktuellen Seite (heller Ring) */
  current?: number;
  label?: string;
  className?: string;
}

/** Ein Balkensegment je Seite; füllt sich live, aktuelle Seite mit hellem Ring. */
export function SegmentProgress({ segments, current, label = de.progress.pageLabel, className }: SegmentProgressProps) {
  const done = segments.filter((s) => s >= 1).length;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={segments.length}
      aria-valuenow={done}
      aria-valuetext={de.progress.pagesCaptured(done, segments.length)}
      className={cn('flex w-full items-center gap-1.5', className)}
    >
      {segments.map((s, i) => (
        <span
          key={i}
          className={cn(
            'relative h-[5px] min-w-0 flex-1 overflow-hidden rounded-[3px] bg-line',
            i === current && 'shadow-[0_0_0_2px_var(--color-accent-ring)]',
          )}
        >
          <span
            className="absolute inset-y-0 left-0 rounded-[3px] bg-accent transition-[width] duration-700 ease-linear"
            style={{ width: `${clamp01(s) * 100}%` }}
          />
        </span>
      ))}
    </div>
  );
}

export interface LinearProgressProps {
  value: number;
  tone?: 'accent' | 'success' | 'warn' | 'danger';
  label: string;
  className?: string;
}

/** Schmaler Balken (Dashboard-Tabellen, KPI). */
export function LinearProgress({ value, tone = 'accent', label, className }: LinearProgressProps) {
  const v = clamp01(value);
  const toneClass = { accent: 'bg-accent', success: 'bg-success', warn: 'bg-warn-strong', danger: 'bg-danger-text' }[tone];
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-line', className)}
    >
      <div className={cn('h-full rounded-full', toneClass)} style={{ width: `${v * 100}%` }} />
    </div>
  );
}
