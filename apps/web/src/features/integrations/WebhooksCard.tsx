import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Plus, RefreshCw, Send, Webhook } from 'lucide-react';
import { Button, Card, CardDescription, CardHeader, CardTitle, CheckboxField, EmptyState, Field, Input, Panel, Sheet, StatusChip } from '@/components/ui';
import { ConfirmSheet, ErrorPanel, Loading, errorMessage } from '@/features/admin/components/common';
import { fieldErrors } from '@/features/auth/session';
import { integrationsApi, iqk, type IntegrationsMeta, type WebhookEndpoint } from './api';
import { canRedeliver, deliveryStatus, endpointStatus, eventLabel, formatDateTime, relativeTime, toggle, webhookUrlError } from './logic';
import { OneTimeSecret } from './OneTimeSecret';

type Notify = (text: string, tone?: 'success' | 'danger') => void;

function CreateWebhookSheet({
  meta, open, onOpenChange, onCreated,
}: { meta: IntegrationsMeta; open: boolean; onOpenChange: (o: boolean) => void; onCreated: (secret: string, ep: WebhookEndpoint) => void }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState('https://');
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState<string[]>(meta.events.map((e) => e.id));
  const [touched, setTouched] = useState(false);
  const urlErr = webhookUrlError(url);
  const create = useMutation({
    mutationFn: () => integrationsApi.createWebhook({ url: url.trim(), description: description.trim() || null, events }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: iqk.webhooks });
      onCreated(r.secret, r.endpoint);
      onOpenChange(false);
    },
  });
  const fe = fieldErrors(create.error);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Webhook hinzufügen"
      description="Bei jedem gewählten Ereignis senden wir einen signierten POST an diese Adresse – nur IDs und Status, keine Personendaten."
      desktopPlacement="right"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending || !!urlErr || events.length === 0}>
            {create.isPending ? 'Wird gespeichert …' : 'Webhook speichern'}
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
        <Field label="Ziel-URL" hint="Nur https://" required error={fe.url ?? (touched ? (urlErr ?? undefined) : undefined)}>
          <Input type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} onBlur={() => setTouched(true)} autoComplete="off" />
        </Field>
        <Field label="Beschreibung (optional)" error={fe.description}>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-[13px] font-medium text-muted">Ereignisse</legend>
          {meta.events.map((e) => (
            <CheckboxField
              key={e.id}
              label={eventLabel(e.id)}
              description={e.description}
              checked={events.includes(e.id)}
              onCheckedChange={(c) => setEvents((x) => toggle(x, e.id, c === true))}
            />
          ))}
          {fe.events && <p className="text-[12.5px] font-medium text-danger-text">{fe.events}</p>}
        </fieldset>
      </div>
    </Sheet>
  );
}

