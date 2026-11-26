import { useNavigate, useParams } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, Panel } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { tp, formatDayMonth } from '@/i18n/participant';
import { nextStep, participantPath, useInvitation, useProgress } from '@/features/participant/api';
import { neededCorrect } from '@/features/participant/quizLogic';
import { ErrorScreen, LoadingScreen } from '@/features/participant/ScreenStates';
import { contactLine, firstName, parseContact } from '@/features/participant/viewerModel';

/** Startbildschirm (5a): Umfang, Ablauf, was erfasst wird, Einstieg bzw. nächster Schritt. */
export default function StartPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const inv = useInvitation(id);
  const progress = useProgress(id);

  if (inv.isError) return <ErrorScreen message={inv.error.message} />;
  const s = inv.data;
  if (!s) return <LoadingScreen />;

  const minutes = Math.max(1, Math.ceil(s.totals.minReadingSeconds / 60));
  const hasQuiz = s.totals.questions > 0;
  const step = nextStep(s.status, hasQuiz);
  const done = progress.data?.pages.filter((p) => p.fulfilled).length ?? 0;
  const started = (progress.data?.pages.some((p) => p.dwellMs > 0 || p.fulfilled) ?? false) || s.status === 'gelesen';
  const contact = contactLine(parseContact(s.training.ansprechpartner));

  const cta =
    step === 'lesen'
      ? { label: started ? tp.start.cta.continue : tp.start.cta.start, to: participantPath.read(id) }
      : step === 'wissenscheck'
        ? { label: tp.start.cta.quiz, to: participantPath.quiz(id) }
        : step === 'abschluss'
          ? { label: tp.start.cta.sign, to: participantPath.sign(id) }
          : step === 'nachweis'
            ? { label: tp.start.cta.evidence, to: participantPath.sign(id) }
            : null;

  const steps = [
    { title: tp.start.stepRead, text: tp.start.stepReadText, done: !['offen', 'geoeffnet', 'ueberfaellig'].includes(s.status) },
    ...(hasQuiz
      ? [
          {
            title: tp.start.stepQuiz,
            text: tp.start.stepQuizText(neededCorrect(s.rules.passPct, s.totals.questions), s.totals.questions),
            done: ['bestanden', 'bestaetigt'].includes(s.status),
          },
        ]
      : []),
    { title: tp.start.stepSign, text: tp.start.stepSignText, done: s.status === 'bestaetigt' },
  ];

  return (
    <div className="min-h-dvh bg-bg">
      <div className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col px-3 pt-3 md:pt-10">
        <section className="flex flex-col gap-3.5 rounded-[28px] bg-[#E4EBFD] px-[22px] pt-[22px] pb-6">
          <div className="flex items-center justify-between gap-3">
            <span className="rounded-pill bg-surface px-3 py-1.5 text-[12px] font-semibold text-accent-text">
              {s.training.kategorie || tp.start.defaultCategory}
            </span>
            {s.dueAt && (
              <span className="rounded-pill bg-warn-soft px-3 py-1.5 text-[12px] font-semibold text-warn-text">{tp.start.due(formatDayMonth(s.dueAt))}</span>
            )}
          </div>
          <h1 className="font-heading text-[28px] leading-[1.2] font-bold tracking-[-0.01em] break-words text-ink [hyphens:manual]">
            {softHyphenate(s.training.titel)}
          </h1>
          <p className="text-[15px] leading-[1.55] text-ink-2">{tp.start.greeting(firstName(s.personName), minutes)}</p>
          <dl className={cn('grid gap-2', hasQuiz ? 'grid-cols-3' : 'grid-cols-2')}>
            <Kpi value={String(s.totals.pages)} label={tp.start.pages(s.totals.pages)} />
            <Kpi value={tp.start.minutesShort(minutes)} label={tp.start.readingTime} />
            {hasQuiz && <Kpi value={String(s.totals.questions)} label={tp.start.questions(s.totals.questions)} />}
          </dl>
        </section>

        <main className="flex flex-1 flex-col gap-3 pt-3.5 md:flex-none">
          <Card padding="none" className="rounded-[22px] px-[18px] pt-[18px] pb-2" aria-labelledby="ablauf-titel">
            <h2 id="ablauf-titel" className="mb-2 font-heading text-[16px] font-bold text-ink">
              {tp.start.stepsTitle}
            </h2>
            <ol>
              {steps.map((st, i) => (
                <li key={st.title} className="flex items-start gap-3.5 py-2">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex size-8 shrink-0 items-center justify-center rounded-[12px] text-[14px] font-bold',
                      st.done ? 'bg-success-soft text-success-text' : 'bg-accent-soft text-accent-text',
                    )}
                  >
                    {i + 1}
                  </span>
                  <div className="text-[14.5px] leading-[1.45]">
                    <strong className="font-semibold text-ink">{st.title}</strong>
                    {st.done && <span className="sr-only">{tp.sign.stepDone}</span>}
                    <br />
                    <span className="text-muted">{st.text}</span>
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          <section aria-label={tp.start.trackedLabel} className="flex items-start gap-3 rounded-[22px] bg-success-soft px-4 py-3.5">
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" className="shrink-0">
              <path d="M11 2.5l7 2.8v5.2c0 4.3-3 7.6-7 9-4-1.4-7-4.7-7-9V5.3z" fill="#FFFFFF" />
              <path d="M7.8 11l2.2 2.2 4.3-4.4" fill="none" stroke="#1E7A50" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="text-[13.5px] leading-[1.5] text-success-text-strong">
              <strong>{tp.start.trackedLabel}</strong> {tp.start.trackedText}
            </p>
          </section>

          {step === 'lesen' && done > 0 && progress.data && (
            <p className="px-1 text-center text-[13px] text-muted">{tp.start.progressNote(done, progress.data.pages.length)}</p>
          )}
          {step === 'befreit' && <Panel tone="success">{tp.start.exempt}</Panel>}
        </main>

        <footer className="sticky bottom-0 flex flex-col gap-2.5 bg-bg pt-3.5 pb-[max(22px,env(safe-area-inset-bottom))]">
          {cta && (
            <Button size="lg" fullWidth onClick={() => navigate(cta.to)}>
              {cta.label}
              <ArrowRight aria-hidden="true" className="size-[18px]" strokeWidth={2.25} />
            </Button>
          )}
          {contact && <p className="text-center text-[13px] text-muted">{tp.start.contact(contact)}</p>}
        </footer>
      </div>
    </div>
  );
}

/** Weiche Trennstellen vor häufigen Wortbestandteilen langer Titel („Sicherheits-unterweisung“, wie im Mockup). */
function softHyphenate(title: string): string {
  return title.replace(/(\p{L}{4,}?)(unterweisung|schulung|belehrung|prüfung|schutz)/giu, '$1\u00AD$2');
}

function Kpi({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col-reverse rounded-[16px] bg-surface px-3 py-2.5">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="font-heading text-[18px] font-bold text-ink tabular-nums">{value}</dd>
    </div>
  );
}
