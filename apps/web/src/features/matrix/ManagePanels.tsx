import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, UserPlus } from 'lucide-react';
import { del, get, patch, post } from '@/lib/api';
import { Avatar, Button, Card, CardDescription, CardHeader, CardTitle, Checkbox, CheckboxField, EmptyState, Field, IconButton, Input, Panel, Select, Sheet, StatusChip, Textarea } from '@/components/ui';
import { qk, type Person, type TrainingListItem } from '@/features/admin/api';
import { ConfirmSheet, errorMessage, Loading } from '@/features/admin/components/common';
import { xk, type Requirement } from '@/features/external/api';
import { deDate } from '@/features/external/model';
import { adm } from '@/i18n/admin';
import { tx } from '@/i18n/external';
import { mk, type Exemption, type Qualification, type QualificationPerson } from './api';

const t = tx.matrix;
type Notify = (text: string, tone?: 'success' | 'danger') => void;

function useInvalidateMatrix() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: mk.compliance }),
      qc.invalidateQueries({ queryKey: mk.qualifications }),
      qc.invalidateQueries({ queryKey: xk.requirements }),
      qc.invalidateQueries({ queryKey: qk.dashboard }),
    ]);
}

// ── Anforderungen ──────────────────────────────────────────
export function RequirementsPanel({ manage, notify }: { manage: boolean; notify: Notify }) {
  const reqs = useQuery({ queryKey: xk.requirements, queryFn: () => get<Requirement[]>('/requirements') });
  const quals = useQuery({ queryKey: mk.qualifications, queryFn: () => get<Qualification[]>('/qualifications') });
  const [editing, setEditing] = useState<Requirement | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Requirement | null>(null);
  const invalidate = useInvalidateMatrix();
  const remove = useMutation({
    mutationFn: (id: string) => del(`/requirements/${id}`),
    onSuccess: async () => {
      setDeleting(null);
      notify(t.req.deleted);
      await invalidate();
    },
    onError: (e) => notify(errorMessage(e), 'danger'),
  });
  const name = (r: Requirement) => `${r.qualification_name} → ${r.training_title}`;
  return (
    <Card radius="lg">
      <CardHeader>
        <div>
          <CardTitle>{t.req.title}</CardTitle>
          <CardDescription>{t.req.hint}</CardDescription>
        </div>
        {manage && (
          <Button onClick={() => setEditing('new')} disabled={!quals.data?.length}>
            <Plus aria-hidden="true" className="size-[18px]" />
            {t.req.add}
          </Button>
        )}
      </CardHeader>
      {manage && quals.isSuccess && !quals.data.length && <Panel tone="accent" className="mb-3">{t.req.needQualification}</Panel>}
      {reqs.isPending ? (
        <Loading />
      ) : !reqs.data?.length ? (
        <p className="text-[14px] text-muted">{t.req.empty}</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label={t.req.title}>
          {reqs.data.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-box bg-bg px-4 py-3" data-testid="anforderung">
              <div className="min-w-0 flex-1 basis-64">
                <p className="text-[15px] font-semibold text-ink">
                  {r.qualification_name} <span className="text-muted">→</span> {r.training_title}
                </p>
                <p className="text-[13px] text-muted">
                  {t.req.format[r.training_format] ?? r.training_format} · {t.every(r.interval_months)} · {t.req.reinviteDays(r.reinvite_days)} ({r.auto_invite ? t.req.auto : t.req.manual})
                  {r.grace_days > 0 ? ` · ${t.cell.grace(r.grace_days)}` : ''}
                </p>
              </div>
              <StatusChip tone="info">{t.req.persons(r.person_count)}</StatusChip>
              {!r.active && <StatusChip tone="neutral">{t.req.inactive}</StatusChip>}
              {manage && (
                <span className="flex gap-1">
                  <IconButton variant="ghost" aria-label={t.req.editNamed(name(r))} onClick={() => setEditing(r)}>
                    <Pencil aria-hidden="true" />
                  </IconButton>
                  <IconButton variant="ghost" aria-label={t.req.deleteNamed(name(r))} onClick={() => setDeleting(r)}>
                    <Trash2 aria-hidden="true" />
                  </IconButton>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <RequirementSheet
          requirement={editing === 'new' ? null : editing}
          qualifications={quals.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            notify(t.req.saved);
            await invalidate();
          }}
        />
      )}
      <ConfirmSheet
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t.req.delete}
        description={deleting ? name(deleting) : undefined}
        confirmLabel={adm.common.delete}
        tone="danger-soft"
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      >
        <p className="text-[14px] text-ink-2">{t.req.deleteConfirm}</p>
      </ConfirmSheet>
    </Card>
  );
}

function RequirementSheet({
  requirement,
  qualifications,
  onClose,
  onSaved,
}: {
  requirement: Requirement | null;
  qualifications: Qualification[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const trainings = useQuery({ queryKey: qk.trainings, queryFn: () => get<TrainingListItem[]>('/trainings') });
  const [qualificationId, setQ] = useState(requirement?.qualification_id ?? qualifications[0]?.id ?? '');
  const [trainingId, setT] = useState(requirement?.training_id ?? '');
  const [interval, setIntervalMonths] = useState(String(requirement?.interval_months ?? 12));
  const [grace, setGrace] = useState(String(requirement?.grace_days ?? 0));
  const [reinvite, setReinvite] = useState(String(requirement?.reinvite_days ?? 30));
  const [auto, setAuto] = useState(requirement?.auto_invite ?? true);
  const [active, setActive] = useState(requirement?.active ?? true);
  const [err, setErr] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      const e: Record<string, string> = {};
      const iv = Number(interval);
      const gd = Number(grace);
      const rd = Number(reinvite);
      if (!Number.isInteger(iv) || iv < 1 || iv > 240) e.interval = t.req.errInterval;
      if (!Number.isInteger(gd) || gd < 0 || gd > 365) e.grace = t.req.errDays;
      if (!Number.isInteger(rd) || rd < 0 || rd > 365) e.reinvite = t.req.errDays;
      if (!requirement && (!qualificationId || !trainingId)) e.form = tx.matrix.ex.errPick;
      setErr(e);
      if (Object.keys(e).length) throw new Error(Object.values(e)[0]);
      const body = { intervalMonths: iv, graceDays: gd, reinviteDays: rd, autoInvite: auto, active };
      return requirement ? patch(`/requirements/${requirement.id}`, body) : post('/requirements', { ...body, qualificationId, trainingId });
    },
    onSuccess: onSaved,
    onError: (e) => setErr((x) => ({ ...x, form: errorMessage(e) })),
  });
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={requirement ? t.req.editTitle : t.req.newTitle}
      desktopPlacement="right"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {adm.common.cancel}
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? adm.common.saving : adm.common.save}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {err.form && (
          <Panel tone="danger" role="alert">
            {err.form}
          </Panel>
        )}
        <Field label={t.req.qualification} required>
          <Select value={qualificationId} disabled={!!requirement} onChange={(e) => setQ(e.target.value)}>
            {qualifications.map((q) => (
              <option key={q.id} value={q.id}>
                {q.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t.req.training} required>
          <Select value={trainingId} disabled={!!requirement} onChange={(e) => setT(e.target.value)}>
            <option value="">{requirement ? requirement.training_title : t.req.pick}</option>
            {(trainings.data ?? [])
              .filter((x) => !x.archived_at)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.titel} · {t.req.format[x.format] ?? x.format}
                </option>
              ))}
          </Select>
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t.req.interval} error={err.interval}>
            <Input inputMode="numeric" value={interval} onChange={(e) => setIntervalMonths(e.target.value)} />
          </Field>
          <Field label={t.req.grace} error={err.grace}>
            <Input inputMode="numeric" value={grace} onChange={(e) => setGrace(e.target.value)} />
          </Field>
          <Field label={t.req.reinvite} error={err.reinvite}>
            <Input inputMode="numeric" value={reinvite} onChange={(e) => setReinvite(e.target.value)} />
          </Field>
        </div>
        <CheckboxField label={t.req.autoInvite} description={t.req.autoInviteHint} checked={auto} onCheckedChange={(v) => setAuto(v === true)} />
        <CheckboxField label={t.req.active} checked={active} onCheckedChange={(v) => setActive(v === true)} />
      </div>
    </Sheet>
  );
}

