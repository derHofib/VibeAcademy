import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
export const hmac = (key: string, s: string) => createHmac('sha256', key).update(s).digest('hex');

/** Schlüssel für einen Zweck aus dem Master-Secret ableiten (keine Wiederverwendung zwischen Zwecken). */
export const deriveKey = (master: string, purpose: string) => hmac(master, `sn:${purpose}`);

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const sixDigitCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
