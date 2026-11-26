import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus } from 'lucide-react';
import { Button, Card, CardDescription, CardHeader, CardTitle, CheckboxField, EmptyState, Field, Input, Panel, Sheet, StatusChip } from '@/components/ui';
import { ConfirmSheet, ErrorPanel, Loading, errorMessage } from '@/features/admin/components/common';
import { fieldErrors } from '@/features/auth/session';
import { integrationsApi, iqk, type ApiKey } from './api';
import { expiryValue, formatDateTime, formatDay, keyStatus, relativeTime, SCOPE_GROUPS, scopeHints, scopeLabel, scopeShort, toggle, type ScopeId } from './logic';
import { OneTimeSecret } from './OneTimeSecret';

function CreateKeySheet({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (key: string, apiKey: ApiKey) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ScopeId[]>([]);
  const [expires, setExpires] = useState('');
  const exp = expiryValue(expires);
  const create = useMutation({
    mutationFn: () => integrationsApi.createKey({ name: name.trim(), scopes, expiresAt: exp.value }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: iqk.keys });
      onCreated(r.key, r.apiKey);
      onOpenChange(false);
    },
  });
  const fe = fieldErrors(create.error);
  const hints = scopeHints(scopes);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Neuer API-Schlüssel"
      description="Ein Schlüssel gehört zu dieser Organisation und darf nur, was Sie hier ankreuzen."
      desktopPlacement="right"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending || !name.trim() || scopes.length === 0 || !!exp.error}>
            {create.isPending ? 'Wird erstellt …' : 'Schlüssel erstellen'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {create.isError && !Object.keys(fe).length && (
          <Panel tone="danger" role="alert">
            {errorMessage(create.error)}
          </Panel>
        )}
        <Field label="Name" hint="z. B. „HR-System“ oder „Lohnbuchhaltung“" required error={fe.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoComplete="off" />
        </Field>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1.5 text-[13px] font-medium text-muted">Berechtigungen (Scopes)</legend>
          {SCOPE_GROUPS.map((g) => (
            <div key={g.label} className="rounded-box bg-bg px-4 py-3">
              <p className="mb-1.5 text-[13.5px] font-semibold text-ink">{g.label}</p>
              <div className="flex flex-col gap-1.5">
                {g.scopes.map((s) => (
                  <CheckboxField
                    key={s.id}
                    label={s.label}
                    description={<code className="font-mono text-[12px]">{s.id}</code>}
                    checked={scopes.includes(s.id)}
                    onCheckedChange={(c) => setScopes((x) => toggle(x, s.id, c === true))}
                  />
                ))}
              </div>
            </div>
          ))}
          {fe.scopes && <p className="text-[12.5px] font-medium text-danger-text">{fe.scopes}</p>}
        </fieldset>
        {hints.map((h) => (
          <Panel key={h} tone="accent">
            {h}
          </Panel>
        ))}
        <Field label="Läuft ab am (optional)" hint="Ohne Datum gilt der Schlüssel, bis Sie ihn widerrufen." error={exp.error ?? fe.expiresAt}>
          <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}

/** API-Schlüssel: anlegen (einmal anzeigen), Liste mit „zuletzt verwendet“, widerrufen. */
export function ApiKeysCard({ onNotice }: { onNotice: (text: string, tone?: 'success' | 'danger') => void }) {
  const qc = useQueryClient();
  const keys = useQuery({ queryKey: iqk.keys, queryFn: integrationsApi.keys });
  const [open, setOpen] = useState(false);
  const [sheetKey, setSheetKey] = useState(0);
  const [created, setCreated] = useState<{ key: string; name: string } | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const revoke = useMutation({
    mutationFn: (k: ApiKey) => integrationsApi.revokeKey(k.id),
    onSuccess: async (k) => {
      setRevoking(null);
      await qc.invalidateQueries({ queryKey: iqk.keys });
      onNotice(`Schlüssel „${k.name}“ wurde widerrufen.`);
    },
    onError: (e) => {
      setRevoking(null);
      onNotice(errorMessage(e), 'danger');
    },
  });

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>API-Schlüssel</CardTitle>
          <CardDescription>Für Fremdsysteme (HR, ERP, Intranet) über die REST-API unter /api/v1.</CardDescription>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            setSheetKey((k) => k + 1);
            setOpen(true);
          }}
        >
          <Plus aria-hidden="true" className="size-[18px]" />
          Neuer Schlüssel
        </Button>
      </CardHeader>

      {created && (
        <div className="mb-4">
          <OneTimeSecret
            title={`API-Schlüssel „${created.name}“`}
            value={created.key}
            hint="Bitte jetzt kopieren und sicher ablegen – der Schlüssel wird nur einmal angezeigt. Gespeichert wird nur ein Hash."
            onDone={() => setCreated(null)}
          />
        </div>
      )}

      {keys.isPending ? (
        <Loading />
      ) : keys.isError ? (
        <ErrorPanel error={keys.error} onRetry={() => keys.refetch()} />
      ) : keys.data.length === 0 ? (
        <EmptyState icon={<KeyRound />} title="Noch keine API-Schlüssel" description="Legen Sie für jedes angebundene System einen eigenen Schlüssel an." />
      ) : (
        <ul className="flex flex-col gap-2" aria-label="API-Schlüssel">
          {keys.data.map((k) => {
            const st = keyStatus(k.status);
            return (
              <li key={k.id} className="flex flex-wrap items-start gap-3 rounded-box bg-bg py-3 pr-3 pl-4">
                <div className="min-w-0 flex-1 basis-60">
                  <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink">
                    {k.name}
                    <StatusChip tone={st.tone}>{st.label}</StatusChip>
                  </p>
                  <p className="mt-0.5 font-mono text-[12.5px] text-muted">{k.preview}</p>
                  <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Berechtigungen">
                    {k.scopes.map((s) => (
                      <li key={s}>
                        <StatusChip tone="info" title={scopeLabel(s)}>
                          {scopeShort(s)}
                        </StatusChip>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[13px] text-muted">
                    Zuletzt verwendet: <span className="text-ink-2">{relativeTime(k.lastUsedAt)}</span>
                    {' · '}Erstellt {formatDateTime(k.createdAt)}
                    {k.createdByName ? ` von ${k.createdByName}` : ''}
                    {k.expiresAt && ` · läuft ab ${formatDay(k.expiresAt)}`}
                    {k.revokedAt && ` · widerrufen ${formatDateTime(k.revokedAt)}`}
                  </p>
                </div>
                {k.status === 'aktiv' && (
                  <Button variant="danger-soft" size="sm" onClick={() => setRevoking(k)} aria-label={`Schlüssel „${k.name}“ widerrufen`}>
                    Widerrufen
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {open && (
        <CreateKeySheet
          key={sheetKey}
          open={open}
          onOpenChange={setOpen}
          onCreated={(key, apiKey) => {
            setCreated({ key, name: apiKey.name });
            onNotice(`Schlüssel „${apiKey.name}“ wurde erstellt.`);
          }}
        />
      )}
      <ConfirmSheet
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={revoking ? `Schlüssel „${revoking.name}“ widerrufen?` : ''}
        description="Anfragen mit diesem Schlüssel werden sofort abgelehnt. Das lässt sich nicht rückgängig machen."
        confirmLabel="Widerrufen"
        tone="danger-soft"
        pending={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking)}
      />
    </Card>
  );
}
