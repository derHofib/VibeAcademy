import { useState } from 'react';
import { Building2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/card';
import { useStepUpOptions } from './api';
import { parseSsoFragment, ssoErrorMessage, stepUpStartUrl } from './model';
import { tsso } from './texts';

/** Rückleitung `#sso=…`/`#sso-fehler=…` einmal lesen und aus der Adresszeile entfernen. */
function readReturn() {
  if (typeof window === 'undefined') return {};
  const f = parseSsoFragment(window.location.hash);
  if (f.ticket || f.error) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  return f;
}

/**
 * Step-up per Firmenkonto vor der Unterschrift (E-36): verfügbar, wenn das Konto mit dem IdP der Organisation verbunden ist;
 * `required` bei „nur SSO“ (dann kein Passwort). Das Ticket aus der Rückleitung wird beim Unterschreiben gegen das
 * Step-up-Token getauscht (`POST /me/invitations/:id/step-up { ssoTicket }`).
 */
export function useSsoStepUp(invitationId: string) {
  const [ret] = useState(readReturn);
  const [ticket, setTicket] = useState<string | null>(ret.ticket ?? null);
  const options = useStepUpOptions(invitationId);
  return {
    available: !!options.data?.sso,
    required: !!options.data?.required,
    startUrl: options.data?.startUrl ?? stepUpStartUrl(invitationId),
    ticket,
    error: ret.error ? ssoErrorMessage(ret.error) : null,
    /** nach einem Fehlversuch: Ticket ist verbraucht → erneut bestätigen */
    clearTicket: () => setTicket(null),
  };
}

export type SsoStepUpState = ReturnType<typeof useSsoStepUp>;

export function SsoStepUpBlock({ sso, passwordAlternative = false }: { sso: SsoStepUpState; passwordAlternative?: boolean }) {
  if (!sso.available) return null;
  return (
    <div className="flex flex-col gap-2 px-1" data-testid="sso-step-up">
      <p className="text-[13px] text-muted">{tsso.stepUp.label}</p>
      {sso.ticket ? (
        <Panel tone="success" role="status" className="flex items-center gap-2">
          <CheckCircle2 aria-hidden="true" className="size-5 shrink-0" />
          {tsso.stepUp.confirmed}
        </Panel>
      ) : (
        <>
          {sso.error && (
            <Panel tone="danger" role="alert">
              {sso.error}
            </Panel>
          )}
          <p className="text-[13px] text-muted">{tsso.stepUp.hint}</p>
          <Button asChild variant="secondary" className="self-start">
            <a href={sso.startUrl}>
              <Building2 aria-hidden="true" className="size-[18px]" />
              {tsso.stepUp.button}
            </a>
          </Button>
          {passwordAlternative && !sso.required && <p className="text-[12.5px] text-muted">{tsso.stepUp.orPassword}</p>}
        </>
      )}
    </div>
  );
}
