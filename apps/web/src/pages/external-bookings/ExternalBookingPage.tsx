import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Copy, FileDown, Paperclip, Plus, Trash2, Upload } from 'lucide-react';
import { BOOKING_MAIN_PATH, BOOKING_STATUS_LABELS, PLATFORM_LABELS, PLATFORMS, bookingTotalCents, formatEuro, parseEuro, type BookingStatus } from '@sn/shared';
import { ApiError, get, patch, post } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button, Card, CardDescription, CardTitle, CheckboxField, Field, Input, Panel, SegmentedControl, Select, StatusChip, Textarea } from '@/components/ui';
import { qk, personsQueryFn } from '@/features/admin/api';
import type { Requirement } from '@/features/external/api';
import { ErrorPanel, Loading, NoticeRegion, useNotice } from '@/features/admin/components/common';
import { uploadWithProgress } from '@/features/admin/upload';
import { berlinIso, berlinParts, bookingKeys, statusTone, type BookingView } from '@/features/external-bookings/api';
import { teb } from '@/i18n/external-bookings';

const f = teb.form;
const fl = teb.flow;
type Draft = {
  titel: string; requirementId: string; providerName: string; providerContact: string; providerPhone: string; providerEmail: string; providerWeb: string;
  bookingNo: string; format: 'praesenz' | 'online'; address: string; room: string; meetingPoint: string; onlinePlatform: string; onlineUrl: string;
  travelMode: '' | 'firmenwagen' | 'bahn' | 'flug' | 'privat'; departure: string; carpool: string; hotelName: string; hotelAddress: string;
  hotelCheckIn: string; hotelCheckOut: string; hotelBookingNo: string; catering: string; bringAlong: string; travelNotes: string; internalContact: string;
  fee: string; hotel: string; travel: string; costCenter: string; approvalRequired: boolean; approverPersonId: string;
  reminderDaysBefore: string; escalateAfterDays: string; days: Array<{ date: string; start: string; end: string }>; personIds: string[];
};

const euro = (c: number) => (c ? (c / 100).toFixed(2).replace('.', ',') : '');
function toDraft(b?: BookingView): Draft {
  return {
    titel: b?.titel ?? '', requirementId: b?.requirementId ?? '', providerName: b?.provider.name ?? '', providerContact: b?.provider.contact ?? '',
    providerPhone: b?.provider.phone ?? '', providerEmail: b?.provider.email ?? '', providerWeb: b?.provider.web ?? '', bookingNo: b?.bookingNo ?? '',
    format: b?.format ?? 'praesenz', address: b?.address ?? '', room: b?.room ?? '', meetingPoint: b?.meetingPoint ?? '', onlinePlatform: b?.onlinePlatform ?? '',
    onlineUrl: b?.onlineUrl ?? '', travelMode: b?.travel.mode ?? '', departure: b?.travel.departure ?? '', carpool: b?.travel.carpool ?? '',
    hotelName: b?.hotel.name ?? '', hotelAddress: b?.hotel.address ?? '', hotelCheckIn: b?.hotel.checkIn?.slice(0, 10) ?? '', hotelCheckOut: b?.hotel.checkOut?.slice(0, 10) ?? '',
    hotelBookingNo: b?.hotel.bookingNo ?? '', catering: b?.travel.catering ?? '', bringAlong: b?.travel.bringAlong ?? '', travelNotes: b?.travel.notes ?? '',
    internalContact: b?.internalContact ?? '', fee: euro(b?.costs.feeCents ?? 0), hotel: euro(b?.costs.hotelCents ?? 0), travel: euro(b?.costs.travelCents ?? 0),
    costCenter: b?.costs.costCenter ?? '', approvalRequired: b?.approval.required ?? false, approverPersonId: b?.approval.approverPersonId ?? '',
    reminderDaysBefore: String(b?.reminders.daysBefore ?? 7), escalateAfterDays: String(b?.reminders.escalateAfterDays ?? 7),
    days: b?.days.length
      ? b.days.map((d) => ({ date: berlinParts(d.startAt).date, start: berlinParts(d.startAt).time, end: berlinParts(d.endAt).time }))
      : [{ date: '', start: '08:30', end: '16:30' }],
    personIds: [],
  };
}

