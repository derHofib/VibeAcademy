import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Check, Info, Pencil, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, Card, CardTitle, Field, IconButton, Input, Panel, Select, Sheet, Textarea } from '@/components/ui';
import { errorMessage } from '@/features/admin/components/common';
import { adm } from '@/i18n/admin';
import { tx } from '@/i18n/external';
import type { CheckItem, RecordDetail, Requirement } from './api';
import { formatMmSs, requirementLabel } from './model';

const ICON: Record<CheckItem['state'], { cls: string; node: ReactNode }> = {
  ok: { cls: 'bg-success-soft text-success', node: <Check aria-hidden="true" className="size-3.5" strokeWidth={3} /> },
  warn: { cls: 'bg-warn-soft text-warn-strong', node: <span aria-hidden="true">!</span> },
  info: { cls: 'bg-accent-soft text-accent-text', node: <Info aria-hidden="true" className="size-3.5" strokeWidth={2.5} /> },
};

/** Restzeit bis `until` (aktualisiert sekündlich); null ohne Frist. */
export function useCountdown(until: string | null | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  if (!until) return null;
  return Math.max(0, new Date(until).getTime() - now);
}

export function CheckList({ checks }: { checks: CheckItem[] }) {
  return (
    <ul className="flex flex-col gap-3.5" aria-label={tx.review.title}>
      {checks.map((c) => (
        <li key={c.key} className="flex items-start gap-3" data-testid={`pruefung-${c.key}`} data-state={c.state}>
          <span className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold', ICON[c.state].cls)}>
            {ICON[c.state].node}
            <span className="sr-only">{tx.review.checkState[c.state]}</span>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-muted">{c.label}</p>
            <p className="text-[14.5px] font-medium break-words text-ink">{c.value}</p>
            {c.note && <p className={cn('text-[12.5px]', c.state === 'warn' ? 'text-warn-strong' : 'text-muted')}>{c.note}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export interface ReviewActions {
  approve: () => void;
  returnWith: (reason: string) => Promise<void>;
  undo: () => void;
  saveFields: (fields: Record<string, unknown>) => Promise<void>;
  pending: 'approve' | 'return' | 'undo' | 'save' | null;
  error: unknown;
}

/** „Angaben prüfen“ (11a–11c): Abgleich, Wirkung, Zurückgeben / Freigeben / Rückgängig, versiegelte Nachweise. */
export function ReviewPanel({ detail, requirements, actions }: { detail: RecordDetail; requirements: Requirement[]; actions: ReviewActions }) {
  const [returnOpen, setReturnOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const rest = useCountdown(detail.permissions.undo ? detail.undo.until : null);
  const status = detail.record.status;
  const approved = status === 'freigegeben';
  const returned = status === 'zurueckgegeben';
  const p = detail.permissions;
  const canDecide = p.approve || p.return;
  const evidences = detail.group.filter((g) => g.evidence && !g.evidence.revoked);

  return (
    <Card radius="lg" className="flex flex-col gap-4" aria-labelledby="pruefen-titel">
      <div className="flex items-center justify-between gap-2">
        <CardTitle id="pruefen-titel">{tx.review.title}</CardTitle>
        {p.edit && (
          <IconButton variant="ghost" className="-my-2 -mr-2" aria-label={tx.review.edit} title={tx.review.edit} onClick={() => setEditOpen(true)}>
            <Pencil aria-hidden="true" />
          </IconButton>
        )}
      </div>
      <CheckList checks={detail.checks} />
      {detail.record.reviewNote && returned && (
        <Panel tone="warn" className="text-[13.5px]">
          <strong className="font-semibold">{tx.review.reviewNote}:</strong> {detail.record.reviewNote}
        </Panel>
      )}
      <Panel tone={detail.effect.newValidUntil || detail.group.length > 1 ? 'success' : 'neutral'} className="rounded-[18px] px-3.5 py-3 text-[13.5px]" data-testid="wirkung">
        {detail.effect.text}
      </Panel>

      {actions.error != null && (
        <Panel tone="danger" role="alert" className="text-[13.5px]">
          {errorMessage(actions.error)}
        </Panel>
      )}

      {approved && (
        <div role="status" className="flex flex-col gap-3">
          <Panel tone="success" className="rounded-[18px] text-[14px]">
            <strong className="font-semibold">{tx.review.approvedHead}</strong> {tx.review.approvedText}
          </Panel>
          {evidences.length > 0 && (
            <ul aria-label={tx.review.evidenceTitle} className="flex flex-col gap-1.5" data-testid="nachweise">
              {evidences.map((g) => (
                <li key={g.recordId} className="flex items-center justify-between gap-2 rounded-input bg-bg px-3.5 py-2 text-[13px]">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-ink">{g.name}</span>
                    <span className="text-muted tabular-nums">{g.evidence!.nachweisNr}</span>
                  </span>
                  <Link
                    to={`/verify/${g.evidence!.verifyCode}`}
                    target="_blank"
                    aria-label={tx.review.verifyAria(g.evidence!.nachweisNr)}
                    className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-pill px-2 font-semibold text-accent-text hover:underline"
                  >
                    <ShieldCheck aria-hidden="true" className="size-4" />
                    {tx.review.verify}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {returned && (
        <Panel tone="warn" role="status" className="rounded-[18px] text-[14px]">
          <strong className="font-semibold">{tx.review.returnedHead}</strong> {tx.review.returnedText(detail.record.reviewNote)}
        </Panel>
      )}

      {approved && p.undo && (
        <Button variant="tonal" fullWidth disabled={actions.pending !== null} onClick={actions.undo}>
          {rest !== null ? tx.review.undoCountdown(formatMmSs(rest)) : tx.review.undo}
        </Button>
      )}

      {canDecide && (
        <div className="flex gap-2.5">
          {p.return && (
            <Button
              className="h-[50px] min-w-0 flex-1 bg-warn-soft px-4 text-warn-text not-disabled:hover:bg-[#ffeccb]"
              variant="tonal"
              size="md"
              disabled={actions.pending !== null}
              onClick={() => setReturnOpen(true)}
            >
              {tx.review.returnAction}
            </Button>
          )}
          {p.approve && (
            <Button className="h-[50px] min-w-0 flex-[1.2] px-4" size="md" disabled={actions.pending !== null} onClick={actions.approve}>
              {actions.pending === 'approve' ? tx.review.approving : tx.review.approve}
            </Button>
          )}
        </div>
      )}
      {!canDecide && !approved && !returned && <p className="text-[13px] text-muted">{tx.review.readOnly}</p>}

      <ReturnSheet open={returnOpen} onOpenChange={setReturnOpen} pending={actions.pending === 'return'} onSubmit={actions.returnWith} />
      {editOpen && (
        <EditSheet open={editOpen} onOpenChange={setEditOpen} detail={detail} requirements={requirements} pending={actions.pending === 'save'} onSave={actions.saveFields} />
      )}
    </Card>
  );
}

function ReturnSheet({
  open,
  onOpenChange,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pending: boolean;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const send = async () => {
    if (reason.trim().length < 5) {
      setErr(tx.review.returnReasonShort);
      return;
    }
    try {
      await onSubmit(reason.trim());
      setReason('');
      setErr(null);
      onOpenChange(false);
    } catch (e) {
      setErr(errorMessage(e));
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={tx.review.returnTitle}
      description={tx.review.returnText}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {adm.common.cancel}
          </Button>
          <Button className="bg-warn-soft text-warn-text not-disabled:hover:bg-[#ffeccb]" variant="tonal" disabled={pending} onClick={send}>
            {tx.review.returnSend}
          </Button>
        </>
      }
    >
      <Field label={tx.review.returnReason} error={err ?? undefined} required>
        <Textarea rows={4} value={reason} placeholder={tx.review.returnPlaceholder} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Sheet>
  );
}

function EditSheet({
  open,
  onOpenChange,
  detail,
  requirements,
  pending,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  detail: RecordDetail;
  requirements: Requirement[];
  pending: boolean;
  onSave: (f: Record<string, unknown>) => Promise<void>;
}) {
  const r = detail.record;
  const f = tx.review.fields;
  const [requirementId, setRequirementId] = useState(r.requirementId ?? '');
  const [freeTitle, setFreeTitle] = useState(r.freeTitle ?? (r.requirementId ? '' : (r.title ?? '')));
  const [provider, setProvider] = useState(r.provider ?? detail.ocr.fields?.provider?.value ?? '');
  const [heldOn, setHeldOn] = useState(r.heldOn ?? (typeof detail.ocr.fields?.date?.normalized === 'string' ? detail.ocr.fields.date.normalized : ''));
  const [duration, setDuration] = useState(r.durationLabel ?? '');
  const [location, setLocation] = useState(r.location ?? '');
  const [validUntil, setValidUntil] = useState(r.validUntil ?? '');
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    try {
      const body: Record<string, unknown> = {
        provider: provider.trim() || null,
        heldOn: heldOn || null,
        durationLabel: duration.trim() || null,
        location: location.trim() || null,
        validUntil: validUntil || null,
        scope: 'group',
      };
      if (requirementId) body.requirementId = requirementId;
      else {
        body.requirementId = null;
        body.trainingId = null;
        if (freeTitle.trim().length >= 2) body.freeTitle = freeTitle.trim();
      }
      await onSave(body);
      onOpenChange(false);
    } catch (e) {
      setErr(errorMessage(e));
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={tx.review.editTitle}
      desktopPlacement="right"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {adm.common.cancel}
          </Button>
          <Button disabled={pending} onClick={save}>
            {tx.review.editSave}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {err && (
          <Panel tone="danger" role="alert">
            {err}
          </Panel>
        )}
        <Field label={f.requirement}>
          <Select value={requirementId} onChange={(e) => setRequirementId(e.target.value)}>
            <option value="">{tx.capture.noAssignment}</option>
            {requirements.map((q) => (
              <option key={q.id} value={q.id}>
                {requirementLabel(q)}
              </option>
            ))}
          </Select>
        </Field>
        {!requirementId && (
          <Field label={f.course}>
            <Input value={freeTitle} onChange={(e) => setFreeTitle(e.target.value)} />
          </Field>
        )}
        <Field label={f.provider}>
          <Input value={provider} onChange={(e) => setProvider(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={f.heldOn}>
            <Input type="date" value={heldOn} onChange={(e) => setHeldOn(e.target.value)} />
          </Field>
          <Field label={f.duration}>
            <Input value={duration} onChange={(e) => setDuration(e.target.value)} />
          </Field>
        </div>
        <Field label={f.location}>
          <Input value={location} onChange={(e) => setLocation(e.target.value)} />
        </Field>
        <Field label={f.validUntil} hint={f.validUntilHint}>
          <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}
