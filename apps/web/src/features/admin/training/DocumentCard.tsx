import { useRef, useState, type DragEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, LoaderCircle, Upload } from 'lucide-react';
import { patch } from '@/lib/api';
import { adm } from '@/i18n/admin';
import { cn } from '@/lib/cn';
import {
  Button,
  Card,
  CardTitle,
  Field,
  Input,
  LinearProgress,
  Panel,
  StatusChip,
  Textarea,
} from '@/components/ui';
import { qk, thumbUrl, type ChangeKind, type PageMeta, type TrainingVersion } from '../api';
import { formatBytes, formatDateTime, formatDuration, formatNumber, shortHash } from '../format';
import { uploadWithProgress } from '../upload';
import { StatBox, errorMessage } from '../components/common';
import { ChapterEditor } from './ChapterEditor';

const d = adm.wizard.doc;

export interface ChangeInfo {
  kind: ChangeKind | null;
  pages: string;
  note: string;
}

/** „3, 7, 8“ / „3-5“ → [3, 4, 5, 7, 8] (nur gültige Seiten). */
export function parsePageList(input: string, max: number): number[] {
  const out = new Set<number>();
  for (const part of input.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:[-–](\d+))?$/.exec(part);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let p = Math.min(a, b); p <= Math.max(a, b) && p <= max; p++) if (p >= 1) out.add(p);
  }
  return [...out].sort((x, y) => x - y);
}

function Dropzone({
  onFile,
  busy,
  progress,
}: {
  onFile: (f: File) => void;
  busy: boolean;
  progress: number | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  };
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        'flex flex-col gap-3 rounded-box border-2 border-dashed px-5 py-6 transition-colors md:flex-row md:items-center',
        over ? 'border-accent bg-accent-soft' : 'border-accent-ring bg-surface',
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-14 shrink-0 items-center justify-center rounded-input bg-accent-soft text-accent-text"
      >
        {busy ? <LoaderCircle className="size-6 animate-spin" /> : <Upload className="size-6" />}
      </span>
      <div className="min-w-0 flex-1">
        {busy ? (
          <>
            <p className="text-[15px] font-semibold text-ink">{d.uploading}</p>
            <LinearProgress value={progress ?? 0} label={d.uploading} className="mt-2 max-w-sm" />
          </>
        ) : (
          <>
            <p className="text-[15px] text-ink">
              <span className="font-semibold">{d.dropTitle}</span> {d.dropOr}{' '}
              <button
                type="button"
                onClick={() => input.current?.click()}
                className="min-h-11 rounded-pill font-semibold text-accent-text underline-offset-4 hover:underline"
              >
                {d.dropPick}
              </button>
            </p>
            <p className="text-[13px] text-muted">{d.dropHint}</p>
          </>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        tabIndex={-1}
        aria-label={d.dropPick}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

function PageThumb({
  trainingId,
  versionId,
  page,
  readOnly,
  floor,
  onNotice,
}: {
  trainingId: string;
  versionId: string;
  page: PageMeta;
  readOnly: boolean;
  floor: number;
  onNotice: (m: string) => void;
}) {
  const qc = useQueryClient();
  const [value, setValue] = useState(page.t_min_manual ? String(page.t_min_manual) : '');
  const save = useMutation({
    mutationFn: (tMinManual: number | null) =>
      patch(`/trainings/${trainingId}/versions/${versionId}/pages/${page.page_no}`, { tMinManual }),
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: qk.version(trainingId, versionId) });
      onNotice(v === null ? `${d.pageLabel(page.page_no)}: ${d.manualReset}` : d.manualSet(page.page_no, v));
    },
    onError: (e) => onNotice(errorMessage(e)),
  });
  const commit = () => {
    const n = Number(value.trim());
    const next = value.trim() === '' ? null : Number.isInteger(n) && n >= 1 && n <= 1800 ? n : undefined;
    if (next === undefined) {
      setValue(page.t_min_manual ? String(page.t_min_manual) : '');
      return;
    }
    if (next !== page.t_min_manual) save.mutate(next);
  };
  const warn = !page.has_text;
  return (
    <li className="flex min-w-0 flex-col items-center gap-1.5">
      <div
        className={cn(
          'relative aspect-[595/842] w-full overflow-hidden rounded-[12px] bg-surface shadow-soft',
          warn && 'bg-warn-soft shadow-[0_0_0_2px_var(--color-warn-line)]',
        )}
      >
        {page.has_thumb ? (
          <img
            src={thumbUrl(trainingId, versionId, page.page_no)}
            alt={d.pageThumbAlt(page.page_no)}
            loading="lazy"
            className={cn('size-full object-contain', warn && 'opacity-60 mix-blend-multiply')}
          />
        ) : (
          <div aria-hidden="true" className="flex size-full flex-col gap-1.5 p-[12%]">
            <span className="h-1.5 w-3/5 rounded bg-line" />
            <span className="h-1 w-full rounded bg-line" />
            <span className="h-1 w-5/6 rounded bg-line" />
            <span className={cn('mt-2 flex-1 rounded', warn ? 'bg-warn-soft' : 'bg-bg')} />
          </div>
        )}
      </div>
      <p className="text-[12.5px] text-ink-2 tabular-nums">
        {d.pageLabel(page.page_no)} · <span className="font-semibold text-ink">{page.t_min_effective} s</span>
        {warn && <span className="sr-only"> ({d.pageNoText})</span>}
      </p>
      {warn && !readOnly && (
        <label className="flex items-center gap-1.5 text-[12px] text-warn-text">
          <span className="sr-only">{d.manualLabel(page.page_no)}</span>
          <Input
            inputMode="numeric"
            value={value}
            placeholder={String(floor)}
            onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ''))}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              }
            }}
            className="h-11 w-16 bg-surface px-2 text-center text-[14px] shadow-soft"
          />
          <span aria-hidden="true">s</span>
        </label>
      )}
    </li>
  );
}

