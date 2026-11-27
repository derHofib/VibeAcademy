import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ChevronLeft, FileUp, Paperclip, Upload } from 'lucide-react';
import { PLATFORM_LABELS, PLATFORMS, anlassLine, type Platform } from '@sn/shared';
import { ApiError, get, post } from '@/lib/api';
import { cn } from '@/lib/cn';
import {
  Button, Card, CardDescription, CardTitle, Checkbox, CheckboxField, Field, Input, KpiTile, Panel, SegmentedControl, Select, StatusChip, Textarea,
} from '@/components/ui';
import { qk, personsQueryFn, type Person, type Training, type TrainingListItem } from '@/features/admin/api';
import { ErrorPanel, Loading, NoticeRegion, useNotice } from '@/features/admin/components/common';
import { uploadWithProgress } from '@/features/admin/upload';
import { useAdminMe } from '@/features/admin/hooks';
import { liveKeys } from '@/features/live/api';
import {
  berlinIso, buildEntries, defaultChoices, type BackdatedState, type ImportResult, type RowChoice,
} from '@/features/presence/backdated';
import { tb } from '@/i18n/backdated';

const t = tb;
const dtDe = (iso: string) =>
  new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(new Date(iso));
const dateDe = (iso: string) => new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeZone: 'Europe/Berlin' }).format(new Date(iso));
const hm = (iso: string) => new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }).format(new Date(iso));

