import { Download, Plus } from 'lucide-react';
import { de } from '@/i18n/de';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, Card, CardHeader, CardTitle, KpiTile, LinearProgress, StatusChip, type StatusTone } from '@/components/ui';

const d = de.dev.adminDemo;
const k = de.dev.gallery.kpi;

const progressTone = (tone: string) =>
  tone === 'danger' ? 'danger' : tone === 'success' ? 'success' : tone === 'warn' ? 'warn' : 'accent';

/** Demo des Verwaltungsrahmens mit Dashboard-Inhalt (Screen 1, im weichen Stil). */
export default function AdminLayoutDemo() {
  return (
    <AdminLayout externalCount={3} tenantName={d.tenant} userName={d.user} currentPath="/">
      <PageHeader
        title={d.title}
        description={d.subtitle}
        actions={
          <>
            <Button variant="secondary">
              <Download aria-hidden="true" className="size-[18px]" />
              {d.export}
            </Button>
            <Button>
              <Plus aria-hidden="true" className="size-[18px]" />
              {d.newTraining}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile label={k.quota} value={k.quotaValue}>
          <LinearProgress value={0.87} label={k.quota} className="mt-1" />
        </KpiTile>
        <KpiTile label={k.overdue} value="6" tone="danger" hint={k.overdueHint} />
        <KpiTile label={k.expiring} value="14" tone="warn" hint={k.expiringHint} />
        <KpiTile label={k.invites} value="23" hint={k.invitesHint} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle>{d.running}</CardTitle>
          </CardHeader>
          <ul className="flex flex-col gap-2">
            {d.trainings.map((t) => (
              <li
                key={t.title}
                className="grid grid-cols-2 items-center gap-x-5 gap-y-2.5 rounded-box bg-bg px-4 py-3.5 md:grid-cols-[minmax(0,2.4fr)_minmax(120px,1fr)_92px_128px]"
              >
                <div className="col-span-2 min-w-0 md:col-span-1">
                  <p className="text-[15px] leading-snug font-semibold text-ink">{t.title}</p>
                  <p className="text-[13px] text-muted">{t.meta}</p>
                </div>
                <div className="col-span-2 flex items-center gap-3 md:col-span-1">
                  <LinearProgress value={t.done / t.total} tone={progressTone(t.tone)} label={d.progressOf(t.title)} />
                  <span className="shrink-0 text-[13px] text-ink-2 tabular-nums">
                    {t.done} / {t.total}
                  </span>
                </div>
                <span className="text-[14px] text-ink-2 tabular-nums">{t.due}</span>
                <span className="justify-self-end md:justify-self-start">
                  <StatusChip tone={t.tone as StatusTone}>{t.status}</StatusChip>
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle>{d.overdue}</CardTitle>
            </CardHeader>
            <ul className="flex flex-col gap-3.5">
              {d.overdueList.map((p) => (
                <li key={p.name} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-ink">{p.name}</p>
                    <p className="text-[13px] text-muted">{p.meta}</p>
                  </div>
                  <span className="shrink-0 text-[13px] font-semibold text-danger-text tabular-nums">{p.days}</span>
                </li>
              ))}
            </ul>
            <Button variant="tonal" fullWidth className="mt-5">
              {d.remindAll}
            </Button>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{d.upcoming}</CardTitle>
            </CardHeader>
            <ul className="flex flex-col gap-3">
              {d.appointments.map((a) => (
                <li key={a.title} className="flex items-center gap-3.5">
                  <span className="flex size-14 shrink-0 flex-col items-center justify-center rounded-input bg-accent-soft text-accent-text">
                    <span className="font-heading text-[18px] leading-none font-bold tabular-nums">{a.day}</span>
                    <span className="text-[11.5px] font-semibold">{a.month}</span>
                  </span>
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-ink">{a.title}</p>
                    <p className="text-[13px] text-muted">{a.meta}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
