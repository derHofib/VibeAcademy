import { Link, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { get } from '@/lib/api';
import { Button } from '@/components/ui';
import { ErrorPanel, Loading } from '@/features/admin/components/common';
import { tl } from '@/i18n/live';
import { livePath, liveKeys, retryUnlessClientError, type QrCodeResponse, type RunView } from '@/features/live/api';
import { svgDataUrl } from '@/features/live/organizer/QrCard';
import { RequireOrganizer } from '@/features/live/organizer/RequireOrganizer';
import { dateDe, hm } from '@/features/live/time';

function Aushang() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const kind = params.get('art') === 'end' ? 'end' : 'start';
  const run = useQuery({
    queryKey: [...liveKeys.organizer(id), 'run'],
    queryFn: async () => (await get<{ run: RunView }>(`/runs/${id}/attendance`)).run,
    retry: retryUnlessClientError,
  });
  const qr = useQuery({
    queryKey: liveKeys.qrPrint(id, kind),
    queryFn: () => get<QrCodeResponse>(`/runs/${id}/qr/print?kind=${kind}`),
    retry: retryUnlessClientError,
    staleTime: Infinity,
  });
  const err = run.error ?? qr.error;
  if (err)
    return (
      <div className="mx-auto max-w-xl p-6">
        <ErrorPanel error={err} />
      </div>
    );
  if (!run.data || !qr.data) return <Loading className="min-h-dvh" />;
  const r = run.data;
  const from = qr.data.validWindow.from;
  const until = qr.data.validWindow.until;
  const p = tl.print;
  return (
    <div className="min-h-dvh bg-bg print:bg-white">
      <div className="mx-auto flex max-w-[820px] flex-col gap-4 px-4 py-6 print:p-0">
        <div className="flex flex-wrap justify-between gap-3 print:hidden">
          <Button asChild variant="ghost">
            <Link to={livePath.organizer(id)}>{p.back}</Link>
          </Button>
          <Button onClick={() => window.print()}>
            <Printer aria-hidden="true" className="size-4" />
            {p.printNow}
          </Button>
        </div>
        <main className="flex flex-col items-center gap-6 rounded-[28px] bg-surface px-10 py-12 text-center shadow-card print:rounded-none print:shadow-none">
          <p className="text-[16px] text-muted">{[r.provider ?? r.tenantName, dateDe(r.startAt), `${hm(r.startAt)}–${hm(r.endAt)}`, r.ort].filter(Boolean).join(' · ')}</p>
          <h1 className="font-heading text-[34px] leading-tight font-bold text-ink">{r.titel}</h1>
          <p className={`rounded-pill px-6 py-2.5 font-heading text-[26px] font-bold ${kind === 'start' ? 'bg-[#DCE5FC] text-accent-text-strong' : 'bg-[#FDE7C2] text-warn-text-strong'}`}>
            {p.title(kind)}
          </p>
          <img
            src={svgDataUrl(qr.data.svg)}
            alt={kind === 'start' ? tl.org.qr.altStart : tl.org.qr.altEnd}
            className="size-[min(420px,70vw)] [image-rendering:pixelated]"
            data-qr-url={qr.data.url}
          />
          <p className="font-heading text-[22px] font-semibold text-ink">{p.lead(kind)}</p>
          <p className="max-w-[560px] text-[15px] leading-[1.55] text-ink-2">
            {p.valid(`${dateDe(from)} ${hm(from)}`, `${dateDe(until)} ${hm(until)}`)} {p.noLocation}
          </p>
        </main>
      </div>
    </div>
  );
}

/** `/verwaltung/termine/:id/aushang?art=start|end` – statischer Code zum Ausdrucken (gültig im Zeitfenster). */
export default function PrintPage() {
  return (
    <RequireOrganizer>
      <Aushang />
    </RequireOrganizer>
  );
}
