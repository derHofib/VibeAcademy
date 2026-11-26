import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Archive, Link2Off, Loader2, LogOut, Ticket } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, Panel } from '@/components/ui/card';
import { Sheet, SheetClose } from '@/components/ui/sheet';
import { StatusChip } from '@/components/ui/status';
import { useLogout, type Me } from '@/features/auth/session';
import { ta } from '@/i18n/account';
import { useDeleteAccount } from './api';

/** Konto-Karte: Name, E-Mail (bestätigt?), Abmelden, Konto löschen. */
export function AccountCard({ me }: { me: Me }) {
  const navigate = useNavigate();
  const logout = useLogout();
  return (
    <Card padding="none" className="rounded-[22px] p-[18px] md:p-6" aria-labelledby="konto-titel">
      <h2 id="konto-titel" className="sr-only">
        {ta.account.title}
      </h2>
      <div className="flex items-center gap-3.5">
        <Avatar name={me.account.name} size="xl" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15.5px] font-semibold text-ink">{me.account.name}</p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] text-muted">
            <span className="min-w-0 break-all">{me.account.email}</span>
            <StatusChip tone={me.account.emailVerified ? 'success' : 'neutral'}>
              {me.account.emailVerified ? ta.account.emailVerified : ta.account.emailUnverified}
            </StatusChip>
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button
          variant="tonal"
          className="sm:flex-1"
          disabled={logout.isPending}
          onClick={() => logout.mutate(undefined, { onSettled: () => navigate('/anmelden?teilnehmer=1', { replace: true }) })}
        >
          <LogOut aria-hidden="true" className="size-[18px]" />
          {ta.page.logout}
        </Button>
        <DeleteAccountSheet hasMemberships={me.memberships.length > 0} />
      </div>
    </Card>
  );
}

function DeleteAccountSheet({ hasMemberships }: { hasMemberships: boolean }) {
  const navigate = useNavigate();
  const remove = useDeleteAccount();
  const [open, setOpen] = useState(false);
  const conflict = remove.error instanceof ApiError && remove.error.status === 409;

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) remove.reset();
      }}
      title={ta.deleteSheet.title}
      description={ta.deleteSheet.description}
      trigger={
        <Button variant="danger-soft" className="sm:flex-1">
          {ta.account.delete}
        </Button>
      }
      footer={
        <>
          <SheetClose asChild>
            <Button variant="tonal">{ta.deleteSheet.cancel}</Button>
          </SheetClose>
          <Button
            variant="dark"
            disabled={remove.isPending || conflict || hasMemberships}
            onClick={() => remove.mutate(undefined, { onSuccess: () => navigate('/konto/geloescht', { replace: true }) })}
          >
            {remove.isPending && <Loader2 aria-hidden="true" className="size-[18px] animate-spin" />}
            {remove.isPending ? ta.deleteSheet.deleting : ta.deleteSheet.confirm}
          </Button>
        </>
      }
    >
      <ul className="flex flex-col gap-3 text-[14.5px] leading-[1.5] text-ink-2">
        <Point icon={<Archive className="size-[18px]" />}>{ta.deleteSheet.stays}</Point>
        <Point icon={<Link2Off className="size-[18px]" />}>{ta.deleteSheet.removed}</Point>
        <Point icon={<Ticket className="size-[18px]" />}>{ta.deleteSheet.later}</Point>
      </ul>
      {hasMemberships || conflict ? (
        <Panel tone="warn" role="alert" className="mt-4">
          {conflict && <span className="mb-1 block font-semibold">{remove.error?.message}</span>}
          {ta.deleteSheet.membership}
        </Panel>
      ) : remove.error ? (
        <Panel tone="danger" role="alert" className="mt-4">
          {remove.error.message}
        </Panel>
      ) : null}
    </Sheet>
  );
}

function Point({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span aria-hidden="true" className="mt-px flex size-8 shrink-0 items-center justify-center rounded-full bg-bg text-ink-2">
        {icon}
      </span>
      <span className="min-w-0 flex-1 pt-1">{children}</span>
    </li>
  );
}
