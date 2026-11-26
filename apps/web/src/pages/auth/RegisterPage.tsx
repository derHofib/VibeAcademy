import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { ShieldCheck } from 'lucide-react';
import { de } from '@/i18n/de';
import { adm } from '@/i18n/admin';
import { ta } from '@/i18n/account';
import { Panel } from '@/components/ui/card';
import { fieldErrors, useMe, useRegister } from '@/features/auth/session';
import { useRegisterAccount } from '@/features/account/api';
import { homePathFor } from '@/features/account/model';
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

/** `dozent`: Konto + neue Organisation (E-07). `teilnehmer`: Konto nur für eigene Nachweise (E-25). */
export type RegisterMode = 'dozent' | 'teilnehmer';

export interface RegisterPageProps {
  mode?: RegisterMode;
  onSubmit?: (values: RegisterValues) => void;
  pending?: boolean;
  /** Feldfehler aus der API */
  errors?: Partial<Record<keyof RegisterValues, string>>;
  /** Allgemeiner Fehler (z. B. Netzwerk) */
  formError?: string;
  /** Vorbelegte E-Mail-Adresse (z. B. aus der Einladung) */
  defaultEmail?: string;
}

const t = de.auth.register;
const linkClass = 'font-semibold text-accent-text underline-offset-4 hover:underline';

/** Registrierung für Dozenten bzw. Teilnehmer – Oberfläche; `RegisterRoute` bindet sie an die API. */
export function RegisterPage({ mode = 'dozent', onSubmit, pending = false, errors = {}, formError, defaultEmail }: RegisterPageProps) {
  const participant = mode === 'teilnehmer';
  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? '');
    onSubmit?.({
      name: get('name'),
      organisation: participant ? '' : get('organisation'),
      email: get('email'),
      password: get('password'),
    });
  };

  return (
    <AuthShell
      title={participant ? ta.register.title : t.title}
      subtitle={participant ? ta.register.subtitle : t.subtitle}
      footer={
        <div className="flex flex-col gap-2">
          <p>
            {t.haveAccount}{' '}
            <Link to={participant ? '/anmelden?teilnehmer=1' : '/anmelden'} className={linkClass}>
              {t.login}
            </Link>
          </p>
          <p>
            {participant ? ta.register.trainerQuestion : ta.register.participantQuestion}{' '}
            <Link to={participant ? '/registrieren' : '/registrieren?teilnehmer=1'} className={linkClass}>
              {participant ? ta.register.trainerLink : ta.register.participantLink}
            </Link>
          </p>
        </div>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        {participant && (
          <Panel tone="accent" className="flex items-start gap-3 text-[13.5px]">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-[18px] shrink-0" />
            <span>
              <strong className="block font-semibold">{ta.register.infoTitle}</strong>
              {ta.register.infoText}
            </span>
          </Panel>
        )}
        {formError && (
          <Panel tone="danger" role="alert">
            {formError}
          </Panel>
        )}
        <Field label={t.name} required error={errors.name}>
          <Input name="name" autoComplete="name" placeholder={t.namePlaceholder} />
        </Field>
        {!participant && (
          <Field label={t.organisation} required error={errors.organisation}>
            <Input name="organisation" autoComplete="organization" placeholder={t.organisationPlaceholder} />
          </Field>
        )}
        <Field label={t.email} required error={errors.email} hint={participant ? ta.register.emailHint : undefined}>
          <Input
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder={t.emailPlaceholder}
            defaultValue={defaultEmail}
          />
        </Field>
        <Field label={t.password} required hint={t.passwordHint} error={errors.password}>
          <Input name="password" type="password" autoComplete="new-password" minLength={12} />
        </Field>
        <Button type="submit" size="lg" fullWidth disabled={pending} className="mt-2">
          {pending ? de.common.loading : participant ? ta.register.submit : t.submit}
        </Button>
      </form>
    </AuthShell>
  );
}

/** Prüft Pflichtfelder vor dem Senden (die API prüft erneut). */
export function validateRegister(v: RegisterValues, mode: RegisterMode = 'dozent'): Partial<Record<keyof RegisterValues, string>> {
  const e: Partial<Record<keyof RegisterValues, string>> = {};
  if (!v.name.trim()) e.name = adm.auth.required;
  if (mode === 'dozent' && v.organisation.trim().length < 2) e.organisation = adm.auth.required;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) e.email = adm.auth.invalidEmail;
  if (v.password.length < 12) e.password = adm.auth.passwordTooShort;
  return e;
}

/**
 * `/registrieren`: legt Konto + Mandant an (E-07) und öffnet das Dashboard.
 * `/registrieren?teilnehmer=1[&email=…]`: Teilnehmerkonto ohne Organisation (E-25) → „Meine Nachweise“.
 */
export function RegisterRoute() {
  const [params] = useSearchParams();
  const mode: RegisterMode = params.get('teilnehmer') === '1' ? 'teilnehmer' : 'dozent';
  const navigate = useNavigate();
  const me = useMe();
  const registerDozent = useRegister();
  const registerAccount = useRegisterAccount();
  const register = mode === 'teilnehmer' ? registerAccount : registerDozent;
  // Lokale Prüffehler gelten nur für den Modus, in dem sie entstanden sind
  const [localState, setLocalState] = useState<{ mode: RegisterMode; errors: Partial<Record<keyof RegisterValues, string>> }>({
    mode,
    errors: {},
  });
  const local = localState.mode === mode ? localState.errors : {};
  if (me.data && !register.isPending && !register.isSuccess) return <Navigate to={homePathFor(me.data)} replace />;

  const api = fieldErrors(register.error) as Partial<Record<keyof RegisterValues, string>>;
  const status = (register.error as { status?: number } | null)?.status;
  // 409: E-Mail vergeben → am E-Mail-Feld anzeigen
  const conflict = status === 409 ? { email: (register.error as Error).message } : {};
  const errors = { ...api, ...conflict, ...local };
  const formError =
    register.error && !Object.keys(api).length && status !== 409 ? (register.error as Error).message : undefined;

  return (
    <RegisterPage
      key={mode}
      mode={mode}
      defaultEmail={params.get('email') ?? undefined}
      pending={register.isPending}
      errors={errors}
      formError={formError}
      onSubmit={(v) => {
        const e = validateRegister(v, mode);
        setLocalState({ mode, errors: e });
        if (Object.keys(e).length) return;
        if (mode === 'teilnehmer') {
          registerAccount.mutate(
            { name: v.name, email: v.email, password: v.password },
            { onSuccess: () => navigate('/konto', { replace: true }) },
          );
        } else {
          registerDozent.mutate(v, { onSuccess: () => navigate('/verwaltung', { replace: true }) });
        }
      }}
    />
  );
}

export default RegisterRoute;
