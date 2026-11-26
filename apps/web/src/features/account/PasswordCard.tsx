import { useEffect, useState, type FormEvent } from 'react';
import { CircleCheck, KeyRound, TimerOff } from 'lucide-react';
import { PASSWORD_MIN_LENGTH } from '@sn/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { fieldErrors } from '@/features/auth/session';
import { lockSecondsFrom } from '@/features/auth/lock';
import { formatClock, useCountdown } from '@/hooks/useCountdown';
import { ta } from '@/i18n/account';
import { useChangePassword } from './api';

export interface PasswordChangeValues {
  currentPassword: string;
  newPassword: string;
  repeat: string;
}

type Errors = Partial<Record<keyof PasswordChangeValues, string>>;

/** Prüfung vor dem Senden (die API prüft erneut). */
export function validatePasswordChange(v: PasswordChangeValues): Errors {
  const e: Errors = {};
  if (!v.currentPassword) e.currentPassword = ta.password.required;
  if (v.newPassword.length < PASSWORD_MIN_LENGTH) e.newPassword = ta.password.tooShort;
  else if (v.newPassword === v.currentPassword) e.newPassword = ta.password.sameAsOld;
  if (v.repeat !== v.newPassword) e.repeat = ta.password.mismatch;
  return e;
}

/** Server-Feldfehler (deutsch) auf die Texte der aktuellen Sprache abbilden. */
function serverErrors(err: unknown): Errors {
  const f = fieldErrors(err);
  const e: Errors = {};
  if (f.currentPassword) e.currentPassword = ta.password.wrongCurrent;
  if (f.newPassword) e.newPassword = /unterscheiden/.test(f.newPassword) ? ta.password.sameAsOld : ta.password.tooShort;
  return e;
}

/** „Passwort ändern“ auf /konto – nur für Konten mit Passwort (nicht bei reiner Firmenanmeldung). */
export function PasswordCard() {
  const change = useChangePassword();
  const [local, setLocal] = useState<Errors>({});
  const [done, setDone] = useState(false);
  const [lockUntil, setLockUntil] = useState<number | null>(null);
  useEffect(() => {
    const s = lockSecondsFrom(change.error);
    if (s) setLockUntil(Date.now() + s * 1000);
  }, [change.error]);
  const lockedSeconds = useCountdown(lockUntil);
  const locked = lockedSeconds > 0;

  const server = serverErrors(change.error);
  const errors: Errors = { ...server, ...local };
  const generic =
    change.error && !locked && !lockSecondsFrom(change.error) && !Object.keys(server).length ? ta.password.failed : null;

  const onSubmit = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const data = new FormData(form);
    const v: PasswordChangeValues = {
      currentPassword: String(data.get('currentPassword') ?? ''),
      newPassword: String(data.get('newPassword') ?? ''),
      repeat: String(data.get('repeat') ?? ''),
    };
    const errs = validatePasswordChange(v);
    setLocal(errs);
    setDone(false);
    change.reset();
    if (Object.keys(errs).length) return;
    change.mutate(
      { currentPassword: v.currentPassword, newPassword: v.newPassword },
      {
        onSuccess: () => {
          setDone(true);
          form.reset();
        },
      },
    );
  };

  return (
    <Card role="region" padding="none" className="rounded-[22px] p-[18px] md:p-6" aria-labelledby="passwort-titel">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-text">
          <KeyRound className="size-5" />
        </span>
        <div>
          <h2 id="passwort-titel" className="font-heading text-[17px] font-bold text-ink">
            {ta.password.title}
          </h2>
          <p className="mt-0.5 text-[13.5px] text-muted">{ta.password.intro}</p>
        </div>
      </div>
      <form className="mt-4 flex flex-col gap-3.5" onSubmit={onSubmit} noValidate>
        <Field label={ta.password.current} required error={errors.currentPassword}>
          <Input name="currentPassword" type="password" autoComplete="current-password" />
        </Field>
        <Field label={ta.password.next} required hint={ta.password.hint} error={errors.newPassword}>
          <Input name="newPassword" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} />
        </Field>
        <Field label={ta.password.repeat} required error={errors.repeat}>
          <Input name="repeat" type="password" autoComplete="new-password" />
        </Field>
        {locked && (
          <p role="alert" className="flex items-start gap-2 rounded-box bg-warn-soft px-4 py-3 text-[14px] font-medium text-warn-text">
            <TimerOff aria-hidden="true" className="mt-0.5 size-[18px] shrink-0" />
            {ta.password.locked(lockedSeconds)}
          </p>
        )}
        {generic && (
          <p role="alert" className="text-[13.5px] font-medium text-danger-text">
            {generic}
          </p>
        )}
        {done && (
          <p role="status" className="flex items-center gap-2 rounded-box bg-success-soft px-4 py-3 text-[14px] font-medium text-success-text">
            <CircleCheck aria-hidden="true" className="size-[18px] shrink-0" />
            {ta.password.success}
          </p>
        )}
        <Button type="submit" variant="tonal" className="self-start" disabled={change.isPending || locked}>
          {change.isPending ? ta.password.saving : locked ? `${ta.password.submit} (${formatClock(lockedSeconds)})` : ta.password.submit}
        </Button>
      </form>
    </Card>
  );
}
