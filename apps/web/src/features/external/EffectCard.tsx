import { useState } from 'react';
import { ArrowRight, Pencil } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card, CardTitle, Input, StatusChip } from '@/components/ui';
import { tx } from '@/i18n/external';
import type { Preview } from './api';
import { deDate, effectRow } from './model';

/** „Was sich ändert“ (Screen 9, rechte Spalte): Gültigkeit (Vorschlag, änderbar) und bisher → neu je Person. */
export function EffectCard({
  preview,
  heldOn,
  override,
  onOverride,
}: {
  preview: Preview | undefined;
  heldOn: string;
  override: string | null;
  onOverride: (v: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const credited = !!preview?.label && (!!preview.validUntil || !!preview.intervalMonths);
  const until = preview?.validUntil ?? null;
  const years = preview?.intervalMonths ? tx.capture.years(preview.intervalMonths) : null;
  return (
    <Card radius="lg" className="flex flex-col gap-3.5" aria-labelledby="wirkung-titel" data-testid="was-sich-aendert">
      <CardTitle id="wirkung-titel">{tx.capture.effectTitle}</CardTitle>
      <div className={cn('rounded-box px-[18px] py-4', credited ? 'bg-success-soft text-success-text-strong' : 'bg-bg text-ink-2')}>
        {credited ? (
          <>
            <div className="flex items-start justify-between gap-2">
              <p className="text-[13px]">{tx.capture.validHead(preview!.label!)}</p>
              <button
                type="button"
                onClick={() => setEditing((e) => !e)}
                aria-label={tx.capture.validChange}
                aria-expanded={editing}
                className="relative -mt-1 -mr-1 inline-flex size-8 cursor-pointer items-center justify-center rounded-full after:absolute after:-inset-1.5 hover:bg-white/60"
              >
                <Pencil aria-hidden="true" className="size-4" />
              </button>
            </div>
            <p className="mt-0.5 font-heading text-[26px] leading-tight font-bold tabular-nums">{until ? deDate(until) : '—'}</p>
            <p className="mt-1 text-[12.5px]">
              {!heldOn && !override ? tx.capture.needDate : override ? tx.capture.validNoteOverride : years ? tx.capture.validNote(years) : ''}
            </p>
            {editing && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Input
                  type="date"
                  aria-label={tx.capture.validChange}
                  value={override ?? until ?? ''}
                  onChange={(e) => onOverride(e.target.value || null)}
                  className="h-11 max-w-[190px] bg-surface"
                />
                {override && (
                  <button type="button" onClick={() => onOverride(null)} className="min-h-11 cursor-pointer text-[13px] font-semibold underline underline-offset-4">
                    {tx.capture.validResetProposal}
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <p className="text-[13px]">{tx.capture.noCreditHead}</p>
            <p className="mt-0.5 font-heading text-[22px] leading-tight font-bold">{tx.capture.noCreditValue}</p>
            <p className="mt-1 text-[12.5px]">{tx.capture.noCreditNote}</p>
          </>
        )}
      </div>
      {credited && preview && preview.persons.length > 0 && (
        <ul className="flex flex-col gap-2.5">
          {preview.persons.map((p) => {
            const row = effectRow(p);
            return (
              <li key={p.personId} className="flex items-center gap-2.5 text-[14px]" data-testid="wirkung-person">
                <span className="min-w-0 flex-1 truncate text-ink">{p.name}</span>
                <StatusChip tone={row.from.tone}>{row.from.label}</StatusChip>
                <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-[#8790A0]" />
                <span className="sr-only">→</span>
                {row.to ? <StatusChip tone="success">{row.to.label}</StatusChip> : <StatusChip tone="neutral">—</StatusChip>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
