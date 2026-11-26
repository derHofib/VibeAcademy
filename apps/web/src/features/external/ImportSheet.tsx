import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, CircleAlert, Download } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button, Field, Panel, SegmentedControl, Sheet } from '@/components/ui';
import { uploadWithProgress } from '@/features/admin/upload';
import { errorMessage } from '@/features/admin/components/common';
import { adm } from '@/i18n/admin';
import { tx } from '@/i18n/external';
import type { ImportResult, ImportRow } from './api';

const t = tx.importSheet;
const TEMPLATE = 'personalnr;name;qualifikation;kurs;anbieter;datum;umfang;ort;gueltig_bis;beleg;arbeitsmedizin\r\n1047;Lea Wagner;Ersthelfer;Erste-Hilfe-Fortbildung;Erste-Hilfe-Ausbildung Muster e. V.;20.11.2026;9 UE;Schulungsraum Lager;;bescheinigung_wagner.pdf;nein\r\n';

const fileClass =
  'block w-full rounded-input bg-bg px-3.5 py-3 text-[14px] text-ink-2 file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-pill file:border-0 file:bg-surface file:px-4 file:font-semibold file:text-ink file:shadow-soft';

/** Import externer Nachweise (CSV + optional ZIP mit Belegen) mit Prüflauf; alles oder nichts. */
export function ExternalImportSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [csv, setCsv] = useState<File | null>(null);
  const [zip, setZip] = useState<File | null>(null);
  const [mode, setMode] = useState<'pruefen' | 'freigeben'>('pruefen');
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger' | 'accent'; text: string } | null>(null);

  const send = async (dryRun: boolean) => {
    if (!csv) {
      setMessage({ tone: 'danger', text: t.needCsv });
      return;
    }
    setBusy(true);
    setMessage(null);
    const form = new FormData();
    form.append('csv', csv, csv.name);
    if (zip) form.append('zip', zip, zip.name);
    form.append('mode', mode);
    if (dryRun) form.append('dryRun', 'true');
    try {
      const r = await uploadWithProgress<ImportResult>('/imports/external', form);
      setRows(r.rows);
      const bad = r.rows.filter((x) => !x.ok).length;
      if (bad) setMessage({ tone: 'danger', text: t.resultFailed(bad, r.rows.length) });
      else if (dryRun) setMessage({ tone: 'accent', text: t.resultOk(r.rows.length) });
      else {
        setMessage({ tone: 'success', text: t.imported(r.created) });
        void qc.invalidateQueries({ queryKey: ['admin'] });
      }
    } catch (e) {
      const body = e instanceof ApiError ? (e.body as { rows?: ImportRow[] } | null) : null;
      if (body?.rows) setRows(body.rows);
      setMessage({ tone: 'danger', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t.title}
      description={t.description}
      desktopPlacement="right"
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={() => send(true)}>
            {t.dryRun}
          </Button>
          <Button disabled={busy} onClick={() => send(false)}>
            {busy ? t.running : t.run}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t.csv} id="extern-csv">
          <input
            id="extern-csv"
            type="file"
            accept=".csv,text/csv,text/plain"
            className={fileClass}
            onChange={(e) => {
              setCsv(e.target.files?.[0] ?? null);
              setRows(null);
              setMessage(null);
            }}
          />
        </Field>
        <Field label={t.zip} id="extern-zip">
          <input
            id="extern-zip"
            type="file"
            accept=".zip,application/zip"
            className={fileClass}
            onChange={(e) => {
              setZip(e.target.files?.[0] ?? null);
              setRows(null);
            }}
          />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span id="import-modus" className="text-[13px] font-medium text-muted">
            {t.mode}
          </span>
          <SegmentedControl
            aria-label={t.mode}
            value={mode}
            onValueChange={setMode}
            options={[
              { value: 'pruefen', label: t.modeCheck },
              { value: 'freigeben', label: t.modeApprove },
            ]}
          />
        </div>
        <p className="text-[12.5px] leading-[1.5] text-muted">{t.columns}</p>
        <Button asChild variant="tonal" size="sm" className="self-start">
          <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(`\uFEFF${TEMPLATE}`)}`} download="externe-nachweise-vorlage.csv">
            <Download aria-hidden="true" className="size-4" />
            {t.template}
          </a>
        </Button>
        <div role="status" aria-live="polite">
          {message && <Panel tone={message.tone}>{message.text}</Panel>}
        </div>
        {rows && rows.length > 0 && (
          <ul aria-label={t.resultsLabel} className="flex flex-col gap-1.5" data-testid="import-zeilen">
            {rows.map((r) => (
              <li key={r.line} className={cn('flex items-start gap-2.5 rounded-input px-3.5 py-2.5 text-[13.5px]', r.ok ? 'bg-bg' : 'bg-danger-soft')}>
                {r.ok ? (
                  <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" strokeWidth={2.5} />
                ) : (
                  <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger-text" />
                )}
                <div className="min-w-0">
                  <p className="font-semibold text-ink">
                    {t.line(r.line)}
                    <span className="sr-only">: {r.ok ? t.rowOk : t.rowError}</span>
                    {r.personName ? ` · ${r.personName}` : ''}
                  </p>
                  {r.errors?.map((er) => (
                    <p key={er} className="text-danger-text">
                      {er}
                    </p>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
        <Button variant="ghost" className="self-start" onClick={() => onOpenChange(false)}>
          {adm.common.cancel}
        </Button>
      </div>
    </Sheet>
  );
}
