import { useId, useState } from 'react';
import { Mail, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Panel } from '@/components/ui/card';
import { tp } from '@/i18n/participant';
import type { Contact } from './viewerModel';

export interface AskPanelProps {
  contact: Contact | null;
  trainingTitle: string;
  /** „Seite 7“ bzw. „Frage 2“ */
  refLabel: string;
  desktop: boolean;
}

/**
 * „Frage stellen“ (5e). Phase 1 hat noch keine Fragen-API: Der Ansprechpartner der Schulung wird
 * angezeigt; die Frage geht per E-Mail-Programm (mailto) oder telefonisch an ihn.
 */
export function AskPanel({ contact, trainingTitle, refLabel, desktop }: AskPanelProps) {
  const [text, setText] = useState('');
  const id = useId();
  if (!contact) {
    return (
      <div className="px-5 pt-2 pb-5">
        <Panel tone="neutral">{tp.reader.ask.noContact}</Panel>
      </div>
    );
  }
  const mailto = contact.email
    ? `mailto:${contact.email}?subject=${encodeURIComponent(tp.reader.ask.mailSubject(trainingTitle, refLabel))}&body=${encodeURIComponent(text)}`
    : null;
  return (
    <div className="flex flex-col gap-3.5 px-5 pt-2.5 pb-5">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[14px] font-bold text-accent-text">
          {contact.initials}
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-ink">{contact.name}</p>
          <p className="text-[12.5px] text-muted">{contact.email ? tp.reader.ask.roleMail : tp.reader.ask.role}</p>
        </div>
      </div>
      <p className="text-[13.5px] leading-[1.5] text-ink-2">{tp.reader.ask.intro}</p>
      {mailto && (
        <>
          <label htmlFor={id} className="sr-only">
            {tp.reader.ask.questionLabel}
          </label>
          <Textarea
            id={id}
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={tp.reader.ask.placeholder}
            className="resize-none rounded-[18px]"
          />
          <Button asChild size={desktop ? 'md' : 'lg'} fullWidth>
            <a href={mailto}>
              <Mail aria-hidden="true" className="size-[18px]" />
              {tp.reader.ask.sendMail}
            </a>
          </Button>
        </>
      )}
      {contact.phone && (
        <Button asChild variant={mailto ? 'soft' : 'primary'} size="md" fullWidth>
          <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`}>
            <Phone aria-hidden="true" className="size-[18px]" />
            {tp.reader.ask.call(contact.phone)}
          </a>
        </Button>
      )}
      {desktop && <p className="text-[12px] leading-[1.5] text-muted">{tp.reader.ask.trackingNote}</p>}
    </div>
  );
}