/** Zustellprotokoll eines Endpunkts mit „Erneut senden“. */
function DeliveryLog({ endpoint, onNotice }: { endpoint: WebhookEndpoint; onNotice: Notify }) {
  const qc = useQueryClient();
  const log = useQuery({
    queryKey: iqk.deliveries(endpoint.id),
    queryFn: () => integrationsApi.deliveries(endpoint.id),
    refetchInterval: (q) => (q.state.data?.data.some((d) => d.status === 'pending' || d.status === 'sending') ? 3000 : false),
  });
  const redeliver = useMutation({
    mutationFn: (deliveryId: string) => integrationsApi.redeliver(endpoint.id, deliveryId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: iqk.deliveries(endpoint.id) });
      onNotice('Ereignis wird erneut zugestellt.');
    },
    onError: (e) => onNotice(errorMessage(e), 'danger'),
  });
  if (log.isPending) return <Loading className="py-6" />;
  if (log.isError) return <ErrorPanel error={log.error} onRetry={() => log.refetch()} />;
  if (!log.data.data.length) return <p className="py-3 text-[13.5px] text-muted">Noch keine Zustellungen. Mit „Test senden“ können Sie den Empfang prüfen.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-[13.5px]">
        <caption className="sr-only">Zustellprotokoll für {endpoint.url}</caption>
        <thead className="text-[12.5px] text-muted">
          <tr>
            <th scope="col" className="py-2 pr-3 font-medium">Ereignis</th>
            <th scope="col" className="py-2 pr-3 font-medium">Zeitpunkt</th>
            <th scope="col" className="py-2 pr-3 font-medium">Status</th>
            <th scope="col" className="py-2 pr-3 font-medium">Versuche</th>
            <th scope="col" className="py-2 pr-3 font-medium">Antwort</th>
            <th scope="col" className="py-2 font-medium"><span className="sr-only">Aktion</span></th>
          </tr>
        </thead>
        <tbody>
          {log.data.data.map((d) => {
            const st = deliveryStatus(d.status);
            return (
              <tr key={d.id} className="border-t border-line align-top">
                <td className="py-2.5 pr-3">
                  <p className="font-medium text-ink">{eventLabel(d.eventType)}</p>
                  <p className="font-mono text-[11.5px] text-muted" title="Zustell-ID (Header Schulungsnachweis-Delivery)">{d.id}</p>
                </td>
                <td className="py-2.5 pr-3 whitespace-nowrap text-ink-2">{formatDateTime(d.createdAt)}</td>
                <td className="py-2.5 pr-3">
                  <StatusChip tone={st.tone}>{st.label}</StatusChip>
                  {d.nextAttemptAt && <p className="mt-1 text-[12px] text-muted">nächster Versuch {formatDateTime(d.nextAttemptAt)}</p>}
                </td>
                <td className="py-2.5 pr-3 tabular-nums">{d.attempts}</td>
                <td className="py-2.5 pr-3">
                  {d.responseCode ? <span className="tabular-nums">HTTP {d.responseCode}</span> : '—'}
                  {d.lastError && d.status !== 'succeeded' && <p className="mt-0.5 text-[12px] break-words text-danger-text">{d.lastError}</p>}
                </td>
                <td className="py-2.5 text-right">
                  {canRedeliver(d.status) && (
                    <Button variant="tonal" size="sm" disabled={redeliver.isPending} onClick={() => redeliver.mutate(d.id)} aria-label={`${eventLabel(d.eventType)} vom ${formatDateTime(d.createdAt)} erneut senden`}>
                      <RefreshCw aria-hidden="true" className="size-4" />
                      Erneut senden
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EndpointRow({ ep, onNotice, onSecret }: { ep: WebhookEndpoint; onNotice: Notify; onSecret: (secret: string, ep: WebhookEndpoint) => void }) {
  const qc = useQueryClient();
  const [showLog, setShowLog] = useState(false);
  const [confirm, setConfirm] = useState<'delete' | 'rotate' | null>(null);
  const logId = useId();
  const st = endpointStatus(ep);
  const refresh = () => qc.invalidateQueries({ queryKey: iqk.webhooks });
  const ping = useMutation({
    mutationFn: () => integrationsApi.ping(ep.id),
    onSuccess: async () => {
      setShowLog(true);
      await qc.invalidateQueries({ queryKey: iqk.deliveries(ep.id) });
      onNotice('Testereignis wurde gesendet – Ergebnis im Zustellprotokoll.');
    },
    onError: (e) => onNotice(errorMessage(e), 'danger'),
  });
  const setActive = useMutation({
    mutationFn: (active: boolean) => integrationsApi.updateWebhook(ep.id, { active }),
    onSuccess: async (r) => {
      await refresh();
      onNotice(r.active ? 'Webhook ist wieder aktiv; ausstehende Zustellungen werden nachgeholt.' : 'Webhook wurde deaktiviert.');
    },
    onError: (e) => onNotice(errorMessage(e), 'danger'),
  });
  const remove = useMutation({
    mutationFn: () => integrationsApi.deleteWebhook(ep.id),
    onSuccess: async () => {
      setConfirm(null);
      await refresh();
      onNotice('Webhook wurde gelöscht.');
    },
    onError: (e) => onNotice(errorMessage(e), 'danger'),
  });
  const rotate = useMutation({
    mutationFn: () => integrationsApi.rotateSecret(ep.id),
    onSuccess: (r) => {
      setConfirm(null);
      onSecret(r.secret, ep);
    },
    onError: (e) => onNotice(errorMessage(e), 'danger'),
  });

  return (
    <li className="rounded-box bg-bg py-3 pr-3 pl-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13.5px] font-semibold break-all text-ink">{ep.url}</span>
            <StatusChip tone={st.tone}>{st.label}</StatusChip>
          </p>
          {ep.description && <p className="mt-0.5 text-[13.5px] text-ink-2">{ep.description}</p>}
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Ereignisse">
            {ep.events.map((e) => (
              <li key={e}>
                <StatusChip tone="info">{eventLabel(e)}</StatusChip>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[13px] text-muted">
            Letzte erfolgreiche Zustellung: <span className="text-ink-2">{relativeTime(ep.lastSuccessAt)}</span>
            {ep.lastFailureAt && ` · letzter Fehler ${relativeTime(ep.lastFailureAt)}`}
          </p>
          {!ep.active && ep.disabledReason && (
            <Panel tone={ep.disabledReason.startsWith('automatisch') ? 'danger' : 'neutral'} className="mt-2">
              {ep.disabledReason.startsWith('automatisch')
                ? `Der Webhook wurde ${ep.disabledReason}. Prüfen Sie den Empfänger und aktivieren Sie ihn wieder – ausstehende Ereignisse werden dann nachgeholt.`
                : 'Der Webhook ist deaktiviert. Ereignisse werden gesammelt und nach dem Aktivieren zugestellt.'}
            </Panel>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => ping.mutate()} disabled={ping.isPending}>
            <Send aria-hidden="true" className="size-4" />
            Test senden
          </Button>
          <Button variant="tonal" size="sm" onClick={() => setActive.mutate(!ep.active)} disabled={setActive.isPending}>
            {ep.active ? 'Deaktivieren' : 'Aktivieren'}
          </Button>
          <Button variant="tonal" size="sm" onClick={() => setConfirm('rotate')}>
            Geheimnis erneuern
          </Button>
          <Button variant="danger-soft" size="sm" onClick={() => setConfirm('delete')} aria-label={`Webhook ${ep.url} löschen`}>
            Löschen
          </Button>
        </div>
      </div>
      <button
        type="button"
        className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-input px-1 text-[13.5px] font-semibold text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-accent"
        aria-expanded={showLog}
        aria-controls={logId}
        onClick={() => setShowLog((v) => !v)}
      >
        {showLog ? <ChevronUp aria-hidden="true" className="size-4" /> : <ChevronDown aria-hidden="true" className="size-4" />}
        Zustellprotokoll
      </button>
      <div id={logId} hidden={!showLog} className="mt-1">
        {showLog && <DeliveryLog endpoint={ep} onNotice={onNotice} />}
      </div>
      <ConfirmSheet
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'delete' ? 'Webhook löschen?' : 'Signaturgeheimnis erneuern?'}
        description={
          confirm === 'delete'
            ? 'Der Endpunkt und sein Zustellprotokoll werden gelöscht. Ausstehende Ereignisse gehen verloren.'
            : 'Das bisherige Geheimnis ist sofort ungültig. Tragen Sie das neue Geheimnis direkt im Empfänger ein.'
        }
        confirmLabel={confirm === 'delete' ? 'Löschen' : 'Erneuern'}
        tone={confirm === 'delete' ? 'danger-soft' : 'primary'}
        pending={remove.isPending || rotate.isPending}
        onConfirm={() => (confirm === 'delete' ? remove.mutate() : rotate.mutate())}
      />
    </li>
  );
}

/** Webhooks: Endpunkt hinzufügen (Geheimnis einmal), Test-Ping, Zustellprotokoll, erneut senden. */
export function WebhooksCard({ meta, onNotice }: { meta: IntegrationsMeta; onNotice: Notify }) {
  const hooks = useQuery({ queryKey: iqk.webhooks, queryFn: integrationsApi.webhooks });
  const [open, setOpen] = useState(false);
  const [sheetKey, setSheetKey] = useState(0);
  const [secret, setSecret] = useState<{ value: string; url: string } | null>(null);
  const showSecret = (value: string, ep: WebhookEndpoint) => setSecret({ value, url: ep.url });
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Webhooks</CardTitle>
          <CardDescription>Benachrichtigungen an Ihre Systeme, z. B. wenn ein Nachweis erstellt wurde.</CardDescription>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            setSheetKey((k) => k + 1);
            setOpen(true);
          }}
        >
          <Plus aria-hidden="true" className="size-[18px]" />
          Webhook hinzufügen
        </Button>
      </CardHeader>
      {secret && (
        <div className="mb-4">
          <OneTimeSecret
            title={`Signaturgeheimnis für ${secret.url}`}
            value={secret.value}
            hint="Damit prüft Ihr System den Header „Schulungsnachweis-Signature“. Bitte jetzt kopieren – es wird nur einmal angezeigt."
            onDone={() => setSecret(null)}
          />
        </div>
      )}
      {hooks.isPending ? (
        <Loading />
      ) : hooks.isError ? (
        <ErrorPanel error={hooks.error} onRetry={() => hooks.refetch()} />
      ) : hooks.data.length === 0 ? (
        <EmptyState icon={<Webhook />} title="Noch keine Webhooks" description="Ein Webhook meldet Ereignisse sofort an Ihr System – statt regelmäßig abzufragen." />
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Webhooks">
          {hooks.data.map((ep) => (
            <EndpointRow key={ep.id} ep={ep} onNotice={onNotice} onSecret={showSecret} />
          ))}
        </ul>
      )}
      {open && (
        <CreateWebhookSheet
          key={sheetKey}
          meta={meta}
          open={open}
          onOpenChange={setOpen}
          onCreated={(s, ep) => {
            showSecret(s, ep);
            onNotice('Webhook wurde gespeichert.');
          }}
        />
      )}
    </Card>
  );
}
