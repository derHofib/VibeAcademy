import { useEffect, useId, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Loader2, ShieldCheck } from 'lucide-react';
import { post, sha256Hex } from '@/lib/api';
import { ParticipantLayout } from '@/components/layout/ParticipantLayout';
import { Button } from '@/components/ui/button';
import { Card, Panel } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/cn';
import { tp } from '@/i18n/participant';
import { participantKeys, type SignatureInfo } from './api';

/** Weiterleitung im Browser (eigene Funktion, damit Tests sie ersetzen können). */
export const redirectTo = { go: (url: string) => window.location.assign(url) };

/**
 * FES/QES (E-40): Bestätigungstext ankreuzen → Weiterleitung zum Signaturanbieter → Rückleitung auf diese Seite
 * (`?signatur=ok|abgebrochen|fehlgeschlagen`). Kein Unterschriftsfeld und kein Code – der Anbieter identifiziert.
 */
export function ProviderSignForm({
  id,
  info,
  header,
  steps,
}: {
  id: string;
  info: SignatureInfo;
  header: { title: string; onBack: () => void };
  steps: ReactNode;
}) {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const outcome = params.get('signatur');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(outcome === 'ok');
  const [error, setError] = useState<string | null>(
    outcome === 'abgebrochen' ? tp.sign.providerCancelled : outcome === 'fehlgeschlagen' ? tp.sign.providerFailed : null,
  );
  const confirmId = useId();
  const level = info.level === 'qes' ? 'qes' : 'fes';

  // Rückleitung „ok“, aber noch keine Unterschrift sichtbar → beim Server nachfragen
  useEffect(() => {
    if (outcome !== 'ok') return;
    let cancelled = false;
    void post<{ outcome: string }>(`/me/invitations/${id}/signature/provider/complete`)
      .then((r) => {
        if (cancelled) return;
        if (r.outcome === 'abgeschlossen') void qc.invalidateQueries({ queryKey: participantKeys.signature(id) });
        else setError(r.outcome === 'abgebrochen' ? tp.sign.providerCancelled : tp.sign.providerFailed);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : tp.sign.providerFailed))
      .finally(() => !cancelled && setChecking(false));
    return () => {
      cancelled = true;
    };
  }, [outcome, id, qc]);

  const start = async () => {
    if (!agree || busy) return;
    setBusy(true);
    setError(null);
    try {
      const confirmTextSha256 = await sha256Hex(info.confirmText);
      const r = await post<{ redirectUrl: string }>(`/me/invitations/${id}/signature/provider`, { confirmed: true, confirmTextSha256 });
      redirectTo.go(r.redirectUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : tp.sign.providerFailed);
      setBusy(false);
    }
  };

  return (
    <ParticipantLayout
      {...header}
      footer={
        <>
          <p id="anbieter-hinweis" aria-live="polite" className={cn('min-h-[18px] text-center text-[13px]', agree ? 'text-success' : 'text-muted')}>
            {checking ? tp.sign.providerChecking : agree ? tp.sign.providerReady : tp.sign.missing([tp.sign.missingConfirm])}
          </p>
          {error && (
            <p role="alert" className="text-center text-[13.5px] font-medium text-danger-text">
              {error}
            </p>
          )}
          <Button size="lg" fullWidth disabled={!agree || busy || checking} aria-describedby="anbieter-hinweis" onClick={() => void start()}>
            {busy ? <Loader2 aria-hidden="true" className="size-5 animate-spin" /> : <ExternalLink aria-hidden="true" className="size-5" />}
            {busy ? tp.sign.providerRedirecting : tp.sign.providerSubmit}
          </Button>
        </>
      }
    >
      {steps}
      <Card padding="none" className="flex items-start gap-3.5 rounded-[20px] p-4">
        <Checkbox id={confirmId} checked={agree} onCheckedChange={(v) => setAgree(v === true)} className="mt-0.5" />
        <label htmlFor={confirmId} className="cursor-pointer text-[14px] leading-[1.55] text-ink">
          {info.confirmText}
        </label>
      </Card>
      <Card padding="md" className="flex items-start gap-3.5" data-testid="provider-card">
        <div aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-text">
          <ShieldCheck className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-[16px] font-bold text-ink">{tp.sign.providerTitle}</h2>
          <p className="mt-1 text-[13.5px] leading-[1.5] text-muted">{tp.sign.providerText(tp.sign.providerLevel[level])}</p>
          {info.provider && <p className="mt-2 text-[13px] font-semibold text-ink-2">{info.provider.label}</p>}
        </div>
      </Card>
      {info.provider?.test && <Panel tone="warn">{tp.sign.providerTest}</Panel>}
    </ParticipantLayout>
  );
}
