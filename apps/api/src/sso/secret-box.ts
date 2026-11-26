import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { deriveKey } from '../common/crypto';

/**
 * AES-256-GCM für gespeicherte Geheimnisse (Client-Secret des IdP, E-36).
 * Schlüssel: aus HMAC_MASTER_SECRET abgeleitet (eigener Zweck), AAD bindet den Chiffretext an den Mandanten.
 * Format: „v1:<iv>:<tag>:<ciphertext>“ (base64url).
 */
export class SecretBox {
  private readonly key: Buffer;
  constructor(masterSecret: string, purpose = 'sso-client-secret') {
    this.key = Buffer.from(deriveKey(masterSecret, purpose), 'hex');
  }

  seal(plain: string, aad: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    c.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':');
  }

  open(sealed: string, aad: string): string {
    const [v, iv, tag, ct] = sealed.split(':');
    if (v !== 'v1' || !iv || !tag || ct === undefined) throw new Error('Unbekanntes Format des verschlüsselten Geheimnisses');
    const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  }
}
