import { useId, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Download, Loader2, ShieldCheck, UserPlus } from 'lucide-react';
import { post, sha256Hex } from '@/lib/api';
import { ParticipantLayout } from '@/components/layout/ParticipantLayout';
import { Button } from '@/components/ui/button';
import { Card, Panel } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { tp, formatDateTime } from '@/i18n/participant';
import {
  participantKeys,
  participantPath,
  useEvidence,
  useInvitation,
  useSignatureInfo,
  type InvitationStart,
  type SignatureInfo,
} from '@/features/participant/api';
import { ErrorScreen, LoadingScreen } from '@/features/participant/ScreenStates';
import { participantRegisterPath } from '@/features/account/model';
import { MIN_SIGNATURE_POINTS, SignatureField, type SignatureFieldHandle } from '@/features/participant/SignatureField';

/** Bestätigung und Unterschrift (Screen 6), danach Abschluss mit Nachweis. */
export default function SignaturePage() {
  const { id = '' } = useParams();
  const inv = useInvitation(id);
  const info = useSignatureInfo(id);
  const [done, setDone] = useState<{ verifyCode: string; nachweisNr: string; signedAt?: string } | null>(null);

  if (inv.isError) return <ErrorScreen message={inv.error.message} />;
  if (info.isError) return <ErrorScreen message={info.error.message} />;
  if (!inv.data || !info.data) return <LoadingScreen />;

  if (done || info.data.signedAt) {
    return (
      <DoneView
        id={id}
        start={inv.data}
        signedAt={done?.signedAt ?? info.data.signedAt ?? undefined}
        verifyCode={done?.verifyCode ?? info.data.verifyCode ?? undefined}
        nachweisNr={done?.nachweisNr}
      />
    );
  }
  return <SignForm id={id} start={inv.data} info={info.data} onSigned={setDone} />;
}

function Steps({ start, info, current }: { start: InvitationStart; info: SignatureInfo; current: boolean }) {
  const items = [
    { label: tp.sign.stepPages(start.totals.pages), done: info.requirements.pagesComplete },
    ...(info.requirements.quizRequired ? [{ label: tp.sign.stepQuiz, done: info.requirements.quizPassed }] : []),
  ];
  return (
    <ol aria-label={tp.sign.progressLabel} className="flex gap-1.5 text-[12.5px] font-semibold">
      {items.map((s) => (
        <li
          key={s.label}
          className={cn(
            'flex min-h-9 flex-1 items-center justify-center gap-1 rounded-pill px-1.5 py-2 text-center',
            s.done ? 'bg-success-soft text-success-text' : 'bg-neutral-soft text-ink-2',
          )}
        >
          {s.done && <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />}
          {s.label}
          {s.done && <span className="sr-only">{tp.sign.stepDone}</span>}
        </li>
      ))}
      <li
        aria-current={current ? 'step' : undefined}
        className="flex min-h-9 flex-1 items-center justify-center rounded-pill bg-accent px-1.5 py-2 text-center text-white"
      >
        {tp.sign.stepSign}
      </li>
    </ol>
  );
}

