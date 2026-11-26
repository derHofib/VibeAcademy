import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, PlugZap, Trash2 } from 'lucide-react';
import { ROLE_LABELS, ROLES, type Role } from '@sn/shared';
import { get } from '@/lib/api';
import {
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
  Select,
  Sheet,
  StatusChip,
} from '@/components/ui';
import { qk, type Member } from '@/features/admin/api';
import { formatShortDateTime } from '@/features/admin/format';
import { ConfirmSheet, CopyButton, ErrorPanel, Loading, errorMessage } from '@/features/admin/components/common';
import { fieldErrors } from '@/features/auth/session';
import { DomainVerification } from './DomainVerification';
import { useCreateScimToken, useRevokeScimToken, useSaveSso, useSsoSettings, useTestSso, type ScimToken, type SsoSettings } from './api';
import { ssoPayload, validateSsoForm, type SsoFormValues } from './model';
import { tsso } from './texts';

const t = tsso.settings;
const JIT_ROLES: Role[] = ROLES.filter((r) => r !== 'admin');

const toForm = (s: SsoSettings): SsoFormValues => ({
  enabled: s.enabled,
  slug: s.slug ?? '',
  issuer: s.issuer,
  clientId: s.clientId,
  clientSecret: '',
  hasClientSecret: s.hasClientSecret,
  scopes: s.scopes,
  domains: s.emailDomains.join(', '),
  ssoOnly: s.ssoOnly,
  emergencyAdminAccountId: s.emergencyAdminAccountId,
  jitEnabled: s.jitEnabled,
  defaultRoles: s.defaultRoles,
});

/** Einstellungen „Anmeldung & Benutzerverwaltung“: IdP (OIDC), nur SSO, JIT, SCIM-Token (E-36). Nur für Admins. */
export function SsoSettingsSection({ isAdmin, onNotice }: { isAdmin: boolean; onNotice: (m: string, tone?: 'danger') => void }) {
  const settings = useSsoSettings(isAdmin);
  return (
    <Card className="mt-5" data-testid="sso-settings">
      <CardHeader>
        <div>
          <CardTitle>{t.title}</CardTitle>
          <CardDescription>{t.hint}</CardDescription>
        </div>
      </CardHeader>
      {!isAdmin ? (
        <Panel tone="neutral">{t.noAdmin}</Panel>
      ) : settings.isPending ? (
        <Loading />
      ) : settings.isError ? (
        <ErrorPanel error={settings.error} onRetry={() => settings.refetch()} />
      ) : (
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <SsoForm key={String(settings.data.updatedAt)} data={settings.data} onNotice={onNotice} />
          <ScimPanel data={settings.data} onNotice={onNotice} />
        </div>
      )}
    </Card>
  );
}

