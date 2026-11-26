import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { get } from '@/lib/api';
import { Button, Field, Input, Panel, Select, Sheet } from '@/components/ui';
import { qk, type OrgUnit, type TrainingListItem } from '@/features/admin/api';
import { isoDate, shortHash } from '@/features/admin/format';
import { errorMessage } from '@/features/admin/components/common';
import { adm } from '@/i18n/admin';
import { tx } from '@/i18n/external';
import { downloadPost } from './api';
import { defaultExportRange } from './model';

const t = tx.exportSheet;

/** Dialog „Nachweismappe exportieren“ (Dashboard, Screen 1): Zeitraum + optionale Filter → ZIP. */
export function NachweismappeSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const units = useQuery({ queryKey: qk.orgUnits, queryFn: () => get<OrgUnit[]>('/org-units'), enabled: open, retry: false });
  const trainings = useQuery({ queryKey: qk.trainings, queryFn: () => get<TrainingListItem[]>('/trainings'), enabled: open, retry: false });
  const range = defaultExportRange(isoDate(new Date()));
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [orgUnitId, setOrgUnitId] = useState('');
  const [trainingId, setTrainingId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const run = async () => {
    if (from > to) {
      setResult({ tone: 'danger', text: t.errRange });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const r = await downloadPost(
        '/exports/nachweismappe',
        { from, to, orgUnitId: orgUnitId || null, trainingId: trainingId || null },
        `Nachweismappe_${from}_${to}.zip`,
      );
      setResult({ tone: 'success', text: t.done(Number(r.headers.get('x-evidence-count') ?? 0), shortHash(r.headers.get('x-content-sha256'))) });
    } catch (e) {
      setResult({ tone: 'danger', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t.title}
      description={t.description}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {adm.common.cancel}
          </Button>
          <Button disabled={busy} onClick={run}>
            <Download aria-hidden="true" className="size-[18px]" />
            {busy ? t.running : t.submit}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t.from}>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label={t.to}>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <Field label={t.orgUnit}>
          <Select value={orgUnitId} onChange={(e) => setOrgUnitId(e.target.value)}>
            <option value="">{t.orgAll}</option>
            {units.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t.training}>
          <Select value={trainingId} onChange={(e) => setTrainingId(e.target.value)}>
            <option value="">{t.trainingAll}</option>
            {trainings.data?.map((x) => (
              <option key={x.id} value={x.id}>
                {x.titel}
              </option>
            ))}
          </Select>
        </Field>
        <div role="status" aria-live="polite">
          {result && (
            <Panel tone={result.tone} data-testid="export-ergebnis">
              {result.text}
            </Panel>
          )}
        </div>
      </div>
    </Sheet>
  );
}
