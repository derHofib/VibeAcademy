import { useState } from 'react';
import { Check } from 'lucide-react';
import { useNavigate } from 'react-router';
import { de } from '@/i18n/de';
import { cn } from '@/lib/cn';
import { ParticipantLayout } from '@/components/layout/ParticipantLayout';
import { Button, Card, CheckboxField, Field, Input } from '@/components/ui';

const d = de.dev.participantDemo;

/** Demo des Teilnehmer-Rahmens am Beispiel „Unterschrift“ (Screen 6). */
export default function ParticipantLayoutDemo() {
  const navigate = useNavigate();
  const [confirmed, setConfirmed] = useState(false);
  const [password, setPassword] = useState('');
  const ready = confirmed && password.length > 0;

  return (
    <ParticipantLayout
      title={d.title}
      onBack={() => navigate('/dev/komponenten')}
      footer={
        <>
          <p role="status" className={cn('text-center text-[13.5px]', ready ? 'text-success-text' : 'text-muted')}>
            {ready ? d.ready : d.missing}
          </p>
          <Button size="lg" fullWidth disabled={!ready}>
            {d.submit}
          </Button>
        </>
      }
    >
      <ol aria-label={d.stepsLabel} className="grid grid-cols-3 gap-2">
        {d.steps.map((s, i) => {
          const done = i < 2;
          return (
            <li
              key={s}
              aria-current={!done ? 'step' : undefined}
              className={cn(
                'flex h-11 items-center justify-center gap-1.5 rounded-pill text-[14px] font-semibold',
                done ? 'bg-success-soft text-success-text' : 'bg-accent text-white',
              )}
            >
              {done && <Check aria-hidden="true" className="size-4" strokeWidth={2.75} />}
              {s}
            </li>
          );
        })}
      </ol>

      <Card padding="md">
        <CheckboxField label={d.confirmText} checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} />
      </Card>

      <Card padding="md" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-heading text-[15px] font-bold text-ink">{d.signature}</h2>
          <Button variant="soft" size="sm">
            {d.clear}
          </Button>
        </div>
        <div className="flex h-40 items-end rounded-box bg-bg px-6 pb-8">
          <div className="w-full border-b-[1.5px] border-dashed border-line pb-2 text-center text-[13px] text-muted">
            {d.signaturePlaceholder}
          </div>
        </div>
        <p className="text-[13px] text-muted">{d.signer}</p>
      </Card>

      <Field label={d.password} className="px-1">
        <Input
          type="password"
          tone="surface"
          size="lg"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
    </ParticipantLayout>
  );
}
