import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { deriveKey } from '../common/crypto';

/** AES-256-GCM für gespeicherte Webhook-Geheimnisse (Schlüssel aus dem Master-Secret abgeleitet). */
export class SecretBox {
  private readonly key: Buffer;
  constructor(master: string, purpose = 'webhook-secret') {
    this.key = Buffer.from(deriveKey(master, purpose), 'hex'); // 32 Byte
  }
  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':');
  }
  decrypt(box: string): string {
    const [v, iv, tag, ct] = box.split(':');
    if (v !== 'v1' || !iv || !tag || ct === undefined) throw new Error('Unbekanntes Format des verschlüsselten Geheimnisses');
    const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  }
}

export const newWebhookSecret = () => `whsec_${randomBytes(32).toString('base64url')}`;

/** Signatur-Header: t=<Unix-Sekunden>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>. */
export function signPayload(secret: string, body: string, unixSeconds: number): string {
  const v1 = createHmac('sha256', secret).update(`${unixSeconds}.${body}`).digest('hex');
  return `t=${unixSeconds},v1=${v1}`;
}

/**
 * Prüfung beim Empfänger (Referenzimplementierung, auch in der OpenAPI-Beschreibung):
 * Zeitstempel höchstens `toleranceSeconds` alt, HMAC in konstanter Zeit vergleichen. Mehrere v1-Werte sind erlaubt
 * (z. B. während eines Geheimnis-Wechsels).
 */
export function verifySignature(secret: string, body: string, header: string, nowSeconds: number, toleranceSeconds = 300): boolean {
  const parts = header.split(',').map((p) => p.trim().split('='));
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  if (!Number.isFinite(t) || Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${body}`).digest('hex'));
  return parts
    .filter(([k, v]) => k === 'v1' && v)
    .some(([, v]) => {
      const got = Buffer.from(v!);
      return got.length === expected.length && timingSafeEqual(got, expected);
    });
}

/** Wartezeit vor dem nächsten Versuch: Basis · 2^(n−1), n = Anzahl bisheriger Versuche (≥ 1). */
export function backoffMs(attempts: number, baseMs: number, maxMs = 24 * 3600_000): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempts - 1));
}
