import { useEffect } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { ParticipantLayout } from '@/components/layout/ParticipantLayout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ta } from '@/i18n/account';
import { useParticipantLang } from '@/i18n/lang';
import { clearAccountSession } from '@/features/account/api';

/** `/konto/geloescht`: Bestätigung nach dem Löschen (Nachweise bleiben beim Mandanten, E-25). */
export default function AccountDeletedPage() {
  const qc = useQueryClient();
  useParticipantLang();
  // Die Sitzung ist serverseitig beendet – zwischengespeicherte Kontodaten verwerfen
  useEffect(() => clearAccountSession(qc), [qc]);
  return (
    <ParticipantLayout className="justify-center">
      <Card className="flex flex-col items-center gap-3 text-center" padding="lg">
        <div aria-hidden="true" className="flex size-[84px] items-center justify-center rounded-full bg-success-soft text-success">
          <Check className="size-10" strokeWidth={3} />
        </div>
        <h1 className="font-heading text-[24px] font-bold text-ink">{ta.deleted.title}</h1>
        <p className="max-w-[360px] text-[15px] leading-[1.55] text-ink-2">{ta.deleted.text}</p>
        <Button asChild variant="tonal" className="mt-2">
          <Link to="/anmelden?teilnehmer=1">{ta.deleted.back}</Link>
        </Button>
      </Card>
    </ParticipantLayout>
  );
}