function SignForm({
  id,
  start,
  info,
  onSigned,
}: {
  id: string;
  start: InvitationStart;
  info: SignatureInfo;
  onSigned: (r: { verifyCode: string; nachweisNr: string; signedAt?: string }) => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pad = useRef<SignatureFieldHandle>(null);
  const [agree, setAgree] = useState(false);
  const [points, setPoints] = useState(0);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeState, setCodeState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmId = useId();
  const authId = useId();

  const usePassword = info.authMethods.includes('password');
  const useOtp = !usePassword && info.authMethods.includes('otp_mail');
  const signed = points >= MIN_SIGNATURE_POINTS;
  const authOk = usePassword ? password.length > 0 : useOtp ? /^\d{6}$/.test(code) : false;
  const ready = info.ready && agree && signed && authOk;
  const missing = [
    ...(agree ? [] : [tp.sign.missingConfirm]),
    ...(signed ? [] : [tp.sign.missingSignature]),
    ...(authOk ? [] : usePassword ? [tp.sign.missingPassword] : useOtp ? [tp.sign.missingCode] : []),
  ];

  const header = { title: tp.sign.title, onBack: () => navigate(participantPath.start(id)) };

  if (!info.ready) {
    const needPages = !info.requirements.pagesComplete;
    return (
      <ParticipantLayout {...header}>
        <Steps start={start} info={info} current={false} />
        <Card>
          <h2 className="font-heading text-[17px] font-bold">{tp.sign.notReadyTitle}</h2>
          <p className="mt-1.5 text-[14.5px] leading-[1.55] text-ink-2">{needPages ? tp.sign.notReadyPages : tp.sign.notReadyQuiz}</p>
          <Button className="mt-4" onClick={() => navigate(needPages ? participantPath.read(id) : participantPath.quiz(id))}>
            {needPages ? tp.sign.toReading : tp.sign.toQuiz}
          </Button>
        </Card>
      </ParticipantLayout>
    );
  }

  const requestCode = async () => {
    setCodeState('sending');
    setError(null);
    try {
      await post(`/me/invitations/${id}/otp`);
      setCodeState('sent');
    } catch (e) {
      setCodeState('idle');
      setError(e instanceof Error ? e.message : tp.common.errorTitle);
    }
  };

  const submit = async () => {
    if (!ready || busy || !pad.current) return;
    setBusy(true);
    setError(null);
    try {
      // Hash des angezeigten Textes – der Server prüft, ob er zur Version passt
      const confirmTextSha256 = await sha256Hex(info.confirmText);
      const { stepUpToken } = await post<{ stepUpToken: string }>(`/me/invitations/${id}/step-up`, usePassword ? { password } : { code });
      const r = await post<{ verifyCode: string; nachweisNr: string; signedAt: string }>(`/me/invitations/${id}/signature`, {
        stepUpToken,
        confirmed: true,
        confirmTextSha256,
        strokes: pad.current.strokes(),
        imagePng: pad.current.png(),
      });
      void qc.invalidateQueries({ queryKey: participantKeys.invitation(id) });
      void qc.invalidateQueries({ queryKey: participantKeys.signature(id) });
      onSigned(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : tp.common.errorTitle);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ParticipantLayout
      {...header}
      footer={
        <>
          <p
            id="unterschrift-hinweis"
            aria-live="polite"
            className={cn('min-h-[18px] text-center text-[13px]', ready ? 'text-success' : 'text-muted')}
          >
            {ready ? tp.sign.ready : tp.sign.missing(missing)}
          </p>
          {error && (
            <p role="alert" className="text-center text-[13.5px] font-medium text-danger-text">
              {error}
            </p>
          )}
          <Button size="lg" fullWidth disabled={!ready || busy} aria-describedby="unterschrift-hinweis" onClick={() => void submit()}>
            {busy && <Loader2 aria-hidden="true" className="size-5 animate-spin" />}
            {busy ? tp.sign.submitting : tp.sign.submit}
          </Button>
        </>
      }
    >
      <Steps start={start} info={info} current />
      <Card padding="none" className="flex items-start gap-3.5 rounded-[20px] p-4">
        <Checkbox id={confirmId} checked={agree} onCheckedChange={(v) => setAgree(v === true)} className="mt-0.5" />
        <label htmlFor={confirmId} className="cursor-pointer text-[14px] leading-[1.55] text-ink">
          {info.confirmText}
        </label>
      </Card>
      <SignatureField ref={pad} caption={start.personName} onChange={setPoints} />
      {usePassword && (
        <div className="flex flex-col gap-1.5 px-1">
          <label htmlFor={authId} className="text-[13px] text-muted">
            {tp.sign.passwordLabel}
          </label>
          <Input
            id={authId}
            type="password"
            tone="surface"
            size="lg"
            autoComplete="current-password"
            placeholder={tp.sign.passwordPlaceholder}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
      )}
      {useOtp && (
        <div className="flex flex-col gap-2 px-1">
          <label htmlFor={authId} className="text-[13px] text-muted">
            {tp.sign.codeLabel}
          </label>
          {codeState === 'idle' ? (
            <>
              <p className="text-[13px] text-muted">{tp.sign.codeHint}</p>
              <Button variant="secondary" onClick={() => void requestCode()} className="self-start">
                {tp.sign.codeRequest}
              </Button>
            </>
          ) : (
            <>
              <Input
                id={authId}
                tone="surface"
                size="lg"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                placeholder={tp.sign.codePlaceholder}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="tracking-[0.3em] tabular-nums"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12.5px] text-muted" aria-live="polite">
                  {codeState === 'sent' ? tp.sign.codeSent : tp.common.loading}
                </p>
                <Button variant="ghost" size="sm" disabled={codeState === 'sending'} onClick={() => void requestCode()}>
                  {tp.sign.codeResend}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      {!usePassword && !useOtp && <Panel tone="warn">{tp.sign.noAuth}</Panel>}
    </ParticipantLayout>
  );
}

function DoneView({
  id,
  start,
  signedAt,
  verifyCode,
  nachweisNr,
}: {
  id: string;
  start: InvitationStart;
  signedAt?: string;
  verifyCode?: string;
  nachweisNr?: string;
}) {
  const ev = useEvidence(id, true);
  const ready = ev.data?.status === 'erzeugt';
  const code = ev.data?.verifyCode ?? verifyCode;
  const nr = ev.data?.nachweisNr ?? nachweisNr;
  return (
    <ParticipantLayout title={start.training.titel} eyebrow={start.tenantName}>
      <Card className="flex flex-col items-center gap-3 text-center" padding="lg">
        <div aria-hidden="true" className="flex size-[84px] items-center justify-center rounded-full bg-success-soft text-success">
          <Check className="size-10" strokeWidth={3} />
        </div>
        <h2 className="font-heading text-[24px] font-bold text-ink">{tp.done.title}</h2>
        <p className="max-w-[340px] text-[15px] leading-[1.55] text-ink-2">{ready ? tp.done.textReady : tp.done.text}</p>
        <dl className="mt-2 grid w-full grid-cols-1 gap-2 text-left sm:grid-cols-2">
          {nr && <Fact label={tp.done.nr} value={nr} />}
          {code && <Fact label={tp.done.code} value={code} mono />}
          {signedAt && <Fact label={tp.done.signedAt} value={formatDateTime(signedAt)} className="sm:col-span-2" />}
        </dl>
        <div className="mt-2 flex w-full flex-col gap-2.5" aria-live="polite">
          {ready ? (
            <Button asChild size="lg" fullWidth>
              <a href={`/api/me/invitations/${id}/evidence/pdf`} download>
                <Download aria-hidden="true" className="size-5" />
                {tp.done.download}
              </a>
            </Button>
          ) : ev.data?.status === 'fehler' ? (
            <Panel tone="warn">{tp.done.failed}</Panel>
          ) : (
            <div role="status" className="flex h-14 items-center justify-center gap-2 rounded-pill bg-bg text-[14.5px] font-medium text-ink-2">
              <Loader2 aria-hidden="true" className="size-5 animate-spin" />
              {tp.done.pending}
            </div>
          )}
          {code && (
            <Button asChild variant="tonal" size="md" fullWidth>
              <Link to={participantPath.verify(code)}>
                <ShieldCheck aria-hidden="true" className="size-[18px]" />
                {tp.done.verify}
              </Link>
            </Button>
          )}
        </div>
      </Card>
      {!start.hasAccount && (
        <Card padding="md" className="flex items-start gap-3.5">
          <div aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-text">
            <UserPlus className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-[16px] font-bold text-ink">{tp.done.accountTitle}</h2>
            <p className="mt-1 text-[13.5px] leading-[1.5] text-muted">{tp.done.accountText}</p>
            <Button asChild variant="soft" size="sm" className="mt-3">
              <Link to={participantRegisterPath(start.personEmail)}>{tp.done.accountAction}</Link>
            </Button>
          </div>
        </Card>
      )}
    </ParticipantLayout>
  );
}

function Fact({ label, value, mono, className }: { label: string; value: string; mono?: boolean; className?: string }) {
  return (
    <div className={cn('rounded-[16px] bg-bg px-4 py-3', className)}>
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className={cn('mt-0.5 text-[15px] font-semibold text-ink', mono && 'tracking-[0.04em] tabular-nums')} data-testid={mono ? 'verify-code' : undefined}>
        {value}
      </dd>
    </div>
  );
}
