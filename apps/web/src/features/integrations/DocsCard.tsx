import { ExternalLink } from 'lucide-react';
import { Card, CardDescription, CardTitle } from '@/components/ui';
import { CopyButton } from '@/features/admin/components/common';
import type { IntegrationsMeta } from './api';
import { curlExample } from './logic';

/** Kurzanleitung und Link zur OpenAPI-Beschreibung. */
export function DocsCard({ meta }: { meta: IntegrationsMeta }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const example = curlExample(origin);
  return (
    <Card>
      <CardTitle className="mb-1">Dokumentation</CardTitle>
      <CardDescription>REST-API mit JSON, Basisadresse {origin}{meta.baseUrl}.</CardDescription>
      <ul className="mt-4 flex flex-col gap-3 text-[14px] leading-[1.55] text-ink-2">
        <li>
          <a
            href={meta.openapiUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-accent-text hover:underline"
          >
            OpenAPI-Beschreibung (JSON)
            <ExternalLink aria-hidden="true" className="size-4" />
            <span className="sr-only">(öffnet in neuem Tab)</span>
          </a>
          <p className="text-[13px] text-muted">Zum Import in Postman, Insomnia oder einen Code-Generator.</p>
        </li>
        <li>
          <p className="font-semibold text-ink">Anmeldung</p>
          <p>
            Header <code className="font-mono text-[12.5px]">Authorization: Bearer sn_live_…</code>. Cookies und CSRF-Token werden unter
            /api/v1 nicht verwendet.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="block min-w-0 flex-1 rounded-input bg-bg px-3 py-2 font-mono text-[12px] break-all text-ink">{example}</code>
            <CopyButton text={example} ariaLabel="Beispielaufruf kopieren" />
          </div>
        </li>
        <li>
          <p className="font-semibold text-ink">Webhook-Signatur prüfen</p>
          <p>
            Header <code className="font-mono text-[12.5px]">Schulungsnachweis-Signature: t=…,v1=…</code>: v1 ist HMAC-SHA256 mit dem
            Signaturgeheimnis über „t.Body“ (roher Body). Zeitstempel älter als 5 Minuten verwerfen; Duplikate über die Ereignis-ID im Body
            erkennen. Fehlgeschlagene Zustellungen werden mit wachsendem Abstand wiederholt.
          </p>
        </li>
      </ul>
    </Card>
  );
}
