import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2, UserPlus } from 'lucide-react';
import { ROLE_LABELS, ROLES, type Role } from '@sn/shared';
import { del, get, patch, post } from '@/lib/api';
import { adm } from '@/i18n/admin';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  Avatar,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  CheckboxField,
  Field,
  IconButton,
  Input,
  Panel,
  Sheet,
  StatusChip,
} from '@/components/ui';
import { qk, type Member } from '@/features/admin/api';
import {
  ConfirmSheet,
  ErrorPanel,
  Loading,
  NoticeRegion,
  errorMessage,
  useNotice,
} from '@/features/admin/components/common';
import { activeTenantName, fieldErrors, hasRole, useSwitchTenant } from '@/features/auth/session';
import { useAdminMe } from '@/features/admin/hooks';
import { SsoSettingsSection } from '@/features/sso/SsoSettingsSection';

const s = adm.settings;
const ASSIGNABLE: Role[] = ROLES.filter((r) => r !== 'teilnehmer');

function MemberSheet({
  member,
  open,
  onOpenChange,
  onDone,
}: {
  member: Member | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: (m: string) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roles, setRoles] = useState<string[]>(member?.roles ?? ['verantwortlich', 'trainer']);
  const save = useMutation({
    mutationFn: () =>
      member
        ? patch(`/tenant/members/${member.id}`, { roles })
        : post<{ invited: boolean }>('/tenant/members', { name, email, roles }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: qk.members });
      onDone(member ? s.rolesSaved : (r as { invited?: boolean })?.invited ? s.invited : s.added);
      onOpenChange(false);
    },
  });
  const fe = fieldErrors(save.error);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={member ? s.sheetEdit(member.name) : s.sheetInvite}
      desktopPlacement="right"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {adm.common.cancel}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || roles.length === 0}>
            {save.isPending ? adm.common.saving : member ? adm.common.save : s.invite}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && !Object.keys(fe).length && (
          <Panel tone="danger" role="alert">
            {errorMessage(save.error)}
          </Panel>
        )}
        {!member && (
          <>
            <Field label={s.name} required error={fe.name}>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
            </Field>
            <Field label={s.email} required error={fe.email}>
              <Input
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
              />
            </Field>
          </>
        )}
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1.5 text-[13px] font-medium text-muted">{s.rolesLegend}</legend>
          {ASSIGNABLE.map((r) => (
            <CheckboxField
              key={r}
              label={ROLE_LABELS[r]}
              description={s.roleHints[r]}
              checked={roles.includes(r)}
              onCheckedChange={(c) =>
                setRoles((x) => (c === true ? [...new Set([...x, r])] : x.filter((y) => y !== r)))
              }
            />
          ))}
          {fe.roles && <p className="text-[12.5px] font-medium text-danger-text">{fe.roles}</p>}
        </fieldset>
      </div>
    </Sheet>
  );
}

