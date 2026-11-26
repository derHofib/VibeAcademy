import { useState, type MouseEvent } from 'react';
import { useSearchParams } from 'react-router';
import { Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/card';
import { useSsoDiscovery } from './api';
import { looksLikeEmail, ssoStartUrl } from './model';
import { tsso } from './texts';

/**
 * „Mit Firmenkonto anmelden“ auf der Anmeldeseite (E-36). Erkennt beim Tippen die E-Mail-Domain; ein Klick leitet
 * über die API zum Identitätsanbieter der Organisation. Als Link umgesetzt (Navigation, kein Formular-Button).
 */
export function SsoLoginButton({ email }: { email: string }) {
  const [params] = useSearchParams();
  const weiter = params.get('weiter');
  const { result } = useSsoDiscovery(email);
  const [hint, setHint] = useState<string | null>(null);
  const href = ssoStartUrl({ email, weiter });
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!looksLikeEmail(email)) {
      e.preventDefault();
      setHint(tsso.login.needEmail);
    } else if (result && !result.sso) {
      e.preventDefault();
      setHint(tsso.login.noSso);
    }
  };
  return (
    <div className="mt-5 flex flex-col gap-3">
      <div className="flex items-center gap-3 text-[13px] text-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        {tsso.login.or}
        <span className="h-px flex-1 bg-line" />
      </div>
      {result?.sso && (
        <Panel tone="accent" role="status">
          {tsso.login.detected(result.tenantName ?? '')}
          {result.ssoOnly && <span className="mt-1 block">{tsso.login.ssoOnly}</span>}
        </Panel>
      )}
      <Button asChild variant={result?.sso ? 'primary' : 'secondary'} size="lg" fullWidth>
        <a href={href} onClick={onClick} data-testid="sso-login">
          <Building2 aria-hidden="true" className="size-5" />
          {tsso.login.button}
        </a>
      </Button>
      {hint && !result?.sso && (
        <p role="alert" className="text-center text-[13px] text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
