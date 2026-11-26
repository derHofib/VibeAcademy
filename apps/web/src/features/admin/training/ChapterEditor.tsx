import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { put } from '@/lib/api';
import { adm } from '@/i18n/admin';
import { Button, IconButton, Input, Panel } from '@/components/ui';
import { qk, type Chapter } from '../api';
import { chapterError, type ChapterDraft } from '../wizard';
import { errorMessage } from '../components/common';

const c = adm.wizard.chapters;

const toDraft = (list: Chapter[]): ChapterDraft[] =>
  list.map((ch) => ({
    title: ch.title,
    shortName: ch.short_name,
    fromPage: ch.from_page,
    toPage: ch.to_page,
  }));

/** Kapitel als Seitenbereiche – Ersatz, wenn das PDF keine Lesezeichen hat (E-05). */
export function ChapterEditor({
  trainingId,
  versionId,
  chapters,
  pageCount,
  readOnly,
  onNotice,
}: {
  trainingId: string;
  versionId: string;
  chapters: Chapter[];
  pageCount: number;
  readOnly: boolean;
  onNotice: (msg: string) => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ChapterDraft[]>(() => toDraft(chapters));
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (list: ChapterDraft[]) =>
      put(`/trainings/${trainingId}/versions/${versionId}/chapters`, list),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.version(trainingId, versionId) });
      setEditing(false);
      onNotice(c.saved);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const source = chapters[0]?.source;

  const start = () => {
    setDraft(
      chapters.length ? toDraft(chapters) : [{ title: '', shortName: '', fromPage: 1, toPage: pageCount }],
    );
    setError(null);
    setEditing(true);
  };
  const update = (i: number, patch: Partial<ChapterDraft>) =>
    setDraft((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const add = () =>
    setDraft((d) => {
      const last = d[d.length - 1];
      const from = last ? Math.min(pageCount, last.toPage + 1) : 1;
      return [...d, { title: '', shortName: '', fromPage: from, toPage: pageCount }];
    });

  return (
    <section aria-labelledby="kapitel-titel" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="kapitel-titel" className="text-[15px] font-semibold text-ink">
          {c.title}
        </h3>
        {!readOnly && !editing && (
          <Button variant="ghost" size="sm" onClick={start}>
            {c.edit}
          </Button>
        )}
      </div>

      {!editing &&
        (chapters.length ? (
          <>
            <ol className="flex flex-wrap gap-2">
              {chapters.map((ch) => (
                <li key={ch.idx} className="rounded-pill bg-bg px-3.5 py-2 text-[13.5px] text-ink-2">
                  <span className="font-semibold text-ink">{ch.title}</span> ·{' '}
                  {c.range(ch.from_page, ch.to_page)}
                </li>
              ))}
            </ol>
            <p className="text-[12.5px] text-muted">{source === 'manuell' ? c.manual : c.fromOutline}</p>
          </>
        ) : (
          <Panel tone="neutral">{c.none}</Panel>
        ))}

      {editing && (
        <div className="flex flex-col gap-2.5">
          {draft.map((ch, i) => (
            <fieldset
              key={i}
              className="grid grid-cols-2 gap-2 rounded-box bg-bg p-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_88px_88px_44px] md:items-end"
            >
              <legend className="sr-only">{`${c.title} ${i + 1}`}</legend>
              <label className="col-span-2 flex flex-col gap-1 text-[12.5px] text-muted md:col-span-1">
                {c.colTitle}
                <Input
                  tone="surface"
                  value={ch.title}
                  onChange={(e) => update(i, { title: e.target.value })}
                />
              </label>
              <label className="col-span-2 flex flex-col gap-1 text-[12.5px] text-muted md:col-span-1">
                {c.colShort}
                <Input
                  tone="surface"
                  maxLength={24}
                  value={ch.shortName}
                  onChange={(e) => update(i, { shortName: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1 text-[12.5px] text-muted">
                {c.colFrom}
                <Input
                  tone="surface"
                  type="number"
                  min={1}
                  max={pageCount}
                  value={ch.fromPage}
                  onChange={(e) => update(i, { fromPage: Number(e.target.value) })}
                />
              </label>
              <label className="flex flex-col gap-1 text-[12.5px] text-muted">
                {c.colTo}
                <Input
                  tone="surface"
                  type="number"
                  min={1}
                  max={pageCount}
                  value={ch.toPage}
                  onChange={(e) => update(i, { toPage: Number(e.target.value) })}
                />
              </label>
              <IconButton
                variant="ghost"
                aria-label={c.remove(i + 1)}
                onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}
              >
                <Trash2 aria-hidden="true" />
              </IconButton>
            </fieldset>
          ))}
          {error && (
            <p role="alert" className="text-[13px] font-medium text-danger-text">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={add}>
              <Plus aria-hidden="true" className="size-4" />
              {c.add}
            </Button>
            <span className="flex-1" />
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              {adm.common.cancel}
            </Button>
            <Button
              size="sm"
              disabled={save.isPending}
              onClick={() => {
                const err = chapterError(draft, pageCount);
                setError(err);
                if (!err) save.mutate(draft);
              }}
            >
              {c.save}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
