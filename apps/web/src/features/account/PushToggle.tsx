import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BellRing } from 'lucide-react';
import { api, get, post } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { tx } from '@/i18n/external';

const t = tx.account.push;
const SW_URL = '/sw.js';

/** VAPID-Schlüssel (Base64URL) → Uint8Array für `pushManager.subscribe`. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/**
 * Opt-in „Benachrichtigungen auf diesem Gerät“ (E-35): nur sichtbar, wenn die API Web-Push anbietet.
 * Der Service Worker wird erst bei Aktivierung registriert (Nutzeraktion).
 */
export function PushToggle() {
  const key = useQuery({ queryKey: ['push', 'key'], queryFn: () => get<{ enabled: boolean; publicKey: string | null }>('/push/key'), staleTime: 300_000, retry: false });
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!supported()) return;
    navigator.serviceWorker
      .getRegistration(SW_URL)
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => setOn(!!sub))
      .catch(() => undefined);
  }, []);

  if (!key.data?.enabled || !key.data.publicKey) return null;

  const enable = async () => {
    if (!supported()) {
      setMsg(t.unsupported);
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      setMsg(t.denied);
      return;
    }
    const reg = await navigator.serviceWorker.register(SW_URL);
    await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key.data!.publicKey!) }));
    const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
    await post('/me/push-subscriptions', { endpoint: json.endpoint, keys: json.keys });
    setOn(true);
    setMsg(t.on);
  };
  const disable = async () => {
    const reg = await navigator.serviceWorker.getRegistration(SW_URL);
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await api('/me/push-subscriptions', { method: 'DELETE', json: { endpoint: sub.endpoint } }).catch(() => undefined);
      await sub.unsubscribe();
    }
    setOn(false);
    setMsg(null);
  };
  const toggle = async (next: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      await (next ? enable() : disable());
    } catch {
      setMsg(t.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding="none" className="flex items-start gap-3.5 rounded-[22px] p-[18px]" data-testid="push-opt-in">
      <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-text">
        <BellRing className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="push-schalter" className="cursor-pointer font-heading text-[16px] font-bold text-ink">
            {t.title}
          </label>
          <Checkbox id="push-schalter" checked={on} disabled={busy} onCheckedChange={(v) => void toggle(v === true)} aria-describedby="push-text" />
        </div>
        <p id="push-text" className="mt-1 text-[13.5px] leading-[1.5] text-muted">
          {t.text}
        </p>
        <p role="status" className="mt-1 text-[13px] font-medium text-ink-2 empty:hidden">
          {busy ? t.busy : msg}
        </p>
      </div>
    </Card>
  );
}
