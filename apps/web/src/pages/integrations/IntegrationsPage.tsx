import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/PageHeader';
import { Panel } from '@/components/ui';
import { ErrorPanel, Loading, NoticeRegion, useNotice } from '@/features/admin/components/common';
import { useAdminMe } from '@/features/admin/hooks';
import { hasRole } from '@/features/auth/session';
import { integrationsApi, iqk } from '@/features/integrations/api';
import { ApiKeysCard } from '@/features/integrations/ApiKeysCard';
import { DocsCard } from '@/features/integrations/DocsCard';
import { WebhooksCard } from '@/features/integrations/WebhooksCard';

/** Verwaltung → Schnittstellen: API-Schlüssel, Webhooks, Dokumentation (PLAN 3.2, E-37). Nur Mandanten-Admin. */
export default function IntegrationsPage() {
  const me = useAdminMe();
  const isAdmin = hasRole(me, 'admin');
  const { notice, show } = useNotice();
  const meta = useQuery({ queryKey: iqk.meta, queryFn: integrationsApi.meta, enabled: isAdmin, staleTime: Infinity });

  return (
    <>
      <PageHeader title="Schnittstellen" description="REST-API und Webhooks für die Anbindung anderer Systeme" />
      <NoticeRegion notice={notice} className="mb-4 empty:hidden" />
      {!isAdmin ? (
        <Panel tone="neutral">Schnittstellen verwalten nur Mandanten-Admins.</Panel>
      ) : meta.isPending ? (
        <Loading />
      ) : meta.isError ? (
        <ErrorPanel error={meta.error} onRetry={() => meta.refetch()} />
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-w-0 flex-col gap-5">
            <ApiKeysCard onNotice={show} />
            <WebhooksCard meta={meta.data} onNotice={show} />
          </div>
          <div className="flex flex-col gap-5">
            <DocsCard meta={meta.data} />
          </div>
        </div>
      )}
    </>
  );
}
