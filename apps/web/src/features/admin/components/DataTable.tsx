import { type ReactNode } from 'react';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { cn } from '@/lib/cn';
import { useMediaQuery } from '@/hooks/useMediaQuery';

export interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  /** Zugänglicher Name der Tabelle */
  label: string;
  /** Kompakte Karte je Zeile unter 768 px (statt horizontal scrollender Tabelle) */
  renderCard?: (row: T) => ReactNode;
  getRowId?: (row: T) => string;
  /** Zeile hervorheben (z. B. gelb für Hinweise) */
  rowClassName?: (row: T) => string | undefined;
  empty?: ReactNode;
  className?: string;
  /** Breakpoint für die Tabellenansicht */
  query?: string;
}

/**
 * Tabelle im weichen Stil (TanStack Table): Zeilen als getönte Flächen ohne Rahmen.
 * Mobil wird jede Zeile als Karte gerendert.
 */
export function DataTable<T>({
  data,
  columns,
  label,
  renderCard,
  getRowId,
  rowClassName,
  empty,
  className,
  query = '(min-width: 768px)',
}: DataTableProps<T>) {
  const wide = useMediaQuery(query);
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel(), getRowId });

  if (data.length === 0 && empty) return <>{empty}</>;

  if (!wide && renderCard) {
    return (
      <ul aria-label={label} className={cn('flex flex-col gap-2', className)}>
        {table.getRowModel().rows.map((row) => (
          <li key={row.id} className={cn('rounded-box bg-bg px-4 py-3.5', rowClassName?.(row.original))}>
            {renderCard(row.original)}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className={cn('-mx-2 overflow-x-auto px-2', className)}>
      <table aria-label={label} className="w-full border-separate border-spacing-y-1.5 text-left text-[14px]">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th
                  key={h.id}
                  scope="col"
                  className={cn(
                    'px-4 pb-1 text-[12.5px] font-semibold whitespace-nowrap text-muted',
                    (h.column.columnDef.meta as { className?: string } | undefined)?.className,
                  )}
                >
                  {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className={cn('bg-bg', rowClassName?.(row.original))}>
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className={cn(
                    'px-4 py-3 align-middle text-ink-2 first:rounded-l-box last:rounded-r-box',
                    (cell.column.columnDef.meta as { className?: string } | undefined)?.className,
                  )}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
