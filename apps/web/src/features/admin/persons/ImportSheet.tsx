import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { post } from '@/lib/api';
import { adm } from '@/i18n/admin';
import { Button, Field, Panel, Sheet, Textarea } from '@/components/ui';
import { CSV_TEMPLATE, precheckCsv, summarizeImport, type ImportResult } from '../csv';
import { qk } from '../api';
import { errorMessage } from '../components/common';

const t = adm.persons.import;

/** CSV-Import mit Ergebnis je Zeile. */
export function ImportSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [csv, setCsv] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: (text: string) => post<ImportResult>('/persons/import', { csv: text }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.personsAll });
      void qc.invalidateQueries({ queryKey: qk.orgUnits });
    },
  });
  const summary = run.data ? summarizeImport(run.data) : null;
  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(`\uFEFF${CSV_TEMPLATE}`)}`;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t.title}
      description={t.description}
      desktopPlacement="right"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {adm.common.cancel}
          </Button>
          <Button
            disabled={run.isPending}
            onClick={() => {
              const err = precheckCsv(csv);
              setLocal(err);
              if (!err) run.mutate(csv);
            }}
          >
            {run.isPending ? t.running : t.submit}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t.file} id="csv-datei">
          <input
            id="csv-datei"
            type="file"
            accept=".csv,text/csv,text/plain"
            className="block w-full rounded-input bg-bg px-3.5 py-3 text-[14px] text-ink-2 file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-pill file:border-0 file:bg-surface file:px-4 file:font-semibold file:text-ink file:shadow-soft"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) {
                setCsv(await f.text());
                run.reset();
              }
            }}
          />
        </Field>
        <Field label={t.paste} error={local ?? undefined}>
          <Textarea
            rows={7}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={CSV_TEMPLATE}
            className="font-mono text-[13px]"
          />
        </Field>
        <a
          href={templateHref}
          download="personen-vorlage.csv"
          className="inline-flex min-h-11 items-center gap-2 self-start rounded-pill px-2 text-[14px] font-semibold text-accent-text underline-offset-4 hover:underline"
        >
          <Download aria-hidden="true" className="size-4" />
          {t.template}
        </a>
        <p className="text-[13px] text-muted">{t.matchHint}</p>
        <div role="status" aria-live="polite">
          {summary && (
            <Panel tone={summary.tone}>
              <p className="font-semibold" data-testid="import-ergebnis">
                {summary.headline}
              </p>
              {summary.lines.length > 0 && (
                <ul className="mt-1.5 list-disc pl-5">
                  {summary.lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>
        {run.isError && (
          <Panel tone="danger" role="alert">
            {errorMessage(run.error)}
          </Panel>
        )}
      </div>
    </Sheet>
  );
}
