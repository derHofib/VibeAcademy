import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { de } from '@/i18n/de';
import { Card } from '@/components/ui/card';

/** Gemeinsamer Rahmen für Anmelden/Registrieren: zentrierte Karte auf `bg`. */
export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center bg-bg px-4 py-8 md:justify-center md:py-12">
      <div className="w-full max-w-[440px]">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-full bg-accent text-white shadow-primary">
            <ShieldCheck className="size-5" strokeWidth={2.25} />
          </span>
          <span className="font-heading text-[18px] font-bold tracking-[-0.01em] text-ink">{de.app.name}</span>
        </div>
        <main>
          <Card radius="lg" padding="lg">
            <h1 className="font-heading text-[26px] leading-tight font-bold text-ink">{title}</h1>
            <p className="mt-1.5 text-[14.5px] leading-[1.55] text-muted">{subtitle}</p>
            <div className="mt-6">{children}</div>
          </Card>
          <div className="mt-5 text-center text-[14px] text-muted">{footer}</div>
        </main>
      </div>
    </div>
  );
}
