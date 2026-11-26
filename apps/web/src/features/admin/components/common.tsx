import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, LoaderCircle } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { adm } from '@/i18n/admin';
import { cn } from '@/lib/cn';
import { Button, Panel, Sheet } from '@/components/ui';

/** Ladeanzeige für ganze Bereiche. */
export function Loading({ label = adm.common.loading, className }: { label?: string; className?: string }) {
  return (
    <div
      role="status"
      className={cn('flex items-center justify-center gap-2.5 py-12 text-[14px] text-muted', className)}
    >
      <LoaderCircle aria-hidden="true" className="size-5 animate-spin text-accent" />
      {label}
    </div>
  );
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return 'Etwas ist schiefgelaufen. Bitte erneut versuchen.';
}

/** Fehlerfläche mit „Erneut versuchen“. */
export function ErrorPanel({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <Panel
      tone="danger"
      role="alert"
      className={cn('flex flex-wrap items-center justify-between gap-3', className)}
    >
      <span>
        <strong className="font-semibold">{adm.common.errorTitle}:</strong> {errorMessage(error)}
      </span>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {adm.common.retry}
        </Button>
      )}
    </Panel>
  );
}

/** Kurzmeldung mit aria-live (für Erfolg nach Aktionen). Verschwindet nach einigen Sekunden. */
export function useNotice(timeout = 6000) {
  const [notice, setNotice] = useState<{
    text: string;
    tone: 'success' | 'danger' | 'warn' | 'accent';
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback(
    (text: string, tone: 'success' | 'danger' | 'warn' | 'accent' = 'success') => {
      setNotice({ text, tone });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setNotice(null), timeout);
    },
    [timeout],
  );
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return { notice, show, clear: () => setNotice(null) };
}

export function NoticeRegion({
  notice,
  className,
}: {
  notice: ReturnType<typeof useNotice>['notice'];
  className?: string;
}) {
  return (
    <div role="status" aria-live="polite" className={className}>
      {notice && (
        <Panel tone={notice.tone} className="font-medium">
          {notice.text}
        </Panel>
      )}
    </div>
  );
}

/** Text in die Zwischenablage, mit Ausweichlösung (z. B. ohne HTTPS). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // weiter mit Ausweichlösung
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

export function CopyButton({
  text,
  label = adm.common.copy,
  ariaLabel,
  variant = 'tonal',
  size = 'sm',
  className,
}: {
  text: string;
  label?: string;
  ariaLabel?: string;
  variant?: 'tonal' | 'secondary' | 'soft' | 'primary';
  size?: 'sm' | 'md';
  className?: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      aria-label={ariaLabel}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        }
      }}
    >
      {done ? (
        <Check aria-hidden="true" className="size-4" />
      ) : (
        <Copy aria-hidden="true" className="size-4" />
      )}
      <span aria-live="polite">{done ? adm.common.copied : label}</span>
    </Button>
  );
}

/** Bestätigungsdialog (Sheet mobil, Panel ab 768 px). */
export function ConfirmSheet({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  pending = false,
  tone = 'primary',
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  pending?: boolean;
  tone?: 'primary' | 'danger-soft' | 'dark';
  children?: ReactNode;
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {adm.common.cancel}
          </Button>
          <Button variant={tone} onClick={onConfirm} disabled={pending}>
            {pending ? adm.common.saving : confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Sheet>
  );
}

/** Kleine Kennzahl-Kachel innerhalb einer Karte (Screen 2/3: graue Fläche, Label + Wert). */
export function StatBox({
  label,
  value,
  hint,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 rounded-input bg-bg px-4 py-3', className)}>
      <p className="text-[13px] text-muted">{label}</p>
      <p className="mt-0.5 font-heading text-[17px] leading-snug font-bold text-ink tabular-nums md:text-[18px]">
        {value}
        {hint && <span className="ml-1.5 font-sans text-[13px] font-semibold text-warn-text">{hint}</span>}
      </p>
    </div>
  );
}
