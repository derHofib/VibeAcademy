import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, FileUp } from 'lucide-react';
import { get, post } from '@/lib/api';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, Card, CheckboxField, Field, Input, Panel, PersonChip, SegmentedControl, Select } from '@/components/ui';
import { qk, type Person, type TrainingListItem } from '@/features/admin/api';
import { ErrorPanel, Loading, errorMessage } from '@/features/admin/components/common';
import { useAdminMe } from '@/features/admin/hooks';
import { canManage } from '@/features/auth/session';
import { fetchRequirements, xk, type CreateResult, type Preview } from '@/features/external/api';
import { EffectCard } from '@/features/external/EffectCard';
import { ExternalImportSheet } from '@/features/external/ImportSheet';
import { ReceiptDropzone, useReceiptUploads } from '@/features/external/ReceiptDropzone';
import { isFutureDate, requirementLabel } from '@/features/external/model';
import { tx } from '@/i18n/external';

const c = tx.capture;
type Mode = 'einzel' | 'gruppe';

/** Zuordnung: `req:<id>` (Pflichtschulung), `tr:<id>` (externe Schulung ohne Anforderung) oder leer (nur dokumentieren). */
function parseAssignment(v: string): { requirementId?: string; trainingId?: string } {
  if (v.startsWith('req:')) return { requirementId: v.slice(4) };
  if (v.startsWith('tr:')) return { trainingId: v.slice(3) };
  return {};
}

