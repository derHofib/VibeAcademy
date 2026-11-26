import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRight, CircleAlert, FileCheck2, Loader2 } from 'lucide-react';
import { ParticipantLayout } from '@/components/layout/ParticipantLayout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/cn';
import { RequireAuth } from '@/features/auth/RequireAuth';
import type { Me } from '@/features/auth/session';
import { de } from '@/i18n/de';
import { ta } from '@/i18n/account';
import { useMyEvidence } from '@/features/account/api';
import { evidenceKey, firstNameOf, groupEvidence } from '@/features/account/model';
import { ExternalSection } from '@/features/account/ExternalCards';
import { PushToggle } from '@/features/account/PushToggle';
import { DoneEvidenceCard, OpenEvidenceCard } from '@/features/account/EvidenceCards';
import { LinkCard } from '@/features/account/LinkCard';
import { AccountCard } from '@/features/account/AccountCard';

/** `/konto` – „Meine Nachweise“ (E-25): eigene Einladungen und Nachweise aus allen verknüpften Organisationen. */
export default function AccountPage() {
  return <RequireAuth>{(me) => <MyEvidencePage me={me} />}</RequireAuth>;
}

function MyEvidencePage({ me }: { me: Me }) {
  const evidence = useMyEvidence();
  const groups = evidence.data ? groupEvidence(evidence.data) : null;
  const isMember = me.memberships.length > 0;

  return (
    <ParticipantLayout title={ta.page.title} eyebrow={de.app.name} width="wide">
      <section
        aria-label={ta.page.greeting(firstNameOf(me.account.name))}
        className="flex flex-col gap-3.5 rounded-[28px] bg-[#E4EBFD] px-[22px] pt-[22px] pb-6"
      >
        <div>
          <p className="font-heading text-[22px] leading-tight font-bold text-ink">{ta.page.greeting(firstNameOf(me.account.name))}</p>
          <p className="mt-1.5 text-[15px] leading-[1.55] text-ink-2">{ta.page.intro}</p>
        </div>
        {groups && (
          <dl className="grid grid-cols-3 gap-2">
            <Kpi value={groups.done.length} label={ta.page.stats.done} />
            <Kpi value={groups.open.length} label={ta.page.stats.open} />
            <Kpi value={groups.expiringCount} label={ta.page.stats.expiring(groups.expiringCount)} warn={groups.expiringCount > 0} />
          </dl>
        )}
        {isMember && (
          <Button asChild variant="secondary" size="sm" className="self-start">
            <Link to="/verwaltung">
              {ta.page.toAdmin}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </Button>
        )}
      </section>

      <ExternalSection />

      {evidence.isPending ? (
        <Card className="flex items-center justify-center gap-2.5 text-[15px] text-muted" role="status">
          <Loader2 aria-hidden="true" className="size-5 animate-spin" />
          {ta.page.loading}
        </Card>
      ) : evidence.isError ? (
        <Card>
          <EmptyState
            icon={<CircleAlert />}
            title={<span role="alert">{ta.page.loadError}</span>}
            description={evidence.error.message}
            action={
              <Button variant="secondary" onClick={() => void evidence.refetch()}>
                {ta.page.retry}
              </Button>
            }
          />
        </Card>
      ) : groups && groups.open.length + groups.done.length === 0 ? (
        <Card padding="none" className="rounded-[22px]">
          <EmptyState icon={<FileCheck2 />} title={ta.empty.title} description={ta.empty.text} />
        </Card>
      ) : groups ? (
        <>
          {groups.open.length > 0 && (
            <Group id="gruppe-offen" title={ta.groups.open} count={groups.open.length} hint={ta.groups.openHint}>
              {groups.open.map((e) => (
                <li key={evidenceKey(e)}>
                  <OpenEvidenceCard e={e} />
                </li>
              ))}
            </Group>
          )}
          {groups.done.length > 0 && (
            <Group id="gruppe-erledigt" title={ta.groups.done} count={groups.done.length}>
              {groups.done.map((e) => (
                <li key={evidenceKey(e)}>
                  <DoneEvidenceCard e={e} />
                </li>
              ))}
            </Group>
          )}
        </>
      ) : null}

      <div className="mt-2 flex flex-col gap-3.5">
        <PushToggle />
        <LinkCard me={me} />
        <AccountCard me={me} />
      </div>
    </ParticipantLayout>
  );
}

function Group({
  id,
  title,
  count,
  hint,
  children,
}: {
  id: string;
  title: string;
  count: number;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mt-2 flex flex-col gap-2.5">
      <div className="px-1">
        <h2 id={id} className="flex items-center gap-2 font-heading text-[18px] font-bold text-ink">
          {title}
          <span className="rounded-pill bg-surface px-2.5 py-0.5 text-[13px] font-semibold text-ink-2 tabular-nums shadow-soft">{count}</span>
        </h2>
        {hint && <p className="mt-0.5 text-[13.5px] text-muted">{hint}</p>}
      </div>
      <ul className="flex flex-col gap-3">{children}</ul>
    </section>
  );
}

function Kpi({ value, label, warn }: { value: number; label: string; warn?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col-reverse rounded-[16px] bg-surface px-3 py-2.5">
      <dt className="text-[12px] leading-tight text-muted">{label}</dt>
      <dd className={cn('font-heading text-[20px] font-bold text-ink tabular-nums', warn && 'text-warn-text')}>{value}</dd>
    </div>
  );
}
