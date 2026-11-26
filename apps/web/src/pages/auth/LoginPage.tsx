import type { FormEvent } from 'react';
import { Link } from 'react-router';
import { de } from '@/i18n/de';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { AuthShell } from './AuthShell';

export interface LoginValues {
  email: string;
  password: string;
}

export interface LoginPageProps {
  /** TODO(API): Anmeldung anbinden (Phase 1). */
  onSubmit?: (values: LoginValues) => void;
  pending?: boolean;
  error?: string;
}

const t = de.auth.login;

/** Anmeldeseite – nur Oberfläche, ohne API. */
export function LoginPage({ onSubmit, pending = false, error }: LoginPageProps) {
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
          <Link to="/registrieren" className="font-semibold text-accent-text underline-offset-4 hover:underline">
            {t.register}
          </Link>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        <Field label={t.email} required>
          <Input name="email" type="email" autoComplete="email" inputMode="email" placeholder={t.emailPlaceholder} />
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

export default LoginPage;
