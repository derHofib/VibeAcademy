import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Camera, ChevronRight } from 'lucide-react';
import { get } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StatusChip } from '@/components/ui/status';
import { xk, type MySubmission, type Target } from '@/features/external/api';
import { relativeDay, statusChip } from '@/features/external/model';
import { tx } from '@/i18n/external';

const t = tx.account;

/** Einstieg „Externen Nachweis einreichen“ und eigene offene Einreichungen (E-34) – nur mit verknüpfter Person. */
export function ExternalSection() {
  const targets = useQuery({ queryKey: xk.targets, queryFn: () => get<Target[]>('/me/external-records/targets'), retry: false });
  const mine = useQuery({
    queryKey: xk.mineList,
    queryFn: () => get<MySubmission[]>('/me/external-records'),
    enabled: !!targets.data?.length,
    retry: false,
  });
  if (!targets.data?.length) return null;
  const open = (mine.data ?? []).filter((r) => r.status === 'entwurf' || r.status === 'eingereicht' || r.status === 'zurueckgegeben');
  return (
    <>
      <Card padding="none" className="flex flex-col gap-3.5 rounded-[22px] p-[18px] sm:flex-row sm:items-center" data-testid="extern-einstieg">
        <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-text">
          <Camera className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-[16.5px] font-bold text-ink">{t.entryTitle}</h2>
          <p className="mt-0.5 text-[13.5px] leading-[1.5] text-muted">{t.entryText}</p>
        </div>
        <Button asChild size="md" className="w-full sm:w-auto">
          <Link to="/konto/extern/neu">{t.entryAction}</Link>
        </Button>
      </Card>
      {open.length > 0 && (
        <section aria-labelledby="eigene-einreichungen" className="mt-2 flex flex-col gap-2.5">
          <div className="px-1">
            <h2 id="eigene-einreichungen" className="flex items-center gap-2 font-heading text-[18px] font-bold text-ink">
              {t.submissions}
              <span className="rounded-pill bg-surface px-2.5 py-0.5 text-[13px] font-semibold text-ink-2 tabular-nums shadow-soft">{open.length}</span>
            </h2>
            <p className="mt-0.5 text-[13.5px] text-muted">{t.submissionsHint}</p>
          </div>
          <ul className="flex flex-col gap-2.5">
            {open.map((r) => {
              const chip = statusChip(r.status);
              const title = r.title ?? t.untitled;
              return (
                <li key={r.id}>
                  <Link
                    to={`/konto/extern/${r.id}`}
                    aria-label={t.open(title)}
                    data-testid="eigene-einreichung"
                    className="flex items-center gap-3 rounded-[22px] bg-surface p-[18px] shadow-card transition-colors hover:bg-surface-hover"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-muted">{r.tenantName}</p>
                      <p className="font-heading text-[16px] leading-snug font-bold text-ink">{title}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
                        {r.submittedAt && <span className="text-[12.5px] text-muted">{relativeDay(r.submittedAt, new Date(), true)}</span>}
                      </div>
                      {r.status === 'zurueckgegeben' && r.reviewNote && <p className="mt-1.5 text-[13px] text-warn-text">{r.reviewNote}</p>}
                    </div>
                    <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
