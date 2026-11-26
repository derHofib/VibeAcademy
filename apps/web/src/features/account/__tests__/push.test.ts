import { describe, expect, it } from 'vitest';
import { urlBase64ToUint8Array } from '../PushToggle';

describe('Web-Push', () => {
  it('wandelt den VAPID-Schlüssel (Base64URL ohne Padding) in Bytes', () => {
    const bytes = urlBase64ToUint8Array('AQID_-8');
    expect(Array.from(bytes)).toEqual([1, 2, 3, 255, 239]);
  });
});
