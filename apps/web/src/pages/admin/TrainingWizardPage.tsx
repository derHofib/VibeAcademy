import { useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Settings2 } from 'lucide-react';
import { ts } from '@/i18n/training-settings';
import { get } from '@/lib/api';
import { adm } from '@/i18n/admin';
import { Button, Panel } from '@/components/ui';
import {
  qk,
  type OrgUnit,
  type Person,
  type Question,
  type Training,
  type TrainingVersion,
} from '@/features/admin/api';
import {
  latestVersion,
  maxReachableStep,
  parseStep,
  stepBlocker,
  audiencePreview,
  type WizardStep,
} from '@/features/admin/wizard';
import { ErrorPanel, Loading, NoticeRegion, useNotice } from '@/features/admin/components/common';
import { useSessionState } from '@/features/admin/upload';
import { Stepper } from '@/features/admin/training/Stepper';
import { BasicsStep } from '@/features/admin/training/BasicsStep';
import { DocumentCard, type ChangeInfo } from '@/features/admin/training/DocumentCard';
import { LanguageVersionsCard } from '@/features/admin/training/LanguageVersionsCard';
import { RulesPanel, type RulesPanelHandle } from '@/features/admin/training/RulesPanel';
import { QuestionPool } from '@/features/admin/training/QuestionPool';
import { AudienceStep, type AudienceSelection } from '@/features/admin/training/AudienceStep';
import { ReviewStep } from '@/features/admin/training/ReviewStep';

const w = adm.wizard;
const noChange: ChangeInfo = { kind: null, pages: '', note: '' };
const noAudience: AudienceSelection = { personIds: [], orgUnitIds: [] };