function SsoForm({ data, onNotice }: { data: SsoSettings; onNotice: (m: string, tone?: 'danger') => void }) {
  const [v, setV] = useState<SsoFormValues>(() => toForm(data));
  const [local, setLocal] = useState<Record<string, string>>({});
  const save = useSaveSso();
  const test = useTestSso();
  const members = useQuery({ queryKey: qk.members, queryFn: () => get<Member[]>('/tenant/members') });
  const admins = (members.data ?? []).filter((m) => m.roles.includes('admin'));
  const set = <K extends keyof SsoFormValues>(k: K, value: SsoFormValues[K]) => setV((x) => ({ ...x, [k]: value }));
  const fe = { ...fieldErrors(save.error), ...local };

  const submit = () => {
    const errs = validateSsoForm(v);
    setLocal(errs);
    if (Object.keys(errs).length) return;
    save.mutate(ssoPayload(v), { onSuccess: () => onNotice(t.saved) });
  };

  return (
    <section aria-labelledby="sso-oidc" className="flex flex-col gap-4">
      <h3 id="sso-oidc" className="font-heading text-[16px] font-bold text-ink">
        {t.sso}
      </h3>
      <CheckboxField label={t.enabled} description={t.enabledHint} checked={v.enabled} onCheckedChange={(c) => set('enabled', c === true)} />
      <Field label={t.issuer} hint={t.issuerHint} error={fe.issuer} required={v.enabled}>
        <Input value={v.issuer} onChange={(e) => set('issuer', e.target.value)} placeholder="https://" autoComplete="off" spellCheck={false} />
      </Field>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label={t.clientId} error={fe.clientId} required={v.enabled}>
          <Input value={v.clientId} onChange={(e) => set('clientId', e.target.value)} autoComplete="off" spellCheck={false} />
        </Field>
        <Field label={t.clientSecret} hint={v.hasClientSecret ? t.clientSecretKeep : t.clientSecretNew} error={fe.clientSecret}>
          <Input
            type="password"
            value={v.clientSecret}
            onChange={(e) => set('clientSecret', e.target.value)}
            autoComplete="new-password"
            placeholder={v.hasClientSecret ? '••••••••' : ''}
          />
        </Field>
      </div>
      <Field label={t.domains} hint={t.domainsHint} error={fe.emailDomains} required={v.enabled}>
        <Input value={v.domains} onChange={(e) => set('domains', e.target.value)} placeholder="firma.de" autoComplete="off" spellCheck={false} />
      </Field>
      <DomainVerification data={data} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label={t.scopes} error={fe.scopes}>
          <Input value={v.scopes} onChange={(e) => set('scopes', e.target.value)} autoComplete="off" spellCheck={false} />
        </Field>
        <Field label={t.slug} hint={t.slugHint} error={fe.slug}>
          <Input value={v.slug} onChange={(e) => set('slug', e.target.value)} autoComplete="off" spellCheck={false} />
        </Field>
      </div>
      <div className="flex flex-col gap-2 rounded-box bg-bg px-4 py-3">
        <p className="text-[13px] text-muted">{t.redirectUri}</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 basis-60 text-[13.5px] break-all text-ink">{data.redirectUri}</code>
          <CopyButton text={data.redirectUri} ariaLabel={t.redirectUri} />
        </div>
        {data.enabled && (
          <>
            <p className="mt-1 text-[13px] text-muted">{t.loginUrl}</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 basis-60 text-[13.5px] break-all text-ink">{data.loginUrl}</code>
              <CopyButton text={data.loginUrl} ariaLabel={t.loginUrl} />
            </div>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="tonal" onClick={() => test.mutate(v.issuer.trim() || undefined)} disabled={test.isPending || !v.issuer.trim()}>
          <PlugZap aria-hidden="true" className="size-[18px]" />
          {test.isPending ? t.testing : t.test}
        </Button>
      </div>
      {test.data && (
        <Panel tone={test.data.ok ? 'success' : 'danger'} role="status" data-testid="sso-test-result">
          {test.data.ok ? t.testOk(test.data.issuer ?? '') : test.data.error}
          {test.data.warnings?.map((w) => (
            <span key={w} className="mt-1 block">
              {w}
            </span>
          ))}
        </Panel>
      )}
      {test.isError && <Panel tone="danger">{errorMessage(test.error)}</Panel>}

      <CheckboxField label={t.ssoOnly} description={t.ssoOnlyHint} checked={v.ssoOnly} onCheckedChange={(c) => set('ssoOnly', c === true)} />
      {fe.ssoOnly && <p className="text-[12.5px] font-medium text-danger-text">{fe.ssoOnly}</p>}
      {v.ssoOnly && (
        <Field label={t.emergency} hint={t.emergencyHint} error={fe.emergencyAdminAccountId}>
          <Select value={v.emergencyAdminAccountId ?? ''} onChange={(e) => set('emergencyAdminAccountId', e.target.value || null)}>
            <option value="">{t.emergencyAuto}</option>
            {admins.map((m) => (
              <option key={m.account_id} value={m.account_id}>
                {m.name} ({m.email})
              </option>
            ))}
          </Select>
        </Field>
      )}

      <CheckboxField label={t.jit} description={t.jitHint} checked={v.jitEnabled} onCheckedChange={(c) => set('jitEnabled', c === true)} />
      <fieldset className="flex flex-col gap-2.5" disabled={!v.jitEnabled}>
        <legend className="mb-1.5 text-[13px] font-medium text-muted">{t.defaultRoles}</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2.5">
          {JIT_ROLES.map((r) => (
            <CheckboxField
              key={r}
              label={ROLE_LABELS[r]}
              checked={v.defaultRoles.includes(r)}
              onCheckedChange={(c) =>
                set('defaultRoles', c === true ? [...new Set([...v.defaultRoles, r])] : v.defaultRoles.filter((x) => x !== r))
              }
            />
          ))}
        </div>
        {fe.defaultRoles && <p className="text-[12.5px] font-medium text-danger-text">{fe.defaultRoles}</p>}
      </fieldset>

      {save.isError && !Object.keys(fieldErrors(save.error)).length && (
        <Panel tone="danger" role="alert">
          {errorMessage(save.error)}
        </Panel>
      )}
      <div>
        <Button onClick={submit} disabled={save.isPending}>
          {save.isPending ? t.saving : t.save}
        </Button>
      </div>
    </section>
  );
}

function ScimPanel({ data, onNotice }: { data: SsoSettings; onNotice: (m: string, tone?: 'danger') => void }) {
  const [label, setLabel] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ScimToken | null>(null);
  const create = useCreateScimToken();
  const revoke = useRevokeScimToken();
  return (
    <section aria-labelledby="sso-scim" className="flex flex-col gap-4">
      <h3 id="sso-scim" className="font-heading text-[16px] font-bold text-ink">
        {t.scim}
      </h3>
      <p className="text-[13.5px] leading-[1.55] text-muted">{t.scimHint}</p>
      <div className="flex flex-col gap-2 rounded-box bg-bg px-4 py-3">
        <p className="text-[13px] text-muted">{t.scimBaseUrl}</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 basis-60 text-[13.5px] break-all text-ink" data-testid="scim-base-url">
            {data.scimBaseUrl}
          </code>
          <CopyButton text={data.scimBaseUrl} ariaLabel={t.scimBaseUrl} />
        </div>
      </div>
      <div>
        <p className="mb-2 text-[13px] font-medium text-muted">{t.tokens}</p>
        {data.scimTokens.length === 0 ? (
          <p className="text-[13.5px] text-muted">{t.noTokens}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.scimTokens.map((tok) => (
              <li key={tok.id} className="flex flex-wrap items-center gap-3 rounded-box bg-bg py-2 pr-2 pl-4">
                <KeyRound aria-hidden="true" className="size-[18px] text-muted" />
                <div className="min-w-0 flex-1 basis-40">
                  <p className="truncate text-[14px] font-semibold text-ink">
                    <code>{tok.prefix}…</code>
                    {tok.label && <span className="font-normal text-muted"> · {tok.label}</span>}
                  </p>
                  <p className="truncate text-[12.5px] text-muted">
                    {t.created(formatShortDateTime(tok.createdAt))} ·{' '}
                    {tok.lastUsedAt ? t.lastUsed(formatShortDateTime(tok.lastUsedAt)) : t.neverUsed}
                  </p>
                </div>
                {tok.revokedAt ? (
                  <StatusChip tone="neutral">{t.revoked}</StatusChip>
                ) : (
                  <IconButton variant="ghost" aria-label={t.revokeAria(tok.prefix)} onClick={() => setRevoking(tok)}>
                    <Trash2 aria-hidden="true" />
                  </IconButton>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t.tokenLabel} className="min-w-0 flex-1 basis-48">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t.tokenLabelPlaceholder} maxLength={100} />
        </Field>
        <Button
          variant="secondary"
          disabled={create.isPending}
          onClick={() =>
            create.mutate(label.trim(), {
              onSuccess: (r) => {
                setCreated(r.token);
                setLabel('');
              },
              onError: (e) => onNotice(errorMessage(e), 'danger'),
            })
          }
        >
          {create.isPending ? t.creating : t.createToken}
        </Button>
      </div>

      <Sheet
        open={!!created}
        onOpenChange={(o) => !o && setCreated(null)}
        title={t.onceTitle}
        description={t.onceText}
        footer={<Button onClick={() => setCreated(null)}>{t.onceDone}</Button>}
      >
        <div className="flex flex-col gap-3">
          <code className="rounded-box bg-bg px-4 py-3 text-[13.5px] break-all text-ink" data-testid="scim-token-once">
            {created}
          </code>
          {created && <CopyButton text={created} variant="primary" size="md" />}
        </div>
      </Sheet>
      <ConfirmSheet
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={t.revokeTitle}
        description={t.revokeText}
        confirmLabel={t.revoke}
        tone="danger-soft"
        pending={revoke.isPending}
        onConfirm={() =>
          revoking &&
          revoke.mutate(revoking.id, {
            onSettled: () => setRevoking(null),
            onError: (e) => onNotice(errorMessage(e), 'danger'),
          })
        }
      />
    </section>
  );
}
