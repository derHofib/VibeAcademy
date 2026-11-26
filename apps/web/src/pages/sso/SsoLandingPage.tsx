import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/card';
import { homePathFor } from '@/features/account/model';
import { fetchMe, meKey } from '@/features/auth/session';
import { safeTarget, ssoErrorMessage } from '@/features/sso/model';
import { tsso } from '@/features/sso/texts';
import { AuthShell } from '@/pages/auth/AuthShell';

const t = tsso.landing;

/**
 * `/anmelden/sso`: Rückkehr von der Firmenanmeldung. Erfolg → Sitzung laden und weiter zu `?weiter=` bzw. zur Startseite
 * des Kontos; Fehler (`?fehler=<code>`) → deutsche Meldung mit Wegen zurück.
 */
export default function SsoLandingPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const error = params.get('fehler');
  const weiter = safeTarget(params.get('weiter'));

  useEffect(() => {
    if (error) return;
    let cancelled = false;
    qc.removeQueries({ queryKey: ['admin'] });
    void qc.fetchQuery({ queryKey: meKey, queryFn: fetchMe, staleTime: 0 }).then(
      (me) => {
        if (cancelled) return;
        if (!me) navigate('/anmelden/sso?fehler=login_required', { replace: true });
        else navigate(weiter ?? homePathFor(me), { replace: true });
      },
      () => !cancelled && navigate('/anmelden/sso?fehler=internal', { replace: true }),
    );
    return () => {
      cancelled = true;
    };
  }, [error, weiter, navigate, qc]);

  if (!error) {
    return (
      <AuthShell title={t.title} subtitle={t.subtitle} footer={null}>
        <div role="status" className="flex items-center justify-center gap-2 py-4 text-[14.5px] text-ink-2">
          <Loader2 aria-hidden="true" className="size-5 animate-spin" />
          {t.subtitle}
        </div>
      </AuthShell>
    );
  }
  return (
    <AuthShell
      title={t.failedTitle}
      subtitle={tsso.landing.title}
      footer={
        <Link to="/anmelden" className="font-semibold text-accent-text underline-offset-4 hover:underline">
          {t.back}
        </Link>
      }
    >
      <Panel tone="danger" role="alert" data-testid="sso-error">
        {ssoErrorMessage(error)}
      </Panel>
      <Button asChild variant="secondary" size="lg" fullWidth className="mt-4">
        <Link to="/anmelden">{t.retry}</Link>
      </Button>
    </AuthShell>
  );
}
