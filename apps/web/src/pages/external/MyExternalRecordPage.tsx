import { useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleAlert, Download, Loader2, ShieldCheck } from 'lucide-react';
import { del, get, post } from '@/lib/api';
import { Button, Card, EmptyState, Field, Input, Panel, Select, StatusChip, StatusPill } from '@/components/ui';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { uploadWithProgress } from '@/features/admin/upload';
import { errorMessage, Loading } from '@/features/admin/components/common';
import { accountKeys } from '@/features/account/api';
import { myEvidencePdfUrl, xk, type MyRecordView, type Target, type TargetOption } from '@/features/external/api';
import { CreditHint, Finder, MobileHeader, MobileShell, Timeline } from '@/features/external/MobileParts';
import { ReceiptPage, toOverlay } from '@/features/external/ReceiptViewer';
import { creditFor, deDate, fieldBoxes } from '@/features/external/model';
import { tx } from '@/i18n/external';

const s = tx.submit;

/** `/konto/extern/:id` – erkannte Angaben prüfen und einreichen (10a), danach Status-Zeitleiste (10b). */
export default function MyExternalRecordPage() {
  return <RequireAuth>{() => <RecordView />}</RequireAuth>;
}

function RecordView() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const view = useQuery({
    queryKey: xk.mineDetail(id),
    queryFn: () => get<MyRecordView>(`/me/external-records/${id}`),
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      if (d.ocr.status === 'ausstehend') return 1500;
      if (d.record.status === 'eingereicht') return 15_000;
      if (d.record.status === 'freigegeben' && d.evidence?.status !== 'erzeugt') return 3000;
      return false;
    },
  });
  const targets = useQuery({ queryKey: xk.targets, queryFn: () => get<Target[]>('/me/external-records/targets') });
  const header = <MobileHeader onBack={() => navigate('/konto')} eyebrow={s.eyebrow} title={s.title} backLabel={s.back} />;

  if (view.isPending) return <MobileShell header={header}>{<Loading />}</MobileShell>;
  if (view.isError || !view.data)
    return (
      <MobileShell header={header}>
        <Card>
          <EmptyState icon={<CircleAlert />} title={s.notFound} description={errorMessage(view.error)} />
        </Card>
      </MobileShell>
    );
  const v = view.data;
  const editable = v.record.status === 'entwurf' || v.record.status === 'zurueckgegeben';
  const options = targets.data?.find((t) => t.personId === v.record.personId)?.options ?? [];
  return editable ? <FormView key={v.record.id} v={v} header={header} options={options} /> : <DoneView v={v} header={header} />;
}

