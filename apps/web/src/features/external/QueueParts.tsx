import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { StatusChip } from '@/components/ui';
import { tx } from '@/i18n/external';
import type { CaseItem, ExtStatus, GroupMember } from './api';
import { caseMeta, queueChip } from './model';

export type QueueTab = 'open' | 'approved' | 'returned' | 'drafts';

/**
 * Reiter der Warteschlange wie in Screen 11: weiße Pillen-Gruppe, aktiver Reiter blau gefüllt.
 * Umsetzung als Umschaltknöpfe (aria-pressed) – die Liste darunter wechselt ihren Inhalt.
 */
export function QueueTabs({
  value,
  onChange,
  counts,
}: {
  value: QueueTab;
  onChange: (t: QueueTab) => void;
  counts: Partial<Record<ExtStatus, number>> | undefined;
}) {
  const open = counts?.eingereicht ?? 0;
  const tabs: Array<{ id: QueueTab; label: string }> = [
    { id: 'open', label: tx.queue.tabOpenCount(open) },
    { id: 'approved', label: tx.queue.tabApproved },
    { id: 'returned', label: tx.queue.tabReturned },
  ];
  if ((counts?.entwurf ?? 0) > 0 || value === 'drafts') tabs.push({ id: 'drafts', label: `${tx.queue.tabDrafts} · ${counts?.entwurf ?? 0}` });
  return (
    <div
      role="group"
      aria-label={tx.queue.tabsLabel}
      className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-pill bg-surface p-1 shadow-soft [scrollbar-width:none]"
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            'inline-flex min-h-11 shrink-0 cursor-pointer items-center rounded-pill px-4 text-[13.5px] font-semibold whitespace-nowrap tabular-nums transition-colors',
            value === t.id ? 'bg-accent text-white' : 'text-ink-2 hover:bg-bg hover:text-ink',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Karte in der Warteschlange (Name, Hinweis-Chip, Kurs, Meta-Zeile). */
export function CaseCard({
  item,
  selected,
  decided,
  onSelect,
  now,
}: {
  item: CaseItem;
  selected: boolean;
  decided?: ExtStatus | null;
  onSelect: () => void;
  now?: Date;
}) {
  const chip = queueChip(item, decided);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      data-testid="extern-fall"
      className={cn(
        'flex w-full cursor-pointer flex-col gap-1.5 rounded-[22px] border-2 bg-surface p-4 text-left text-ink shadow-card transition-colors',
        selected ? 'border-accent' : 'border-transparent hover:border-accent-ring',
      )}
    >
      <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <strong className="text-[14.5px] font-bold">{item.label}</strong>
        <StatusChip tone={chip.tone} icon={chip.check ? <Check aria-hidden="true" strokeWidth={2.5} /> : undefined}>
          {chip.label}
        </StatusChip>
      </span>
      <span className="text-[13.5px] text-ink-2">{item.title ?? '—'}</span>
      <span className="text-[12px] text-muted">{caseMeta(item, now)}</span>
    </button>
  );
}

/** Papierliste (11b): Personen des Vorgangs mit Markierung „Unterschrift prüfen“, umschaltbar für die Verwaltung. */
export function PaperList({
  members,
  canEdit,
  pending,
  onToggle,
}: {
  members: GroupMember[];
  canEdit: boolean;
  pending: boolean;
  onToggle: (m: GroupMember, flagged: boolean) => void;
}) {
  return (
    <div className="w-full max-w-[440px] rounded-[18px] bg-white/[0.06] px-4 py-3 text-[13.5px] text-[#E2E8F0]">
      <p className="mb-1.5 text-[12.5px] font-semibold tracking-[0.02em] text-[#CBD5E1]">{tx.receipt.listTitle}</p>
      <ul className="flex flex-col">
        {members.map((m) => {
          const flagged = m.flags.some((f) => f.code === 'unterschrift_unleserlich');
          return (
            <li key={m.recordId} className="flex min-h-11 items-center gap-3 border-b border-white/10 last:border-0" data-testid="listen-person">
              <span className="min-w-0 flex-1 truncate text-white">{m.name}</span>
              {canEdit ? (
                <button
                  type="button"
                  disabled={pending}
                  aria-pressed={flagged}
                  title={flagged ? tx.receipt.unmarkSignature(m.name) : tx.receipt.markSignature(m.name)}
                  onClick={() => onToggle(m, !flagged)}
                  className={cn(
                    'relative min-h-8 cursor-pointer rounded-pill px-3 text-[12px] font-bold after:absolute after:-inset-1.5 disabled:cursor-wait',
                    flagged ? 'bg-warn-soft text-warn-text' : 'bg-white/10 text-[#CBD5E1] hover:bg-white/15',
                  )}
                >
                  <span className="sr-only">{tx.receipt.signatureOf(m.name)}</span>
                  {flagged ? tx.receipt.signatureCheck : tx.receipt.signatureOk}
                </button>
              ) : (
                flagged && <span className="rounded-pill bg-warn-soft px-3 py-1 text-[12px] font-bold text-warn-text">{tx.receipt.signatureCheck}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
