import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Check, ChevronLeft, Inbox, LayoutGrid, Menu, MessageSquare, Plus, TriangleAlert, X } from 'lucide-react';
import { de } from '@/i18n/de';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  Avatar,
  Button,
  Card,
  CheckboxField,
  EmptyState,
  Field,
  IconButton,
  Input,
  KpiTile,
  LinearProgress,
  Panel,
  PersonChip,
  ProgressRing,
  QuizOption,
  RingButton,
  SegmentProgress,
  SegmentedControl,
  Select,
  Sheet,
  SheetClose,
  StatusChip,
  StatusPill,
  Textarea,
} from '@/components/ui';

const g = de.dev.gallery;

function Section({ id, title, children, className }: { id: string; title: string; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="font-heading text-[19px] font-bold text-ink">
        {title}
      </h2>
      <Card className={cn('flex flex-col gap-5', className)}>{children}</Card>
    </section>
  );
}

function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-center gap-3', className)}>{children}</div>;
}

const swatches: { name: string; varName: string; dark?: boolean }[] = [
  { name: 'bg', varName: '--color-bg' },
  { name: 'surface', varName: '--color-surface' },
  { name: 'ink', varName: '--color-ink', dark: true },
  { name: 'ink-2', varName: '--color-ink-2', dark: true },
  { name: 'muted', varName: '--color-muted', dark: true },
  { name: 'line', varName: '--color-line' },
  { name: 'accent', varName: '--color-accent', dark: true },
  { name: 'accent-soft', varName: '--color-accent-soft' },
  { name: 'success', varName: '--color-success', dark: true },
  { name: 'success-soft', varName: '--color-success-soft' },
  { name: 'warn', varName: '--color-warn' },
  { name: 'warn-soft', varName: '--color-warn-soft' },
  { name: 'danger-soft', varName: '--color-danger-soft' },
  { name: 'disabled', varName: '--color-disabled' },
  { name: 'scan-bg', varName: '--color-scan-bg', dark: true },
];

