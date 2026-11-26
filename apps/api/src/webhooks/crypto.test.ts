import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateApiKey, parseApiKey } from '../public-api/api-key.service';
import { backoffMs, newWebhookSecret, SecretBox, signPayload, verifySignature } from './crypto';
import { isPrivateAddress, webhookUrlProblem } from './url-guard';

describe('Webhook-Signatur', () => {
  const secret = newWebhookSecret();
  const body = JSON.stringify({ id: 'e1', type: 'evidence.created', data: { evidenceId: 'x' } });

  it('t=<unix>,v1=HMAC-SHA256(secret, "t.body") – unabhängig nachgerechnet', () => {
    const h = signPayload(secret, body, 1_800_000_000);
    expect(h).toBe(`t=1800000000,v1=${createHmac('sha256', secret).update(`1800000000.${body}`).digest('hex')}`);
  });

  it('prüft Zeitfenster, Geheimnis, Body und erlaubt mehrere v1-Werte', () => {
    const t = 1_800_000_000;
    const h = signPayload(secret, body, t);
    expect(verifySignature(secret, body, h, t + 10)).toBe(true);
    expect(verifySignature(secret, body, h, t + 301)).toBe(false);
    expect(verifySignature(newWebhookSecret(), body, h, t)).toBe(false);
    expect(verifySignature(secret, body + ' ', h, t)).toBe(false);
    expect(verifySignature(secret, body, `t=${t},v1=${'0'.repeat(64)}, ${h.split(',')[1]}`, t)).toBe(true);
    expect(verifySignature(secret, body, 'kaputt', t)).toBe(false);
  });

  it('exponentieller Backoff mit Obergrenze', () => {
    expect([1, 2, 3, 4, 5].map((n) => backoffMs(n, 60_000))).toEqual([60_000, 120_000, 240_000, 480_000, 960_000]);
    expect(backoffMs(40, 60_000)).toBe(24 * 3600_000);
  });
});

describe('SecretBox (AES-256-GCM)', () => {
  it('ver- und entschlüsselt; Manipulation und falscher Schlüssel fallen auf', () => {
    const box = new SecretBox('m'.repeat(40));
    const enc = box.encrypt('whsec_geheim');
    expect(enc).toMatch(/^v1:/);
    expect(enc).not.toContain('geheim');
    expect(box.encrypt('whsec_geheim')).not.toBe(enc); // zufälliger IV
    expect(box.decrypt(enc)).toBe('whsec_geheim');
    const parts = enc.split(':');
    parts[3] = Buffer.from('x' + Buffer.from(parts[3]!, 'base64url').toString('latin1').slice(1), 'latin1').toString('base64url');
    expect(() => box.decrypt(parts.join(':'))).toThrow();
    expect(() => new SecretBox('n'.repeat(40)).decrypt(enc)).toThrow();
  });
});

describe('Webhook-URL', () => {
  it('nur https; http nur zu localhost bei allowPrivate; private Ziele in Produktion gesperrt', () => {
    expect(webhookUrlProblem('https://hooks.example.com/sn', false)).toBeNull();
    expect(webhookUrlProblem('http://hooks.example.com/sn', true)).toBe('Webhooks müssen https verwenden');
    expect(webhookUrlProblem('http://127.0.0.1:8080/x', true)).toBeNull();
    expect(webhookUrlProblem('http://127.0.0.1:8080/x', false)).toBe('Webhooks müssen https verwenden');
    expect(webhookUrlProblem('https://10.1.2.3/x', false)).toBe('Interne Adressen sind als Webhook-Ziel nicht erlaubt');
    expect(webhookUrlProblem('https://[::1]/x', false)).toBe('Interne Adressen sind als Webhook-Ziel nicht erlaubt');
    expect(webhookUrlProblem('https://intranet.local/x', false)).toBe('Interne Adressen sind als Webhook-Ziel nicht erlaubt');
    expect(webhookUrlProblem('https://10.1.2.3/x', true)).toBeNull();
    expect(webhookUrlProblem('https://a:b@example.com/x', false)).toBe('Zugangsdaten in der URL sind nicht erlaubt');
    expect(webhookUrlProblem('kein link', false)).toContain('vollständige URL');
  });
  it('erkennt private und reservierte Adressen', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.20.1.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2a00:1450:4001:80b::200e']) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});

describe('API-Schlüssel-Format', () => {
  it('sn_live_<12 Zeichen>_<43 Zeichen>; nur der Hash des Geheimnisses wird verglichen', () => {
    const g = generateApiKey();
    expect(g.key).toMatch(/^sn_live_[a-z0-9]{12}_[A-Za-z0-9_-]{43}$/);
    expect(parseApiKey(g.key)).toEqual({ prefix: g.prefix, hash: g.hash });
    expect(parseApiKey(`${g.key}x`)).toBeNull();
    expect(parseApiKey('sn_test_abc')).toBeNull();
  });
});
