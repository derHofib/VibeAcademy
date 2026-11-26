import { useId, useState } from 'react';
import { useParams } from 'react-router';
import { BadgeCheck, FileSearch, Loader2, SearchX } from 'lucide-react';
import { ParticipantLayout } from '@/components/layout/ParticipantLayout';
import { Card, CardDescription, CardTitle, Panel } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill } from '@/components/ui/status';
import { cn } from '@/lib/cn';
import { tp, formatDateTime } from '@/i18n/participant';
import { useVerify } from '@/features/participant/api';
import { LoadingScreen } from '@/features/participant/ScreenStates';

async function fileSha256(file: File): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Öffentliche Echtheitsprüfung `/verify/:code` (E-10): Status, Nr., Datum, Schulung, Initialen, SHA-256 + lokaler Dateiabgleich. */
export default function VerifyPage() {
  const { code = '' } = useParams();
  const q = useVerify(code);
  const inputId = useId();
  const [check, setCheck] = useState<{ state: 'idle' } | { state: 'busy' } | { state: 'done'; hash: string; match: boolean }>({ state: 'idle' });

  if (q.isPending) return <LoadingScreen label={tp.verify.loading} />;
  if (q.isError || !q.data) {
    return (
      <ParticipantLayout title={tp.verify.title} eyebrow={tp.verify.eyebrow} className="justify-start">
        <Card>
          <EmptyState icon={<SearchX />} title={<span role="alert">{tp.verify.notFoundTitle}</span>} description={tp.verify.notFoundText} />
        </Card>
      </ParticipantLayout>
    );
  }
  const v = q.data;
  const valid = v.status === 'gueltig';

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setCheck({ state: 'busy' });
    const hash = await fileSha256(file);
    setCheck({ state: 'done', hash, match: !!v.sha256 && hash === v.sha256.toLowerCase() });
  };

  return (
    <ParticipantLayout title={tp.verify.title} eyebrow={tp.verify.eyebrow}>
      <Card className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div
            aria-hidden="true"
            className={cn('flex size-12 shrink-0 items-center justify-center rounded-full', valid ? 'bg-success-soft text-success' : 'bg-warn-soft text-warn-strong')}
          >
            <BadgeCheck className="size-6" />
          </div>
          <StatusPill tone={valid ? 'success' : 'warn'} appearance="soft" role="status" className="whitespace-normal">
            {valid ? tp.verify.valid : v.status === 'ausstehend' ? tp.verify.pending : tp.verify.otherStatus(v.status)}
          </StatusPill>
        </div>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Fact label={tp.verify.nr} value={v.nachweisNr} />
          {v.versiegeltAm && <Fact label={tp.verify.sealedAt} value={formatDateTime(v.versiegeltAm)} />}
          <Fact label={tp.verify.training} value={`${v.schulung} · ${tp.verify.version(v.version)}`} className="sm:col-span-2" />
          <Fact label={tp.verify.participant} value={v.teilnehmer} />
          <Fact label={tp.verify.issuer} value={v.aussteller} />
          {v.sha256 && <Fact label={tp.verify.hash} value={v.sha256} mono className="sm:col-span-2" />}
        </dl>
        <p className="text-[12.5px] text-muted">{tp.verify.privacy}</p>
      </Card>

      {v.sha256 && (
        <Card className="flex flex-col gap-3">
          <div>
            <CardTitle>{tp.verify.fileTitle}</CardTitle>
            <CardDescription className="mt-1">{tp.verify.fileText}</CardDescription>
          </div>
          <label
            htmlFor={inputId}
            className="inline-flex h-12 cursor-pointer items-center justify-center gap-2 self-start rounded-pill bg-accent-soft px-5 text-[14.5px] font-semibold text-accent-text hover:bg-accent-ring/60 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
          >
            <FileSearch aria-hidden="true" className="size-[18px]" />
            {tp.verify.fileLabel}
            <input
              id={inputId}
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </label>
          <div aria-live="polite">
            {check.state === 'busy' && (
              <p className="flex items-center gap-2 text-[14px] text-muted">
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                {tp.verify.fileChecking}
              </p>
            )}
            {check.state === 'done' && (
              <Panel tone={check.match ? 'success' : 'danger'} data-testid="file-check">
                <p className="font-semibold">{check.match ? tp.verify.fileMatch : tp.verify.fileMismatch}</p>
                <p className="mt-1 text-[12.5px] break-all">{tp.verify.fileHash(check.hash)}</p>
              </Panel>
            )}
          </div>
        </Card>
      )}
    </ParticipantLayout>
  );
}

function Fact({ label, value, mono, className }: { label: string; value: string; mono?: boolean; className?: string }) {
  return (
    <div className={cn('min-w-0 rounded-[16px] bg-bg px-4 py-3', className)}>
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className={cn('mt-0.5 text-[15px] font-semibold text-ink', mono && 'font-mono text-[12.5px] font-medium break-all')}>{value}</dd>
    </div>
  );
}
