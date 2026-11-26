import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, FileUp, Link2, Loader2 } from 'lucide-react';
import { get } from '@/lib/api';
import { Button, Card, EmptyState, Field, Panel, Select } from '@/components/ui';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { uploadWithProgress } from '@/features/admin/upload';
import { errorMessage, Loading } from '@/features/admin/components/common';
import { xk, type Target } from '@/features/external/api';
import { Finder, MobileHeader, MobileShell } from '@/features/external/MobileParts';
import { tx } from '@/i18n/external';

const s = tx.submit;

/** `/konto/extern/neu` – Mitarbeiter fotografiert den Beleg (Screen 10a, Schritt 1). */
export default function SubmitExternalPage() {
  return <RequireAuth>{() => <Capture />}</RequireAuth>;
}

function Capture() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const targets = useQuery({ queryKey: xk.targets, queryFn: () => get<Target[]>('/me/external-records/targets') });
  const [personId, setPersonId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = targets.data ?? [];
  const target = list.find((t) => t.personId === personId) ?? list[0];

  const send = async (files: FileList | null) => {
    if (!files?.length || !target) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    for (const f of Array.from(files).slice(0, 5)) form.append('dateien', f, f.name);
    form.append('personId', target.personId);
    try {
      const r = await uploadWithProgress<{ id: string }>('/me/external-records', form);
      void qc.invalidateQueries({ queryKey: xk.mine });
      navigate(`/konto/extern/${r.id}`, { replace: true });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <MobileShell header={<MobileHeader onBack={() => navigate('/konto')} eyebrow={s.eyebrow} title={s.title} backLabel={s.back} />}>
      {targets.isPending ? (
        <Loading />
      ) : targets.isError ? (
        <Panel tone="danger" role="alert">
          {errorMessage(targets.error)}
        </Panel>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Link2 />}
            title={s.noTargets}
            description={s.noTargetsText}
            action={
              <Button asChild variant="secondary">
                <Link to="/konto">{s.toAccount}</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          {list.length > 1 && (
            <Field label={s.org}>
              <Select tone="surface" value={target?.personId ?? ''} onChange={(e) => setPersonId(e.target.value)}>
                {list.map((t) => (
                  <option key={t.personId} value={t.personId}>
                    {t.tenantName} · {t.personName}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Finder label={s.finderLabel} className="min-h-[360px] items-center">
            <div className="flex max-w-[260px] flex-col items-center gap-4 text-center text-[#E2E8F0]">
              {busy ? (
                <>
                  <Loader2 aria-hidden="true" className="size-9 animate-spin text-white" />
                  <p role="status" className="text-[15px] font-semibold text-white">
                    {s.uploading}
                  </p>
                </>
              ) : (
                <>
                  <span aria-hidden="true" className="flex size-16 items-center justify-center rounded-full bg-white/10 text-white">
                    <Camera className="size-8" />
                  </span>
                  <p className="text-[14.5px] leading-[1.55]">{s.intro}</p>
                </>
              )}
            </div>
          </Finder>
          {error && (
            <Panel tone="danger" role="alert">
              {error}
            </Panel>
          )}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="kamera-input"
            onChange={(e) => void send(e.target.files)}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="datei-input"
            onChange={(e) => void send(e.target.files)}
          />
          <Button size="lg" fullWidth disabled={busy} onClick={() => cameraRef.current?.click()}>
            <Camera aria-hidden="true" className="size-5" />
            {s.takePhoto}
          </Button>
          <Button variant="secondary" size="lg" fullWidth disabled={busy} onClick={() => fileRef.current?.click()}>
            <FileUp aria-hidden="true" className="size-5" />
            {s.pickFile}
          </Button>
        </>
      )}
    </MobileShell>
  );
}
