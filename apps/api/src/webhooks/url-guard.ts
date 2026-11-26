import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/** Private, lokale und reservierte Adressbereiche – Ziel von Webhooks nur mit WEBHOOK_ALLOW_PRIVATE (SSRF-Schutz). */
const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return blocked.check(ip, 'ipv4');
  if (v === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (mapped) return blocked.check(mapped[1]!, 'ipv4');
    return blocked.check(ip, 'ipv6');
  }
  return true;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Prüft eine Webhook-URL beim Anlegen. Liefert eine deutsche Fehlermeldung oder null.
 * Erlaubt: https://… ; http:// nur zu 127.0.0.1/localhost und nur, wenn allowPrivate (Entwicklung/Test).
 */
export function webhookUrlProblem(raw: string, allowPrivate: boolean): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'Bitte eine vollständige URL angeben (https://…)';
  }
  if (raw.length > 2000) return 'Die URL ist zu lang';
  if (u.username || u.password) return 'Zugangsdaten in der URL sind nicht erlaubt';
  if (u.hash) return 'Die URL darf keinen Anker (#) enthalten';
  if (u.protocol === 'http:') {
    if (!allowPrivate || !LOOPBACK_HOSTS.has(u.hostname)) return 'Webhooks müssen https verwenden';
    return null;
  }
  if (u.protocol !== 'https:') return 'Webhooks müssen https verwenden';
  if (!allowPrivate) {
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
      return 'Interne Adressen sind als Webhook-Ziel nicht erlaubt';
    }
    if (isIP(host) && isPrivateAddress(host)) return 'Interne Adressen sind als Webhook-Ziel nicht erlaubt';
  }
  return null;
}

/** Vor jeder Zustellung: alle aufgelösten Adressen müssen öffentlich sein (sofern nicht allowPrivate). */
export async function assertPublicTarget(raw: string, allowPrivate: boolean): Promise<void> {
  const problem = webhookUrlProblem(raw, allowPrivate);
  if (problem) throw new Error(problem);
  if (allowPrivate) return;
  const host = new URL(raw).hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error('Ziel löst auf eine interne Adresse auf');
}
