import { useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, CalendarPlus, CheckCircle2, FileText, MapPin, MonitorPlay, Upload } from 'lucide-react';
import { ParticipantLayout } from '@/components/layout/ParticipantLayout';
import { Button, Card, Field, Panel, StatusChip, Textarea } from '@/components/ui';
import { get, post } from '@/lib/api';
import { uploadWithProgress } from '@/features/admin/upload';
import { statusTone, type MyBookingView } from '@/features/external-bookings/api';
import { teb } from '@/i18n/external-bookings';

const t = teb.me;
const fmtDate = (iso: string) => new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeZone: 'Europe/Berlin' }).format(new Date(iso));

function Block({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <Card padding="none" className="rounded-[22px] p-[18px]">
      <h2 className="mb-2 flex items-center gap-2 font-heading text-[16px] font-bold text-ink">
        {icon}
        {title}
      </h2>
      <div className="text-[14.5px] leading-relaxed text-ink-2">{children}</div>
    </Card>
  );
}

/** `/extern/b/:token` – persönliche Seite zu einer externen Schulung (E-55), auch ohne Konto. */
export default function MyBookingPage() {
  const { token = '' } = useParams();
  const qc = useQueryClient();
  const key = ['extern-buchung', token];
  const view = useQuery({ queryKey: key, queryFn: () => get<MyBookingView>(`/public/external-bookings/${token}`), retry: false });
  const [problem, setProblem] = useState('');
  const [showProblem, setShowProblem] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const confirm = useMutation({
    mutationFn: () => post(`/public/external-bookings/${token}/confirm`),
    onSuccess: async () => {
      setMsg(t.confirmed);
      await qc.invalidateQueries({ queryKey: key });
    },
  });
  const report = useMutation({
    mutationFn: () => post(`/public/external-bookings/${token}/problem`, { note: problem }),
    onSuccess: async () => {
      setMsg(t.problemSent);
      setShowProblem(false);
      setProblem('');
      await qc.invalidateQueries({ queryKey: key });
    },
  });
  const upload = async (file: File) => {
    setBusy(true);
    const form = new FormData();
    form.append('datei', file, file.name);
    try {
      await uploadWithProgress(`/public/external-bookings/${token}/certificate`, form);
      setMsg(t.uploaded);
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (view.isPending) return <ParticipantLayout title="…"><p role="status">{t.loading}</p></ParticipantLayout>;
  if (view.error || !view.data) {
    return (
      <ParticipantLayout title={teb.nav}>
        <Panel tone="danger" role="alert">{t.invalid}</Panel>
      </ParticipantLayout>
    );
  }
  const { booking: b, me, can, tenantName } = view.data;
  const place = [b.address, b.room].filter(Boolean).join(' · ');
  const travel = b.travel;
  const hotel = b.hotel;

  return (
    <ParticipantLayout title={b.titel} eyebrow={tenantName}>
      <p className="-mt-2 mb-3 text-[14px] text-muted">{b.provider.name}{b.bookingNo ? ` · Buchung ${b.bookingNo}` : ''}</p>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-[14px]">
          <span className="text-muted">{t.status}:</span>
          <StatusChip tone={statusTone(me.status)}>{me.statusLabel}</StatusChip>
        </div>
        {me.status === 'eingeladen' && <Panel tone="accent"><b>{t.registered}</b> {t.confirmBy}</Panel>}
        {me.status === 'verschoben' && <Panel tone="warn">{t.moved}</Panel>}
        {msg && <Panel tone="success" role="status" className="flex items-start gap-2"><CheckCircle2 aria-hidden="true" className="mt-0.5 size-[18px] shrink-0" />{msg}</Panel>}

        <Block title={t.dates} icon={<CalendarDays aria-hidden="true" className="size-[18px] text-accent-text" />}>
          <ul className="flex flex-col gap-1">
            {b.days.map((d) => (
              <li key={d.dayNo} className="font-semibold text-ink">{d.label}</li>
            ))}
          </ul>
          <div className="mt-3">
            <Button asChild variant="tonal" size="sm">
              <a href={`/api/public/external-bookings/${token}/termin.ics`}>
                <CalendarPlus aria-hidden="true" className="size-4" />
                {t.ics}
              </a>
            </Button>
          </div>
        </Block>

        {b.format === 'online' ? (
          <Block title={t.online} icon={<MonitorPlay aria-hidden="true" className="size-[18px] text-accent-text" />}>
            {b.onlineUrl ? <a className="break-all text-accent-text underline" href={b.onlineUrl}>{b.onlineUrl}</a> : '–'}
          </Block>
        ) : (
          place && (
            <Block title={t.place} icon={<MapPin aria-hidden="true" className="size-[18px] text-accent-text" />}>
              <p>{place}</p>
              {b.meetingPoint && <p className="text-muted">{b.meetingPoint}</p>}
              {b.address && (
                <div className="mt-3">
                  <Button asChild variant="secondary" size="sm">
                    <a href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(b.address)}`} target="_blank" rel="noreferrer">{t.map}</a>
                  </Button>
                </div>
              )}
            </Block>
          )
        )}

        {(travel.mode || hotel.name) && (
          <Block title={t.travelHotel}>
            {travel.mode && (
              <p>
                <b>{teb.form.travelModes[travel.mode]}</b>
                {travel.departure ? ` · ${travel.departure}` : ''}
                {travel.carpool && <span className="block text-muted">{travel.carpool}</span>}
              </p>
            )}
            {hotel.name && (
              <p className="mt-2">
                <b>{hotel.name}</b>
                {hotel.address ? `, ${hotel.address}` : ''}
                <span className="block text-muted">
                  {[hotel.checkIn && hotel.checkOut ? `${fmtDate(hotel.checkIn)} – ${fmtDate(hotel.checkOut)}` : null, hotel.bookingNo ? `Buchung ${hotel.bookingNo}` : null].filter(Boolean).join(' · ')}
                </span>
              </p>
            )}
          </Block>
        )}

        {(travel.bringAlong || b.files.length > 0) && (
          <Block title={t.bring}>
            {travel.bringAlong && <p>{travel.bringAlong}</p>}
            {b.files.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1.5">
                {b.files.map((x) => (
                  <li key={x.id}>
                    <a href={`/api/public/external-bookings/${token}/files/${x.id}`} className="flex items-center gap-2 rounded-box bg-bg px-3 py-2">
                      <FileText aria-hidden="true" className="size-4 text-muted" />
                      {x.file_name}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Block>
        )}

        {(b.internalContact || b.provider.contact) && (
          <Block title={t.contacts}>
            {b.internalContact && <p>{t.internal}: {b.internalContact}</p>}
            {b.provider.contact && <p>{t.provider}: {[b.provider.contact, b.provider.phone].filter(Boolean).join(' · ')}</p>}
          </Block>
        )}

        <div className="mt-1 flex flex-col gap-2.5">
          {can.confirm && <Button size="lg" fullWidth disabled={confirm.isPending} onClick={() => confirm.mutate()}>{t.confirm}</Button>}
          {can.upload && (
            <>
              <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg" capture="environment" className="sr-only" aria-label={t.upload} data-testid="bescheinigung-datei" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); e.target.value = ''; }} />
              <Button size="lg" fullWidth disabled={busy} onClick={() => fileRef.current?.click()}>
                <Upload aria-hidden="true" className="size-4" />
                {t.upload}
              </Button>
              <p className="text-center text-[13px] text-muted">{t.uploadHint}</p>
            </>
          )}
          {can.problem && !showProblem && <Button size="lg" variant="secondary" fullWidth onClick={() => setShowProblem(true)}>{t.problem}</Button>}
          {showProblem && (
            <Card padding="none" className="flex flex-col gap-3 rounded-[22px] p-[18px]">
              <Field label={t.problemLabel}>
                <Textarea rows={3} value={problem} onChange={(e) => setProblem(e.target.value)} />
              </Field>
              <Button disabled={problem.trim().length < 5 || report.isPending} onClick={() => report.mutate()}>{t.problemSend}</Button>
            </Card>
          )}
          {!can.upload && ['eingeladen', 'bestaetigt', 'verschoben'].includes(me.status) && <p className="text-center text-[13px] text-muted">{t.afterHint}</p>}
        </div>
      </div>
    </ParticipantLayout>
  );
}
