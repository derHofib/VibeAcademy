import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Download, ShieldCheck, TriangleAlert } from 'lucide-react';
import { get, post } from '@/lib/api';
import { adm } from '@/i18n/admin';
import { cn } from '@/lib/cn';
import {
  Avatar,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Panel,
  StatusChip,
} from '@/components/ui';
import { IconButton } from '@/components/ui/icon-button';
import { ChevronLeft } from 'lucide-react';
import { useMediaQuery, DESKTOP_QUERY } from '@/hooks/useMediaQuery';
import {
  qk,
  type AuditEntry,
  type AuditVerify,
  type InvitationReport,
  type ReportPage,
} from '@/features/admin/api';
import {
  formatClock,
  formatDate,
  formatShortDateTime,
  invitationChip,
  sessionsSummary,
  shortHash,
} from '@/features/admin/format';
import {
  ConfirmSheet,
  CopyButton,
  ErrorPanel,
  Loading,
  NoticeRegion,
  StatBox,
  errorMessage,
  useNotice,
} from '@/features/admin/components/common';
import { canManage } from '@/features/auth/session';
import { useAdminMe } from '@/features/admin/hooks';

const t = adm.report;

/** Balken „Verweildauer gegen Soll“: Länge relativ zum größten Wert der Tabelle, Strich = Soll. */
export function barGeometry(p: Pick<ReportPage, 'ist_ms' | 'soll_ms'>, scaleMs: number) {
  const scale = Math.max(1, scaleMs);
  return { ist: Math.min(100, (p.ist_ms / scale) * 100), soll: Math.min(100, (p.soll_ms / scale) * 100) };
}

function pageState(p: ReportPage): { label: string; tone: 'success' | 'warn' | 'muted' } {
  if (p.fulfilled_at) return { label: t.fulfilled, tone: 'success' };
  if (p.ist_ms > 0 || p.first_seen_at) return { label: t.partial, tone: 'warn' };
  return { label: t.notSeen, tone: 'muted' };
}

function Bar({ p, scale }: { p: ReportPage; scale: number }) {
  const g = barGeometry(p, scale);
  return (
    <div
      role="img"
      aria-label={t.barLabel(p.page_no, formatClock(p.ist_ms), formatClock(p.soll_ms))}
      className="relative h-2 rounded-full bg-line"
    >
      <div
        className={cn(
          'absolute inset-y-0 left-0 rounded-full',
          p.fulfilled_at ? 'bg-accent' : 'bg-warn-strong',
        )}
        style={{ width: `${g.ist}%` }}
      />
      <div
        className="absolute -top-1.5 h-5 w-0.5 rounded bg-ink"
        style={{ left: `calc(${g.soll}% - 1px)` }}
      />
    </div>
  );
}

function PageState({ p }: { p: ReportPage }) {
  const st = pageState(p);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[13.5px] font-semibold whitespace-nowrap',
        st.tone === 'success' ? 'text-success-text' : st.tone === 'warn' ? 'text-warn-strong' : 'text-muted',
      )}
    >
      {st.tone === 'success' && <Check aria-hidden="true" className="size-4" />}
      {st.label}
    </span>
  );
}