/** Prüft den Entwurf und baut den Körper für POST/PATCH. */
export function bookingBody(d: Draft, isNew: boolean): { errors: Record<string, string>; body?: Record<string, unknown> } {
  const e: Record<string, string> = {};
  if (d.titel.trim().length < 2) e.titel = f.required;
  if (d.providerName.trim().length < 2) e.providerName = f.required;
  d.days.forEach((x, i) => {
    if (!x.date) e[`day${i}`] = f.required;
    else if (x.end <= x.start) e[`day${i}`] = f.endAfterStart;
  });
  const money = { fee: parseEuro(d.fee), hotel: parseEuro(d.hotel), travel: parseEuro(d.travel) };
  for (const [k, v] of Object.entries(money)) if (v === null) e[k] = f.euroInvalid;
  if (d.approvalRequired && !d.approverPersonId) e.approverPersonId = f.required;
  if (Object.keys(e).length) return { errors: e };
  const n = (s: string) => s.trim() || null;
  return {
    errors: e,
    body: {
      titel: d.titel.trim(), requirementId: d.requirementId || null, providerName: d.providerName.trim(), providerContact: n(d.providerContact),
      providerPhone: n(d.providerPhone), providerEmail: n(d.providerEmail), providerWeb: n(d.providerWeb), bookingNo: n(d.bookingNo), format: d.format,
      address: n(d.address), room: n(d.room), meetingPoint: n(d.meetingPoint), onlinePlatform: d.format === 'online' ? d.onlinePlatform || null : null,
      onlineUrl: d.format === 'online' ? n(d.onlineUrl) : null, travelMode: d.travelMode || null, departure: n(d.departure), carpool: n(d.carpool),
      hotelName: n(d.hotelName), hotelAddress: n(d.hotelAddress), hotelCheckIn: d.hotelCheckIn || null, hotelCheckOut: d.hotelCheckOut || null,
      hotelBookingNo: n(d.hotelBookingNo), catering: n(d.catering), bringAlong: n(d.bringAlong), travelNotes: n(d.travelNotes), internalContact: n(d.internalContact),
      feeCents: money.fee!, hotelCents: money.hotel!, travelCents: money.travel!, costCenter: n(d.costCenter), approvalRequired: d.approvalRequired,
      approverPersonId: d.approvalRequired ? d.approverPersonId : null, reminderDaysBefore: Number(d.reminderDaysBefore) || 0,
      escalateAfterDays: Number(d.escalateAfterDays) || 7,
      days: d.days.map((x) => ({ startAt: berlinIso(x.date, x.start), endAt: berlinIso(x.date, x.end) })),
      ...(isNew ? { personIds: d.personIds } : {}),
    },
  };
}