/** Screen 2 – „Schulung anlegen“ als Assistent in vier Schritten (`/verwaltung/schulungen/neu` bzw. `/:id`). */
export default function TrainingWizardPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { notice, show } = useNotice();
  const rulesRef = useRef<RulesPanelHandle>(null);
  const requested = parseStep(params.get('schritt'));

  const training = useQuery({
    queryKey: qk.training(id ?? ''),
    queryFn: () => get<Training>(`/trainings/${id}`),
    enabled: !!id,
  });
  const latest = training.data ? latestVersion(training.data.versions) : null;
  const version = useQuery({
    queryKey: qk.version(id ?? '', latest?.id ?? ''),
    queryFn: () => get<TrainingVersion>(`/trainings/${id}/versions/${latest!.id}`),
    enabled: !!id && !!latest,
    refetchInterval: (q) =>
      q.state.data && ['hochgeladen', 'analyse'].includes(q.state.data.status) ? 1000 : false,
  });
  const questions = useQuery({
    queryKey: qk.questions(id ?? ''),
    queryFn: () => get<Question[]>(`/trainings/${id}/questions`),
    enabled: !!id,
  });
  const persons = useQuery({
    queryKey: qk.persons(),
    queryFn: () => get<Person[]>('/persons'),
    enabled: !!id && requested >= 3,
  });
  const units = useQuery({
    queryKey: qk.orgUnits,
    queryFn: () => get<OrgUnit[]>('/org-units'),
    enabled: !!id && requested >= 3,
  });

  const [change, setChange] = useSessionState<ChangeInfo>(
    latest ? `sn:aenderung:${latest.id}` : null,
    noChange,
  );
  const [audience, setAudience] = useSessionState<AudienceSelection>(
    id ? `sn:zielgruppe:${id}` : null,
    noAudience,
  );

  // E-51: Standard-Zielgruppe der Schulung einmal je Sitzung vorauswählen (eigene Auswahl hat Vorrang)
  const defaultUnits = training.data?.defaultOrgUnits;
  useEffect(() => {
    if (!id || !defaultUnits?.length) return;
    const flag = `sn:zielgruppe-vorbelegt:${id}`;
    try {
      if (sessionStorage.getItem(flag)) return;
      sessionStorage.setItem(flag, '1');
    } catch {
      return;
    }
    setAudience((a) => (a.personIds.length || a.orgUnitIds.length ? a : { personIds: [], orgUnitIds: defaultUnits }));
  }, [id, defaultUnits, setAudience]);

  const activeQuestions = questions.data?.filter((q) => q.active).length ?? 0;
  const v = version.data ?? null;
  const state = {
    training: training.data ? { id: training.data.id, quizRequired: training.data.quizRequired } : null,
    version: v ? { status: v.status, versionNo: v.versionNo, publishedAt: v.publishedAt } : null,
    hasPublished: !!training.data?.versions.some((x) => x.published_at),
    activeQuestions,
    changeKind: change.kind,
    selectedPersons: audience.personIds.length,
    selectedOrgUnits: audience.orgUnitIds.length,
  };
  const maxStep = maxReachableStep(state);
  const step: WizardStep = !id ? 1 : requested;
  const audienceCount = useMemo(
    () =>
      persons.data && units.data
        ? audiencePreview(persons.data, units.data, audience.personIds, audience.orgUnitIds).total
        : 0,
    [persons.data, units.data, audience],
  );

  const hrefFor = (s: WizardStep) =>
    id ? `/verwaltung/schulungen/${id}?schritt=${s}` : '/verwaltung/schulungen/neu';
  const go = (s: WizardStep) => {
    setParams({ schritt: String(s) });
    window.scrollTo({ top: 0 });
  };
  const goNext = async (from: WizardStep) => {
    if (from === 2 && rulesRef.current && !(await rulesRef.current.flush())) return;
    const next = (from + 1) as WizardStep;
    const blocker = stepBlocker(next, state);
    if (blocker) show(blocker, 'warn');
    else go(next);
  };

  const loading = !!id && (training.isPending || questions.isPending || (!!latest && version.isPending));
  const error = training.error ?? version.error ?? questions.error;
  const title = training.data?.titel ?? w.titleNew;
  const blockerHere = id && step > 1 ? stepBlocker(step, state) : null;

  const nav = (from: WizardStep, nextLabel?: string) => (
    <div className="flex flex-wrap justify-between gap-2.5">
      <Button variant="secondary" onClick={() => go((from - 1) as WizardStep)}>
        {adm.common.back}
      </Button>
      {nextLabel && <Button onClick={() => void goNext(from)}>{w.next(nextLabel)}</Button>}
    </div>
  );

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4 md:mb-6">
        <div className="min-w-0">
          <Link
            to="/verwaltung/schulungen"
            className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-pill px-2 text-[14px] font-semibold text-accent-text underline-offset-4 hover:underline"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            {w.backToTrainings}
          </Link>
          <h1 className="font-heading text-[24px] leading-tight font-bold text-ink md:text-[28px]">
            {title}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Stepper current={step} maxReachable={id ? maxStep : 1} hrefFor={hrefFor} />
          {id && (
            <Button asChild variant="secondary" size="sm">
              <Link to={`/verwaltung/schulungen/${id}/einstellungen`}>
                <Settings2 aria-hidden="true" className="size-4" />
                {ts.open}
              </Link>
            </Button>
          )}
        </div>
      </div>

      <NoticeRegion notice={notice} className="mb-4 empty:hidden" />

      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorPanel error={error} onRetry={() => void training.refetch()} />
      ) : blockerHere && step > maxStep ? (
        <Panel tone="warn" role="alert" className="flex flex-wrap items-center justify-between gap-3">
          {blockerHere}
          <Button variant="secondary" size="sm" onClick={() => go(maxStep)}>
            {w.steps[maxStep - 1]}
          </Button>
        </Panel>
      ) : step === 1 ? (
        <BasicsStep
          key={training.data?.id ?? 'neu'}
          training={training.data ?? null}
          onSaved={(newId) => {
            show(w.basics.saved);
            navigate(`/verwaltung/schulungen/${newId}?schritt=2`, { replace: !id });
          }}
        />
      ) : step === 2 && training.data ? (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
            <DocumentCard
              trainingId={training.data.id}
              version={v}
              previousVersionNo={v && v.versionNo >= 2 ? v.versionNo - 1 : null}
              floor={training.data.settings.floorSeconds}
              change={change}
              onChange={setChange}
              onUploaded={() => show(w.doc.analysing, 'accent')}
              onNotice={(m) => show(m)}
            />
            <div className="flex flex-col gap-4">
              <RulesPanel
                ref={rulesRef}
                training={training.data}
                activeQuestions={activeQuestions}
                onSaved={(m) => {
                  show(m);
                  void version.refetch();
                }}
              />
              <LanguageVersionsCard training={training.data} onNotice={(m) => show(m)} />
              {nav(2, w.steps[2])}
            </div>
          </div>
          <QuestionPool
            trainingId={training.data.id}
            questions={questions.data ?? []}
            quizCount={training.data.settings.quizQuestionCount}
            quizRequired={training.data.quizRequired}
            onNotice={(m) => show(m)}
          />
        </div>
      ) : step === 3 && training.data ? (
        persons.isPending || units.isPending ? (
          <Loading />
        ) : persons.isError || units.isError ? (
          <ErrorPanel error={persons.error ?? units.error} onRetry={() => void persons.refetch()} />
        ) : (
          <AudienceStep
            persons={persons.data}
            units={units.data}
            value={audience}
            onChange={setAudience}
            footer={nav(3, w.steps[3])}
          />
        )
      ) : step === 4 && training.data ? (
        persons.isPending ? (
          <Loading />
        ) : (
          <ReviewStep
            training={training.data}
            version={v}
            activeQuestions={activeQuestions}
            audience={audience}
            audienceCount={audienceCount}
            persons={persons.data ?? []}
            change={change}
            back={nav(4)}
          />
        )
      ) : null}
    </>
  );
}