// ── Qualifikationen ────────────────────────────────────────
export function QualificationsPanel({ manage, notify }: { manage: boolean; notify: Notify }) {
  const quals = useQuery({ queryKey: mk.qualifications, queryFn: () => get<Qualification[]>('/qualifications') });
  const [editing, setEditing] = useState<Qualification | 'new' | null>(null);
  const [assigning, setAssigning] = useState<Qualification | null>(null);
  const [deleting, setDeleting] = useState<Qualification | null>(null);
  const invalidate = useInvalidateMatrix();
  const remove = useMutation({
    mutationFn: (id: string) => del(`/qualifications/${id}`),
    onSuccess: async () => {
      setDeleting(null);
      notify(t.qual.deleted);
      await invalidate();
    },
    onError: (e) => notify(errorMessage(e), 'danger'),
  });
  return (
    <Card radius="lg">
      <CardHeader>
        <div>
          <CardTitle>{t.qual.title}</CardTitle>
          <CardDescription>{t.qual.hint}</CardDescription>
        </div>
        {manage && (
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden="true" className="size-[18px]" />
            {t.qual.add}
          </Button>
        )}
      </CardHeader>
      {quals.isPending ? (
        <Loading />
      ) : !quals.data?.length ? (
        <p className="text-[14px] text-muted">{t.qual.empty}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2" aria-label={t.qual.title}>
          {quals.data.map((q) => (
            <li key={q.id} className="flex flex-wrap items-center gap-3 rounded-box bg-bg px-4 py-3" data-testid="qualifikation">
              <div className="min-w-0 flex-1 basis-48">
                <p className="text-[15px] font-semibold text-ink">{q.name}</p>
                <p className="text-[13px] text-muted">
                  {t.qual.persons(q.person_count)} · {t.qual.requirements(q.requirement_count)}
                </p>
                {q.description && <p className="mt-0.5 text-[13px] text-ink-2">{q.description}</p>}
              </div>
              {manage && (
                <span className="flex gap-1">
                  <Button variant="secondary" size="sm" aria-label={t.qual.assignNamed(q.name)} onClick={() => setAssigning(q)}>
                    <UserPlus aria-hidden="true" className="size-4" />
                    {t.qual.assign}
                  </Button>
                  <IconButton variant="ghost" aria-label={t.qual.editNamed(q.name)} onClick={() => setEditing(q)}>
                    <Pencil aria-hidden="true" />
                  </IconButton>
                  <IconButton variant="ghost" aria-label={t.qual.deleteNamed(q.name)} onClick={() => setDeleting(q)}>
                    <Trash2 aria-hidden="true" />
                  </IconButton>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <QualificationSheet
          qualification={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (created) => {
            setEditing(null);
            notify(t.qual.saved);
            await invalidate();
            if (created) setAssigning(created);
          }}
        />
      )}
      {assigning && (
        <AssignSheet
          qualification={assigning}
          onClose={() => setAssigning(null)}
          onSaved={async (n) => {
            setAssigning(null);
            notify(t.qual.assigned(n));
            await invalidate();
          }}
        />
      )}
      <ConfirmSheet
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting ? t.qual.deleteNamed(deleting.name) : ''}
        confirmLabel={adm.common.delete}
        tone="danger-soft"
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      >
        <p className="text-[14px] text-ink-2">{t.qual.deleteConfirm}</p>
      </ConfirmSheet>
    </Card>
  );
}

function QualificationSheet({
  qualification,
  onClose,
  onSaved,
}: {
  qualification: Qualification | null;
  onClose: () => void;
  onSaved: (created: Qualification | null) => void;
}) {
  const [name, setName] = useState(qualification?.name ?? '');
  const [description, setDescription] = useState(qualification?.description ?? '');
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error(t.qual.errName);
      const body = { name: name.trim(), description: description.trim() || null };
      if (qualification) {
        await patch(`/qualifications/${qualification.id}`, body);
        return null;
      }
      const r = await post<{ id: string }>('/qualifications', body);
      return { id: r.id, name: body.name, description: body.description, created_at: '', person_count: 0, requirement_count: 0 } as Qualification;
    },
    onSuccess: onSaved,
    onError: (e) => setErr(errorMessage(e)),
  });
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={qualification ? t.qual.editTitle : t.qual.newTitle}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {adm.common.cancel}
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? adm.common.saving : adm.common.save}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t.qual.name} error={err ?? undefined} required>
          <Input value={name} placeholder={t.qual.namePlaceholder} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t.qual.description}>
          <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}