function FormView({ v, header, options }: { v: MyRecordView; header: ReactNode; options: TargetOption[] }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const r = v.record;
  const ocr = v.ocr.fields;
  const running = v.ocr.status === 'ausstehend';
  const retakeRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const [edits, setEdits] = useState<{ course?: string; heldOn?: string; duration?: string; provider?: string; requirementId?: string | null }>({});
  const [chooseTarget, setChooseTarget] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Werte: eigene Eingabe > gespeicherte Angabe > OCR-Vorschlag
  const requirementId = edits.requirementId !== undefined ? edits.requirementId : (r.requirementId ?? v.ocr.suggestedRequirementId ?? null);
  const option = options.find((o) => o.requirementId === requirementId) ?? null;
  const course = edits.course ?? (option ? option.trainingTitle : (r.freeTitle ?? r.title ?? ocr?.course?.value ?? ''));
  const ocrDate = typeof ocr?.date?.normalized === 'string' ? ocr.date.normalized : '';
  const heldOn = edits.heldOn ?? r.heldOn ?? ocrDate;
  const duration = edits.duration ?? r.durationLabel ?? ocr?.duration?.value ?? '';
  const provider = edits.provider ?? r.provider ?? ocr?.provider?.value ?? '';
  const credit = creditFor(option, heldOn || null);
  const set = (k: keyof typeof edits) => (value: string | null) => setEdits((e) => ({ ...e, [k]: value }));

  const refresh = () => qc.invalidateQueries({ queryKey: xk.mineDetail(r.id) });
  const submit = useMutation({
    mutationFn: () => {
      if (!option && course.trim().length < 2) throw new Error(s.errCourse);
      const fields: Record<string, unknown> = {
        provider: provider.trim() || null,
        heldOn: heldOn || null,
        durationLabel: duration.trim() || null,
      };
      if (option) fields.requirementId = option.requirementId;
      else {
        fields.requirementId = null;
        fields.trainingId = null;
        fields.freeTitle = course.trim();
      }
      return post(`/me/external-records/${r.id}/submit`, fields);
    },
    onMutate: () => setError(null),
    onSuccess: async () => {
      await refresh();
      void qc.invalidateQueries({ queryKey: xk.mine });
      void qc.invalidateQueries({ queryKey: accountKeys.evidence });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const addPage = useMutation({
    mutationFn: (files: FileList) => {
      const form = new FormData();
      for (const f of Array.from(files).slice(0, 5)) form.append('dateien', f, f.name);
      return uploadWithProgress(`/me/external-records/${r.id}/files`, form);
    },
    onSuccess: () => refresh(),
    onError: (e) => setError(errorMessage(e)),
  });
  const retake = useMutation({
    mutationFn: async (files: FileList) => {
      const form = new FormData();
      for (const f of Array.from(files).slice(0, 5)) form.append('dateien', f, f.name);
      form.append('personId', r.personId);
      const created = await uploadWithProgress<{ id: string }>('/me/external-records', form);
      await del(`/me/external-records/${r.id}`).catch(() => undefined);
      return created;
    },
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: xk.mine });
      navigate(`/konto/extern/${c.id}`, { replace: true });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const file = v.files[0];
  const boxes = running ? [] : toOverlay(fieldBoxes(ocr, 1, ['name', 'date', 'course']));
  const nameMatches = ocr?.nameMatches;
  const busyFiles = addPage.isPending || retake.isPending;

  return (
    <MobileShell
      header={header}
      footer={
        <Button size="lg" fullWidth className="h-14 text-[16px]" disabled={submit.isPending || busyFiles} onClick={() => submit.mutate()}>
          {submit.isPending ? s.submitting : s.submit}
        </Button>
      }
    >
      <Finder label={s.photoAlt}>
        <div className="relative w-full">
          {file ? (
            <ReceiptPage
              key={`${file.url}-${v.files.length}`}
              file={file}
              boxes={boxes}
              maxHeight={340}
              className="rounded-[6px] shadow-[0_10px_24px_rgba(0,0,0,0.35)]"
            />
          ) : null}
          {running && (
            <div className="absolute inset-x-0 top-3 flex justify-center">
              <StatusPill tone="accent" pulse role="status">
                {s.ocrRunning}
              </StatusPill>
            </div>
          )}
        </div>
      </Finder>
      {v.files.length > 1 && <p className="-mt-1.5 text-center text-[12.5px] text-muted">{tx.receipt.fileOf(1, v.files.length)}</p>}

      <input ref={retakeRef} type="file" accept="image/*,application/pdf" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => e.target.files?.length && retake.mutate(e.target.files)} />
      <input ref={addRef} type="file" accept="image/*,application/pdf" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="seite-input" onChange={(e) => e.target.files?.length && addPage.mutate(e.target.files)} />
      <div className="flex gap-2">
        {r.status === 'entwurf' && (
          <Button variant="secondary" className="flex-1" disabled={busyFiles} onClick={() => retakeRef.current?.click()}>
            {retake.isPending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
            {s.retake}
          </Button>
        )}
        <Button variant="secondary" className="flex-1" disabled={busyFiles} onClick={() => addRef.current?.click()}>
          {addPage.isPending ? s.addingPage : s.addPage}
        </Button>
      </div>

      <Card padding="none" className="flex flex-col gap-3 rounded-[24px] p-[18px]" aria-labelledby="erkannt-titel">
        <div className="flex items-center justify-between gap-2">
          <h2 id="erkannt-titel" className="font-heading text-[16px] font-bold text-ink">
            {s.recognizedTitle}
          </h2>
          {!running && nameMatches === true && (
            <StatusChip tone="success" size="md" icon={<Check aria-hidden="true" strokeWidth={2.5} />}>
              {s.nameOk}
            </StatusChip>
          )}
          {!running && nameMatches === false && (
            <StatusChip tone="warn" size="md">
              {s.nameMismatch}
            </StatusChip>
          )}
        </div>
        {r.status === 'zurueckgegeben' && r.reviewNote && (
          <Panel tone="warn" className="text-[13.5px]">
            <strong className="font-semibold">{s.returnedHead}.</strong> {s.returnedText(r.reviewNote)}
          </Panel>
        )}
        {running && <p className="text-[13px] text-muted">{s.ocrRunningText}</p>}
        {v.ocr.status === 'fehler' && <p className="text-[13px] text-warn-strong">{s.ocrFailed}</p>}
        <Field label={s.course}>
          <Input value={course} readOnly={!!option} title={option ? s.courseReadOnly : undefined} onChange={(e) => set('course')(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label={s.date}>
            <Input type="date" value={heldOn} onChange={(e) => set('heldOn')(e.target.value)} />
          </Field>
          <Field label={s.duration}>
            <Input value={duration} onChange={(e) => set('duration')(e.target.value)} />
          </Field>
        </div>
        <Field label={s.provider}>
          <Input value={provider} onChange={(e) => set('provider')(e.target.value)} />
        </Field>
        {credit ? (
          <CreditHint>
            {(() => {
              const t = credit.validUntil ? s.credit(credit.label, deDate(credit.validUntil)) : s.creditNoDate(credit.label);
              return (
                <>
                  {t.before}
                  <strong className="font-bold">{t.label}</strong>
                  {t.after}
                </>
              );
            })()}
          </CreditHint>
        ) : (
          <CreditHint tone="neutral">{s.noCredit}</CreditHint>
        )}
        {options.length > 0 &&
          (chooseTarget ? (
            <Field label={s.target}>
              <Select value={requirementId ?? ''} onChange={(e) => set('requirementId')(e.target.value || null)}>
                {options.map((o) => (
                  <option key={o.requirementId} value={o.requirementId}>
                    {o.label}
                  </option>
                ))}
                <option value="">{s.targetNone}</option>
              </Select>
            </Field>
          ) : (
            <button type="button" onClick={() => setChooseTarget(true)} className="min-h-11 cursor-pointer self-start text-[13.5px] font-semibold text-accent-text underline-offset-4 hover:underline">
              {s.changeTarget}
            </button>
          ))}
        {error && (
          <Panel tone="danger" role="alert" className="text-[13.5px]">
            {error}
          </Panel>
        )}
      </Card>
    </MobileShell>
  );
}

function DoneView({ v, header }: { v: MyRecordView; header: ReactNode }) {
  const navigate = useNavigate();
  const approved = v.record.status === 'freigegeben' || v.record.status === 'abgelaufen';
  const title = v.record.title ?? tx.account.untitled;
  const ev = v.evidence && !v.evidence.revoked ? v.evidence : null;
  return (
    <MobileShell
      header={header}
      footer={
        <Button variant="secondary" size="lg" fullWidth className="h-14 text-[16px]" onClick={() => navigate('/konto/extern/neu')}>
          {s.again}
        </Button>
      }
    >
      <Card padding="none" className="flex flex-col items-center gap-3 rounded-[28px] px-[22px] py-[30px] text-center" role="status">
        <span aria-hidden="true" className="flex size-[84px] items-center justify-center rounded-full bg-success-soft text-success">
          <Check className="size-10" strokeWidth={2.75} />
        </span>
        <h2 className="font-heading text-[23px] font-bold text-ink">{approved ? s.approvedTitle : s.doneTitle}</h2>
        <p className="text-[15px] leading-[1.55] text-ink-2">{approved ? s.approvedText(title) : s.doneText(title, v.reviewerName)}</p>
        {approved && (
          <div className="mt-1 flex w-full flex-col gap-2">
            {ev && ev.status === 'erzeugt' ? (
              <Button asChild variant="tonal" fullWidth>
                <a href={myEvidencePdfUrl(v.record.id)} download>
                  <Download aria-hidden="true" className="size-[18px]" />
                  {s.download}
                </a>
              </Button>
            ) : (
              <p className="flex h-12 items-center justify-center gap-2 rounded-pill bg-bg text-[14px] text-ink-2">
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                {tx.review.evidencePending}
              </p>
            )}
            {ev && (
              <Button asChild variant="ghost" fullWidth>
                <Link to={`/verify/${ev.verifyCode}`}>
                  <ShieldCheck aria-hidden="true" className="size-[18px]" />
                  {s.verify}
                </Link>
              </Button>
            )}
          </div>
        )}
      </Card>
      <Card padding="none" className="rounded-[24px] px-5 py-[18px]">
        <Timeline steps={v.timeline} />
      </Card>
    </MobileShell>
  );
}
