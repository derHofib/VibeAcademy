import type { ReactNode } from 'react';
import { CircleAlert, Loader2 } from 'lucide-react';
import { ParticipantLayout } from '@/components/layout/ParticipantLayout';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { tp } from '@/i18n/participant';

export function LoadingScreen({ label = tp.common.loading }: { label?: string }) {
  return (
    <ParticipantLayout className="items-center justify-center">
      <div role="status" className="flex items-center gap-2.5 text-[15px] text-muted">
        <Loader2 aria-hidden="true" className="size-5 animate-spin" />
        {label}
      </div>
    </ParticipantLayout>
  );
}

export function ErrorScreen({ title = tp.common.errorTitle, message, action }: { title?: string; message: ReactNode; action?: ReactNode }) {
  return (
    <ParticipantLayout className="justify-center">
      <Card>
        <EmptyState icon={<CircleAlert />} title={<span role="alert">{title}</span>} description={message} action={action} />
      </Card>
    </ParticipantLayout>
  );
}