/** Personen einer Qualifikation zuordnen/entfernen (Checkliste mit Suche). */
function AssignSheet({ qualification, onClose, onSaved }: { qualification: Qualification; onClose: () => void; onSaved: (n: number) => void }) {
  const persons = useQuery({ queryKey: qk.persons(), queryFn: () => get<Person[]>('/persons') });
  const current = useQuery({
    queryKey: mk.qualificationPersons(qualification.id),
    queryFn: () => get<QualificationPerson[]>(`/qualifications/${qualification.id}/persons`),
  });
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [q, setQ] = useState('');
  const initial = useMemo(() => new Set((current.data ?? []).map((p) => p.id)), [current.data]);
  const sel = selected ?? initial;
  const shown = (persons.data ?? []).filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()));
  const save = useMutation({
    mutationFn: async () => {
      const add = [...sel].filter((id) => !initial.has(id));
      const remove = [...initial].filter((id) => !sel.has(id));
      if (add.length) await post(`/qualifications/${qualification.id}/persons`, { personIds: add });
      for (const id of remove) await del(`/qualifications/${qualification.id}/persons/${id}`);
      return sel.size;
    },
    onSuccess: onSaved,
  });
  const toggle = (id: string, on: boolean) => {
    const next = new Set(sel);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={t.qual.assignTitle(qualification.name)}
      description={t.qual.assignDescription}
      desktopPlacement="right"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {adm.common.cancel}
          </Button>
          <Button disabled={save.isPending || current.isPending} onClick={() => save.mutate()}>
            {save.isPending ? adm.common.saving : t.qual.assignSave}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {save.isError && (
          <Panel tone="danger" role="alert">
            {errorMessage(save.error)}
          </Panel>
        )}
        <Input type="search" aria-label={t.qual.assignSearch} placeholder={t.qual.assignSearch} value={q} onChange={(e) => setQ(e.target.value)} />
        <p className="text-[13px] text-muted" aria-live="polite">
          {t.qual.persons(sel.size)}
        </p>
        {persons.isPending || current.isPending ? (
          <Loading />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {shown.map((p) => {
              const id = `zuordnen-${p.id}`;
              return (
                <li key={p.id} className="flex items-center gap-3 rounded-input bg-bg px-3.5 py-2">
                  <Checkbox id={id} checked={sel.has(p.id)} onCheckedChange={(v) => toggle(p.id, v === true)} />
                  <label htmlFor={id} className="flex min-h-9 flex-1 cursor-pointer items-center gap-2.5 text-[14px] text-ink">
                    <Avatar name={p.name} tone="surface" size="sm" />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    {p.org_unit_name && <span className="truncate text-[12.5px] text-muted">{p.org_unit_name}</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

// ── Ausnahmen ──────────────────────────────────────────────
export function ExemptionsPanel({ manage, notify }: { manage: boolean; notify: Notify }) {
  const list = useQuery({ queryKey: mk.exemptions, queryFn: () => get<Exemption[]>('/compliance/exemptions') });
  const [adding, setAdding] = useState(false);
  const invalidate = useInvalidateMatrix();
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => del(`/compliance/exemptions/${id}`),
    onSuccess: async () => {
      notify(t.ex.deleted);
      await Promise.all([invalidate(), qc.invalidateQueries({ queryKey: mk.exemptions })]);
    },
    onError: (e) => notify(errorMessage(e), 'danger'),
  });
  return (
    <Card radius="lg">
      <CardHeader>
        <div>
          <CardTitle>{t.ex.title}</CardTitle>
          <CardDescription>{t.ex.hint}</CardDescription>
        </div>
        {manage && (
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" className="size-[18px]" />
            {t.ex.add}
          </Button>
        )}
      </CardHeader>
      {list.isPending ? (
        <Loading />
      ) : !list.data?.length ? (
        <EmptyState title={t.ex.empty} className="py-6" />
      ) : (
        <ul className="flex flex-col gap-2" aria-label={t.ex.title}>
          {list.data.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-3 rounded-box bg-bg px-4 py-3">
              <Avatar name={x.person_name} tone="surface" />
              <div className="min-w-0 flex-1 basis-56">
                <p className="text-[15px] font-semibold text-ink">{x.person_name}</p>
                <p className="text-[13px] text-muted">
                  {x.training_title} · {x.qualification_name}
                </p>
                <p className="text-[13px] text-ink-2">{x.reason}</p>
              </div>
              <StatusChip tone="neutral">{x.valid_until ? t.ex.until(deDate(x.valid_until)) : t.ex.unlimited}</StatusChip>
              {manage && (
                <IconButton variant="ghost" aria-label={t.ex.deleteNamed(x.person_name)} onClick={() => remove.mutate(x.id)}>
                  <Trash2 aria-hidden="true" />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <ExemptionSheet
          preset={null}
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            notify(t.ex.saved);
            await Promise.all([invalidate(), qc.invalidateQueries({ queryKey: mk.exemptions })]);
          }}
        />
      )}
    </Card>
  );
}

export function ExemptionSheet({
  preset,
  onClose,
  onSaved,
}: {
  preset: { personId: string; requirementId: string } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const persons = useQuery({ queryKey: qk.persons(), queryFn: () => get<Person[]>('/persons') });
  const reqs = useQuery({ queryKey: xk.requirements, queryFn: () => get<Requirement[]>('/requirements') });
  const [personId, setPersonId] = useState(preset?.personId ?? '');
  const [requirementId, setRequirementId] = useState(preset?.requirementId ?? '');
  const [reason, setReason] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      if (!personId || !requirementId) throw new Error(t.ex.errPick);
      if (reason.trim().length < 3) throw new Error(t.ex.errReason);
      return post('/compliance/exemptions', { personId, requirementId, reason: reason.trim(), validUntil: validUntil || null });
    },
    onSuccess: onSaved,
    onError: (e) => setErr(errorMessage(e)),
  });
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={t.ex.newTitle}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {adm.common.cancel}
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? adm.common.saving : adm.common.save}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {err && (
          <Panel tone="danger" role="alert">
            {err}
          </Panel>
        )}
        <Field label={t.ex.person} required>
          <Select value={personId} onChange={(e) => setPersonId(e.target.value)}>
            <option value="">{t.req.pick}</option>
            {(persons.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t.ex.requirement} required>
          <Select value={requirementId} onChange={(e) => setRequirementId(e.target.value)}>
            <option value="">{t.req.pick}</option>
            {(reqs.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.training_title} · {r.qualification_name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t.ex.reason} required>
          <Textarea rows={3} value={reason} placeholder={t.ex.reasonPlaceholder} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label={t.ex.validUntil}>
          <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}
