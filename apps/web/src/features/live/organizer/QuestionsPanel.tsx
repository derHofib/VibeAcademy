import { Triangle } from 'lucide-react';
import { Button, StatusChip } from '@/components/ui';
import { cn } from '@/lib/cn';
import { tl } from '@/i18n/live';
import type { OrganizerQuestion } from '../api';
import { hm } from '../time';
import { sortQuestions } from './model';
import type { useOrganizerActions } from './useOrganizerLive';

const tq = tl.org.questions;

/** Reiter „Fragen“ (12e): nach Unterstützung sortiert, „Per Mail“ / „Beantwortet“. */
export function QuestionsPanel({
  questions,
  actions,
  onNotice,
}: {
  questions: OrganizerQuestion[];
  actions: ReturnType<typeof useOrganizerActions>;
  onNotice: (text: string, tone?: 'success' | 'danger') => void;
}) {
  const list = sortQuestions(questions);
  const set = async (id: string, status: OrganizerQuestion['status']) => {
    try {
      await actions.questionStatus.mutateAsync({ id, status });
    } catch (e) {
      onNotice((e as Error).message, 'danger');
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[14px] text-muted">{tq.intro}</p>
      {list.length === 0 ? (
        <p className="rounded-box bg-bg px-4 py-6 text-center text-[14px] text-muted">{tq.empty}</p>
      ) : (
        <ul aria-label={tq.listLabel} className="flex flex-col gap-2.5">
          {list.map((q) => {
            const open = q.status === 'offen';
            return (
              <li
                key={q.id}
                className={cn('flex items-center gap-4 rounded-[22px] px-3.5 py-3', open ? 'bg-[#F1F5FE]' : 'bg-[#F8F9FC]')}
                data-testid="org-question"
              >
                <span
                  className="flex h-[52px] w-[50px] shrink-0 flex-col items-center justify-center rounded-[14px] bg-surface text-accent-text"
                  aria-label={tq.votes(q.votes)}
                  role="img"
                >
                  <Triangle aria-hidden="true" className="size-2.5 fill-current" strokeWidth={0} />
                  <span aria-hidden="true" className="font-heading text-[16px] leading-tight font-bold tabular-nums">
                    {q.votes}
                  </span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn('text-[15.5px] leading-snug break-words', open ? 'text-ink' : 'text-muted')}>{q.text}</p>
                  <p className="mt-0.5 text-[13px] text-muted">
                    {q.author ?? tq.anonymous} · {hm(q.createdAt)}
                  </p>
                </div>
                {open ? (
                  <div className="flex shrink-0 gap-2">
                    <Button variant="secondary" size="sm" disabled={actions.questionStatus.isPending} onClick={() => void set(q.id, 'per_mail')}>
                      {tq.perMail}
                    </Button>
                    <Button size="sm" disabled={actions.questionStatus.isPending} onClick={() => void set(q.id, 'beantwortet')}>
                      {tq.answered}
                    </Button>
                  </div>
                ) : (
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusChip tone="success" size="md">
                      {q.status === 'per_mail' ? tq.statusMail : tq.statusAnswered}
                    </StatusChip>
                    <Button variant="ghost" size="sm" className="text-[13px]" onClick={() => void set(q.id, 'offen')}>
                      {tq.reopen}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