function PageProtocol({ pages }: { pages: ReportPage[] }) {
  const wide = useMediaQuery(DESKTOP_QUERY);
  const scale = Math.max(...pages.map((p) => Math.max(p.ist_ms, p.soll_ms * 1.6)), 1);
  return (
    <Card padding="none" className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 md:px-6">
        <CardTitle>{t.protocol}</CardTitle>
        <div aria-hidden="true" className="flex items-center gap-4 text-[13px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-5 rounded-full bg-accent" />
            {t.legendIst}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3.5 w-0.5 rounded bg-ink" />
            {t.legendSoll}
          </span>
        </div>
      </div>
      {!wide ? (
        <ol aria-label={t.protocol} className="flex flex-col gap-1.5 px-3 pt-3 pb-4">
          {pages.map((p) => (
            <li key={p.page_no} className="flex flex-col gap-2 rounded-input bg-bg px-3.5 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[14.5px] font-semibold text-ink">
                  {t.colPage} {p.page_no}
                </span>
                <PageState p={p} />
              </div>
              <Bar p={p} scale={scale} />
              <p className="flex justify-between gap-3 text-[13px] text-muted tabular-nums">
                <span>
                  {formatClock(p.ist_ms)} / {formatClock(p.soll_ms)}
                </span>
                <span>{formatShortDateTime(p.first_seen_at)}</span>
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <div className="px-3 pt-3 pb-4 md:px-4">
          <table className="w-full border-separate border-spacing-y-0 text-left text-[14px]">
            <caption className="sr-only">{t.protocol}</caption>
            <thead>
              <tr className="text-[12.5px] text-muted">
                <th scope="col" className="px-2 py-2 font-semibold md:px-3">
                  {t.colPage}
                </th>
                <th scope="col" className="px-2 py-2 font-semibold md:px-3">
                  {t.colSeen}
                </th>
                <th scope="col" className="w-[38%] px-2 py-2 font-semibold md:px-3">
                  {t.colBar}
                </th>
                <th scope="col" className="px-2 py-2 font-semibold md:px-3">
                  {t.colIstSoll}
                </th>
                <th scope="col" className="px-2 py-2 font-semibold md:px-3">
                  {t.colStatus}
                </th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => {
                const ist = formatClock(p.ist_ms);
                const soll = formatClock(p.soll_ms);
                return (
                  <tr key={p.page_no} className="odd:bg-bg/60">
                    <td className="rounded-l-input px-2 py-2.5 font-semibold text-ink tabular-nums md:px-3">
                      {p.page_no}
                    </td>
                    <td className="px-2 py-2.5 text-ink-2 tabular-nums md:px-3">
                      {formatShortDateTime(p.first_seen_at)}
                    </td>
                    <td className="px-2 py-2.5 md:px-3">
                      <Bar p={p} scale={scale} />
                    </td>
                    <td className="px-2 py-2.5 whitespace-nowrap text-ink-2 tabular-nums md:px-3">
                      {ist} / {soll}
                    </td>
                    <td className="rounded-r-input px-2 py-2.5 md:px-3">
                      <PageState p={p} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function eventLabel(e: AuditEntry): { title: string; detail: string | null; dot: string } {
  const key = `${e.entity}:${e.action}`;
  const title = t.events[key] ?? `${e.entity} · ${e.action}`;
  const p = e.payload ?? {};
  let detail: string | null = null;
  if (e.entity === 'quiz_attempt' && p.scorePct !== undefined)
    detail = `${t.eventScore(p.scorePct)} · ${t.eventAttempt(p.attemptNo)}`;
  else if (e.entity === 'quiz_attempt' && p.attemptNo !== undefined) detail = t.eventAttempt(p.attemptNo);
  else if (e.entity === 'evidence' && typeof p.nachweisNr === 'string') detail = p.nachweisNr;
  const dot =
    e.action === 'failed'
      ? 'bg-warn'
      : ['signed', 'passed', 'created'].includes(e.action) && e.entity !== 'read_session'
        ? 'bg-success'
        : e.entity === 'read_session' || e.action === 'reading_completed'
          ? 'bg-accent'
          : 'bg-control';
  return { title, detail, dot };
}

function AuditTrail({ entries }: { entries: AuditEntry[] }) {
  const verify = useMutation({ mutationFn: () => get<AuditVerify>('/audit/verify') });
  const list = [...entries].reverse();
  return (
    <Card>
      <CardHeader className="mb-2">
        <div>
          <CardTitle>{t.audit}</CardTitle>
          <div aria-live="polite">
            {verify.data && (
              <CardDescription
                className={cn(
                  'mt-0.5 flex items-center gap-1.5',
                  verify.data.ok ? 'text-success-text' : 'text-danger-text',
                )}
              >
                {verify.data.ok ? (
                  <ShieldCheck aria-hidden="true" className="size-4" />
                ) : (
                  <TriangleAlert aria-hidden="true" className="size-4" />
                )}
                {verify.data.ok ? t.auditOk(verify.data.checked) : t.auditBad(verify.data.firstBadSeq)}
              </CardDescription>
            )}
            {verify.isError && (
              <CardDescription className="text-danger-text">{errorMessage(verify.error)}</CardDescription>
            )}
          </div>
        </div>
        <Button variant="tonal" size="sm" onClick={() => verify.mutate()} disabled={verify.isPending}>
          {verify.isPending ? t.auditVerifying : t.auditVerify}
        </Button>
      </CardHeader>
      {list.length === 0 ? (
        <p className="text-[14px] text-muted">{t.auditEmpty}</p>
      ) : (
        <ol className="flex flex-col">
          {list.map((e, i) => {
            const l = eventLabel(e);
            return (
              <li key={`${e.ts}-${i}`} className="flex gap-3 border-b border-line py-3 last:border-b-0">
                <span aria-hidden="true" className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', l.dot)} />
                <div className="min-w-0">
                  <p className="text-[14.5px] font-semibold text-ink">{l.title}</p>
                  <p className="text-[13px] text-muted tabular-nums">
                    {formatShortDateTime(e.ts)}
                    {l.detail ? ` · ${l.detail}` : ''}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <Panel tone="neutral" className="mt-3 text-[13px]">
        {t.privacy}
      </Panel>
    </Card>
  );
}

/** Screen 3 – Lesenachweis je Teilnehmer (`/verwaltung/nachweise/:invitationId`). */
export default function EvidenceReportPage() {
  const { invitationId = '' } = useParams();
  const navigate = useNavigate();
  const me = useAdminMe();
  const manage = canManage(me);
  const qc = useQueryClient();
  const { notice, show } = useNotice();
  const [confirmLink, setConfirmLink] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const report = useQuery({
    queryKey: qk.report(invitationId),
    queryFn: () => get<InvitationReport>(`/invitations/${invitationId}/report`),
  });
  const remind = useMutation({
    mutationFn: () => post(`/invitations/${invitationId}/remind`),
    onSuccess: () => {
      show(adm.run.reminded(report.data?.person.name ?? ''));
      void qc.invalidateQueries({ queryKey: qk.report(invitationId) });
    },
    onError: (e) => show(errorMessage(e), 'danger'),
  });
  const newLink = useMutation({
    mutationFn: () => post<{ link: string }>(`/invitations/${invitationId}/link`),
    onSuccess: (r) => {
      setConfirmLink(false);
      setLink(r.link);
      void qc.invalidateQueries({ queryKey: qk.report(invitationId) });
    },
    onError: (e) => show(errorMessage(e), 'danger'),
  });

  if (report.isPending) return <Loading />;
  if (report.isError) return <ErrorPanel error={report.error} onRetry={() => report.refetch()} />;
  const r = report.data;
  const inv = r.invitation;
  const overdue =
    !!inv.dueAt && new Date(inv.dueAt) < new Date() && !['bestaetigt', 'befreit'].includes(inv.status);
  const chip = invitationChip(inv.status, overdue);
  const overall = overdue ? t.overall.ueberfaellig : (t.overall[inv.status] ?? chip.label);
  const lastAttempt = [...r.attempts].reverse().find((a) => a.submitted_at);
  const bestPassed = r.attempts.find((a) => a.passed);
  const quizValue = !r.training.quizRequired
    ? t.tileQuizOff
    : bestPassed
      ? t.tileQuizValue(bestPassed.score_pct ?? 0, bestPassed.attempt_no)
      : lastAttempt
        ? t.tileQuizValue(lastAttempt.score_pct ?? 0, lastAttempt.attempt_no)
        : t.tileQuizNone;
  const done = ['bestaetigt', 'befreit'].includes(inv.status);
  const evidenceReady = r.evidence?.status === 'erzeugt';

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4 md:mb-6">
        <div className="flex min-w-0 items-center gap-3.5">
          <IconButton aria-label={adm.common.back} onClick={() => navigate(-1)}>
            <ChevronLeft aria-hidden="true" />
          </IconButton>
          <Avatar name={r.person.name} size="xl" className="hidden sm:inline-flex" />
          <div className="min-w-0">
            <p className="text-[13px] text-muted">{t.eyebrow}</p>
            <h1 className="font-heading text-[24px] leading-tight font-bold text-ink md:text-[28px]">
              {r.person.name}
            </h1>
            <p className="text-[14px] text-muted">{t.meta(r.person.personalnr, r.person.orgUnit)}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {manage && !done && (
            <>
              <Button variant="secondary" onClick={() => remind.mutate()} disabled={remind.isPending}>
                {t.remind}
              </Button>
              <Button variant="secondary" onClick={() => setConfirmLink(true)}>
                {t.newLink}
              </Button>
            </>
          )}
          {r.evidence &&
            (evidenceReady ? (
              <Button asChild>
                <a href={`/api/evidence/${r.evidence.id}/pdf`} download>
                  <Download aria-hidden="true" className="size-[18px]" />
                  {t.openPdf}
                </a>
              </Button>
            ) : (
              <Button disabled>{t.pdfPending}</Button>
            ))}
        </div>
      </div>
      <NoticeRegion notice={notice} className="mb-4 empty:hidden" />
      {link && (
        <Panel tone="accent" className="mb-4 flex flex-wrap items-center gap-3" role="status">
          <div className="min-w-0 flex-1 basis-64">
            <p className="font-semibold">{adm.run.newLinkResult}</p>
            <p className="font-mono text-[12.5px] break-all">{link}</p>
          </div>
          <CopyButton text={link} variant="secondary" />
        </Panel>
      )}

      <Card className="mb-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-heading text-[17px] font-bold text-ink">
              {t.trainingTitle(r.training.titel, r.training.versionNo)}
            </h2>
            <p className="text-[13.5px] text-muted">
              {t.trainingMeta(shortHash(r.training.sha256), r.training.pageCount, formatDate(inv.dueAt))}
            </p>
          </div>
          <StatusChip
            tone={chip.tone}
            size="md"
            icon={inv.status === 'bestaetigt' ? <Check aria-hidden="true" /> : undefined}
          >
            {overall}
          </StatusChip>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatBox label={t.tileInvited} value={formatShortDateTime(inv.sentAt)} />
          <StatBox label={t.tileOpened} value={formatShortDateTime(inv.openedAt)} />
          <StatBox label={t.tileSessions} value={sessionsSummary(r.sessions)} />
          <StatBox
            label={t.tileTime}
            value={`${formatClock(r.summary.istMs)} / ${formatClock(r.summary.sollMs)} min`}
          />
          <StatBox label={t.tileQuiz} value={quizValue} />
          <StatBox
            label={t.tileSignature}
            value={r.signature ? formatShortDateTime(r.signature.signed_at) : t.tileSignatureNone}
          />
        </div>
        {!r.summary.plausibel && (
          <Panel tone="warn" role="note" className="mt-4 flex items-start gap-2.5">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-[18px] shrink-0 text-warn-strong" />
            {t.implausible}
          </Panel>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-5">
          <PageProtocol pages={r.pages} />
          <div className="grid gap-5 md:grid-cols-2">
            <Card>
              <CardTitle className="mb-3">{t.attempts}</CardTitle>
              {r.attempts.length === 0 ? (
                <p className="text-[14px] text-muted">
                  {r.training.quizRequired ? t.attemptsEmpty : t.tileQuizOff}
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {r.attempts.map((a) => (
                    <li
                      key={a.attempt_no}
                      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-input bg-bg px-4 py-2.5"
                    >
                      <span className="min-w-0">
                        <span className="block text-[14.5px] font-semibold text-ink">
                          {t.attempt(a.attempt_no)}
                        </span>
                        <span className="block text-[13px] text-muted tabular-nums">
                          {formatShortDateTime(a.submitted_at)}
                        </span>
                      </span>
                      <StatusChip tone={a.passed ? 'success' : a.submitted_at ? 'warn' : 'neutral'}>
                        {a.submitted_at
                          ? `${a.score_pct ?? 0} % · ${a.passed ? t.attemptPassed : t.attemptFailed}`
                          : t.attemptOpen}
                      </StatusChip>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardTitle className="mb-3">{t.signature}</CardTitle>
              {r.signature ? (
                <p className="text-[14.5px] text-ink-2">
                  {t.signatureAt(
                    formatShortDateTime(r.signature.signed_at),
                    t.authMethods[r.signature.auth_method] ?? r.signature.auth_method,
                  )}
                </p>
              ) : (
                <p className="text-[14px] text-muted">{t.signatureNone}</p>
              )}
              <CardTitle className="mt-5 mb-3">{t.evidence}</CardTitle>
              {r.evidence ? (
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[14px]">
                  <dt className="text-muted">{t.evidenceNr}</dt>
                  <dd className="font-semibold text-ink">{r.evidence.nachweis_nr ?? '—'}</dd>
                  <dt className="text-muted">{t.verifyCode}</dt>
                  <dd className="font-mono font-semibold text-ink">{r.evidence.verify_code ?? '—'}</dd>
                  <dt className="text-muted">{t.pdfHash}</dt>
                  <dd className="font-mono text-ink-2">{shortHash(r.evidence.pdf_sha256)}</dd>
                </dl>
              ) : (
                <p className="text-[14px] text-muted">{t.evidenceNone}</p>
              )}
            </Card>
          </div>
        </div>
        <AuditTrail entries={r.audit} />
      </div>

      <ConfirmSheet
        open={confirmLink}
        onOpenChange={setConfirmLink}
        title={adm.run.newLinkTitle(r.person.name)}
        description={adm.run.newLinkText}
        confirmLabel={adm.run.newLinkConfirm}
        pending={newLink.isPending}
        onConfirm={() => newLink.mutate()}
      />
    </>
  );
}
