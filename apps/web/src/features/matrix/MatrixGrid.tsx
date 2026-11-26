import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { Avatar, StatusChip } from '@/components/ui';
import { tx } from '@/i18n/external';
import type { ComplianceRequirement, ComplianceRow } from './api';
import { cellChip, STATE_LABEL, type MatrixPerson } from './model';

const t = tx.matrix;

function ColumnHead({ r }: { r: ComplianceRequirement }) {
  return (
    <span className="flex min-w-[128px] flex-col gap-0.5 text-left">
      <span className="text-[13px] leading-snug font-semibold text-ink">{r.trainingTitle}</span>
      <span className="text-[12px] font-normal text-muted">
        {r.qualificationName} · {t.every(r.intervalMonths)}
      </span>
    </span>
  );
}

function Cell({
  person,
  req,
  row,
  dim,
  onOpen,
}: {
  person: MatrixPerson;
  req: ComplianceRequirement;
  row: ComplianceRow | undefined;
  dim: boolean;
  onOpen?: (row: ComplianceRow) => void;
}) {
  if (!row) {
    return (
      <span className="text-[13px] text-[#8790A0]">
        <span aria-hidden="true">—</span>
        <span className="sr-only">{t.notRequired}</span>
      </span>
    );
  }
  const chip = cellChip(row);
  const prefix = `${person.name} · ${req.trainingTitle} (${req.qualificationName}): `;
  const suffix = chip.label.startsWith(STATE_LABEL[row.state]) ? '' : ` (${STATE_LABEL[row.state]})`;
  const body = (
    <>
      <span className="sr-only">{prefix}</span>
      <StatusChip tone={chip.tone} className={cn(dim && 'opacity-40')}>
        {chip.label}
      </StatusChip>
      {suffix && <span className="sr-only">{suffix}</span>}
    </>
  );
  return onOpen ? (
    <button
      type="button"
      onClick={() => onOpen(row)}
      data-testid="matrix-zelle"
      data-state={row.state}
      className="-m-1 inline-flex min-h-11 cursor-pointer items-center rounded-pill p-1 hover:bg-surface"
    >
      {body}
    </button>
  ) : (
    <span data-testid="matrix-zelle" data-state={row.state} className="inline-flex">
      {body}
    </span>
  );
}

/** Raster Person × Pflichtschulung (Desktop: Tabelle mit fester Namensspalte, mobil: Karte je Person). */
export function MatrixGrid({
  columns,
  persons,
  highlight,
  onOpen,
}: {
  columns: ComplianceRequirement[];
  persons: MatrixPerson[];
  /** Zellen in anderem Zustand abblenden (Statusfilter) */
  highlight: string;
  onOpen?: (row: ComplianceRow) => void;
}) {
  const wide = useMediaQuery('(min-width: 768px)');
  if (!wide) {
    return (
      <ul aria-label={t.gridLabel} className="flex flex-col gap-2.5">
        {persons.map((p) => (
          <li key={p.personId} className="rounded-box bg-bg px-4 py-3.5" data-testid="matrix-person">
            <div className="mb-2.5 flex items-center gap-3">
              <Avatar name={p.name} tone="surface" size="lg" />
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold text-ink">{p.name}</p>
                {p.orgUnitName && <p className="truncate text-[12.5px] text-muted">{p.orgUnitName}</p>}
              </div>
            </div>
            <ul className="flex flex-col gap-2">
              {columns
                .filter((c) => p.cells[c.id])
                .map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 text-[13.5px]">
                    <span className="min-w-0 text-ink-2">
                      {c.trainingTitle}
                      <span className="block text-[12px] text-muted">{c.qualificationName}</span>
                    </span>
                    <Cell person={p} req={c} row={p.cells[c.id]} dim={!!highlight && p.cells[c.id]!.state !== highlight} onOpen={onOpen} />
                  </li>
                ))}
            </ul>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="-mx-2 overflow-x-auto px-2 pb-1">
      <table aria-label={t.gridLabel} className="w-full border-separate border-spacing-y-1.5 text-left text-[14px]">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-[1] bg-surface px-4 pb-1.5 text-[12.5px] font-semibold text-muted">
              {t.colPerson}
            </th>
            {columns.map((c) => (
              <th key={c.id} scope="col" className="px-3 pb-1.5 align-bottom">
                <ColumnHead r={c} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {persons.map((p) => (
            <tr key={p.personId} className="bg-bg" data-testid="matrix-person">
              <th scope="row" className="sticky left-0 z-[1] rounded-l-box bg-bg px-4 py-2.5 text-left font-normal">
                <span className="flex items-center gap-3">
                  <Avatar name={p.name} tone="surface" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold whitespace-nowrap text-ink">{p.name}</span>
                    {p.orgUnitName && <span className="block truncate text-[12.5px] text-muted">{p.orgUnitName}</span>}
                  </span>
                </span>
              </th>
              {columns.map((c, i) => (
                <td key={c.id} className={cn('px-3 py-2.5 align-middle', i === columns.length - 1 && 'rounded-r-box')}>
                  <Cell person={p} req={c} row={p.cells[c.id]} dim={!!highlight && !!p.cells[c.id] && p.cells[c.id]!.state !== highlight} onOpen={onOpen} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
