import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { post } from '@/lib/api';
import { adm } from '@/i18n/admin';
import { de } from '@/i18n/de';
import { Button, Field, Input, Panel } from '@/components/ui';
import { fieldErrors, meKey } from '@/features/auth/session';
import { AuthShell } from './AuthShell';

const t = adm.auth.setPassword;

/** Token aus `#token=…` (Fragment wird nicht an Server/Logs übertragen). */
export function tokenFromHash(hash: string): string | null {
  const m = /(?:^#|&)token=([^&]+)/.exec(hash);
  return m ? decodeURIComponent(m[1]!) : null;
}

/** `/passwort-festlegen#token=…` aus der Einladung eines Kollegen. */
export default function SetPasswordPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const token = tokenFromHash(location.hash);
  const [local, setLocal] = useState<{ password?: string; repeat?: string }>({});
  const m = useMutation({
    mutationFn: (password: string) => post('/auth/password/set', { token, password }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: meKey });
      navigate('/verwaltung', { replace: true });
    },
  });

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const password = String(data.get('password') ?? '');
    const repeat = String(data.get('repeat') ?? '');
    const errs: typeof local = {};
    if (password.length < 12) errs.password = adm.auth.passwordTooShort;
    if (password !== repeat) errs.repeat = t.mismatch;
    setLocal(errs);
    if (!Object.keys(errs).length) m.mutate(password);
  };

  const fe = fieldErrors(m.error);
  const general = m.error && !fe.password ? (m.error as Error).message : undefined;

  return (
    <AuthShell
      title={t.title}
      subtitle={t.subtitle}
      footer={
        <Link to="/anmelden" className="font-semibold text-accent-text underline-offset-4 hover:underline">
          {t.toLogin}
        </Link>
      }
    >
      {!token ? (
        <Panel tone="warn" role="alert">
          {t.missingToken}
        </Panel>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          {general && (
            <Panel tone="danger" role="alert">
              {general}
            </Panel>
          )}
          <Field
            label={t.password}
            required
            hint={de.auth.register.passwordHint}
            error={local.password ?? fe.password}
          >
            <Input name="password" type="password" autoComplete="new-password" />
          </Field>
          <Field label={t.repeat} required error={local.repeat}>
            <Input name="repeat" type="password" autoComplete="new-password" />
          </Field>
          <Button type="submit" size="lg" fullWidth disabled={m.isPending} className="mt-2">
            {m.isPending ? de.common.loading : t.submit}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
