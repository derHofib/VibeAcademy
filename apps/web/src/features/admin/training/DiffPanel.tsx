import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GitCompareArrows, LoaderCircle } from 'lucide-react';
import { get } from '@/lib/api';
import { ac } from '@/i18n/admin-diff-i18n';
import { cn } from '@/lib/cn';
import { Button, Panel } from '@/components/ui';
import type { ChangeKind } from '../api';
import { errorMessage } from '../components/common';

const t = ac.diff;

export type PageDiffStatus = 'unveraendert' | 'geaendert' | 'neu' | 'entfernt';
export interface PageDiffEntry {
  pageNo: number | null;
  oldPageNo: number | null;
  status: PageDiffStatus;
  similarity: number;
  moved: boolean;
  noText: boolean;
  excerpt: { removed: string; added: string } | null;
}
export interface VersionDiff {
  versionId: string;
  versionNo: number;
  against: { versionId: string; versionNo: number };
  pages: PageDiffEntry[];
  changedPages: number[];
  summary: Record<PageDiffStatus, number>;
  suggestedChangeKind: ChangeKind | null;
}

export const diffKey = (trainingId: string, versionId: string) => ['schulung', trainingId, 'version', versionId, 'diff'] as const;

/** „3, 7, 8“ für das Eingabefeld „Geänderte Seiten“ */
export const pagesText = (pages: readonly number[]) => pages.join(', ');

const tone: Record<PageDiffStatus, string> = {
  unveraendert: 'bg-bg text-muted',
  geaendert: 'bg-warn-soft text-warn-text',
  neu: 'bg-accent-soft text-accent-text',
  entfernt: 'bg-danger-soft text-danger-text',
};

/**
 * Seiten-Diff im Assistenten (E-38): Vergleich der neuen mit der veröffentlichten Version, Vorschlag für Art der
 * Änderung und „geänderte Seiten“. Der Vorschlag wird einmal automatisch übernommen, solange noch nichts gewählt ist.
 */
export function DiffPanel({
  trainingId,
  versionId,
  current,
  onApply,
}: {
  trainingId: string;
  versionId: string;
  current: { kind: ChangeKind | null; pages: string };
  onApply: (kind: ChangeKind | null, pages: string) => void;
}) {
  const q = useQuery({
    queryKey: diffKey(trainingId, versionId),
    queryFn: () => get<VersionDiff>(`/trainings/${trainingId}/versions/${versionId}/diff`),
    retry: false,
    staleTime: 60_000,
  });
  const [showAll, setShowAll] = useState(false);
  const autoApplied = useRef(false);
  const d = q.data;

  useEffect(() => {
    if (!d || autoApplied.current) return;
    autoApplied.current = true;
    if (!current.kind && !current.pages.trim() && d.suggestedChangeKind) {
      onApply(d.suggestedChangeKind, d.suggestedChangeKind === 'inhaltlich' ? pagesText(d.changedPages) : '');
    }
  }, [d, current.kind, current.pages, onApply]);

  if (q.isPending) {
    return (
      <Panel tone="neutral" role="status" className="flex items-center gap-2.5">
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> {t.loading}
      </Panel>
    );
  }
  if (q.isError || !d) {
    return <Panel tone="neutral">{q.error ? `${t.failed} ${errorMessage(q.error)}` : t.failed}</Panel>;
  }

  const changed = d.pages.filter((p) => p.status !== 'unveraendert' || p.moved || p.noText);
  const list = showAll ? d.pages : changed;
  const suggestion = d.suggestedChangeKind
    ? t.suggestion(t.kind[d.suggestedChangeKind]!, d.suggestedChangeKind === 'inhaltlich' ? pagesText(d.changedPages) : '')
    : null;
  const matches =
    !!d.suggestedChangeKind &&
    current.kind === d.suggestedChangeKind &&
    (d.suggestedChangeKind !== 'inhaltlich' || current.pages.replace(/\s/g, '') === pagesText(d.changedPages).replace(/\s/g, ''));

  return (
    <section aria-labelledby="seitendiff" className="flex flex-col gap-3 rounded-box bg-surface px-4 py-3.5" data-testid="diff-panel">
      <div className="flex flex-wrap items-center gap-2.5">
        <GitCompareArrows aria-hidden="true" className="size-5 text-accent-text" />
        <h4 id="seitendiff" className="text-[15px] font-semibold text-ink">
          {t.title(d.against.versionNo)}
        </h4>
      </div>
      <p className="text-[14px] text-ink-2">{t.summary(d.summary)}</p>
      {!d.suggestedChangeKind && <p className="text-[13px] text-muted">{t.nothing}</p>}
      {suggestion && (
        <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-input bg-accent-soft px-3.5 py-2.5">
          <span className="text-[14px] font-medium text-accent-text-strong" data-testid="diff-suggestion">
            {suggestion}
          </span>
          {!matches && (
            <Button size="sm" variant="secondary" onClick={() => onApply(d.suggestedChangeKind, d.suggestedChangeKind === 'inhaltlich' ? pagesText(d.changedPages) : '')}>
              {t.apply}
            </Button>
          )}
        </div>
      )}
      {list.length > 0 && (
        <ul aria-label={t.listLabel} className="flex max-h-[320px] flex-col gap-1.5 overflow-y-auto">
          {list.map((p) => (
            <li key={`${p.oldPageNo}-${p.pageNo}`} className="flex flex-col gap-1 rounded-input bg-bg px-3 py-2 text-[13px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-ink">{t.page(p.pageNo, p.oldPageNo)}</span>
                <span className={cn('rounded-pill px-2 py-0.5 text-[12px] font-semibold', tone[p.status])}>{t.status[p.status]}</span>
                {p.status === 'geaendert' && <span className="text-muted">{t.similarity(Math.round(p.similarity * 100))}</span>}
                {p.moved && <span className="text-muted">{t.moved}</span>}
                {p.noText && <span className="text-warn-text">{t.noText}</span>}
              </div>
              {p.excerpt?.removed && (
                <p className="break-words text-danger-text">
                  <span className="font-semibold">{t.removed}</span> <del>{p.excerpt.removed}</del>
                </p>
              )}
              {p.excerpt?.added && (
                <p className="break-words text-success-text">
                  <span className="font-semibold">{t.added}</span> <ins className="no-underline">{p.excerpt.added}</ins>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {d.pages.length > changed.length && (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setShowAll((x) => !x)}>
          {showAll ? t.showChanged : t.showAll(d.pages.length)}
        </Button>
      )}
    </section>
  );
}