/** Linke Karte „Dokument“ (Screen 2): Upload, Analyse, PDF-Karte, Kennzahlen, Seitenraster, Kapitel, Art der Änderung. */
export function DocumentCard({
  trainingId,
  version,
  previousVersionNo,
  floor,
  change,
  onChange,
  onUploaded,
  onNotice,
}: {
  trainingId: string;
  version: TrainingVersion | null;
  previousVersionNo: number | null;
  floor: number;
  change: ChangeInfo;
  onChange: (c: ChangeInfo) => void;
  onUploaded: (versionId: string) => void;
  onNotice: (m: string) => void;
}) {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<number | null>(null);
  const [replacing, setReplacing] = useState(false);
  const replaceInput = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('datei', file, file.name);
      setProgress(0);
      return uploadWithProgress<{ id: string }>(`/trainings/${trainingId}/versions`, form, setProgress);
    },
    onSuccess: async (r) => {
      setProgress(null);
      setReplacing(false);
      await qc.invalidateQueries({ queryKey: qk.training(trainingId) });
      onUploaded(r.id);
    },
    onError: () => setProgress(null),
  });
  const onFile = (f: File) => {
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') {
      upload.reset();
      onNotice(d.errorPdfOnly);
      return;
    }
    upload.mutate(f);
  };

  const published = !!version?.publishedAt;
  const analysing = version && (version.status === 'hochgeladen' || version.status === 'analyse');
  const ready = version && (version.status === 'bereit' || version.status === 'veroeffentlicht');
  const showDrop = !version || replacing || upload.isPending;

  return (
    <Card radius="lg" padding="lg" className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{d.card}</CardTitle>
        {version && (
          <StatusChip
            tone={
              published
                ? 'success'
                : version.status === 'fehler'
                  ? 'danger'
                  : version.status === 'bereit'
                    ? 'warn'
                    : 'info'
            }
          >
            {d.versionChip(version.versionNo, adm.status.version[version.status] ?? version.status)}
          </StatusChip>
        )}
      </div>

      {upload.isError && (
        <Panel tone="danger" role="alert">
          {errorMessage(upload.error)}
        </Panel>
      )}

      {version && !showDrop && (
        <div className="flex flex-wrap items-center gap-4 rounded-box bg-accent-soft px-5 py-4">
          <span
            aria-hidden="true"
            className="hidden size-12 shrink-0 items-center justify-center rounded-input bg-surface text-accent-text shadow-soft sm:flex"
          >
            <FileText className="size-6" />
          </span>
          <div className="min-w-0 flex-1 basis-56">
            <p className="text-[15px] font-semibold break-all text-ink">{version.fileName}</p>
            <p className="text-[13px] text-ink-2">
              {d.fileMeta(
                version.pageCount ? adm.common.pages(version.pageCount) : '…',
                formatBytes(version.fileSize),
                shortHash(version.sha256),
                formatDateTime(version.createdAt),
              )}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => replaceInput.current?.click()}
            disabled={upload.isPending}
          >
            {published ? d.newVersion : d.replace}
          </Button>
          <input
            ref={replaceInput}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            tabIndex={-1}
            aria-label={published ? d.newVersion : d.replace}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = '';
            }}
          />
        </div>
      )}

      {showDrop && <Dropzone onFile={onFile} busy={upload.isPending} progress={progress} />}

      {analysing && !upload.isPending && (
        <Panel tone="accent" role="status" className="flex items-center gap-3">
          <LoaderCircle aria-hidden="true" className="size-5 shrink-0 animate-spin" />
          <span>
            <strong className="font-semibold">{d.analysing}</strong> {d.analysingHint}
          </span>
        </Panel>
      )}
      {version?.status === 'fehler' && (
        <Panel tone="danger" role="alert">
          <strong className="font-semibold">{d.failed}</strong> {version.analysisError}
        </Panel>
      )}

      {ready && version && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatBox label={d.kpiWords} value={formatNumber(version.totals.words)} />
            <StatBox label={d.kpiTime} value={formatDuration(version.totals.minReadingSeconds)} />
            <StatBox
              label={d.kpiNoText}
              value={version.totals.pagesWithoutText}
              hint={version.totals.pagesWithoutText > 0 ? d.kpiNoTextHint : undefined}
            />
          </div>

          <section aria-labelledby="seitenanalyse" className="flex flex-col gap-3">
            <h3 id="seitenanalyse" className="text-[15px] font-semibold text-ink">
              {d.pagesTitle}
            </h3>
            {version.totals.pagesWithoutText > 0 && !published && (
              <p className="text-[13px] text-muted">{d.noTextExplain}</p>
            )}
            <ul className="grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-4 md:grid-cols-5 2xl:grid-cols-7">
              {version.pages.map((p) => (
                <PageThumb
                  key={p.page_no}
                  trainingId={trainingId}
                  versionId={version.id}
                  page={p}
                  readOnly={published}
                  floor={floor}
                  onNotice={onNotice}
                />
              ))}
            </ul>
          </section>

          <ChapterEditor
            key={`${version.id}-${version.chapters.length}`}
            trainingId={trainingId}
            versionId={version.id}
            chapters={version.chapters}
            pageCount={version.pageCount ?? version.pages.length}
            readOnly={published}
            onNotice={onNotice}
          />

          {published && <Panel tone="neutral">{d.publishedLocked}</Panel>}

          {!published && previousVersionNo && (
            <fieldset className="flex flex-col gap-3 rounded-box bg-bg px-5 py-4">
              <legend className="float-left mb-1 w-full text-[15px] font-semibold text-ink">
                {d.changeKindLegend(previousVersionNo)}
              </legend>
              {(['inhaltlich', 'redaktionell'] as const).map((k) => (
                <label
                  key={k}
                  className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] text-ink-2"
                >
                  <input
                    type="radio"
                    name="changeKind"
                    value={k}
                    checked={change.kind === k}
                    onChange={() => onChange({ ...change, kind: k })}
                    className="size-5 accent-[var(--color-accent)]"
                  />
                  <span>
                    <strong className="font-semibold text-ink">
                      {k === 'inhaltlich' ? d.changeInhaltlich : d.changeRedaktionell}
                    </strong>
                    {k === 'inhaltlich' ? d.changeInhaltlichText : d.changeRedaktionellText}
                  </span>
                </label>
              ))}
              {change.kind === 'inhaltlich' && (
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label={d.changedPages} hint={d.changedPagesHint}>
                    <Input
                      tone="surface"
                      value={change.pages}
                      onChange={(e) => onChange({ ...change, pages: e.target.value })}
                    />
                  </Field>
                  <Field label={d.changeNote}>
                    <Textarea
                      tone="surface"
                      rows={2}
                      value={change.note}
                      onChange={(e) => onChange({ ...change, note: e.target.value })}
                    />
                  </Field>
                </div>
              )}
            </fieldset>
          )}
        </>
      )}
    </Card>
  );
}
