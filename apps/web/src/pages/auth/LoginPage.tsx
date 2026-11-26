import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { de } from '@/i18n/de';
import { adm } from '@/i18n/admin';
import { ApiError } from '@/lib/api';
import { fieldErrors, safeNext, useLogin, useMe } from '@/features/auth/session';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { AuthShell } from './AuthShell';

export interface LoginValues {
  email: string;
  password: string;
}

export interface LoginPageProps {
  onSubmit?: (values: LoginValues) => void;
  pending?: boolean;
  /** Fehler am Passwortfeld (z. B. „E-Mail oder Passwort falsch“) */
  error?: string;
  /** Fehler am E-Mail-Feld */
  emailError?: string;
}

const t = de.auth.login;

/** Anmeldeseite – Oberfläche; `LoginRoute` bindet sie an die API. */
export function LoginPage({ onSubmit, pending = false, error, emailError }: LoginPageProps) {
  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    onSubmit?.({ email: String(data.get('email') ?? ''), password: String(data.get('password') ?? '') });
  };

  return (
    <AuthShell
      title={t.title}
      subtitle={t.subtitle}
      footer={
        <>
          {t.noAccount}{' '}
          <Link
            to="/registrieren"
            className="font-semibold text-accent-text underline-offset-4 hover:underline"
          >
            {t.register}
          </Link>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        <Field label={t.email} required error={emailError}>
          <Input
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder={t.emailPlaceholder}
          />
        </Field>
        <Field label={t.password} required error={error}>
          <Input name="password" type="password" autoComplete="current-password" />
        </Field>
        <Button type="submit" size="lg" fullWidth disabled={pending} className="mt-2">
          {pending ? de.common.loading : t.submit}
        </Button>
      </form>
    </AuthShell>
  );
}

/** `/anmelden`: meldet an und leitet zu `?weiter=` bzw. zur Verwaltung. */
export function LoginRoute() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const me = useMe();
  const login = useLogin();
  const next = safeNext(params.get('weiter'));
  if (me.data && !login.isPending) return <Navigate to={next} replace />;

  const fe = fieldErrors(login.error);
  const generic =
    login.error && !fe.email && !fe.password
      ? login.error instanceof ApiError && login.error.status === 401
        ? login.error.message || adm.auth.loginFailed
        : (login.error as Error).message || adm.auth.loginFailed
      : undefined;

  return (
    <LoginPage
      pending={login.isPending}
      emailError={fe.email}
      error={fe.password ?? generic}
      onSubmit={(v) => {
        login.mutate(v, { onSuccess: () => navigate(next, { replace: true }) });
      }}
    />
  );
}

export default LoginRoute;
