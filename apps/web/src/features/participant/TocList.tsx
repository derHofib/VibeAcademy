import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { tp } from '@/i18n/participant';
import type { InvitationStart, PageProgress } from './api';
import { chapterLabel, pageTitle } from './viewerModel';

export interface TocListProps {
  start: InvitationStart;
  pages: PageProgress[];
  /** Aktuelle Seite (null im Wissenscheck) */
  current: number | null;
  onGo: (pageNo: number) => void;
  desktop: boolean;
}

/** Inhaltsverzeichnis nach Kapiteln (5d/5i): erfasst ✓ · aktuell · gesperrt · offen. */
export function TocList({ start, pages, current, onGo, desktop }: TocListProps) {
  const byNo = new Map(pages.map((p) => [p.pageNo, p]));
  const groups =
    start.chapters.length > 0
      ? start.chapters.map((c) => {
          const l = chapterLabel(c);
          return {
            key: `k${c.idx}`,
            header: `${l.no} · ${l.title}`,
            pages: start.pages.filter((p) => p.pageNo >= c.from_page && p.pageNo <= c.to_page).map((p) => p.pageNo),
          };
        })
      : [{ key: 'alle', header: null as string | null, pages: start.pages.map((p) => p.pageNo) }];
  // Seiten außerhalb aller Kapitel (z. B. Titelblatt) vorn anhängen
  const covered = new Set(groups.flatMap((g) => g.pages));
  const loose = start.pages.map((p) => p.pageNo).filter((n) => !covered.has(n));
  if (loose.length) groups.unshift({ key: 'vorab', header: null, pages: loose });

  return (
    <div className={cn('pb-4', desktop ? 'px-3' : 'px-3 pb-5')}>
      {groups.map((g) => (
        <section key={g.key} aria-label={g.header ?? undefined}>
          {g.header && (
            <h3 className="px-2 pt-3.5 pb-1.5 font-sans text-[12px] font-bold tracking-[0.03em] text-muted uppercase">{g.header}</h3>
          )}
          <ul className="flex flex-col">
            {g.pages.map((n) => {
              const p = byNo.get(n);
              const done = !!p?.fulfilled;
              const isCurrent = n === current;
              const locked = !!p && !p.allowed;
              const optional = p?.required === false;
              const label = done ? tp.reader.toc.captured : isCurrent ? tp.reader.toc.current : locked ? tp.reader.toc.locked : optional ? tp.reader.toc.optional : desktop ? '' : tp.reader.toc.open;
              return (
                <li key={n}>
                  <button
                    type="button"
                    disabled={locked}
                    aria-current={isCurrent ? 'page' : undefined}
                    onClick={() => onGo(n)}
                    className={cn(
                      'flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-[16px] px-3 py-2 text-left text-[14px] disabled:cursor-not-allowed',
                      isCurrent ? 'bg-accent-soft text-ink' : 'enabled:hover:bg-bg',
                      locked ? 'text-muted' : 'text-ink',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="sr-only">{tp.reader.pageLabel(n)}: </span>
                      {pageTitle(start, n)}
                    </span>
                    {label && (
                      <span
                        className={cn(
                          'inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold',
                          done ? 'text-success' : isCurrent ? 'text-accent-text' : 'text-muted',
                        )}
                      >
                        {done && <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />}
                        <span className={cn(done && desktop && 'sr-only')}>{label}</span>
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
