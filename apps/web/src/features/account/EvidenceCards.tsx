import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Download, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StatusChip, type StatusTone } from '@/components/ui/status';
import { cn } from '@/lib/cn';
import { formatDate } from '@/features/admin/format';
import { participantPath } from '@/features/participant/api';
import { ta } from '@/i18n/account';
import { evidencePdfUrl } from './api';
import { canDownload, type MyEvidence, type Validity, type ValidityKind } from './model';

const OPEN_TONE: Record<string, StatusTone> = {
  offen: 'info',
  geoeffnet: 'info',
  gelesen: 'info',
  bestanden: 'warn',
  ueberfaellig: 'danger',
};

const VALIDITY_CHIP: Record<ValidityKind, { tone: StatusTone; label: string }> = {
  gueltig: { tone: 'success', label: ta.card.valid },
  laeuftAb: { tone: 'warn', label: ta.card.expiring },
  abgelaufen: { tone: 'danger', label: ta.card.expired },
  keine: { tone: 'neutral', label: ta.card.exempt },
};

function CardHead({ e, aside }: { e: MyEvidence; aside?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] text-muted">{e.tenant_name}</p>
        <h3 className="mt-0.5 font-heading text-[16.5px] leading-snug font-bold break-words text-ink">{e.training_titel}</h3>
      </div>
      {aside}
    </div>
  );
}

/** Noch nicht bestätigte Einladung: Status + „Weiter“ in die Teilnahme. */
export function OpenEvidenceCard({ e }: { e: MyEvidence }) {
  return (
    <Card
      padding="none"
      className="flex flex-col gap-3.5 rounded-[22px] p-[18px] sm:flex-row sm:items-center sm:gap-5"
      data-testid="nachweis-offen"
    >
      <div className="min-w-0 flex-1">
        <CardHead e={e} />
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <StatusChip tone={OPEN_TONE[e.status] ?? 'info'}>{ta.status[e.status] ?? e.status}</StatusChip>
          <span className="text-[12.5px] text-muted">{ta.card.version(e.version_no)}</span>
        </div>
      </div>
      <Button asChild size="md" className="w-full sm:w-auto">
        <Link to={participantPath.start(e.invitation_id)} aria-label={ta.card.continueAria(e.training_titel)}>
          {ta.card.continue}
          <ArrowRight aria-hidden="true" className="size-[18px]" strokeWidth={2.25} />
        </Link>
      </Button>
    </Card>
  );
}

/** Erledigt: Nachweis-Nr., Gültigkeit (grün/gelb/rot), Download und Prüflink. */
export function DoneEvidenceCard({ e }: { e: MyEvidence & { validity: Validity } }) {
  const chip = VALIDITY_CHIP[e.validity.kind];
  const exempt = e.status === 'befreit';
  return (
    <Card padding="none" className="flex flex-col gap-3.5 rounded-[22px] p-[18px]" data-testid="nachweis-erledigt">
      <CardHead
        e={e}
        aside={
          <StatusChip tone={chip.tone} size="md" className="mt-0.5">
            {chip.label}
          </StatusChip>
        }
      />
      {exempt ? (
        <p className="text-[14px] leading-[1.5] text-muted">{ta.card.exemptText}</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2">
            <Fact label={ta.card.nr} value={e.nachweis_nr ?? '—'} />
            <Fact
              label={ta.card.validUntil}
              value={formatDate(e.valid_until)}
              note={
                e.validity.kind === 'laeuftAb' && e.validity.daysLeft !== null ? ta.card.daysLeft(e.validity.daysLeft) : undefined
              }
              tone={e.validity.kind}
            />
            <Fact label={ta.card.completedAt} value={formatDate(e.completed_at)} className="col-span-2 sm:col-span-1" />
            <Fact label={ta.card.versionLabel} value={String(e.version_no)} className="hidden sm:block" />
          </dl>
          <div className="flex flex-col gap-2 sm:flex-row" aria-live="polite">
            {canDownload(e) ? (
              <Button asChild variant="tonal" size="md" className="sm:flex-1">
                <a href={evidencePdfUrl(e.invitation_id)} download aria-label={ta.card.downloadAria(e.training_titel)}>
                  <Download aria-hidden="true" className="size-[18px]" />
                  {ta.card.download}
                </a>
              </Button>
            ) : (
              <p
                role="status"
                className="flex h-12 items-center justify-center gap-2 rounded-pill bg-bg px-4 text-[14px] font-medium text-ink-2 sm:flex-1"
              >
                {e.evidence_status === 'fehler' ? (
                  ta.card.failed
                ) : (
                  <>
                    <Loader2 aria-hidden="true" className="size-[18px] animate-spin" />
                    {ta.card.pending}
                  </>
                )}
              </p>
            )}
            {e.verify_code && (
              <Button asChild variant="ghost" size="md" className="sm:flex-1">
                <Link to={participantPath.verify(e.verify_code)} aria-label={ta.card.verifyAria(e.training_titel)}>
                  <ShieldCheck aria-hidden="true" className="size-[18px]" />
                  {ta.card.verify}
                </Link>
              </Button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function Fact({
  label,
  value,
  note,
  tone,
  className,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: ValidityKind;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 rounded-[16px] bg-bg px-3.5 py-2.5', className)}>
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 text-[14.5px] font-semibold break-words text-ink',
          tone === 'abgelaufen' && 'text-danger-text',
          tone === 'laeuftAb' && 'text-warn-text',
        )}
      >
        {value}
        {note && <span className="block text-[12px] font-medium">{note}</span>}
      </dd>
    </div>
  );
}
