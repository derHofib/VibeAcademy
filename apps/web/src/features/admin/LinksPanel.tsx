import { useState } from 'react';
import { Link2, Printer } from 'lucide-react';
import { post } from '@/lib/api';
import { adm } from '@/i18n/admin';
import {
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Panel,
  SegmentedControl,
} from '@/components/ui';
import type { RunInvitation } from './api';
import { formatDate } from './format';
import { ConfirmSheet, CopyButton, errorMessage } from './components/common';

const l = adm.links;

export interface IssuedLink {
  invitationId: string;
  name: string;
  orgUnit: string | null;
  link: string;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Druckfassung als eigenes Dokument (unabhängig vom App-Layout). */
export function printableHtml(title: string, deadline: string | null, links: IssuedLink[]): string {
  const rows = links
    .map(
      (x) =>
        `<tr><td><strong>${esc(x.name)}</strong>${x.orgUnit ? `<br><span class="m">${esc(x.orgUnit)}</span>` : ''}</td><td class="l">${esc(x.link)}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(l.printTitle(title))}</title>
<style>body{font:14px/1.5 Inter,system-ui,sans-serif;color:#1d2433;margin:24px}h1{font-size:20px;margin:0 0 4px}
p{margin:0 0 16px;color:#3a4456}table{width:100%;border-collapse:collapse}td{padding:10px 8px;border-bottom:1px solid #e3e8f2;vertical-align:top}
td.l{font-family:ui-monospace,monospace;font-size:12.5px;word-break:break-all}.m{color:#5f6b7d;font-size:12.5px}tr{break-inside:avoid}</style>
</head><body><h1>${esc(l.printTitle(title))}</h1><p>${deadline ? `${esc(l.deadline(formatDate(deadline)))} · ` : ''}${esc(l.listHint)}</p>
<table><tbody>${rows}</tbody></table></body></html>`;
}

/**
 * Persönliche Links erzeugen, kopieren und als Liste drucken (E-12: ohne Mailversand nutzbar).
 * Jeder neue Link macht den vorherigen Link der Person ungültig – daher mit Bestätigung.
 */
export function LinksPanel({
  title,
  deadline,
  invitations,
  initialLinks = [],
}: {
  title: string;
  deadline: string | null;
  invitations: RunInvitation[];
  initialLinks?: IssuedLink[];
}) {
  const withoutEmail = invitations.filter((i) => !i.has_email);
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<'alle' | 'ohne'>(withoutEmail.length ? 'ohne' : 'alle');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [links, setLinks] = useState<IssuedLink[]>(initialLinks);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    const list = scope === 'ohne' && withoutEmail.length ? withoutEmail : invitations;
    setError(null);
    setProgress({ done: 0, total: list.length });
    const out: IssuedLink[] = [];
    try {
      for (const inv of list) {
        const r = await post<{ link: string }>(`/invitations/${inv.id}/link`);
        out.push({ invitationId: inv.id, name: inv.person_name, orgUnit: inv.org_unit_name, link: r.link });
        setProgress({ done: out.length, total: list.length });
      }
    } catch (e) {
      setError(errorMessage(e));
    }
    setLinks(out);
    setProgress(null);
    setOpen(false);
  };

  const print = () => {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.open();
    w.document.write(printableHtml(title, deadline, links));
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <Card radius="lg" padding="lg">
      <CardHeader>
        <div>
          <CardTitle>{l.listTitle}</CardTitle>
          <CardDescription>{l.listHint}</CardDescription>
        </div>
        <Button variant="secondary" onClick={() => setOpen(true)} disabled={!invitations.length}>
          <Link2 aria-hidden="true" className="size-[18px]" />
          {l.action}
        </Button>
      </CardHeader>

      {error && (
        <Panel tone="danger" role="alert" className="mb-3">
          {error}
        </Panel>
      )}

      {links.length > 0 && (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <CopyButton
              variant="soft"
              label={l.copyAll}
              text={links.map((x) => `${x.name}${x.orgUnit ? ` (${x.orgUnit})` : ''}: ${x.link}`).join('\n')}
            />
            <Button variant="tonal" size="sm" onClick={print}>
              <Printer aria-hidden="true" className="size-4" />
              {adm.common.print}
            </Button>
          </div>
          <ul aria-label={l.listTitle} className="flex flex-col gap-2">
            {links.map((x) => (
              <li
                key={x.invitationId}
                className="flex flex-wrap items-center gap-3 rounded-box bg-bg px-4 py-3"
              >
                <div className="min-w-0 flex-1 basis-64">
                  <p className="text-[15px] font-semibold text-ink">
                    {x.name}
                    {x.orgUnit && <span className="font-normal text-muted"> · {x.orgUnit}</span>}
                  </p>
                  <p className="font-mono text-[12.5px] break-all text-ink-2" data-testid="einladungslink">
                    {x.link}
                  </p>
                </div>
                <CopyButton text={x.link} ariaLabel={l.copyOne(x.name)} />
              </li>
            ))}
          </ul>
        </>
      )}

      <ConfirmSheet
        open={open}
        onOpenChange={(o) => !progress && setOpen(o)}
        title={l.confirmTitle}
        description={l.confirmText}
        confirmLabel={progress ? l.generating(progress.done, progress.total) : l.generate}
        pending={!!progress}
        onConfirm={() => void generate()}
      >
        {withoutEmail.length > 0 && withoutEmail.length < invitations.length && (
          <SegmentedControl
            aria-label={l.listTitle}
            fullWidth
            value={scope}
            onValueChange={setScope}
            options={[
              { value: 'ohne', label: l.confirmScopeNoEmail(withoutEmail.length) },
              { value: 'alle', label: l.confirmScopeAll(invitations.length) },
            ]}
          />
        )}
        {progress && (
          <p role="status" className="mt-3 text-[14px] text-muted">
            {l.generating(progress.done, progress.total)}
          </p>
        )}
      </ConfirmSheet>
    </Card>
  );
}
