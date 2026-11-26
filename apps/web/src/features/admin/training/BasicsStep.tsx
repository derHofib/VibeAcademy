import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { patch, post } from '@/lib/api';
import { adm } from '@/i18n/admin';
import { Button, Card, CardTitle, Field, Input, Panel, Textarea } from '@/components/ui';
import { fieldErrors } from '@/features/auth/session';
import { qk, type Training } from '../api';
import { defaultConfirmText } from '../wizard';
import { errorMessage } from '../components/common';

const t = adm.wizard.basics;

interface Values {
  titel: string;
  kategorie: string;
  rechtsgrundlage: string;
  ansprechpartner: string;
  confirmText: string;
}

/** Schritt 1: Grunddaten inkl. Bestätigungstext. */
export function BasicsStep({
  training,
  onSaved,
}: {
  training: Training | null;
  onSaved: (id: string) => void;
}) {
  const qc = useQueryClient();
  const versionNo =
    (training?.versions[0]?.published_at
      ? training.versions[0].version_no + 1
      : training?.versions[0]?.version_no) ?? 1;
  const [v, setV] = useState<Values>(() => ({
    titel: training?.titel ?? '',
    kategorie: training?.kategorie ?? '',
    rechtsgrundlage: training?.rechtsgrundlage ?? '',
    ansprechpartner: training?.ansprechpartner ?? '',
    confirmText: training?.confirmText ?? '',
  }));
  const [local, setLocal] = useState<Partial<Record<keyof Values, string>>>({});
  const save = useMutation({
    mutationFn: async (vals: Values) => {
      const body = {
        titel: vals.titel,
        kategorie: vals.kategorie || null,
        rechtsgrundlage: vals.rechtsgrundlage || null,
        ansprechpartner: vals.ansprechpartner || null,
        confirmText: vals.confirmText || defaultConfirmText(vals.titel, vals.ansprechpartner, versionNo),
      };
      if (training) {
        await patch(`/trainings/${training.id}`, body);
        return training.id;
      }
      return (await post<{ id: string }>('/trainings', { ...body, format: 'online', quizRequired: true })).id;
    },
    onSuccess: async (id) => {
      await qc.invalidateQueries({ queryKey: qk.training(id) });
      void qc.invalidateQueries({ queryKey: qk.trainings });
      onSaved(id);
    },
  });

  const set = (k: keyof Values) => (e: { target: { value: string } }) =>
    setV((p) => ({ ...p, [k]: e.target.value }));
  const fe = { ...(fieldErrors(save.error) as Partial<Record<keyof Values, string>>), ...local };
  const general =
    save.error && !Object.keys(fieldErrors(save.error)).length ? errorMessage(save.error) : null;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const errs: typeof local = {};
    if (v.titel.trim().length < 2) errs.titel = adm.auth.required;
    setLocal(errs);
    if (Object.keys(errs).length) return;
    save.mutate(v);
  };

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]"
    >
      <Card radius="lg" padding="lg" className="flex flex-col gap-4">
        <CardTitle>{t.card}</CardTitle>
        {general && (
          <Panel tone="danger" role="alert">
            {general}
          </Panel>
        )}
        <Field label={t.titel} required error={fe.titel}>
          <Input
            name="titel"
            value={v.titel}
            onChange={set('titel')}
            placeholder={t.titelPlaceholder}
            autoComplete="off"
          />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t.kategorie} error={fe.kategorie}>
            <Input
              name="kategorie"
              value={v.kategorie}
              onChange={set('kategorie')}
              placeholder={t.kategoriePlaceholder}
            />
          </Field>
          <Field label={t.rechtsgrundlage} error={fe.rechtsgrundlage}>
            <Input
              name="rechtsgrundlage"
              value={v.rechtsgrundlage}
              onChange={set('rechtsgrundlage')}
              placeholder={t.rechtsgrundlagePlaceholder}
            />
          </Field>
        </div>
        <Field label={t.ansprechpartner} hint={t.ansprechpartnerHint} error={fe.ansprechpartner}>
          <Input
            name="ansprechpartner"
            value={v.ansprechpartner}
            onChange={set('ansprechpartner')}
            placeholder={t.ansprechpartnerPlaceholder}
          />
        </Field>
        <Field
          label={t.confirmText}
          hint={t.confirmHint}
          error={fe.confirmText}
          aside={
            <button
              type="button"
              className="min-h-11 rounded-pill px-2 font-semibold text-accent-text underline-offset-4 hover:underline"
              onClick={() =>
                setV((p) => ({
                  ...p,
                  confirmText: defaultConfirmText(p.titel, p.ansprechpartner, versionNo),
                }))
              }
            >
              {t.suggest}
            </button>
          }
        >
          <Textarea
            name="confirmText"
            rows={4}
            value={v.confirmText}
            onChange={set('confirmText')}
            placeholder={defaultConfirmText(v.titel, v.ansprechpartner, versionNo)}
          />
        </Field>
      </Card>

      <div className="flex flex-col gap-4">
        <Panel tone="accent">{t.help}</Panel>
        <div className="flex flex-wrap justify-between gap-2.5 xl:flex-col-reverse xl:items-stretch">
          <Button asChild variant="secondary">
            <Link to="/verwaltung/schulungen">{adm.common.cancel}</Link>
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? adm.common.saving : adm.wizard.next(adm.wizard.steps[1]!)}
          </Button>
        </div>
      </div>
    </form>
  );
}