export default function ComponentGallery() {
  const [mode, setMode] = useState<'einzel' | 'gruppe'>('gruppe');
  const [tab, setTab] = useState<'anwesenheit' | 'fragen' | 'kontrolle'>('anwesenheit');
  const [qr, setQr] = useState<'start' | 'ende'>('ende');
  const [people, setPeople] = useState<string[]>(g.persons.people);
  const [lastRemoved, setLastRemoved] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(true);
  const [anon, setAnon] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [askOpen, setAskOpen] = useState(false);

  const segs = [1, 1, 1, 1, 1, 1, 0.35, 0, 0, 0, 0, 0, 0, 0];

  return (
    <div className="min-h-dvh bg-bg">
      <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-8 px-4 py-6 md:px-7 md:py-8">
        <PageHeader
          eyebrow={g.eyebrow}
          title={g.title}
          description={g.intro}
          actions={
            <>
              <Button asChild variant="secondary" size="sm">
                <Link to="/dev/layout-admin">{de.nav.dashboard}</Link>
              </Button>
              <Button asChild variant="secondary" size="sm">
                <Link to="/dev/layout-teilnehmer">{de.dev.participantDemo.title}</Link>
              </Button>
            </>
          }
        />

        {/* Farben */}
        <Section id="farben" title={g.sections.tokens}>
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            {swatches.map((s) => (
              <li key={s.name} className="flex flex-col gap-1.5">
                <span
                  aria-hidden="true"
                  className="h-14 rounded-input shadow-[inset_0_0_0_1px_rgba(29,36,51,0.06)]"
                  style={{ background: `var(${s.varName})` }}
                />
                <span className="text-[12.5px] font-medium text-ink-2">{s.name}</span>
              </li>
            ))}
          </ul>
        </Section>

        {/* Typografie */}
        <Section id="typografie" title={g.sections.typography}>
          <div className="flex flex-col gap-3">
            <p className="font-heading text-[28px] leading-tight font-bold tracking-[-0.01em]">{g.typo.h1}</p>
            <p className="font-heading text-[20px] font-bold tracking-[-0.01em]">{g.typo.h2}</p>
            <p className="font-heading text-[17px] font-semibold tracking-[-0.01em]">{g.typo.h3}</p>
            <p className="max-w-2xl text-[15.5px] leading-[1.65] text-ink-2 md:text-[17px]">{g.typo.body}</p>
            <p className="text-[13px] text-muted">{g.typo.small}</p>
            <p className="font-heading text-[22px] font-bold tabular-nums">{g.typo.numbers}</p>
          </div>
        </Section>

        {/* Buttons */}
        <Section id="buttons" title={g.sections.buttons}>
          <Row>
            <Button variant="primary">{g.buttons.primary}</Button>
            <Button variant="secondary">{g.buttons.secondary}</Button>
            <Button variant="tonal">{g.buttons.tonal}</Button>
            <Button variant="soft">{g.buttons.soft}</Button>
            <Button variant="ghost">{g.buttons.ghost}</Button>
          </Row>
          <Row>
            <Button variant="dark">{g.buttons.dark}</Button>
            <Button variant="success">{g.buttons.success}</Button>
            <Button variant="danger-soft">{g.buttons.dangerSoft}</Button>
            <Button disabled>{g.buttons.disabled}</Button>
          </Row>
          <Row>
            <Button size="sm">{g.buttons.sizeSm}</Button>
            <Button size="md">{g.buttons.sizeMd}</Button>
            <Button size="lg">{g.buttons.sizeLg}</Button>
            <Button>
              <Plus aria-hidden="true" className="size-[18px]" />
              {g.buttons.withIcon}
            </Button>
            <Button asChild variant="secondary">
              <Link to="/anmelden">{g.buttons.asLink}</Link>
            </Button>
          </Row>
          <div className="flex max-w-[420px] flex-col gap-2.5">
            <Button size="lg" fullWidth>
              {g.buttons.disabled}
            </Button>
            <Button size="lg" fullWidth disabled>
              {g.buttons.disabled}
            </Button>
          </div>
        </Section>

        {/* Icon-Buttons */}
        <Section id="icon-buttons" title={g.sections.iconButtons}>
          <Row>
            <IconButton aria-label={g.iconButtons.back}>
              <ChevronLeft aria-hidden="true" />
            </IconButton>
            <IconButton aria-label={g.iconButtons.close} variant="tonal">
              <X aria-hidden="true" />
            </IconButton>
            <IconButton aria-label={g.iconButtons.add} variant="soft">
              <Plus aria-hidden="true" />
            </IconButton>
            <IconButton aria-label={g.iconButtons.menu} variant="ghost">
              <Menu aria-hidden="true" />
            </IconButton>
            <IconButton aria-label={g.iconButtons.add} variant="primary" size="md">
              <Plus aria-hidden="true" />
            </IconButton>
            <IconButton aria-label={g.iconButtons.add} variant="surface" size="lg">
              <Plus aria-hidden="true" />
            </IconButton>
            <IconButton aria-label={g.iconButtons.close} disabled>
              <X aria-hidden="true" />
            </IconButton>
          </Row>
        </Section>

        {/* Karten und Panels */}
        <section aria-labelledby="karten" className="flex flex-col gap-3">
          <h2 id="karten" className="font-heading text-[19px] font-bold text-ink">
            {g.sections.cards}
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <h3 className="font-heading text-[17px] font-bold">{g.cards.cardTitle}</h3>
              <p className="mt-1.5 text-[14px] text-muted">{g.cards.cardText}</p>
            </Card>
            <Card elevation="float" radius="lg">
              <h3 className="font-heading text-[17px] font-bold">{g.cards.floatTitle}</h3>
              <p className="mt-1.5 text-[14px] text-muted">{g.cards.floatText}</p>
            </Card>
          </div>
          <Card className="grid gap-3 md:grid-cols-2">
            <Panel tone="neutral">{g.cards.panelNeutral}</Panel>
            <Panel tone="accent">{g.cards.panelAccent}</Panel>
            <Panel tone="success">{g.cards.panelSuccess}</Panel>
            <Panel tone="warn" className="flex items-start gap-3">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 fill-warn text-warn-text" strokeWidth={2} />
              {g.cards.panelWarn}
            </Panel>
            <Panel tone="danger" className="md:col-span-2">
              {g.cards.panelDanger}
            </Panel>
          </Card>
        </section>

        {/* Status-Chips + Pillen */}
        <div className="grid gap-8 md:grid-cols-2">
          <Section id="status-chips" title={g.sections.chips}>
            <Row className="gap-2">
              <StatusChip tone="success">{g.chips.done}</StatusChip>
              <StatusChip tone="success">{g.chips.present}</StatusChip>
              <StatusChip tone="info">{g.chips.running}</StatusChip>
              <StatusChip tone="info">{g.chips.open}</StatusChip>
              <StatusChip tone="warn">{g.chips.review}</StatusChip>
              <StatusChip tone="warn">{g.chips.partial}</StatusChip>
              <StatusChip tone="danger">{g.chips.expired}</StatusChip>
              <StatusChip tone="danger">{g.chips.overdue}</StatusChip>
              <StatusChip tone="neutral">{g.chips.neutral}</StatusChip>
            </Row>
            <Row className="gap-2">
              <StatusChip tone="success" size="md">
                {g.chips.done}
              </StatusChip>
              <StatusChip tone="info" size="md">
                {g.chips.running}
              </StatusChip>
              <StatusChip tone="warn" size="md">
                {g.chips.review}
              </StatusChip>
            </Row>
          </Section>
          <section aria-labelledby="status-pillen" className="flex flex-col gap-3">
            <h2 id="status-pillen" className="font-heading text-[19px] font-bold text-ink">
              {g.sections.pills}
            </h2>
            <div className="flex flex-col items-start gap-3 rounded-card bg-neutral-soft p-5">
              <StatusPill tone="accent" pulse>
                {g.pills.capturing}
              </StatusPill>
              <StatusPill tone="accent">{g.pills.capturingCountdown}</StatusPill>
              <StatusPill tone="muted">{g.pills.paused}</StatusPill>
              <StatusPill tone="success">{g.pills.passed}</StatusPill>
              <StatusPill tone="danger">{g.pills.failed}</StatusPill>
              <StatusPill tone="success" appearance="soft" pulse>
                {g.pills.running}
              </StatusPill>
            </div>
          </section>
        </div>

        {/* Segment-Umschalter */}
        <Section id="segment" title={g.sections.segmented}>
          <SegmentedControl
            aria-label={g.segmented.groupLabel}
            value={mode}
            onValueChange={setMode}
            options={[
              { value: 'einzel', label: g.segmented.single },
              { value: 'gruppe', label: g.segmented.group },
            ]}
          />
          <SegmentedControl
            aria-label={g.segmented.tabsLabel}
            value={tab}
            onValueChange={setTab}
            options={[
              { value: 'anwesenheit', label: g.segmented.attendance, count: 8 },
              { value: 'fragen', label: g.segmented.questions, count: 3 },
              { value: 'kontrolle', label: g.segmented.checks, count: g.segmented.live, countTone: 'live' },
            ]}
          />
          <div className="max-w-[440px]">
            <SegmentedControl
              aria-label={g.segmented.qrLabel}
              fullWidth
              size="sm"
              value={qr}
              onValueChange={setQr}
              options={[
                { value: 'start', label: g.segmented.startQr },
                { value: 'ende', label: g.segmented.endQr },
              ]}
            />
          </div>
        </Section>

        {/* Personen */}
        <Section id="personen" title={g.sections.persons}>
          <Row className="gap-2.5">
            {people.map((p) => (
              <PersonChip
                key={p}
                name={p}
                onRemove={() => {
                  setPeople((list) => list.filter((x) => x !== p));
                  setLastRemoved(p);
                }}
              />
            ))}
            <PersonChip name={g.persons.readonlyPerson} />
            {people.length < g.persons.people.length && (
              <Button variant="ghost" size="sm" onClick={() => setPeople(g.persons.people)}>
                {g.persons.reset}
              </Button>
            )}
          </Row>
          <p role="status" className="min-h-5 text-[13px] text-muted">
            {lastRemoved ? g.persons.removed(lastRemoved) : ''}
          </p>
          <Row>
            <Avatar name={g.persons.avatars[0]!} size="sm" labelled />
            <Avatar name={g.persons.avatars[1]!} size="md" labelled />
            <Avatar name={g.persons.avatars[2]!} size="lg" tone="success" labelled />
            <Avatar name={g.persons.avatars[3]!} size="xl" tone="neutral" labelled />
          </Row>
        </Section>

        {/* Formulare */}
        <Section id="formulare" title={g.sections.forms}>
          <Field label={g.forms.assignment}>
            <Select defaultValue={g.forms.assignmentOptions[0]}>
              {g.forms.assignmentOptions.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={g.forms.provider}>
              <Input defaultValue={g.forms.providerValue} />
            </Field>
            <Field label={g.forms.place}>
              <Input placeholder={g.forms.placePlaceholder} />
            </Field>
            <Field label={g.forms.date}>
              <Input type="date" defaultValue="2026-12-04" />
            </Field>
            <Field label={g.forms.scope} hint={g.forms.scopeHint} error={g.forms.scopeError}>
              <Input inputMode="decimal" />
            </Field>
          </div>
          <Field label={g.forms.note} hint={g.forms.scopeHint}>
            <Textarea placeholder={g.forms.notePlaceholder} rows={3} />
          </Field>
          <div className="rounded-card bg-bg p-4 md:p-5">
            <Field label={g.forms.password}>
              <Input type="password" tone="surface" size="lg" defaultValue="geheim1" />
            </Field>
          </div>
          <div className="flex flex-col gap-4">
            <CheckboxField label={g.forms.confirm} checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} />
            <CheckboxField label={g.forms.anonymous} checked={anon} onCheckedChange={(v) => setAnon(v === true)} />
            <CheckboxField label={g.forms.disabledCheckbox} disabled />
          </div>
        </Section>

        {/* Fortschritt */}
        <Section id="fortschritt" title={g.sections.progress}>
          <div className="flex flex-col gap-2">
            <SegmentProgress segments={segs} current={6} />
            <p className="text-[13px] text-muted">{de.progress.pagesCaptured(6, 14)}</p>
          </div>
          <Row className="gap-5">
            <ProgressRing value={0.43} size={44} tone="success" label={g.progress.ringLabel} fill="var(--color-surface)">
              <span className="text-[11px] font-bold text-ink">{de.progress.percent(43)}</span>
            </ProgressRing>
            <div className="flex flex-col items-center gap-1">
              <ProgressRing value={1} size={50} tone="success" label={g.progress.chapterBasis}>
                <Check aria-hidden="true" className="size-5 text-success" strokeWidth={2.75} />
              </ProgressRing>
              <span className="text-[12px] font-semibold text-success-text">{g.progress.chapterBasis}</span>
            </div>
            <div className="flex flex-col items-center gap-1 rounded-[22px] bg-accent-soft px-3 py-2">
              <ProgressRing value={0.6} size={50} label={g.progress.chapterStrom}>
                <span className="font-heading text-[17px] font-bold text-accent-text">2</span>
              </ProgressRing>
              <span className="text-[12px] font-semibold text-accent-text">{g.progress.chapterStrom}</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <ProgressRing value={0} size={50} label={g.progress.chapterBrand}>
                <span className="font-heading text-[17px] font-bold text-muted">3</span>
              </ProgressRing>
              <span className="text-[12px] font-medium text-muted">{g.progress.chapterBrand}</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <ProgressRing value={0} size={50} label={g.progress.chapterNotfall}>
                <span className="font-heading text-[17px] font-bold text-muted">4</span>
              </ProgressRing>
              <span className="text-[12px] font-medium text-muted">{g.progress.chapterNotfall}</span>
            </div>
          </Row>
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-muted">{g.progress.ringButtonStates}</p>
            <div className="flex flex-wrap items-center gap-5 rounded-card bg-bg p-5">
              <RingButton state="counting" progress={0.62} seconds={5} />
              <RingButton state="ready" />
              <RingButton state="quiz" />
              <RingButton state="done" />
              <RingButton state="counting" progress={0.3} seconds={8} size="desktop" />
            </div>
          </div>
          <div className="grid max-w-[520px] gap-3">
            <LinearProgress value={41 / 48} label={de.dev.adminDemo.progressOf(de.dev.adminDemo.trainings[0]!.title)} />
            <LinearProgress value={18 / 22} tone="danger" label={de.dev.adminDemo.progressOf(de.dev.adminDemo.trainings[1]!.title)} />
            <LinearProgress value={1} tone="success" label={de.dev.adminDemo.progressOf(de.dev.adminDemo.trainings[2]!.title)} />
            <LinearProgress value={52 / 64} tone="warn" label={de.dev.adminDemo.progressOf(de.dev.adminDemo.trainings[3]!.title)} />
          </div>
        </Section>

        {/* Quiz */}
        <section aria-labelledby="quiz" className="flex flex-col gap-3">
          <h2 id="quiz" className="font-heading text-[19px] font-bold text-ink">
            {g.sections.quiz}
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="flex flex-col gap-2.5">
              <h3 className="mb-1 font-heading text-[17px] font-bold">{g.quiz.question}</h3>
              {g.quiz.options.map((o, i) => {
                const answered = picked !== null;
                const state = !answered ? 'idle' : i === 1 ? 'correct' : i === picked ? 'wrong' : 'dimmed';
                return (
                  <QuizOption key={o} state={state} picked={i === picked} onClick={() => setPicked(i)}>
                    {o}
                  </QuizOption>
                );
              })}
              {picked !== null && (
                <>
                  <Panel tone="accent" className="mt-1">
                    {g.quiz.explanation}
                  </Panel>
                  <Button variant="ghost" size="sm" className="self-start" onClick={() => setPicked(null)}>
                    {g.persons.reset}
                  </Button>
                </>
              )}
            </Card>
            <Card className="flex flex-col gap-2.5">
              <p className="mb-1 text-[13px] text-muted">{g.quiz.states}</p>
              <QuizOption state="idle">{g.quiz.options[0]}</QuizOption>
              <QuizOption state="selected">{g.quiz.options[1]}</QuizOption>
              <QuizOption state="correct" picked>
                {g.quiz.options[1]}
              </QuizOption>
              <QuizOption state="wrong">{g.quiz.options[2]}</QuizOption>
              <QuizOption state="dimmed">{g.quiz.options[3]}</QuizOption>
            </Card>
          </div>
        </section>

        {/* Sheet */}
        <Section id="sheet" title={g.sections.sheet}>
          <Row>
            <Sheet
              title={g.sheet.title}
              description={g.sheet.description}
              trigger={
                <Button variant="tonal">
                  <LayoutGrid aria-hidden="true" className="size-[18px]" />
                  {g.sheet.open}
                </Button>
              }
            >
              <ol className="flex flex-col gap-1.5">
                {g.sheet.chapters.map((c, i) => (
                  <li
                    key={c}
                    className={cn(
                      'rounded-input px-4 py-3 text-[15px]',
                      i === 1 ? 'bg-accent-soft font-semibold text-accent-text-strong' : 'bg-bg text-ink-2',
                    )}
                  >
                    {c}
                  </li>
                ))}
              </ol>
            </Sheet>
            <Sheet
              open={askOpen}
              onOpenChange={setAskOpen}
              title={g.sheet.askTitle}
              trigger={
                <Button variant="secondary">
                  <MessageSquare aria-hidden="true" className="size-[18px]" />
                  {g.sheet.askOpen}
                </Button>
              }
              footer={
                <>
                  <SheetClose asChild>
                    <Button variant="tonal" size="lg" className="md:h-12 md:text-[14.5px]">
                      {de.common.cancel}
                    </Button>
                  </SheetClose>
                  <Button size="lg" className="md:h-12 md:text-[14.5px]" onClick={() => setAskOpen(false)}>
                    {g.sheet.askSend}
                  </Button>
                </>
              }
            >
              <Field label={g.sheet.askLabel}>
                <Textarea placeholder={g.sheet.askPlaceholder} rows={4} />
              </Field>
              <CheckboxField label={g.forms.anonymous} className="mt-4" />
            </Sheet>
          </Row>
        </Section>

        {/* KPI */}
        <section aria-labelledby="kpi" className="flex flex-col gap-3">
          <h2 id="kpi" className="font-heading text-[19px] font-bold text-ink">
            {g.sections.kpi}
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiTile label={g.kpi.quota} value={g.kpi.quotaValue}>
              <LinearProgress value={0.87} label={g.kpi.quota} className="mt-1" />
            </KpiTile>
            <KpiTile label={g.kpi.overdue} value="6" tone="danger" hint={g.kpi.overdueHint} />
            <KpiTile label={g.kpi.expiring} value="14" tone="warn" hint={g.kpi.expiringHint} />
            <KpiTile label={g.kpi.invites} value="23" hint={g.kpi.invitesHint} />
          </div>
        </section>

        {/* Leerer Zustand */}
        <Section id="leer" title={g.sections.empty}>
          <EmptyState
            icon={<Inbox />}
            title={g.empty.title}
            description={g.empty.text}
            action={
              <Button>
                <Plus aria-hidden="true" className="size-[18px]" />
                {g.empty.action}
              </Button>
            }
          />
        </Section>
      </main>
    </div>
  );
}
