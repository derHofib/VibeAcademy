import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Send } from 'lucide-react';
import { get, post } from '@/lib/api';
import { adm } from '@/i18n/admin';
import { Button, Card, CardTitle, CheckboxField, Field, Input, Panel } from '@/components/ui';
import {
  qk,
  type InviteResult,
  type Person,
  type RunDetail,
  type Training,
  type TrainingVersion,
} from '../api';
import { addDays, formatDate, formatDuration, isoDate } from '../format';
import { needsPublish } from '../wizard';
import { errorMessage } from '../components/common';
import { LinksPanel } from '../LinksPanel';
import type { AudienceSelection } from './AudienceStep';
import { parsePageList, type ChangeInfo } from './DocumentCard';

const r = adm.wizard.review;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 rounded-input bg-bg px-4 py-3 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
      <dt className="text-[13.5px] text-muted">{label}</dt>
      <dd className="text-[15px] font-medium text-ink">{children}</dd>
    </div>
  );
}

/** Schritt 4: Zusammenfassung, veröffentlichen, Durchführung anlegen, einladen, Ergebnis + Links. */
export function ReviewStep({
  training,
  version,
  activeQuestions,
  audience,
  audienceCount,
  persons,
  change,
  back,
}: {
  training: Training;
  version: TrainingVersion | null;
  activeQuestions: number;
  audience: AudienceSelection;
  audienceCount: number;
  persons: Person[];
  change: ChangeInfo;
  back: ReactNode;
}) {
  const qc = useQueryClient();
  const s = training.settings;
  const [deadline, setDeadline] = useState(() => isoDate(addDays(new Date(), s.deadlineDays)));
  const [sendMail, setSendMail] = useState(true);
  const publish = needsPublish(version);
  const publishedNo = training.versions.find((v) => v.published_at)?.version_no ?? null;
  const usedVersion = publish ? version?.versionNo : publishedNo;

  const run = useMutation({
    mutationFn: async () => {
      // frisch prüfen: bei einem Wiederholversuch kann die Version schon veröffentlicht sein
      const fresh =
        publish && version
          ? await get<TrainingVersion>(`/trainings/${training.id}/versions/${version.id}`)
          : null;
      if (version && fresh && !fresh.publishedAt) {
        await post(`/trainings/${training.id}/versions/${version.id}/publish`, {
          ...(version.versionNo >= 2 && change.kind ? { changeKind: change.kind } : {}),
          ...(change.kind === 'inhaltlich' && change.pages.trim()
            ? { changedPages: parsePageList(change.pages, version.pageCount ?? 0) }
            : {}),
          ...(change.note.trim() ? { changeNote: change.note.trim() } : {}),
        });
      }
      const created = await post<{ id: string; deadline: string }>('/runs', {
        trainingId: training.id,
        deadline,
      });
      const res = await post<InviteResult>(`/runs/${created.id}/invite`, {
        personIds: audience.personIds,
        orgUnitIds: audience.orgUnitIds,
        sendMail,
      });
      const detail = await get<RunDetail>(`/runs/${created.id}`);
      return { runId: created.id, res, detail };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.training(training.id) });
      void qc.invalidateQueries({ queryKey: qk.trainings });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
      void qc.invalidateQueries({ queryKey: qk.runs });
    },
  });

  if (run.isSuccess) {
    const { res, detail, runId } = run.data;
    const names = new Map(persons.map((p) => [p.id, p.name]));
    return (
      <div className="flex flex-col gap-5">
        <Card radius="lg" padding="lg" className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-12 items-center justify-center rounded-full bg-success-soft text-success"
            >
              <CircleCheck className="size-6" />
            </span>
            <h2
              className="font-heading text-[20px] font-bold text-ink"
              tabIndex={-1}
              ref={(el) => el?.focus()}
            >
              {r.resultTitle}
            </h2>
          </div>
          <ul className="flex flex-wrap gap-2 text-[14px]">
            <li className="rounded-pill bg-success-soft px-3.5 py-1.5 font-semibold text-success-text">
              {r.resultCreated(res.created)}
            </li>
            {res.skipped > 0 && (
              <li className="rounded-pill bg-neutral-soft px-3.5 py-1.5 font-semibold text-ink-2">
                {r.resultSkipped(res.skipped)}
              </li>
            )}
            <li className="rounded-pill bg-accent-soft px-3.5 py-1.5 font-semibold text-accent-text">
              {r.resultMails(res.mailsQueued)}
            </li>
          </ul>
          {res.withoutEmail.length > 0 && (
            <Panel tone="warn">
              <p className="font-semibold">{r.resultNoEmail(res.withoutEmail.length)}</p>
              <p>{res.withoutEmail.map((id) => names.get(id) ?? id).join(', ')}</p>
            </Panel>
          )}
          <div>
            <Button asChild>
              <Link to={`/verwaltung/durchfuehrungen/${runId}`}>{r.toRun}</Link>
            </Button>
          </div>
        </Card>
        <LinksPanel
          title={detail.titel_effektiv}
          deadline={detail.deadline}
          invitations={detail.invitations}
        />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card radius="lg" padding="lg" className="flex flex-col gap-4">
        <CardTitle>{r.summary}</CardTitle>
        <dl className="flex flex-col gap-2">
          <Row label={adm.wizard.basics.titel}>{training.titel}</Row>
          {version && (
            <Row label={r.document}>
              {r.documentValue(usedVersion ?? version.versionNo, version.pageCount, version.totals.words)}
            </Row>
          )}
          {version && <Row label={r.minTime}>{formatDuration(version.totals.minReadingSeconds)}</Row>}
          <Row label={r.quiz}>
            {training.quizRequired
              ? r.quizValue(Math.min(s.quizQuestionCount, activeQuestions), s.passPct, s.maxAttempts)
              : r.quizOff}
          </Row>
          <Row label={r.signature}>{r.signatureValue(s.requireStepUp)}</Row>
          {publish && version && version.versionNo >= 2 && change.kind && (
            <Row label={r.change}>
              {change.kind === 'inhaltlich'
                ? adm.wizard.doc.changeInhaltlich
                : adm.wizard.doc.changeRedaktionell}
            </Row>
          )}
          <Row label={r.audience}>{adm.wizard.audience.previewCount(audienceCount)}</Row>
          <Row label={adm.wizard.basics.confirmText}>
            <span className="font-normal text-ink-2">{training.confirmText || '—'}</span>
          </Row>
        </dl>
        <Panel tone={publish ? 'accent' : 'neutral'}>
          {publish && version ? r.publishNote(version.versionNo) : r.publishedNote(publishedNo ?? 1)}
        </Panel>
      </Card>

      <div className="flex flex-col gap-4">
        <Card radius="lg" padding="lg" className="flex flex-col gap-4">
          <Field label={r.deadline} hint={r.deadlineHint}>
            <Input
              type="date"
              value={deadline}
              min={isoDate(new Date())}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </Field>
          <p className="sr-only" aria-live="polite">
            {formatDate(deadline)}
          </p>
          <CheckboxField
            label={r.sendMail}
            description={r.sendMailHint}
            checked={sendMail}
            onCheckedChange={(c) => setSendMail(c === true)}
          />
          {run.isError && (
            <Panel tone="danger" role="alert">
              {errorMessage(run.error)}
            </Panel>
          )}
          <Button size="lg" onClick={() => run.mutate()} disabled={run.isPending || !deadline}>
            <Send aria-hidden="true" className="size-[18px]" />
            {run.isPending ? r.submitting : publish ? r.submit : r.submitPublished}
          </Button>
        </Card>
        {back}
      </div>
    </div>
  );
}
