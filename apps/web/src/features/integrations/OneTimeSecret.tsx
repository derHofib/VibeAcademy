import { KeyRound } from 'lucide-react';
import { Button, Panel } from '@/components/ui';
import { CopyButton } from '@/features/admin/components/common';

/** Geheimnis genau einmal anzeigen (API-Schlüssel, Webhook-Signaturgeheimnis) – mit Kopieren und deutlichem Hinweis. */
export function OneTimeSecret({ title, value, hint, onDone }: { title: string; value: string; hint: string; onDone: () => void }) {
  return (
    <Panel tone="warn" role="region" aria-label={title} className="flex flex-col gap-3">
      <p className="flex items-center gap-2 font-semibold">
        <KeyRound aria-hidden="true" className="size-[18px] shrink-0" />
        {title}
      </p>
      <p>{hint}</p>
      <code className="block rounded-input bg-surface px-3 py-2.5 font-mono text-[13px] break-all text-ink select-all" tabIndex={0}>
        {value}
      </code>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={value} variant="secondary" label="Kopieren" ariaLabel={`${title} kopieren`} />
        <Button variant="ghost" size="sm" onClick={onDone}>
          Ich habe es sicher abgelegt
        </Button>
      </div>
    </Panel>
  );
}
