import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Button, StatusChip } from '@/components/ui';
import { post, ApiError } from '@/lib/api';
import { ssoKeys, type SsoSettings } from './api';

export interface DomainStatus {
  domain: string;
  verified: boolean;
  verifiedAt: string | null;
  txtName: string;
  txtValue: string;
}

/**
 * Domain-Nachweis per DNS-TXT (Migration 018): erst bestätigte Domains leiten zur Firmenanmeldung weiter
 * und erlauben das automatische Anlegen bzw. Verknüpfen von Konten.
 */
export function DomainVerification({ data }: { data: SsoSettings & { emailDomainStatus?: DomainStatus[] } }) {
  const items = data.emailDomainStatus ?? [];
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-3 rounded-box bg-bg px-4 py-3" data-testid="sso-domains">
      <p className="text-sm text-ink-2">
        Damit niemand eine fremde Domain verwendet, muss jede Domain einmal per DNS-Eintrag bestätigt werden. Erst danach
        greifen die Firmenanmeldung auf der Anmeldeseite und das automatische Anlegen von Konten.
      </p>
      <ul className="flex flex-col gap-3">
        {items.map((d) => (
          <DomainRow key={d.domain} d={d} />
        ))}
      </ul>
    </div>
  );
}

function DomainRow({ d }: { d: DomainStatus }) {
  const qc = useQueryClient();
  const [copied, setCopied] = useState<string | null>(null);
  const verify = useMutation({
    mutationFn: () => post<{ verified: boolean }>(`/tenant/sso/domains/${encodeURIComponent(d.domain)}/verify`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ssoKeys.settings }),
  });
  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* Zwischenablage nicht verfügbar – Wert ist sichtbar */
    }
  };
  return (
    <li className="rounded-box bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-ink">{d.domain}</span>
        {d.verified ? (
          <StatusChip tone="success" icon={<ShieldCheck className="size-4" aria-hidden />}>bestätigt</StatusChip>
        ) : (
          <StatusChip tone="warn" icon={<ShieldAlert className="size-4" aria-hidden />}>nicht bestätigt</StatusChip>
        )}
      </div>
      {!d.verified && (
        <div className="mt-3 flex flex-col gap-2 text-sm">
          <p className="text-ink-2">Legen Sie beim DNS-Anbieter diesen TXT-Eintrag an und prüfen Sie danach:</p>
          {(
            [
              ['Name', d.txtName, 'name'],
              ['Wert', d.txtValue, 'value'],
            ] as const
          ).map(([label, value, key]) => (
            <div key={key} className="flex flex-wrap items-center gap-2">
              <span className="w-12 text-muted">{label}</span>
              <code className="min-w-0 flex-1 break-all rounded-lg bg-bg px-2 py-1 font-mono text-xs text-ink">{value}</code>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => copy(value, key)}
                aria-label={`${label} kopieren`}
              >
                {copied === key ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="secondary" onClick={() => verify.mutate()} disabled={verify.isPending}>
              {verify.isPending ? 'Prüfe …' : 'Jetzt prüfen'}
            </Button>
            {verify.isError && (
              <span role="alert" className="text-danger-text">
                {verify.error instanceof ApiError ? verify.error.message : 'Prüfung fehlgeschlagen'}
              </span>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
