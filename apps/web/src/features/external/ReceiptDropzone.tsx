import { useRef, useState, type DragEvent } from 'react';
import { Check, CircleAlert, Loader2, Upload, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/features/admin/format';
import { uploadWithProgress } from '@/features/admin/upload';
import { errorMessage } from '@/features/admin/components/common';
import { tx } from '@/i18n/external';
import type { UploadResult } from './api';
import { fileExt, pct } from './model';

export interface ReceiptItem {
  key: string;
  name: string;
  mime: string;
  size: number;
  pages: number;
  progress: number;
  uploadId: string | null;
  error: string | null;
  /** Zuordnung bei „Zertifikat je Person“ */
  personId: string | null;
}

let seq = 0;

/** Lädt Dateien sofort hoch (`POST /api/external-uploads`) und meldet den Fortschritt je Datei. */
export function useReceiptUploads(onChange?: () => void) {
  const [items, setItems] = useState<ReceiptItem[]>([]);
  const update = (key: string, patch: Partial<ReceiptItem>) => setItems((all) => all.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const add = (files: FileList | File[]) => {
    onChange?.();
    for (const file of Array.from(files)) {
      const key = `beleg-${++seq}`;
      setItems((all) => [
        ...all,
        { key, name: file.name, mime: file.type, size: file.size, pages: 1, progress: 0, uploadId: null, error: null, personId: null },
      ]);
      const form = new FormData();
      form.append('datei', file, file.name);
      uploadWithProgress<UploadResult>('/external-uploads', form, (r) => update(key, { progress: r }))
        .then((u) => update(key, { uploadId: u.id, pages: u.pages, mime: u.mime, size: u.size, progress: 1 }))
        .catch((e) => update(key, { error: errorMessage(e) }));
    }
  };
  const remove = (key: string) => {
    onChange?.();
    setItems((all) => all.filter((i) => i.key !== key));
  };
  const assign = (key: string, personId: string | null) => {
    onChange?.();
    update(key, { personId });
  };
  return { items, add, remove, assign, busy: items.some((i) => !i.uploadId && !i.error) };
}

const EXT_COLOR: Record<string, string> = { PDF: 'text-danger-text', JPG: 'text-accent-text', PNG: 'text-accent-text', DATEI: 'text-ink-2' };

/** Belege (Screen 9): Ablagefläche + Liste „✓ hochgeladen“, optional Zuordnung je Person. */
export function ReceiptDropzone({
  uploads,
  perPerson,
  persons,
  groupMode,
}: {
  uploads: ReturnType<typeof useReceiptUploads>;
  perPerson: boolean;
  persons: Array<{ id: string; name: string }>;
  groupMode: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) uploads.add(e.dataTransfer.files);
  };
  const metaFor = (i: ReceiptItem) => {
    const kind = fileExt(i.name, i.mime);
    if (perPerson) {
      return null;
    }
    if (kind === 'PDF') return groupMode ? tx.capture.fileMetaAll(i.pages) : tx.capture.fileMetaPdf(i.pages);
    return tx.capture.fileMetaPhoto(formatBytes(i.size));
  };
  return (
    <div className="flex flex-col gap-2.5">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          'flex items-center gap-3.5 rounded-box border-2 border-dashed bg-surface-hover px-[18px] py-[18px] transition-colors',
          over ? 'border-accent bg-accent-soft' : 'border-[#D5DCEA]',
        )}
      >
        <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-accent-soft text-accent-text">
          <Upload className="size-[22px]" />
        </span>
        <div className="min-w-0 flex-1 text-[14px] leading-[1.45] text-ink">
          <strong className="font-semibold">{tx.capture.dropTitle}</strong>
          {tx.capture.dropOr}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="cursor-pointer font-semibold text-accent-text underline-offset-4 hover:underline"
          >
            {tx.capture.dropPick}
          </button>
          <span className="block text-[12.5px] text-muted">{tx.capture.dropHint}</span>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="application/pdf,image/jpeg,image/png,image/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            if (e.target.files?.length) uploads.add(e.target.files);
            e.target.value = '';
          }}
          data-testid="beleg-input"
        />
      </div>
      {uploads.items.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label={tx.capture.receipts}>
          {uploads.items.map((i) => {
            const ext = fileExt(i.name, i.mime);
            const meta = metaFor(i);
            return (
              <li key={i.key} className="flex flex-wrap items-center gap-3 rounded-input bg-bg px-3.5 py-2.5" data-testid="beleg-datei">
                <span aria-hidden="true" className={cn('flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-surface text-[10px] font-bold', EXT_COLOR[ext])}>
                  {ext === 'DATEI' ? '…' : ext}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-ink">{i.name}</p>
                  {perPerson ? (
                    <label className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-muted">
                      <span>{tx.capture.assignedTo}:</span>
                      <select
                        aria-label={tx.capture.assignTo(i.name)}
                        value={i.personId ?? ''}
                        onChange={(e) => uploads.assign(i.key, e.target.value || null)}
                        className="min-h-8 max-w-[220px] cursor-pointer rounded-pill bg-surface px-2 text-[12.5px] font-semibold text-ink"
                      >
                        <option value="">{tx.capture.unassigned}</option>
                        {persons.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    meta && <p className="text-[12.5px] text-muted">{meta}</p>
                  )}
                </div>
                <span className="flex items-center gap-1 text-[12.5px] font-semibold" aria-live="polite">
                  {i.error ? (
                    <span className="flex items-center gap-1 text-danger-text" title={i.error}>
                      <CircleAlert aria-hidden="true" className="size-4" />
                      {tx.capture.uploadFailed}
                    </span>
                  ) : i.uploadId ? (
                    <span className="flex items-center gap-1 text-success-text">
                      <Check aria-hidden="true" className="size-4" strokeWidth={2.5} />
                      {tx.capture.uploaded}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-muted">
                      <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                      {tx.capture.uploading(pct(i.progress))}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  aria-label={tx.capture.removeFile(i.name)}
                  onClick={() => uploads.remove(i.key)}
                  className="relative inline-flex size-9 cursor-pointer items-center justify-center rounded-full text-ink-2 after:absolute after:-inset-1 hover:bg-surface"
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
