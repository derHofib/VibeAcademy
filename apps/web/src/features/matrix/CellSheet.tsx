import { Link } from 'react-router';
import { FilePlus2, ShieldOff } from 'lucide-react';
import { Button, Sheet, StatusChip } from '@/components/ui';
import { tx } from '@/i18n/external';
import type { ComplianceRow } from './api';
import { cellChip, deDate, STATE_LABEL } from './model';

const t = tx.matrix.cell;

/** Detail einer Zelle: Stand, Gültigkeit, Wiedereinladung; Aktionen „Externen Nachweis erfassen“ und „Ausnahme eintragen“. */
export function CellSheet({
  row,
  manage,
  onClose,
  onExempt,
}: {
  row: ComplianceRow;
  manage: boolean;
  onClose: () => void;
  onExempt: (row: ComplianceRow) => void;
}) {
  const chip = cellChip(row);
  const facts: Array<[string, string]> = [
    [t.state, STATE_LABEL[row.state]],
    [t.lastCompleted, deDate(row.lastCompletedOn ?? null)],
    [t.validUntil, deDate(row.validUntil)],
  ];
  if (row.reinviteOn) facts.push([t.reinvite, deDate(row.reinviteOn)]);
  if (row.source) facts.push([t.source, t.sources[row.source] ?? row.source]);
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={row.personName}
      description={`${row.trainingTitle} · ${row.qualificationName}`}
      footer={
        manage && (
          <>
            {row.state !== 'befreit' && (
              <Button variant="ghost" onClick={() => onExempt(row)}>
                <ShieldOff aria-hidden="true" className="size-4" />
                {t.exempt}
              </Button>
            )}
            <Button asChild>
              <Link to={`/verwaltung/extern/neu?modus=einzel&person=${row.personId}&requirement=${row.requirementId}`}>
                <FilePlus2 aria-hidden="true" className="size-4" />
                {t.recordExternal}
              </Link>
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3">
        <StatusChip tone={chip.tone} size="md" className="self-start">
          {chip.label}
        </StatusChip>
        <dl className="grid grid-cols-2 gap-2">
          {facts.map(([k, v]) => (
            <div key={k} className="rounded-input bg-bg px-3.5 py-2.5">
              <dt className="text-[12px] text-muted">{k}</dt>
              <dd className="text-[14.5px] font-semibold text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Sheet>
  );
}
