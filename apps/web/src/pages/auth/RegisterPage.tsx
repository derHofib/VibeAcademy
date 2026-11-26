import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { de } from '@/i18n/de';
import { adm } from '@/i18n/admin';
import { Panel } from '@/components/ui/card';
import { fieldErrors, useMe, useRegister } from '@/features/auth/session';
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
  onSubmit?: (values: RegisterValues) => void;
  pending?: boolean;
  /** Feldfehler aus der API */
  errors?: Partial<Record<keyof RegisterValues, string>>;
  /** Allgemeiner Fehler (z. B. Netzwerk) */
  formError?: string;
}

const t = de.auth.register;

/** Registrierung für Dozenten – Oberfläche; `RegisterRoute` bindet sie an die API. */
export function RegisterPage({ onSubmit, pending = false, errors = {}, formError }: RegisterPageProps) {
  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? '');
    onSubmit?.({
      name: get('name'),
      organisation: get('organisation'),
      email: get('email'),
      password: get('password'),
    });
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
        {formError && (
          <Panel tone="danger" role="alert">
            {formError}
          </Panel>
        )}
        <Field label={t.name} required error={errors.name}>
          <Input name="name" autoComplete="name" placeholder={t.namePlaceholder} />
        </Field>
        <Field label={t.organisation} required error={errors.organisation}>
          <Input name="organisation" autoComplete="organization" placeholder={t.organisationPlaceholder} />
        </Field>
        <Field label={t.email} required error={errors.email}>
          <Input
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder={t.emailPlaceholder}
          />
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

/** Prüft Pflichtfelder vor dem Senden (die API prüft erneut). */
export function validateRegister(v: RegisterValues): Partial<Record<keyof RegisterValues, string>> {
  const e: Partial<Record<keyof RegisterValues, string>> = {};
  if (!v.name.trim()) e.name = adm.auth.required;
  if (v.organisation.trim().length < 2) e.organisation = adm.auth.required;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) e.email = adm.auth.invalidEmail;
  if (v.password.length < 12) e.password = adm.auth.passwordTooShort;
  return e;
}

/** `/registrieren`: legt Konto + Mandant an (E-07) und öffnet das Dashboard. */
export function RegisterRoute() {
  const navigate = useNavigate();
  const me = useMe();
  const register = useRegister();
  const [local, setLocal] = useState<Partial<Record<keyof RegisterValues, string>>>({});
  if (me.data && !register.isPending && !register.isSuccess) return <Navigate to="/verwaltung" replace />;

  const api = fieldErrors(register.error) as Partial<Record<keyof RegisterValues, string>>;
  const status = (register.error as { status?: number } | null)?.status;
  // 409: E-Mail vergeben → am E-Mail-Feld anzeigen
  const conflict = status === 409 ? { email: (register.error as Error).message } : {};
  const errors = { ...api, ...conflict, ...local };
  const formError =
    register.error && !Object.keys(api).length && status !== 409
      ? (register.error as Error).message
      : undefined;

  return (
    <RegisterPage
      pending={register.isPending}
      errors={errors}
      formError={formError}
      onSubmit={(v) => {
        const e = validateRegister(v);
        setLocal(e);
        if (Object.keys(e).length) return;
        register.mutate(v, { onSuccess: () => navigate('/verwaltung', { replace: true }) });
      }}
    />
  );
}

export default RegisterRoute;
