import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, put } from '@/lib/api';
import { Button, CheckboxField, Panel, Sheet, StatusChip } from '@/components/ui';
import { ErrorPanel, Loading, errorMessage } from '@/features/admin/components/common';
import { adm } from '@/i18n/admin';
import { tx } from '@/i18n/external';
import { mk, type Compliance, type Qualification } from './api';
import { cellChip } from './model';

const t = tx.matrix.personSheet;

/** Qualifikationen einer Person (Personenseite) mit aktuellem Erfüllungsstand ihrer Pflichtschulungen. */
export function PersonQualificationsSheet({
  person,
  manage,
  onClose,
  onSaved,
}: {
  person: { id: string; name: string };
  manage: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const all = useQuery({ queryKey: mk.qualifications, queryFn: () => get<Qualification[]>('/qualifications') });
  const mine = useQuery({
    queryKey: mk.personQualifications(person.id),
    queryFn: () => get<Array<{ id: string; name: string; since: string | null }>>(`/persons/${person.id}/qualifications`),
  });
  const status = useQuery({ queryKey: [...mk.compliance, 'person', person.id], queryFn: () => get<Compliance>(`/compliance?person=${person.id}`) });
  const initial = useMemo(() => new Set((mine.data ?? []).map((q) => q.id)), [mine.data]);
  const [sel, setSel] = useState<Set<string> | null>(null);
  const selected = sel ?? initial;
  const save = useMutation({
    mutationFn: () => put(`/persons/${person.id}/qualifications`, { qualificationIds: [...selected] }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: mk.personQualifications(person.id) }),
        qc.invalidateQueries({ queryKey: mk.qualifications }),
        qc.invalidateQueries({ queryKey: mk.compliance }),
      ]);
      onSaved();
    },
  });
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={t.title(person.name)}
      description={t.description}
      desktopPlacement="right"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {adm.common.cancel}
          </Button>
          {manage && (
            <Button disabled={save.isPending || mine.isPending} onClick={() => save.mutate()}>
              {save.isPending ? adm.common.saving : adm.common.save}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && (
          <Panel tone="danger" role="alert">
            {errorMessage(save.error)}
          </Panel>
        )}
        {all.isPending || mine.isPending ? (
          <Loading />
        ) : all.isError ? (
          <ErrorPanel error={all.error} />
        ) : !all.data.length ? (
          <p className="text-[14px] text-muted">{t.empty}</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {all.data.map((q) => (
              <li key={q.id} className="rounded-input bg-bg px-3.5 py-3">
                <CheckboxField
                  label={q.name}
                  description={q.description ?? undefined}
                  disabled={!manage}
                  checked={selected.has(q.id)}
                  onCheckedChange={(v) => {
                    const next = new Set(selected);
                    if (v === true) next.add(q.id);
                    else next.delete(q.id);
                    setSel(next);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        {status.data && status.data.rows.length > 0 && (
          <section aria-labelledby="pq-status">
            <h3 id="pq-status" className="mb-2 text-[13px] font-semibold text-muted">
              {t.status}
            </h3>
            <ul className="flex flex-col gap-1.5">
              {status.data.rows.map((r) => {
                const chip = cellChip(r);
                return (
                  <li key={r.requirementId} className="flex items-center justify-between gap-3 text-[13.5px]">
                    <span className="min-w-0 text-ink-2">
                      {r.trainingTitle} <span className="text-muted">· {r.qualificationName}</span>
                    </span>
                    <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        <Link to="/verwaltung/pflichtmatrix" className="min-h-11 self-start py-2 text-[13.5px] font-semibold text-accent-text underline-offset-4 hover:underline">
          {t.toMatrix}
        </Link>
      </div>
    </Sheet>
  );
}
