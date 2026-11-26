import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Languages, LoaderCircle } from 'lucide-react';
import { get, post } from '@/lib/api';
import { ac } from '@/i18n/admin-diff-i18n';
import { Button, Card, CardTitle, Field, Input, Panel, StatusChip } from '@/components/ui';
import { qk, type Training, type TrainingVersion } from '../api';
import { errorMessage } from '../components/common';
import { uploadWithProgress } from '../upload';
import { parsePageList } from './DocumentCard';

const t = ac.languages;

/**
 * Sprachfassungen (E-39): englische Fassung zur aktuellen deutschen Versionsnummer hochladen und veröffentlichen.
 * Einladungen wählen sie für Personen mit Sprache Englisch; ohne veröffentlichte Fassung gilt die deutsche.
 */
export function LanguageVersionsCard({ training, onNotice }: { training: Training; onNotice: (m: string) => void }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState('');
  const de = training.versions.filter((v) => (v.sprache ?? 'de') === 'de').sort((a, b) => b.version_no - a.version_no)[0];
  const en = de ? training.versions.find((v) => v.sprache === 'en' && v.version_no === de.version_no) : undefined;
  const enVersion = useQuery({
    queryKey: qk.version(training.id, en?.id ?? ''),
    queryFn: () => get<TrainingVersion>(`/trainings/${training.id}/versions/${en!.id}`),
    enabled: !!en,
    refetchInterval: (q) => (q.state.data && ['hochgeladen', 'analyse'].includes(q.state.data.status) ? 1000 : false),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: qk.training(training.id) });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('sprache', 'en');
      form.append('datei', file, file.name);
      return uploadWithProgress<{ id: string }>(`/trainings/${training.id}/versions`, form);
    },
    onSuccess: () => void refresh(),
  });
  const publish = useMutation({
    mutationFn: (v: TrainingVersion) => {
      const list = parsePageList(pages, v.pageCount ?? 0);
      return post(`/trainings/${training.id}/versions/${v.id}/publish`, list.length ? { changedPages: list } : {});
    },
    onSuccess: async () => {
      onNotice(t.publishedNotice);
      await refresh();
      await enVersion.refetch();
    },
  });

  const v = enVersion.data;
  const status = v?.status;
  const busy = upload.isPending || status === 'hochgeladen' || status === 'analyse';
  const deNo = de?.version_no ?? null;

  return (
    <Card radius="lg" padding="lg" className="flex flex-col gap-4" data-testid="language-versions">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{t.title}</CardTitle>
        <Languages aria-hidden="true" className="size-5 text-muted" />
      </div>
      {!deNo ? (
        <p className="text-[14px] text-muted">{t.needGerman}</p>
      ) : (
        <>
          <p className="text-[14px] text-ink-2">{t.intro(deNo)}</p>
          <ul className="flex flex-col gap-2 text-[14px]">
            <li className="flex flex-wrap items-center justify-between gap-2 rounded-input bg-bg px-3.5 py-2.5">
              <span className="font-semibold text-ink">{t.de}</span>
              <StatusChip tone={de?.published_at ? 'success' : 'warn'}>{`V${deNo}`}</StatusChip>
            </li>
            <li className="flex flex-wrap items-center justify-between gap-2 rounded-input bg-bg px-3.5 py-2.5">
              <span className="font-semibold text-ink">{t.en}</span>
              {!en ? (
                <span className="text-muted">{t.none}</span>
              ) : busy ? (
                <span className="flex items-center gap-1.5 text-muted">
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> {upload.isPending ? t.uploading : t.analysing}
                </span>
              ) : status === 'fehler' ? (
                <StatusChip tone="danger">{t.failed}</StatusChip>
              ) : v ? (
                <StatusChip tone={v.publishedAt ? 'success' : 'warn'}>{v.publishedAt ? t.published(v.pageCount ?? 0) : t.ready(v.pageCount ?? 0)}</StatusChip>
              ) : null}
            </li>
          </ul>
          {(upload.isError || publish.isError) && (
            <Panel tone="danger" role="alert">
              {errorMessage(upload.error ?? publish.error)}
            </Panel>
          )}
          {v && status === 'bereit' && !v.publishedAt && (
            <div className="flex flex-col gap-3">
              {deNo >= 2 && (
                <Field label={t.changedPages} hint={t.changedPagesHint}>
                  <Input tone="surface" value={pages} onChange={(e) => setPages(e.target.value)} />
                </Field>
              )}
              <Button onClick={() => publish.mutate(v)} disabled={publish.isPending}>
                {publish.isPending ? t.publishing : t.publish}
              </Button>
            </div>
          )}
          {!v?.publishedAt && (
            <>
              <Button variant="secondary" className="self-start" disabled={busy} onClick={() => input.current?.click()}>
                {en ? t.replace : t.upload}
              </Button>
              <input
                ref={input}
                type="file"
                accept="application/pdf,.pdf"
                className="sr-only"
                tabIndex={-1}
                aria-label={en ? t.replace : t.upload}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload.mutate(f);
                  e.target.value = '';
                }}
              />
            </>
          )}
        </>
      )}
    </Card>
  );
}
