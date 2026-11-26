import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { QrCode } from 'lucide-react';
import { peekQrToken } from '@sn/shared';
import { ApiError, post } from '@/lib/api';
import { ParticipantLayout } from '@/components/layout/ParticipantLayout';
import { Button, Card, EmptyState, Field, Input, Panel } from '@/components/ui';
import { tl } from '@/i18n/live';
import { LoadingScreen } from '@/features/participant/ScreenStates';
import { livePath, type ScanResponse } from '@/features/live/api';
import { browserStore, enqueueScan } from '@/features/live/offlineQueue';

const t = tl.tn;

type State =
  | { step: 'sending' }
  | { step: 'walkIn'; error: string | null; pending: boolean }
  | { step: 'error'; title: string; message: string; login?: boolean };

/**
 * QR-Deep-Link `/q/:token` (Scan mit der Kamera-App des Handys): Start-Code → einchecken, Ende-Code → auschecken,
 * danach weiter zur Live-Ansicht. Ohne Sitzung am Start-QR: kurzes Formular (Name, E-Mail) – Check-in ohne Einladung.
 */
export default function QrLinkPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const payload = peekQrToken(token);
  const kind = payload?.kind ?? 'start';
  const [state, setState] = useState<State>(
    payload ? { step: 'sending' } : { step: 'error', title: t.qrLink.invalid, message: t.scan.notAQr },
  );
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const started = useRef(false);

  const send = useCallback(
    async (extra: { name?: string; email?: string } = {}) => {
      const deviceTime = new Date().toISOString();
      try {
        const res = await post<ScanResponse>(kind === 'start' ? '/checkin' : '/checkout', { token, deviceTime, ...extra });
        // Neue Sitzung (Check-in ohne Einladung): alte Teilnahmedaten verwerfen
        if (res.newSession) qc.removeQueries({ queryKey: ['teilnahme'] });
        const notice = kind === 'start' ? (res.alreadyCheckedIn ? t.in.already : t.in.checkedInNow) : undefined;
        navigate(livePath.participant(res.invitationId), { replace: true, state: notice ? { notice } : null });
      } catch (e) {
        if (e instanceof ApiError) {
          if (e.code === 'anmeldung_noetig') {
            setState({ step: 'walkIn', error: Object.keys(extra).length ? e.message : null, pending: false });
          } else if (e.code === 'nicht_angemeldet') {
            setState({ step: 'error', title: t.qrLink.failed, message: `${e.message} ${t.walkIn.notAllowed}`, login: true });
          } else if (e.status === 400 && e.fields.length) {
            setState({ step: 'walkIn', error: e.fields[0]!.message, pending: false });
          } else {
            setState({ step: 'error', title: t.qrLink.failed, message: e.message });
          }
          return;
        }
        // Netzfehler: Scan merken und später übertragen (Scanzeit = signierter Code-Zeitpunkt)
        enqueueScan(browserStore(), { kind, token, deviceTime, invitationId: null });
        setState({ step: 'error', title: t.qrLink.failed, message: t.scan.offlineQueued });
      }
    },
    [kind, token, navigate, qc],
  );

  useEffect(() => {
    if (!payload || started.current) return;
    started.current = true;
    void send();
  }, [payload, send]);

  if (state.step === 'sending') return <LoadingScreen label={kind === 'start' ? t.qrLink.checkingIn : t.qrLink.checkingOut} />;

  if (state.step === 'walkIn') {
    const submit = (e: FormEvent) => {
      e.preventDefault();
      setState({ step: 'walkIn', error: null, pending: true });
      void send({ name: name.trim(), email: email.trim() });
    };
    return (
      <ParticipantLayout eyebrow={t.scan.kickerStart} title={t.walkIn.title}>
        <Card className="rounded-[24px]">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <p className="text-[14.5px] leading-[1.55] text-ink-2">{t.walkIn.text}</p>
            <Field label={t.walkIn.name} required>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" minLength={2} maxLength={200} />
            </Field>
            <Field label={t.walkIn.email} required>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={254} />
            </Field>
            {state.error && (
              <Panel tone="danger" role="alert">
                {state.error}
              </Panel>
            )}
            <Button type="submit" size="lg" fullWidth disabled={state.pending || name.trim().length < 2 || !email.includes('@')}>
              {state.pending ? t.qrLink.checkingIn : t.walkIn.submit}
            </Button>
          </form>
        </Card>
      </ParticipantLayout>
    );
  }

  return (
    <ParticipantLayout className="justify-center">
      <Card>
        <EmptyState
          icon={<QrCode />}
          title={<span role="alert">{state.title}</span>}
          description={state.message}
          action={
            state.login ? (
              <Button asChild variant="secondary">
                <Link to={`/anmelden?weiter=${encodeURIComponent(`/q/${token}`)}`}>{t.qrLink.toLogin}</Link>
              </Button>
            ) : undefined
          }
        />
      </Card>
    </ParticipantLayout>
  );
}
