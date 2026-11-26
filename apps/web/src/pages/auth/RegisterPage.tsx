import type { FormEvent } from 'react';
import { Link } from 'react-router';
import { de } from '@/i18n/de';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { AuthShell } from './AuthShell';

export interface RegisterValues {
  name: string;
  organisation: string;
  email: string;
  password: string;
}

export interface RegisterPageProps {
  /** TODO(API): Registrierung anbinden (Phase 1). */
  onSubmit?: (values: RegisterValues) => void;
  pending?: boolean;
  /** Feldfehler aus der API */
  errors?: Partial<Record<keyof RegisterValues, string>>;
}

const t = de.auth.register;

/** Registrierung für Dozenten – nur Oberfläche, ohne API. */
export function RegisterPage({ onSubmit, pending = false, errors = {} }: RegisterPageProps) {
  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? '');
    onSubmit?.({ name: get('name'), organisation: get('organisation'), email: get('email'), password: get('password') });
  };

  return (
    <AuthShell
      title={t.title}
      subtitle={t.subtitle}
      footer={
        <>
          {t.haveAccount}{' '}
          <Link to="/anmelden" className="font-semibold text-accent-text underline-offset-4 hover:underline">
            {t.login}
          </Link>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        <Field label={t.name} required error={errors.name}>
          <Input name="name" autoComplete="name" placeholder={t.namePlaceholder} />
        </Field>
        <Field label={t.organisation} required error={errors.organisation}>
          <Input name="organisation" autoComplete="organization" placeholder={t.organisationPlaceholder} />
        </Field>
        <Field label={t.email} required error={errors.email}>
          <Input name="email" type="email" autoComplete="email" inputMode="email" placeholder={t.emailPlaceholder} />
        </Field>
        <Field label={t.password} required hint={t.passwordHint} error={errors.password}>
          <Input name="password" type="password" autoComplete="new-password" minLength={12} />
        </Field>
        <Button type="submit" size="lg" fullWidth disabled={pending} className="mt-2">
          {pending ? de.common.loading : t.submit}
        </Button>
      </form>
    </AuthShell>
  );
}

export default RegisterPage;
