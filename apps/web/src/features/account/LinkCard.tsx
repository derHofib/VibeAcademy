import { useId, useState, type FormEvent } from 'react';
import { BadgeCheck, Check, Link2, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, Panel } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { StatusChip } from '@/components/ui/status';
import type { Me } from '@/features/auth/session';
import { ta } from '@/i18n/account';
import { useLinkCandidates, useLinkPersons, useRequestEmailCode, useVerifyEmail } from './api';

/** „Weitere Nachweise verknüpfen“: E-Mail per Code bestätigen, dann Einträge aus anderen Organisationen auswählen. */
export function LinkCard({ me }: { me: Me }) {
  const verified = me.account.emailVerified;
  return (
    <Card padding="none" className="rounded-[22px] p-[18px] md:p-6" aria-labelledby="verknuepfen-titel" data-testid="verknuepfen">
      <div className="flex items-start gap-3.5">
        <div aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-text">
          <Link2 className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="verknuepfen-titel" className="font-heading text-[17px] font-bold text-ink">
            {ta.link.title}
          </h2>
          <p className="mt-1 text-[14px] leading-[1.5] text-muted">{ta.link.intro}</p>
        </div>
      </div>
      <div className="mt-4">{verified ? <Candidates /> : <VerifyEmail email={me.account.email} />}</div>
    </Card>
  );
}

function VerifyEmail({ email }: { email: string }) {
  const request = useRequestEmailCode();
  const verify = useVerifyEmail();
  const [code, setCode] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const sent = request.isSuccess;

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setLocalError(ta.link.codeInvalid);
      return;
    }
    setLocalError(null);
    verify.mutate(code);
  };

  return (
    <div className="flex flex-col gap-3 rounded-box bg-bg p-4">
      <div>
        <h3 className="text-[15px] font-semibold text-ink">{ta.link.verifyTitle}</h3>
        <p className="mt-0.5 text-[14px] leading-[1.5] break-words text-ink-2">{ta.link.verifyText(email)}</p>
      </div>
      {!sent ? (
        <>
          {request.error && (
            <p role="alert" className="text-[13.5px] font-medium text-danger-text">
              {request.error.message}
            </p>
          )}
          <Button variant="secondary" className="self-start" disabled={request.isPending} onClick={() => request.mutate()}>
            {request.isPending && <Loader2 aria-hidden="true" className="size-[18px] animate-spin" />}
            {ta.link.requestCode}
          </Button>
        </>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          <p role="status" className="text-[13px] text-success-text">
            {ta.link.codeSent}
          </p>
          <Field label={ta.link.codeLabel} error={localError ?? verify.error?.message}>
            <Input
              tone="surface"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder={ta.link.codePlaceholder}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="tracking-[0.3em] tabular-nums placeholder:tracking-normal"
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={verify.isPending}>
              {verify.isPending && <Loader2 aria-hidden="true" className="size-[18px] animate-spin" />}
              {ta.link.confirmCode}
            </Button>
            <Button variant="ghost" size="sm" disabled={request.isPending} onClick={() => request.mutate()}>
              {ta.link.resend}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function Candidates() {
  const candidates = useLinkCandidates(true);
  const link = useLinkPersons();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const consentId = useId();
  const baseId = useId();

  const rows = candidates.data ?? [];
  const open = rows.filter((r) => !r.linked);
  const linked = rows.filter((r) => r.linked);

  const toggle = (id: string, on: boolean) => {
    setHint(null);
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const submit = () => {
    const ids = open.filter((r) => selected.has(r.person_id)).map((r) => r.person_id);
    if (!ids.length) {
      setHint(ta.link.selectFirst);
      return;
    }
    setResult(null);
    link.mutate(ids, {
      onSuccess: ({ linked: n }) => {
        setSelected(new Set());
        setResult(n > 0 ? ta.link.linked(n) : ta.link.linkedNone);
      },
    });
  };

  const count = open.filter((r) => selected.has(r.person_id)).length;

  return (
    <div className="flex flex-col gap-3">
      <StatusChip tone="success" icon={<BadgeCheck aria-hidden="true" />} className="self-start">
        {ta.link.verified}
      </StatusChip>

      {candidates.isPending ? (
        <p role="status" className="flex items-center gap-2 text-[14px] text-muted">
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          {ta.link.candidatesLoading}
        </p>
      ) : candidates.isError ? (
        <Panel tone="danger" role="alert">
          {candidates.error.message}
        </Panel>
      ) : rows.length === 0 ? (
        <p className="text-[14px] text-muted">{ta.link.noCandidates}</p>
      ) : (
        <>
          <ul aria-label={ta.link.listLabel} className="flex flex-col gap-2">
            {open.map((r) => {
              const id = `${baseId}-${r.person_id}`;
              return (
                <li key={r.person_id} className="flex items-center gap-3.5 rounded-box bg-bg px-4 py-3">
                  <Checkbox
                    id={id}
                    checked={selected.has(r.person_id)}
                    onCheckedChange={(v) => toggle(r.person_id, v === true)}
                    aria-describedby={consentId}
                  />
                  <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                    <span className="block text-[15px] font-semibold break-words text-ink">{r.tenant_name}</span>
                    <span className="block text-[13px] text-muted">{r.person_name}</span>
                  </label>
                </li>
              );
            })}
            {linked.map((r) => (
              <li key={r.person_id} className="flex items-center gap-3.5 rounded-box bg-bg px-4 py-3">
                <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-[7px] bg-success-soft text-success-text">
                  <Check className="size-4" strokeWidth={3} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold break-words text-ink">{r.tenant_name}</span>
                  <span className="block text-[13px] text-muted">{r.person_name}</span>
                </span>
                <StatusChip tone="success">{ta.link.linkedChip}</StatusChip>
              </li>
            ))}
          </ul>

          {open.length === 0 ? (
            <p className="text-[14px] text-muted">{ta.link.allLinked}</p>
          ) : (
            <>
              <Panel tone="accent" id={consentId} className="flex items-start gap-3 text-[13.5px]">
                <ShieldCheck aria-hidden="true" className="mt-0.5 size-[18px] shrink-0" />
                <span>{ta.link.consent}</span>
              </Panel>
              {(hint || link.error) && (
                <p role="alert" className="text-[13.5px] font-medium text-danger-text">
                  {hint ?? link.error?.message}
                </p>
              )}
              <Button onClick={submit} disabled={link.isPending} className="self-stretch sm:self-start">
                {link.isPending && <Loader2 aria-hidden="true" className="size-[18px] animate-spin" />}
                {ta.link.submitCount(count)}
              </Button>
            </>
          )}
        </>
      )}
      <p role="status" className="text-[13.5px] font-medium text-success-text empty:hidden">
        {result}
      </p>
    </div>
  );
}