export default function SettingsPage() {
  const me = useAdminMe();
  const isAdmin = hasRole(me, 'admin');
  const qc = useQueryClient();
  const { notice, show } = useNotice();
  const switchTenant = useSwitchTenant();
  const [editing, setEditing] = useState<Member | null>(null);
  const [open, setOpen] = useState(false);
  const [sheetKey, setSheetKey] = useState(0);
  const [removing, setRemoving] = useState<Member | null>(null);
  const members = useQuery({
    queryKey: qk.members,
    queryFn: () => get<Member[]>('/tenant/members'),
    enabled: isAdmin,
  });
  const remove = useMutation({
    mutationFn: (m: Member) => del(`/tenant/members/${m.id}`),
    onSuccess: () => {
      setRemoving(null);
      void qc.invalidateQueries({ queryKey: qk.members });
    },
    onError: (e) => {
      setRemoving(null);
      show(errorMessage(e), 'danger');
    },
  });
  const openSheet = (m: Member | null) => {
    setEditing(m);
    setSheetKey((k) => k + 1);
    setOpen(true);
  };

  return (
    <>
      <PageHeader title={s.title} />
      <NoticeRegion notice={notice} className="mb-4 empty:hidden" />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <Card>
            <CardTitle className="mb-3">{s.account}</CardTitle>
            <div className="flex items-center gap-3">
              <Avatar name={me.account.name} size="xl" />
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold text-ink">{me.account.name}</p>
                <p className="truncate text-[13.5px] text-muted">{me.account.email}</p>
              </div>
            </div>
            <p className="mt-4 text-[13px] text-muted">{s.roles}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {me.roles.map((r) => (
                <StatusChip key={r} tone="info">
                  {ROLE_LABELS[r as Role] ?? r}
                </StatusChip>
              ))}
            </div>
          </Card>
          <Card>
            <CardTitle className="mb-3">{s.tenant}</CardTitle>
            <p className="text-[15px] font-semibold text-ink">{activeTenantName(me) ?? '—'}</p>
            {me.memberships.length > 1 && (
              <ul className="mt-3 flex flex-col gap-1.5">
                {me.memberships
                  .filter((m) => m.tenantId !== me.activeTenantId)
                  .map((m) => (
                    <li key={m.tenantId}>
                      <Button
                        variant="tonal"
                        size="sm"
                        fullWidth
                        onClick={() => switchTenant.mutate(m.tenantId)}
                      >
                        {adm.auth.tenantLabel}: {m.tenantName}
                      </Button>
                    </li>
                  ))}
              </ul>
            )}
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>{s.members}</CardTitle>
              <CardDescription>{s.membersHint}</CardDescription>
            </div>
            {isAdmin && (
              <Button variant="secondary" onClick={() => openSheet(null)}>
                <UserPlus aria-hidden="true" className="size-[18px]" />
                {s.invite}
              </Button>
            )}
          </CardHeader>
          {!isAdmin ? (
            <Panel tone="neutral">{s.noAdmin}</Panel>
          ) : members.isPending ? (
            <Loading />
          ) : members.isError ? (
            <ErrorPanel error={members.error} onRetry={() => members.refetch()} />
          ) : (
            <ul className="flex flex-col gap-2">
              {members.data.map((m) => {
                const self = m.account_id === me.account.id;
                return (
                  <li
                    key={m.id}
                    className="flex flex-wrap items-center gap-3 rounded-box bg-bg py-2.5 pr-2 pl-4"
                  >
                    <Avatar name={m.name} size="lg" tone="surface" />
                    <div className="min-w-0 flex-1 basis-48">
                      <p className="truncate text-[15px] font-semibold text-ink">
                        {m.name}
                        {self && <span className="font-normal text-muted"> ({s.you})</span>}
                      </p>
                      <p className="truncate text-[13px] text-muted">{m.email}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {m.roles.map((r) => (
                        <StatusChip key={r} tone="info">
                          {ROLE_LABELS[r as Role] ?? r}
                        </StatusChip>
                      ))}
                      <StatusChip tone={m.active ? 'success' : 'warn'}>
                        {m.active ? s.activeYes : s.activeNo}
                      </StatusChip>
                    </div>
                    <div className="flex">
                      <IconButton
                        variant="ghost"
                        aria-label={s.editRoles(m.name)}
                        onClick={() => openSheet(m)}
                      >
                        <Pencil aria-hidden="true" />
                      </IconButton>
                      {!self && (
                        <IconButton
                          variant="ghost"
                          aria-label={s.remove(m.name)}
                          onClick={() => setRemoving(m)}
                        >
                          <Trash2 aria-hidden="true" />
                        </IconButton>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {/* Phase 3 (E-36): Anmeldung & Benutzerverwaltung (SSO, SCIM) */}
      <SsoSettingsSection isAdmin={isAdmin} onNotice={show} />

      {open && (
        <MemberSheet
          key={sheetKey}
          member={editing}
          open={open}
          onOpenChange={setOpen}
          onDone={(m) => show(m)}
        />
      )}
      <ConfirmSheet
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={removing ? s.removeTitle(removing.name) : ''}
        description={s.removeText}
        confirmLabel={adm.common.delete}
        tone="danger-soft"
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </>
  );
}