function Section({ title, sub, children, className }: { title: string; sub?: string; children: ReactNode; className?: string }) {
  const id = `abschnitt-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <Card radius="lg" padding="lg" role="region" aria-labelledby={id} className={cn('flex flex-col gap-3.5', className)}>
      <div>
        <CardTitle id={id}>{title}</CardTitle>
        {sub && <CardDescription>{sub}</CardDescription>}
      </div>
      {children}
    </Card>
  );
}

/** `/verwaltung/externe-schulungen/neu` bzw. `/:id` – planen, buchen, einladen, nachverfolgen (E-55). */
export default function ExternalBookingPage() {
  const { id } = useParams();
  const isNew = !id || id === 'neu';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { notice, show } = useNotice();
  const booking = useQuery({ queryKey: bookingKeys.one(id ?? ''), queryFn: () => get<BookingView>(`/external-bookings/${id}`), enabled: !isNew });
  const persons = useQuery({ queryKey: qk.persons('', ''), queryFn: personsQueryFn('', '') });
  const requirements = useQuery({ queryKey: ['admin', 'requirements'], queryFn: () => get<Requirement[]>('/requirements') });
  const [d, setD] = useState<Draft>(() => toDraft());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [links, setLinks] = useState<Array<{ participantId: string; name: string; link: string; mailed: boolean }>>([]);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelCost, setCancelCost] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const certRef = useRef<HTMLInputElement>(null);
  const loaded = booking.data;
  useEffect(() => {
    if (loaded) setD(toDraft(loaded));
  }, [loaded]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'external-bookings'] });
  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.fields.length) setErrors(Object.fromEntries(e.fields.map((x) => [x.path, x.message])));
    show((e as Error).message, 'danger');
  };

  const save = useMutation({
    mutationFn: async () => {
      const r = bookingBody(d, isNew);
      setErrors(r.errors);
      if (!r.body) throw new Error(teb.form.required);
      if (isNew) return post<{ id: string }>('/external-bookings', r.body);
      await patch(`/external-bookings/${id}`, r.body);
      return { id: id! };
    },
    onSuccess: async (r) => {
      await refresh();
      show(f.saved);
      if (isNew) navigate(`/verwaltung/externe-schulungen/${r.id}`, { replace: true });
    },
    onError: fail,
  });
  const action = useMutation({
    mutationFn: async (a: { path: string; body?: unknown; msg: (r: never) => string }) => ({ r: await post(`/external-bookings/${id}/${a.path}`, a.body ?? {}), a }),
    onSuccess: async ({ r, a }) => {
      await refresh();
      if ((r as { links?: typeof links }).links) setLinks((r as { links: typeof links }).links);
      show(a.msg(r as never));
    },
    onError: fail,
  });

  const upload = async (path: string, file: File, extra?: Record<string, string>, msg?: (r: { records?: number }) => string) => {
    setBusy(true);
    const form = new FormData();
    form.append('datei', file, file.name);
    for (const [k, v] of Object.entries(extra ?? {})) form.append(k, v);
    try {
      const r = await uploadWithProgress<{ records?: number }>(`/external-bookings/${id}/${path}`, form);
      await refresh();
      if (msg) show(msg(r));
    } catch (e) {
      show((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  const total = useMemo(() => {
    const p = isNew ? d.personIds.length : (loaded?.participants.filter((x) => x.status !== 'abgesagt').length ?? 0);
    return bookingTotalCents({ feeCents: parseEuro(d.fee) ?? 0, hotelCents: parseEuro(d.hotel) ?? 0, travelCents: parseEuro(d.travel) ?? 0 }, p);
  }, [d, isNew, loaded]);

  if (!isNew && booking.isPending) return <Loading />;
  if (!isNew && booking.error) return <ErrorPanel error={booking.error} onRetry={() => void booking.refetch()} />;
  const b = loaded;
  const st = (s: BookingStatus) => b?.participants.some((p) => p.status === s) ?? false;
  const cancelled = !!b?.cancelled;
  const personsList = persons.data ?? [];
  const txt = (k: keyof Draft, label: string, extra?: { hint?: string; type?: string }) => (
    <Field label={label} hint={extra?.hint} error={errors[k as string]}>
      <Input name={k} type={extra?.type} value={String(d[k] ?? '')} onChange={(e) => set(k, e.target.value as never)} />
    </Field>
  );

  return (
    <>
      <Link to="/verwaltung/externe-schulungen" className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-pill px-2 text-[14px] font-semibold text-accent-text underline-offset-4 hover:underline">
        <ChevronLeft aria-hidden="true" className="size-4" />
        {f.back}
      </Link>
      <h1 className="mb-5 font-heading text-[24px] leading-tight font-bold text-ink md:text-[28px]">{isNew ? f.titleNew : b!.titel}</h1>
      <NoticeRegion notice={notice} className="mb-4 empty:hidden" />
      {cancelled && <Panel tone="danger" className="mb-4 text-[14px]">{BOOKING_STATUS_LABELS.abgesagt}: {b!.cancelled!.reason}</Panel>}

      <form noValidate onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <Section title={f.training}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {txt('titel', f.titel)}
              <Field label={f.requirement} hint={f.requirementHint}>
                <Select name="requirementId" value={d.requirementId} onChange={(e) => set('requirementId', e.target.value)}>
                  <option value="">{f.noRequirement}</option>
                  {(requirements.data ?? []).map((r) => (
                    <option key={r.id} value={r.id}>{r.qualification_name} · {r.training_title} · {r.interval_months} Monate</option>
                  ))}
                </Select>
              </Field>
              {txt('providerName', f.provider)}
              {txt('bookingNo', f.bookingNo)}
              {txt('providerContact', f.providerContact)}
              {txt('providerPhone', f.providerPhone)}
              {txt('providerEmail', f.providerEmail, { type: 'email' })}
              {txt('providerWeb', f.providerWeb)}
            </div>
          </Section>

          <Section title={f.dates}>
            <SegmentedControl aria-label={f.format} value={d.format} onValueChange={(v) => set('format', v as Draft['format'])} options={[{ value: 'praesenz', label: f.praesenz }, { value: 'online', label: f.online }]} />
            {d.days.map((x, i) => (
              <fieldset key={i} className="grid grid-cols-[auto_1fr_auto_auto_auto] items-end gap-2.5">
                <legend className="sr-only">{f.day(i + 1)}</legend>
                <span className="pb-3 text-[13px] font-semibold text-ink-2">{f.day(i + 1)}</span>
                <Field label={f.date} error={errors[`day${i}`]}>
                  <Input type="date" aria-label={`${f.day(i + 1)} ${f.date}`} value={x.date} onChange={(e) => set('days', d.days.map((y, j) => (j === i ? { ...y, date: e.target.value } : y)))} />
                </Field>
                <Field label={f.start}>
                  <Input type="time" aria-label={`${f.day(i + 1)} ${f.start}`} value={x.start} onChange={(e) => set('days', d.days.map((y, j) => (j === i ? { ...y, start: e.target.value } : y)))} />
                </Field>
                <Field label={f.end}>
                  <Input type="time" aria-label={`${f.day(i + 1)} ${f.end}`} value={x.end} onChange={(e) => set('days', d.days.map((y, j) => (j === i ? { ...y, end: e.target.value } : y)))} />
                </Field>
                <Button type="button" variant="ghost" size="sm" aria-label={f.removeDay(i + 1)} disabled={d.days.length === 1} onClick={() => set('days', d.days.filter((_, j) => j !== i))}>
                  <Trash2 aria-hidden="true" className="size-4" />
                </Button>
              </fieldset>
            ))}
            <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => set('days', [...d.days, { date: '', start: d.days.at(-1)?.start ?? '08:30', end: d.days.at(-1)?.end ?? '16:30' }])}>
              <Plus aria-hidden="true" className="size-4" />
              {f.addDay}
            </Button>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {d.format === 'praesenz' ? (
                <>
                  {txt('address', f.address)}
                  {txt('room', f.room)}
                  {txt('meetingPoint', f.meetingPoint)}
                </>
              ) : (
                <>
                  <Field label={f.platform}>
                    <Select name="onlinePlatform" value={d.onlinePlatform} onChange={(e) => set('onlinePlatform', e.target.value)}>
                      <option value="">–</option>
                      {PLATFORMS.map((p) => (
                        <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>
                      ))}
                    </Select>
                  </Field>
                  <div className="md:col-span-2">{txt('onlineUrl', f.onlineUrl, { type: 'url' })}</div>
                </>
              )}
            </div>
          </Section>

          <Section title={f.travelHotel}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label={f.travelMode}>
                <Select name="travelMode" value={d.travelMode} onChange={(e) => set('travelMode', e.target.value as Draft['travelMode'])}>
                  <option value="">–</option>
                  {(Object.keys(f.travelModes) as Array<keyof typeof f.travelModes>).map((m) => (
                    <option key={m} value={m}>{f.travelModes[m]}</option>
                  ))}
                </Select>
              </Field>
              {txt('departure', f.departure)}
              {txt('carpool', f.carpool)}
              {txt('hotelName', f.hotelName)}
              {txt('hotelAddress', f.hotelAddress)}
              {txt('hotelBookingNo', f.hotelBookingNo)}
              {txt('hotelCheckIn', f.checkIn, { type: 'date' })}
              {txt('hotelCheckOut', f.checkOut, { type: 'date' })}
              {txt('catering', f.catering)}
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label={f.bringAlong}>
                <Textarea name="bringAlong" rows={2} value={d.bringAlong} onChange={(e) => set('bringAlong', e.target.value)} />
              </Field>
              <Field label={f.travelNotes}>
                <Textarea name="travelNotes" rows={2} value={d.travelNotes} onChange={(e) => set('travelNotes', e.target.value)} />
              </Field>
            </div>
            {txt('internalContact', f.internalContact)}
          </Section>
        </div>

        <div className="flex flex-col gap-5">
          <Section title={f.participants}>
            {b?.participants.length ? (
              <ul className="flex flex-col divide-y divide-line">
                {b.participants.map((p) => (
                  <li key={p.id} className="flex flex-col gap-1.5 py-2.5" data-testid={`teilnehmer-${p.name}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <b className="text-[14.5px]">{p.name}</b>
                      <StatusChip tone={statusTone(p.status)}>{p.statusLabel}</StatusChip>
                      {p.problem && <StatusChip tone="warn">{fl.problem}</StatusChip>}
                    </div>
                    {p.problem && <p className="text-[13px] text-warn-text">„{p.problem.note}“</p>}
                    {p.statusReason && <p className="text-[12.5px] text-muted">{p.statusReason}</p>}
                    <div className="flex flex-wrap gap-1.5">
                      {['eingeladen', 'bestaetigt', 'verschoben'].includes(p.status) && (
                        <Button type="button" variant="ghost" size="sm" onClick={() => action.mutate({ path: `participants/${p.id}/status`, body: { status: 'teilgenommen' }, msg: () => fl.markAttended })}>{fl.markAttended}</Button>
                      )}
                      {['eingeladen', 'bestaetigt', 'verschoben', 'teilgenommen'].includes(p.status) && (
                        <Button type="button" variant="ghost" size="sm" onClick={() => { const r = window.prompt(fl.reasonPrompt); if (r) action.mutate({ path: `participants/${p.id}/status`, body: { status: 'nicht_erschienen', reason: r }, msg: () => fl.markNoShow }); }}>{fl.markNoShow}</Button>
                      )}
                      {p.invitedAt && (
                        <Button type="button" variant="ghost" size="sm" asChild>
                          <a href={`/api/external-bookings/${b.id}/participants/${p.id}/invitation.pdf`}><FileDown aria-hidden="true" className="size-4" />{fl.pdf}</a>
                        </Button>
                      )}
                      {p.externalRecordId && p.status === 'eingereicht' && (
                        <Button type="button" variant="ghost" size="sm" asChild><Link to="/verwaltung/extern">{fl.toReview}</Link></Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
            {isNew && (
              <div role="group" aria-label={f.participants} className="flex max-h-56 flex-col gap-2 overflow-y-auto">
                {personsList.map((p) => (
                  <CheckboxField key={p.id} label={p.name} checked={d.personIds.includes(p.id)} onCheckedChange={(v) => set('personIds', v === true ? [...d.personIds, p.id] : d.personIds.filter((x) => x !== p.id))} />
                ))}
              </div>
            )}
            {!isNew && !cancelled && (
              <Select aria-label={f.addPerson} value="" onChange={(e) => e.target.value && action.mutate({ path: 'participants', body: { personIds: [e.target.value] }, msg: () => f.saved })}>
                <option value="">{`${f.addPerson} …`}</option>
                {personsList.filter((p) => !b?.participants.some((x) => x.personId === p.id)).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            )}
          </Section>

          <Section title={f.costs}>
            <div className="grid grid-cols-3 gap-2.5">
              {txt('fee', f.fee)}
              {txt('hotel', f.hotel)}
              {txt('travel', f.travel)}
            </div>
            {txt('costCenter', f.costCenter)}
            <p className="flex justify-between border-t border-line pt-3 text-[15px]"><b>{f.total}</b><b className="tabular-nums" data-testid="kosten-summe">{formatEuro(total)}</b></p>
            <CheckboxField label={<span className="font-semibold">{f.approval}</span>} checked={d.approvalRequired} onCheckedChange={(v) => set('approvalRequired', v === true)} />
            {d.approvalRequired && (
              <Field label={f.approver} error={errors.approverPersonId}>
                <Select name="approverPersonId" value={d.approverPersonId} onChange={(e) => set('approverPersonId', e.target.value)}>
                  <option value="">{f.choosePerson}</option>
                  {personsList.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              </Field>
            )}
            <div className="grid grid-cols-2 gap-2.5">
              {txt('reminderDaysBefore', f.reminders)}
              {txt('escalateAfterDays', f.escalate)}
            </div>
          </Section>

          {b && (
            <Section title={f.files} sub={f.filesHint}>
              {b.files.map((x) => (
                <a key={x.id} href={`/api/external-bookings/${b.id}/files/${x.id}`} className="flex items-center gap-2 rounded-box bg-bg px-3.5 py-2.5 text-[14px]">
                  <Paperclip aria-hidden="true" className="size-4 text-muted" />
                  {x.file_name}
                </a>
              ))}
              <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg" className="sr-only" aria-label={f.addFile} data-testid="anhang-datei" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload('files', file, undefined, () => f.saved); e.target.value = ''; }} />
              <Button type="button" variant="secondary" size="sm" className="self-start" disabled={busy} onClick={() => fileRef.current?.click()}>
                <Upload aria-hidden="true" className="size-4" />
                {f.addFile}
              </Button>
            </Section>
          )}

          {b && !cancelled && (
            <Section title={fl.title}>
              <ol aria-label={fl.statusFlow} className="flex flex-wrap gap-1.5 text-[12px]">
                {BOOKING_MAIN_PATH.map((s) => (
                  <li key={s} className={cn('rounded-pill px-2.5 py-1', st(s) ? 'bg-accent-soft font-semibold text-accent-text-strong' : 'bg-bg text-muted')}>{BOOKING_STATUS_LABELS[s]}</li>
                ))}
              </ol>
              <div className="flex flex-wrap gap-2">
                {b.approval.required && !b.approval.approvedAt && st('geplant') && (
                  <Button type="button" variant="secondary" onClick={() => action.mutate({ path: 'request-approval', msg: () => fl.sentApproval })}>{fl.requestApproval}</Button>
                )}
                {b.approval.required && !b.approval.approvedAt && st('zur_freigabe') && (
                  <Button type="button" variant="secondary" onClick={() => action.mutate({ path: 'approve', msg: () => fl.approved })}>{fl.approve}</Button>
                )}
                {(st('geplant') || st('zur_freigabe')) && (!b.approval.required || b.approval.approvedAt) && (
                  <Button type="button" onClick={() => action.mutate({ path: 'booked', body: { bookingNo: d.bookingNo || null }, msg: (r: { booked: number }) => fl.bookedOk(r.booked) })}>{fl.booked}</Button>
                )}
                {(st('gebucht') || st('verschoben')) && (
                  <>
                    <Button type="button" onClick={() => action.mutate({ path: 'invite', body: { sendMail: true }, msg: (r: { invited: number; mailsQueued: number }) => fl.invited(r.invited, r.mailsQueued) })}>{fl.invite}</Button>
                    <Button type="button" variant="secondary" onClick={() => action.mutate({ path: 'invite', body: { sendMail: false }, msg: (r: { invited: number; mailsQueued: number }) => fl.invited(r.invited, r.mailsQueued) })}>{fl.inviteNoMail}</Button>
                  </>
                )}
              </div>
              {links.length > 0 && (
                <div className="rounded-box bg-bg p-3.5">
                  <p className="text-[13px] font-semibold text-ink-2">{fl.links}</p>
                  <p className="mb-2 text-[12.5px] text-muted">{fl.linksHint}</p>
                  {links.map((l) => (
                    <div key={l.participantId} className="flex flex-wrap items-center gap-2 py-1 text-[13px]">
                      <b>{l.name}</b>
                      <code className="min-w-0 flex-1 truncate" data-testid="persoenlicher-link">{l.link}</code>
                      <Button type="button" variant="ghost" size="sm" aria-label={`${fl.copy}: ${l.name}`} onClick={() => void navigator.clipboard?.writeText(l.link).then(() => show(fl.copied))}><Copy aria-hidden="true" className="size-4" /></Button>
                    </div>
                  ))}
                </div>
              )}
              {(st('teilgenommen') || st('eingeladen') || st('bestaetigt')) && (
                <div className="border-t border-line pt-3">
                  <p className="text-[13px] font-semibold text-ink-2">{fl.group}</p>
                  <p className="mb-2 text-[12.5px] text-muted">{fl.groupHint}</p>
                  <input ref={certRef} type="file" accept="application/pdf,image/png,image/jpeg" className="sr-only" aria-label={fl.group} onChange={(e) => {
                    const file = e.target.files?.[0];
                    const ids = b.participants.filter((p) => ['teilgenommen', 'eingeladen', 'bestaetigt'].includes(p.status)).map((p) => p.personId);
                    if (file) void upload('certificate', file, { personIds: ids.join(',') }, (r) => fl.groupDone(r.records ?? 0));
                    e.target.value = '';
                  }} />
                  <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => certRef.current?.click()}><Upload aria-hidden="true" className="size-4" />{fl.group}</Button>
                </div>
              )}
              <details className="border-t border-line pt-3">
                <summary className="cursor-pointer text-[14px] font-semibold text-danger-text">{fl.cancel}</summary>
                <div className="mt-3 flex flex-col gap-2.5">
                  <Field label={fl.cancelReason}><Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} /></Field>
                  <Field label={fl.cancelCost}><Input inputMode="decimal" value={cancelCost} onChange={(e) => setCancelCost(e.target.value)} /></Field>
                  <Button type="button" variant="danger-soft" className="self-start" disabled={cancelReason.trim().length < 3} onClick={() => action.mutate({ path: 'cancel', body: { reason: cancelReason, cancelCostCents: parseEuro(cancelCost) ?? 0 }, msg: () => fl.cancelled })}>{fl.cancelConfirm}</Button>
                </div>
              </details>
            </Section>
          )}

          {!cancelled && (
            <div className="flex justify-end">
              <Button type="submit" disabled={save.isPending}>{isNew ? f.saveNew : f.save}</Button>
            </div>
          )}
        </div>
      </form>
    </>
  );
}