function Steps({ current }: { current: number }) {
  return (
    <ol aria-label={t.stepLabel} className="mb-6 flex max-w-3xl items-start">
      {t.steps.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        return (
          <li key={label} aria-current={n === current ? 'step' : undefined} className="flex flex-1 flex-col items-center gap-1.5 text-center text-[12.5px]">
            <span
              aria-hidden="true"
              className={cn('size-3.5 rounded-full', done ? 'bg-success' : n === current ? 'bg-accent ring-4 ring-accent-soft' : 'bg-line')}
            />
            <span className={cn(n === current ? 'font-semibold text-ink' : 'text-muted')}>
              {n} {label}
              {done && <span className="sr-only"> – {t.done}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Header({ title, step }: { title: string; step: number }) {
  return (
    <>
      <Link to="/verwaltung/termine" className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-pill px-2 text-[14px] font-semibold text-accent-text underline-offset-4 hover:underline">
        <ChevronLeft aria-hidden="true" className="size-4" />
        {t.back}
      </Link>
      <h1 className="mb-4 font-heading text-[24px] leading-tight font-bold text-ink md:text-[28px]">{title}</h1>
      <Steps current={step} />
    </>
  );
}

/** `/verwaltung/termine/nachtraeglich` bzw. `/verwaltung/termine/:id/nachtraeglich?schritt=2–4` (E-53/E-54). */
export default function BackdatedPage() {
  const { id } = useParams();
  return id ? <BackdatedRun id={id} /> : <CreateStep />;
}

// ── Schritt 1: Termin ─────────────────────────────────────────

function CreateStep() {
  const navigate = useNavigate();
  const me = useAdminMe();
  const trainings = useQuery({ queryKey: qk.trainings, queryFn: () => get<TrainingListItem[]>('/trainings') });
  const persons = useQuery({ queryKey: qk.persons('', ''), queryFn: personsQueryFn('', '') });
  const [trainingId, setTrainingId] = useState('');
  const training = useQuery({ queryKey: qk.training(trainingId), queryFn: () => get<Training>(`/trainings/${trainingId}`), enabled: !!trainingId });
  const [f, setF] = useState({
    delivery: 'live_online' as 'praesenz' | 'live_online', kombiniert: false, date: '', start: '09:00', end: '10:00',
    platform: 'teams' as Platform | '', meetingUrl: '', ort: '', trainerPersonId: '', completenessPct: '90', reason: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  // Vorgaben der Schulung übernehmen (E-51)
  useEffect(() => {
    const tr = training.data;
    if (!tr) return;
    setF((p) => ({
      ...p,
      delivery: tr.defaultDelivery === 'praesenz' || tr.defaultDelivery === 'kombiniert' ? 'praesenz' : 'live_online',
      kombiniert: tr.defaultDelivery === 'kombiniert',
      platform: tr.defaultPlatform ?? p.platform,
      meetingUrl: tr.defaultMeetingUrl ?? '',
      completenessPct: String(tr.settings.completenessPct),
    }));
  }, [training.data]);

  const create = useMutation({
    mutationFn: () =>
      post<{ id: string }>('/runs/nachtraeglich', {
        trainingId, delivery: f.delivery, kombiniert: f.kombiniert, startAt: berlinIso(f.date, f.start), endAt: berlinIso(f.date, f.end),
        platform: f.delivery === 'live_online' ? f.platform || null : null, meetingUrl: f.delivery === 'live_online' ? f.meetingUrl : null,
        ort: f.delivery === 'praesenz' ? f.ort || null : null, trainerPersonId: f.trainerPersonId || null,
        completenessPct: Number(f.completenessPct) || null, reason: f.reason,
      }),
    onSuccess: (r) => navigate(`/verwaltung/termine/${r.id}/nachtraeglich?schritt=2`, { replace: true }),
    onError: (e) => {
      if (e instanceof ApiError) setErrors(Object.fromEntries(e.fields.map((x) => [x.path, x.message])));
    },
  });

  const submit = () => {
    const e: Record<string, string> = {};
    if (!trainingId) e.trainingId = t.termin.required;
    if (!f.date) e.date = t.termin.required;
    if (f.date && f.end <= f.start) e.endAt = t.termin.endAfterStart;
    if (f.date && !e.endAt && Date.parse(berlinIso(f.date, f.end)) > Date.now()) e.endAt = t.termin.endInPast;
    if (f.reason.trim().length < 10) e.reason = t.termin.reasonShort;
    if (f.delivery === 'live_online' && !f.platform) e.platform = t.termin.required;
    setErrors(e);
    if (!Object.keys(e).length) create.mutate();
  };

  const published = (trainings.data ?? []).filter((x) => !x.archived_at);
  const anlass = training.data ? anlassLine(training.data.anlassTyp, training.data.anlassText) : null;
  const deliveryText = f.delivery === 'live_online' ? `Live-Online · ${f.platform ? PLATFORM_LABELS[f.platform] : '–'}` : `Präsenz${f.ort ? ` · ${f.ort}` : ''}`;
  const myName = me?.account.name ?? '';

  return (
    <>
      <Header title={t.title} step={1} />
      <form noValidate onSubmit={(e) => { e.preventDefault(); submit(); }} className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card radius="lg" padding="lg" className="flex flex-col gap-4">
          <div>
            <CardTitle>{t.termin.card}</CardTitle>
            <CardDescription>{t.termin.sub}</CardDescription>
          </div>
          <Field label={t.termin.training} required error={errors.trainingId}>
            <Select name="trainingId" value={trainingId} onChange={(e) => setTrainingId(e.target.value)}>
              <option value="">{t.termin.chooseTraining}</option>
              {published.map((x) => (
                <option key={x.id} value={x.id}>{x.titel}</option>
              ))}
            </Select>
          </Field>
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-ink-2">{t.termin.delivery}</p>
            <SegmentedControl
              aria-label={t.termin.delivery}
              value={f.delivery}
              onValueChange={(v) => set('delivery', v as 'praesenz' | 'live_online')}
              options={[{ value: 'praesenz', label: t.termin.praesenz }, { value: 'live_online', label: t.termin.liveOnline }]}
            />
          </div>
          <CheckboxField label={<span className="font-semibold">{t.termin.kombiniert}</span>} description={t.termin.kombiniertText} checked={f.kombiniert} onCheckedChange={(c) => set('kombiniert', c === true)} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label={t.termin.date} required error={errors.date}>
              <Input name="date" type="date" value={f.date} onChange={(e) => set('date', e.target.value)} />
            </Field>
            <Field label={t.termin.start} required>
              <Input name="start" type="time" value={f.start} onChange={(e) => set('start', e.target.value)} />
            </Field>
            <Field label={t.termin.end} required error={errors.endAt}>
              <Input name="end" type="time" value={f.end} onChange={(e) => set('end', e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {f.delivery === 'live_online' ? (
              <Field label={t.termin.platform} required error={errors.platform}>
                <Select name="platform" value={f.platform} onChange={(e) => set('platform', e.target.value as Platform)}>
                  {PLATFORMS.map((p) => (
                    <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field label={t.termin.ort}>
                <Input name="ort" value={f.ort} onChange={(e) => set('ort', e.target.value)} />
              </Field>
            )}
            <Field label={t.termin.trainer}>
              <Select name="trainerPersonId" value={f.trainerPersonId} onChange={(e) => set('trainerPersonId', e.target.value)}>
                <option value="">{t.termin.noTrainer}</option>
                {(persons.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            </Field>
          </div>
          {f.delivery === 'live_online' && (
            <Field label={t.termin.meetingUrl} error={errors.meetingUrl}>
              <Input name="meetingUrl" type="url" value={f.meetingUrl} onChange={(e) => set('meetingUrl', e.target.value)} />
            </Field>
          )}
          <Field label={t.termin.completeness}>
            <Input name="completenessPct" inputMode="numeric" value={f.completenessPct} onChange={(e) => set('completenessPct', e.target.value)} />
          </Field>
          <Field label={t.termin.reason} required hint={t.termin.reasonHint} error={errors.reason}>
            <Textarea name="reason" rows={3} value={f.reason} onChange={(e) => set('reason', e.target.value)} />
          </Field>
          {create.isError && !(create.error instanceof ApiError && create.error.fields.length) && (
            <p role="alert" className="text-[13px] font-medium text-danger-text">{(create.error as Error).message}</p>
          )}
        </Card>
        <div className="flex flex-col gap-4">
          <Panel tone="warn" className="flex items-start gap-2.5 text-[14px]">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-[18px] shrink-0" />
            <span>
              <b>{t.termin.pastWarnTitle}</b>
              <br />
              {t.termin.pastWarn}
            </span>
          </Panel>
          <Card radius="lg" padding="lg">
            <CardTitle>{t.termin.preview}</CardTitle>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[14px]">
              <dt className="text-muted">{t.termin.previewDelivery}</dt>
              <dd data-testid="vorschau-art">{deliveryText}</dd>
              <dt className="text-muted">{t.termin.previewDate}</dt>
              <dd>{f.date ? `${dateDe(`${f.date}T12:00:00Z`)}, ${f.start}–${f.end}` : '–'}</dd>
              {anlass && (
                <>
                  <dt className="text-muted">{t.termin.previewAnlass}</dt>
                  <dd>{anlass}</dd>
                </>
              )}
              <dt className="text-muted">{t.termin.previewErfassung}</dt>
              <dd>{t.termin.previewErfassungText(myName)}</dd>
            </dl>
          </Card>
          <div className="flex justify-end gap-2.5">
            <Button asChild variant="secondary"><Link to="/verwaltung/termine">{t.termin.cancel}</Link></Button>
            <Button type="submit" disabled={create.isPending}>{t.termin.submit}</Button>
          </div>
        </div>
      </form>
    </>
  );
}

// ── Schritte 2–4 ─────────────────────────────────────────────

function BackdatedRun({ id }: { id: string }) {
  const [params, setParams] = useSearchParams();
  const { notice, show } = useNotice();
  const state = useQuery({ queryKey: ['admin', 'nachtraeglich', id], queryFn: () => get<BackdatedState>(`/runs/${id}/nachtraeglich`) });
  const signed = !!state.data?.run.countersignedAt;
  const step = signed ? 4 : Math.min(4, Math.max(2, Number(params.get('schritt') ?? 2) || 2));
  const go = (s: number) => {
    setParams({ schritt: String(s) });
    window.scrollTo({ top: 0 });
  };
  if (state.isPending) return <Loading />;
  if (state.error) return <ErrorPanel error={state.error} onRetry={() => void state.refetch()} />;
  const s = state.data!;
  return (
    <>
      <Header title={`${t.titleRun}: ${s.run.titel}`} step={step} />
      <p className="-mt-3 mb-4 text-[14px] text-ink-2">
        {s.run.delivery === 'live_online' ? `Live-Online · ${s.run.platform ? PLATFORM_LABELS[s.run.platform] : ''}` : `Präsenz${s.run.ort ? ` · ${s.run.ort}` : ''}`} ·{' '}
        {dateDe(s.run.startAt)}, {hm(s.run.startAt)}–{hm(s.run.endAt)}
      </p>
      <NoticeRegion notice={notice} className="mb-4 empty:hidden" />
      {step === 2 && <AttendanceStep s={s} onDone={() => { show(t.attendance.applied); go(3); }} />}
      {step === 3 && <ReceiptStep s={s} onNext={() => go(4)} onSaved={() => show(t.beleg.uploaded)} />}
      {step === 4 && <SignStep s={s} />}
    </>
  );
}

function Kpis({ items }: { items: Array<{ value: ReactNode; label: string; warn?: boolean }> }) {
  return (
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((k) => (
        <KpiTile key={k.label} value={k.value} label={k.label} tone={k.warn ? 'warn' : undefined} />
      ))}
    </div>
  );
}

function PresenceBar({ pct, threshold }: { pct: number; threshold: number }) {
  return (
    <div className="flex items-center gap-2">
      <div aria-hidden="true" className="h-2 w-24 overflow-hidden rounded-pill bg-line">
        <div className={cn('h-full rounded-pill', pct >= threshold ? 'bg-success' : 'bg-warn')} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="tabular-nums">{pct} %</span>
    </div>
  );
}

function AttendanceStep({ s, onDone }: { s: BackdatedState; onDone: () => void }) {
  const qc = useQueryClient();
  const persons = useQuery({ queryKey: qk.persons('', ''), queryFn: personsQueryFn('', '') });
  const fileRef = useRef<HTMLInputElement>(null);
  const [imp, setImp] = useState<ImportResult | null>(null);
  const [choices, setChoices] = useState<Record<number, RowChoice>>({});
  const [checklist, setChecklist] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const threshold = s.run.completenessPct;

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append('datei', file, file.name);
    try {
      const r = await uploadWithProgress<ImportResult>(`/runs/${s.run.id}/nachtraeglich/import`, form);
      setImp(r);
      setChoices(defaultChoices(r.rows));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const built = useMemo(() => buildEntries(imp?.rows ?? [], choices, checklist), [imp, choices, checklist]);
  const apply = useMutation({
    mutationFn: () => post(`/runs/${s.run.id}/nachtraeglich/anwesenheit`, { importId: imp?.importId ?? null, entries: built.entries }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin', 'nachtraeglich', s.run.id] });
      onDone();
    },
  });
  const setChoice = (i: number, patch: Partial<RowChoice>) => setChoices((p) => ({ ...p, [i]: { ...p[i]!, ...patch } }));
  const rows = imp?.rows ?? [];
  const partial = rows.filter((r) => choices[r.index]?.include && r.state === 'teilweise');

  return (
    <div className="flex flex-col gap-5">
      {imp && (
        <Kpis
          items={[
            { value: rows.length, label: t.attendance.kpiRows },
            { value: rows.filter((r) => r.match?.by === 'email').length, label: t.attendance.kpiEmail },
            { value: rows.filter((r) => r.state === 'teilweise').length, label: t.attendance.kpiPartial(threshold), warn: rows.some((r) => r.state === 'teilweise') },
            { value: rows.filter((r) => !r.match).length, label: t.attendance.kpiUnknown },
          ]}
        />
      )}
      <Card radius="lg" padding="lg" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{t.attendance.card}</CardTitle>
            <CardDescription>
              {imp ? `${t.attendance.meta(imp.fileName, imp.plannedMinutes)} · ${t.attendance.formats[imp.format]}` : t.attendance.importHint}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,.tsv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              aria-label={t.attendance.importButton}
              data-testid="import-datei"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
                e.target.value = '';
              }}
            />
            <Button type="button" variant={imp ? 'secondary' : 'primary'} size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
              <FileUp aria-hidden="true" className="size-4" />
              {busy ? t.attendance.importing : imp ? t.attendance.otherFile : t.attendance.importButton}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowList((v) => !v)} aria-expanded={showList}>
              {t.attendance.checklist}
            </Button>
          </div>
        </div>
        {error && <p role="alert" className="text-[13.5px] font-medium text-danger-text">{error}</p>}
        {imp?.warnings.map((w) => (
          <p key={w} className="text-[13px] text-warn-text">{w}</p>
        ))}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[14px]">
              <caption className="sr-only">{t.attendance.card}</caption>
              <thead>
                <tr className="border-b border-line text-[12.5px] text-muted">
                  <th scope="col" className="py-2 pr-2 font-semibold">{t.attendance.colTake}</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">{t.attendance.colPerson}</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">{t.attendance.colMinutes}</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">{t.attendance.colPresence}</th>
                  <th scope="col" className="py-2 font-semibold">{t.attendance.colAssign}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const c = choices[r.index]!;
                  return (
                    <tr key={r.index} className={cn('border-b border-line align-top', r.state === 'teilweise' && c.include && 'bg-warn-soft/40')}>
                      <td className="py-3 pr-2">
                        <Checkbox aria-label={t.attendance.take(r.name)} checked={c.include} onCheckedChange={(v) => setChoice(r.index, { include: v === true })} />
                      </td>
                      <td className="py-3 pr-3">
                        <b>{r.name}</b>
                        <div className="text-[13px] text-muted">{r.email ?? '—'}{r.role ? ` · ${r.role}` : ''}</div>
                      </td>
                      <td className="py-3 pr-3 tabular-nums">{r.minutes === null ? '—' : `${r.minutes} min`}</td>
                      <td className="py-3 pr-3">
                        {r.pct === null ? <span className="text-[13px] text-muted">{t.attendance.noTimes}</span> : <PresenceBar pct={r.pct} threshold={threshold} />}
                        {r.state === 'teilweise' && c.include && (
                          <label className="mt-1.5 flex items-center gap-2 text-[13px]">
                            <Checkbox checked={c.credit} onCheckedChange={(v) => setChoice(r.index, { credit: v === true })} />
                            {t.attendance.credit}
                          </label>
                        )}
                      </td>
                      <td className="py-3">
                        <div className="flex flex-col gap-1.5">
                          {r.match ? (
                            <StatusChip tone={r.match.by === 'email' ? 'success' : 'info'}>{r.match.by === 'email' ? t.attendance.byEmail : t.attendance.byName}</StatusChip>
                          ) : (
                            <StatusChip tone="neutral">{t.attendance.unknown}</StatusChip>
                          )}
                          <Select
                            aria-label={t.attendance.assignLabel(r.name)}
                            value={c.createNew ? '__neu' : (c.personId ?? '')}
                            onChange={(e) => {
                              const v = e.target.value;
                              setChoice(r.index, v === '__neu' ? { createNew: true, personId: null, include: true } : { createNew: false, personId: v || null, include: !!v || c.include });
                            }}
                          >
                            <option value="">{t.attendance.assignNone}</option>
                            <option value="__neu">{t.attendance.assignNew}: {r.name}</option>
                            {(persons.data ?? []).map((p: Person) => (
                              <option key={p.id} value={p.id}>{p.name}{p.email ? ` (${p.email})` : ''}</option>
                            ))}
                          </Select>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {partial.map((r) => (
          <Panel key={r.index} tone="warn" className="text-[14px]">{t.attendance.partialHint(r.name, r.minutes ?? 0, imp!.plannedMinutes, r.pct ?? 0)}</Panel>
        ))}

        {showList && (
          <fieldset className="rounded-box bg-bg p-4">
            <legend className="px-1 text-[13px] font-semibold text-ink-2">{t.attendance.checklist}</legend>
            <p className="mb-2 text-[12.5px] text-muted">{t.attendance.checklistHint}</p>
            <div className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
              {(persons.data ?? []).map((p) => (
                <CheckboxField
                  key={p.id}
                  label={p.name}
                  checked={checklist.includes(p.id)}
                  onCheckedChange={(v) => setChecklist((l) => (v === true ? [...l, p.id] : l.filter((x) => x !== p.id)))}
                />
              ))}
            </div>
          </fieldset>
        )}

        {s.attendances.length > 0 && !imp && (
          <div>
            <p className="mb-2 text-[13px] font-semibold text-ink-2">{t.attendance.current}</p>
            <ul className="flex flex-col gap-1.5 text-[14px]">
              {s.attendances.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2">
                  <b>{a.name}</b> <PresenceBar pct={a.pct} threshold={threshold} />
                  <span className="text-[12.5px] text-muted">{a.source === 'import' ? t.attendance.sourceImport : t.attendance.sourceManual}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p className="text-[13px] text-muted" role="status">
            {built.missing.length ? t.attendance.missing(built.missing.join(', ')) : t.attendance.summary(built.entries.length)}
          </p>
          <div className="flex gap-2.5">
            {s.attendances.length > 0 && !built.entries.length ? (
              <Button type="button" onClick={onDone}>{t.attendance.apply}</Button>
            ) : (
              <Button type="button" disabled={apply.isPending || !built.entries.length || built.missing.length > 0} onClick={() => apply.mutate()}>
                {t.attendance.apply}
              </Button>
            )}
          </div>
        </div>
        {apply.isError && <p role="alert" className="text-[13px] font-medium text-danger-text">{(apply.error as Error).message}</p>}
      </Card>
    </div>
  );
}

function ReceiptStep({ s, onNext, onSaved }: { s: BackdatedState; onNext: () => void; onSaved: () => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append('datei', file, file.name);
    try {
      await uploadWithProgress(`/runs/${s.run.id}/nachtraeglich/belege`, form);
      await qc.invalidateQueries({ queryKey: ['admin', 'nachtraeglich', s.run.id] });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card radius="lg" padding="lg" className="flex max-w-3xl flex-col gap-4">
      <div>
        <CardTitle>{t.beleg.card}</CardTitle>
        <CardDescription>{t.beleg.sub}</CardDescription>
      </div>
      {s.documents.length ? (
        <ul className="flex flex-col gap-2">
          {s.documents.map((d) => (
            <li key={d.id} className="flex items-center gap-2.5 rounded-box bg-bg px-4 py-3 text-[14px]">
              <Paperclip aria-hidden="true" className="size-4 text-muted" />
              <span className="min-w-0 flex-1 truncate">{d.file_name}</span>
              <span className="text-[12.5px] text-muted">{t.beleg.kinds[d.kind]} · SHA-256 {d.sha256.slice(0, 8)}…</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[14px] text-muted">{t.beleg.none}</p>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        className="sr-only"
        aria-label={t.beleg.upload}
        data-testid="beleg-datei"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = '';
        }}
      />
      {error && <p role="alert" className="text-[13.5px] font-medium text-danger-text">{error}</p>}
      <div className="flex flex-wrap justify-between gap-2.5">
        <Button type="button" variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload aria-hidden="true" className="size-4" />
          {t.beleg.upload}
        </Button>
        <Button type="button" onClick={onNext}>{t.beleg.next}</Button>
      </div>
    </Card>
  );
}

function SignStep({ s }: { s: BackdatedState }) {
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const sign = useMutation({
    mutationFn: () => post<{ evidenceQueued: number; followupInvited: number }>(`/runs/${s.run.id}/nachtraeglich/gegenzeichnen`, { password }),
    onSuccess: async () => {
      setPassword('');
      await qc.invalidateQueries({ queryKey: ['admin', 'nachtraeglich', s.run.id] });
      await qc.invalidateQueries({ queryKey: liveKeys.termine });
    },
  });
  const signed = !!s.run.countersignedAt;
  return (
    <div className="flex max-w-4xl flex-col gap-5">
      {signed && (
        <Panel tone="success" role="status" className="flex items-start gap-2.5 text-[14px]">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-[18px] shrink-0" />
          <span>
            <b>{t.sign.doneTitle}</b> – {t.sign.signedBy(s.run.countersignName ?? '–', dtDe(s.run.countersignedAt!))}
            {sign.data && (
              <>
                <br />
                {t.sign.done(sign.data.evidenceQueued)}
                {sign.data.followupInvited ? ` ${t.sign.followup(sign.data.followupInvited)}` : ''}
              </>
            )}
          </span>
        </Panel>
      )}
      <Card radius="lg" padding="lg" className="flex flex-col gap-4">
        <div>
          <CardTitle>{t.sign.card}</CardTitle>
          <CardDescription>{t.sign.sub}</CardDescription>
        </div>
        <ul className="flex flex-col divide-y divide-line text-[14px]">
          {s.attendances.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2.5 py-2.5">
              <b className="min-w-40">{a.name}</b>
              <PresenceBar pct={a.pct} threshold={s.run.completenessPct} />
              <StatusChip tone={a.state === 'vollstaendig' ? 'success' : 'warn'}>{a.state === 'vollstaendig' ? t.sign.full : t.sign.partial}</StatusChip>
              {a.state === 'teilweise' && <span className="text-[12.5px] text-muted">{a.release === 'freigegeben' ? t.sign.credited : t.sign.notCredited}</span>}
              {a.verifyCode && <span className="ml-auto text-[12.5px] text-muted">{t.sign.evidence} {a.verifyCode}</span>}
            </li>
          ))}
        </ul>
        {!signed && (
          <form noValidate onSubmit={(e) => { e.preventDefault(); sign.mutate(); }} className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
            <Field label={t.sign.password} required className="min-w-64 flex-1" error={sign.isError ? (sign.error as Error).message : undefined}>
              <Input name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Button type="submit" disabled={!password || sign.isPending || !s.attendances.length}>{sign.isPending ? t.sign.signing : t.sign.submit}</Button>
          </form>
        )}
        {signed && (
          <div className="flex justify-end">
            <Button asChild variant="secondary"><Link to="/verwaltung/termine">{t.sign.toList}</Link></Button>
          </div>
        )}
      </Card>
    </div>
  );
}
