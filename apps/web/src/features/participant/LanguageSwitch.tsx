import { Languages } from 'lucide-react';
import { post } from '@/lib/api';
import { cn } from '@/lib/cn';
import { chooseLang, LANGS, useLang, type Lang } from '@/i18n/lang';
import { tp } from '@/i18n/participant';

/**
 * Sprachumschalter der Teilnehmersicht (E-39): kleine Pillen „DE | EN“. Mit Einladung wird die Wahl auch bei der Person
 * gespeichert (künftige Mails und das Nachweis-PDF in dieser Sprache).
 */
export function LanguageSwitch({ invitationId, className }: { invitationId?: string; className?: string }) {
  const lang = useLang();
  const pick = (l: Lang) => {
    if (l === lang) return;
    chooseLang(l);
    if (invitationId) void post(`/me/invitations/${invitationId}/language`, { sprache: l }).catch(() => undefined);
  };
  return (
    <div role="group" aria-label={tp.lang.label} className={cn('inline-flex shrink-0 items-center gap-0.5 rounded-pill bg-surface/80 p-0.5', className)}>
      <Languages aria-hidden="true" className="mx-1 size-3.5 text-muted" />
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={l === lang}
          onClick={() => pick(l)}
          className={cn(
            'min-h-8 min-w-9 cursor-pointer rounded-pill px-2 text-[12px] font-semibold uppercase tracking-[0.04em] transition-colors',
            l === lang ? 'bg-accent text-white' : 'text-ink-2 hover:bg-bg',
          )}
        >
          {l}
          <span className="sr-only"> – {tp.lang[l]}</span>
        </button>
      ))}
    </div>
  );
}
