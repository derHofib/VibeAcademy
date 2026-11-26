import { useEffect, useState, type FormEvent } from 'react';
import { TimerOff } from 'lucide-react';
import { loginLockedText } from '@sn/shared';
import { formatClock, useCountdown } from '@/hooks/useCountdown';
import { lockSecondsFrom } from '@/features/auth/lock';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { de } from '@/i18n/de';
import { adm } from '@/i18n/admin';
import { ApiError } from '@/lib/api';
import { ta } from '@/i18n/account';
import { useQueryClient } from '@tanstack/react-query';
import { fieldErrors, meKey, safeNext, useLogin, useMe, type Me } from '@/features/auth/session';
import { homePathFor } from '@/features/account/model';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { AuthShell } from './AuthShell';
import { SsoLoginButton } from '@/features/sso/SsoLoginButton';

export interface LoginValues {
  email: string;
  password: string;
}

export interface LoginPageProps {
  /** `teilnehmer`: Texte und Links für „Meine Nachweise“ (E-25) */
  mode?: 'dozent' | 'teilnehmer';
  onSubmit?: (values: LoginValues) => void;
  pending?: boolean;
  /** Fehler am Passwortfeld (z. B. „E-Mail oder Passwort falsch“) */
  error?: string;
  /** Fehler am E-Mail-Feld */
  emailError?: string;
  /** Restsekunden einer Login-Sperre (> 0: Meldung mit Restzeit, Anmelden deaktiviert) */
  lockedSeconds?: number;
}

const t = de.auth.login;

/** Anmeldeseite – Oberfläche; `LoginRoute` bindet sie an die API. */
export function LoginPage({ mode = 'dozent', onSubmit, pending = false, error, emailError, lockedSeconds = 0 }: LoginPageProps) {
  const locked = lockedSeconds > 0;
  const participant = mode === 'teilnehmer';
  const [email, setEmail] = useState('');
  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    onSubmit?.({ email: String(data.get('email') ?? ''), password: String(data.get('password') ?? '') });
  };

  return (
    <AuthShell
      title={participant ? ta.login.title : t.title}
      subtitle={participant ? ta.login.subtitle : t.subtitle}
      footer={
        <>
          {t.noAccount}{' '}
          <Link
            to={participant ? '/registrieren?teilnehmer=1' : '/registrieren'}
            className="font-semibold text-accent-text underline-offset-4 hover:underline"
          >
            {participant ? ta.login.register : t.register}
          </Link>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        {locked && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-box bg-warn-soft px-4 py-3 text-[14px] font-medium text-warn-text"
          >
            <TimerOff aria-hidden="true" className="mt-0.5 size-[18px] shrink-0" />
            <span data-testid="login-sperre">{loginLockedText(lockedSeconds)}</span>
          </div>
        )}
        <Field label={t.email} required error={emailError}>
          <Input
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder={t.emailPlaceholder}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label={t.password} required error={locked ? undefined : error}>
          <Input name="password" type="password" autoComplete="current-password" />
        </Field>
        <Button type="submit" size="lg" fullWidth disabled={pending || locked} className="mt-2">
          {pending ? de.common.loading : locked ? t.lockedSubmit(formatClock(lockedSeconds)) : t.submit}
        </Button>
      </form>
      {/* Phase 3 (E-36): Anmeldung mit Firmenkonto */}
      <SsoLoginButton email={email} />
    </AuthShell>
  );
}

/**
 * `/anmelden`: meldet an und leitet zu `?weiter=` bzw. – ohne Ziel – reine Teilnehmerkonten zu `/konto`,
 * Mitglieder einer Organisation zur Verwaltung. `?teilnehmer=1` (oder Ziel `/konto`) zeigt die Teilnehmertexte.
 */
export function LoginRoute() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const me = useMe();
  const qc = useQueryClient();
  const login = useLogin();
  const weiter = params.get('weiter');
  const mode = params.get('teilnehmer') === '1' || weiter?.startsWith('/konto') ? 'teilnehmer' : 'dozent';
  const target = (m: Me | null | undefined) => (weiter ? safeNext(weiter) : homePathFor(m));
  // Login-Sperre: Restzeit aus der 429-Antwort, Countdown bis zum Ablauf
  const [lockUntil, setLockUntil] = useState<number | null>(null);
  useEffect(() => {
    const s = lockSecondsFrom(login.error);
    if (s) setLockUntil(Date.now() + s * 1000);
  }, [login.error]);
  const lockedSeconds = useCountdown(lockUntil);
  if (me.data && !login.isPending) return <Navigate to={target(me.data)} replace />;

  const fe = fieldErrors(login.error);
  const generic =
    login.error && !fe.email && !fe.password && !lockSecondsFrom(login.error)
      ? login.error instanceof ApiError && login.error.status === 401
        ? login.error.message || adm.auth.loginFailed
        : (login.error as Error).message || adm.auth.loginFailed
      : undefined;

  return (
    <LoginPage
      mode={mode}
      pending={login.isPending}
      emailError={fe.email}
      error={fe.password ?? generic}
      lockedSeconds={lockedSeconds}
      onSubmit={(v) => {
        login.mutate(v, { onSuccess: () => navigate(target(qc.getQueryData<Me | null>(meKey)), { replace: true }) });
      }}
    />
  );
}

export default LoginRoute;