/** `/verwaltung/extern/neu` – Externe Schulung erfassen (Screens 9a/9b). */
export default function ExternalCapturePage() {
  const me = useAdminMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const manage = canManage(me);

  const persons = useQuery({ queryKey: qk.persons(), queryFn: () => get<Person[]>('/persons') });
  const requirements = useQuery({ queryKey: xk.requirements, queryFn: fetchRequirements });
  const trainings = useQuery({ queryKey: qk.trainings, queryFn: () => get<TrainingListItem[]>('/trainings') });

  const [saved, setSaved] = useState<{ kind: 'final' | 'review' | 'draft'; count: number; preview?: Preview } | null>(null);
  const dirty = () => setSaved(null);
  const [mode, setModeRaw] = useState<Mode>(params.get('modus') === 'einzel' ? 'einzel' : 'gruppe');
  const [assignment, setAssignment] = useState<string | null>(params.get('requirement') ? `req:${params.get('requirement')}` : null);
  const [freeTitle, setFreeTitle] = useState('');
  const [provider, setProvider] = useState('');
  const [location, setLocation] = useState('');
  const [heldOn, setHeldOn] = useState('');
  const [duration, setDuration] = useState('');
  const [isMedical, setIsMedical] = useState(false);
  const [review, setReview] = useState(false);
  const [personIds, setPersonIds] = useState<string[]>(() => (params.get('person') ? [params.get('person')!] : []));
  const [receiptMode, setReceiptMode] = useState<'one' | 'per'>('one');
  const [override, setOverride] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const uploads = useReceiptUploads(dirty);

  const activeReqs = useMemo(() => (requirements.data ?? []).filter((r) => r.active), [requirements.data]);
  const coveredTrainings = new Set(activeReqs.map((r) => r.training_id));
  const externalTrainings = (trainings.data ?? []).filter((t) => t.format === 'extern' && !t.archived_at && !coveredTrainings.has(t.id));
  // Standard: erste Pflichtschulung, sobald die Liste da ist
  const assignValue = assignment ?? (activeReqs[0] ? `req:${activeReqs[0].id}` : '');
  const asg = parseAssignment(assignValue);
  const effectivePersons = mode === 'einzel' ? personIds.slice(0, 1) : personIds;
  const byId = new Map((persons.data ?? []).map((p) => [p.id, p]));
  const chosen = effectivePersons.map((id) => byId.get(id)).filter(Boolean) as Person[];
  const addable = (persons.data ?? []).filter((p) => !effectivePersons.includes(p.id));
  const perPerson = mode === 'einzel' ? false : receiptMode === 'per';

  const previewBody = { ...asg, heldOn: heldOn || null, personIds: effectivePersons, validUntil: override };
  const preview = useQuery({
    queryKey: xk.preview(previewBody),
    queryFn: () => post<Preview>('/external-records/preview', previewBody),
    placeholderData: keepPreviousData,
    enabled: requirements.isSuccess,
  });

  // „Was sich ändert“ in der Reihenfolge der Teilnehmer-Chips
  const orderedPreview = preview.data
    ? { ...preview.data, persons: [...preview.data.persons].sort((a, b) => effectivePersons.indexOf(a.personId) - effectivePersons.indexOf(b.personId)) }
    : undefined;

  const setMode = (m: Mode) => {
    dirty();
    setModeRaw(m);
    if (m === 'einzel') setPersonIds((ids) => ids.slice(0, 1));
  };
  const change =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      dirty();
      set(v);
    };

  const save = useMutation({
    mutationFn: async (kind: 'final' | 'draft') => {
      const asDraft = kind === 'draft';
      if (!effectivePersons.length) throw new Error(c.errPersons);
      if (!asDraft) {
        if (!heldOn) throw new Error(c.errDate);
        if (isFutureDate(heldOn)) throw new Error(c.errFuture);
        if (!asg.requirementId && !asg.trainingId && freeTitle.trim().length < 2) throw new Error(c.errCourse);
      }
      if (uploads.busy) throw new Error(c.waitUpload);
      const ready = uploads.items.filter((i) => i.uploadId);
      if (perPerson && ready.some((i) => !i.personId || !effectivePersons.includes(i.personId))) throw new Error(c.errPerPerson);
      const body = {
        mode,
        personIds: effectivePersons,
        ...asg,
        freeTitle: !asg.requirementId && !asg.trainingId && freeTitle.trim() ? freeTitle.trim() : undefined,
        provider: provider.trim() || null,
        location: isMedical ? null : location.trim() || null,
        heldOn: heldOn || null,
        durationLabel: isMedical ? null : duration.trim() || null,
        isMedical,
        ...(override ? { validUntil: override } : {}),
        receipts: perPerson
          ? {
              mode: 'per' as const,
              uploadIds: [],
              perPerson: effectivePersons
                .map((pid) => ({ personId: pid, uploadIds: ready.filter((i) => i.personId === pid).map((i) => i.uploadId!) }))
                .filter((x) => x.uploadIds.length),
            }
          : { mode: 'one' as const, uploadIds: ready.map((i) => i.uploadId!), perPerson: [] },
        draft: asDraft,
        review: !asDraft && review,
      };
      return post<CreateResult>('/external-records', body);
    },
    onMutate: () => setError(null),
    onSuccess: (r, kind) => {
      // „Was sich ändert“ zeigt nach dem Speichern weiter den Stand vorher → nachher (9b)
      setSaved({ kind: kind === 'draft' ? 'draft' : r.status === 'eingereicht' ? 'review' : 'final', count: r.records.length, preview: orderedPreview });
      void qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  if (!manage) return <ErrorPanel error={new Error(c.onlyManagers)} />;

  const loading = persons.isPending || requirements.isPending;
  const finalSaved = saved?.kind === 'final' || saved?.kind === 'review';
  const credited = !!preview.data?.credited || (!!preview.data?.label && !!preview.data.intervalMonths);

  return (
    <>
      <PageHeader
        eyebrow={c.eyebrow}
        title={c.title}
        onBack={() => navigate('/verwaltung/extern')}
        backLabel={c.back}
        actions={
          <>
            <Button variant="secondary" disabled={save.isPending} onClick={() => save.mutate('draft')}>
              {saved?.kind === 'draft' && <Check aria-hidden="true" className="size-4" />}
              {c.draft}
            </Button>
            <Button
              variant={finalSaved ? 'success' : 'primary'}
              disabled={save.isPending}
              onClick={() => !finalSaved && save.mutate('final')}
            >
              {finalSaved ? (
                <>
                  <Check aria-hidden="true" className="size-[18px]" strokeWidth={2.5} />
                  {c.saved}
                </>
              ) : save.isPending ? (
                c.saving
              ) : credited ? (
                c.save
              ) : (
                c.saveNoCredit
              )}
            </Button>
          </>
        }
      />

      {loading ? (
        <Loading />
      ) : persons.isError || requirements.isError ? (
        <ErrorPanel error={persons.error ?? requirements.error} onRetry={() => void persons.refetch()} />
      ) : (
        <div className="flex flex-col items-start gap-5 xl:flex-row">
          <Card radius="lg" padding="lg" className="flex w-full min-w-0 flex-1 flex-col gap-[22px]" aria-label="Angaben" role="group">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SegmentedControl
                aria-label={c.modeLabel}
                value={mode}
                onValueChange={setMode}
                options={[
                  { value: 'einzel', label: c.single },
                  { value: 'gruppe', label: c.group },
                ]}
              />
              <Button variant="ghost" size="sm" onClick={() => setImportOpen(true)}>
                <FileUp aria-hidden="true" className="size-4" />
                {c.importAction}
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label={c.assignment} className="md:col-span-2">
                <Select value={assignValue} onChange={(e) => change(setAssignment)(e.target.value)} disabled={isMedical}>
                  {activeReqs.map((r) => (
                    <option key={r.id} value={`req:${r.id}`}>
                      {requirementLabel(r)}
                    </option>
                  ))}
                  {externalTrainings.map((t) => (
                    <option key={t.id} value={`tr:${t.id}`}>
                      {c.trainingOnly(t.titel)}
                    </option>
                  ))}
                  <option value="">{c.noAssignment}</option>
                </Select>
              </Field>
              {!asg.requirementId && !asg.trainingId && (
                <Field label={c.course} className="md:col-span-2" required>
                  <Input value={freeTitle} placeholder={c.coursePlaceholder} onChange={(e) => change(setFreeTitle)(e.target.value)} />
                </Field>
              )}
              <Field label={c.provider}>
                <Input value={provider} onChange={(e) => change(setProvider)(e.target.value)} />
              </Field>
              <Field label={c.location}>
                <Input value={location} disabled={isMedical} onChange={(e) => change(setLocation)(e.target.value)} />
              </Field>
              <Field label={c.date} required>
                <Input type="date" value={heldOn} onChange={(e) => change(setHeldOn)(e.target.value)} />
              </Field>
              <Field label={c.duration}>
                <Input value={duration} disabled={isMedical} placeholder={c.durationPlaceholder} onChange={(e) => change(setDuration)(e.target.value)} />
              </Field>
            </div>

            <div className="flex flex-col gap-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span id="teilnehmer-label" className="text-[13px] font-medium text-muted">
                  {c.participants}
                </span>
                <span className="text-[13px] text-muted" aria-live="polite">
                  {c.personCount(chosen.length)}
                </span>
              </div>
              <ul aria-labelledby="teilnehmer-label" className="flex flex-wrap items-center gap-2">
                {chosen.map((p) => (
                  <li key={p.id}>
                    <PersonChip name={p.name} onRemove={() => change(setPersonIds)(personIds.filter((x) => x !== p.id))} />
                  </li>
                ))}
                {(mode === 'gruppe' || chosen.length === 0) && addable.length > 0 && (
                  <li className="relative">
                    <select
                      aria-label={c.addPersonLabel}
                      value=""
                      onChange={(e) => e.target.value && change(setPersonIds)([...effectivePersons, e.target.value])}
                      className="h-11 cursor-pointer appearance-none rounded-pill border-[1.5px] border-dashed border-[#C9D1E0] bg-surface pr-10 pl-4 text-[14px] font-medium text-accent-text"
                    >
                      <option value="">{c.addPerson}</option>
                      {addable.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.personalnr ? ` · ${p.personalnr}` : ''}
                        </option>
                      ))}
                    </select>
                    <ChevronDown aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-accent-text" />
                  </li>
                )}
              </ul>
            </div>

            <div className="flex flex-col gap-2.5">
              <span className="text-[13px] font-medium text-muted">{c.receipts}</span>
              <ReceiptDropzone uploads={uploads} perPerson={perPerson} persons={chosen} groupMode={mode === 'gruppe'} />
              {mode === 'gruppe' && (
                <div role="group" aria-label={c.receiptModeLabel} className="flex flex-wrap gap-2">
                  {(['one', 'per'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={receiptMode === m}
                      onClick={() => change(setReceiptMode)(m)}
                      className={cn(
                        'min-h-11 cursor-pointer rounded-pill px-4 text-[13.5px] font-semibold transition-colors',
                        receiptMode === m ? 'bg-accent text-white shadow-primary' : 'bg-bg text-ink-2 hover:bg-neutral-soft',
                      )}
                    >
                      {m === 'one' ? c.oneList : c.perPerson}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-line pt-4">
              <CheckboxField label={c.medical} description={c.medicalHint} checked={isMedical} onCheckedChange={(v) => change(setIsMedical)(v === true)} />
              {mode === 'gruppe' && (
                <CheckboxField label={c.review} description={c.reviewHint} checked={review} onCheckedChange={(v) => change(setReview)(v === true)} />
              )}
            </div>
          </Card>

          <aside aria-label={c.effectTitle} className="flex w-full flex-col gap-4 xl:w-[380px] xl:shrink-0">
            <EffectCard preview={saved?.preview ?? orderedPreview} heldOn={heldOn} override={override} onOverride={change(setOverride)} />
            <Panel tone="accent" className="rounded-[22px] text-[13.5px]">
              {c.info}
            </Panel>
            <div role="status" aria-live="polite" className="empty:hidden">
              {error && (
                <Panel tone="danger" className="rounded-[22px] text-[14px]">
                  {error}
                </Panel>
              )}
              {saved && (
                <Panel tone="success" className="flex flex-col gap-2 rounded-[22px] text-[14px]">
                  <span>
                    {saved.kind === 'draft' ? (
                      c.savedDraft
                    ) : (
                      <>
                        <strong className="font-semibold">{c.savedHead}</strong> {saved.kind === 'review' ? c.savedReview(saved.count) : c.savedText(saved.count)}
                      </>
                    )}
                  </span>
                  <Link to="/verwaltung/extern" className="font-semibold underline underline-offset-4">
                    {c.toQueue}
                  </Link>
                </Panel>
              )}
            </div>
          </aside>
        </div>
      )}
      {importOpen && <ExternalImportSheet open={importOpen} onOpenChange={setImportOpen} />}
    </>
  );
}
