import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOGIN_LOCK,
  PASSWORD_MIN_LENGTH,
  formatWaitDe,
  loginLockSeconds,
  loginLockedText,
  passwordTooShortText,
} from './password';

describe('Passwortregeln', () => {
  it('Mindestlänge 10, Text aus der Konstante', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(10);
    expect(passwordTooShortText()).toBe('Das Passwort muss mindestens 10 Zeichen haben');
    expect(passwordTooShortText('en')).toContain('10 characters');
  });
});

describe('Login-Sperre mit steigender Dauer', () => {
  it('die ersten 5 Fehlversuche sind frei', () => {
    for (let n = 0; n <= 5; n++) expect(loginLockSeconds(n)).toBe(0);
  });
  it('6. → 1 min, 7. → 2 min, 8. → 4 min, 9. → 8 min', () => {
    expect([6, 7, 8, 9].map((n) => loginLockSeconds(n))).toEqual([60, 120, 240, 480]);
  });
  it('gedeckelt auf 24 Stunden, auch bei sehr vielen Versuchen', () => {
    expect(loginLockSeconds(16)).toBe(61_440); // 60 · 2^10
    expect(loginLockSeconds(17)).toBe(24 * 3600); // 60 · 2^11 = 122 880 → Deckel
    expect(loginLockSeconds(10_000)).toBe(24 * 3600);
    expect(loginLockSeconds(15)).toBe(60 * 2 ** 9);
  });
  it('eigene Werte', () => {
    expect(loginLockSeconds(3, { freeAttempts: 2, baseSeconds: 10, maxSeconds: 15 })).toBe(10);
    expect(loginLockSeconds(4, { freeAttempts: 2, baseSeconds: 10, maxSeconds: 15 })).toBe(15);
    expect(DEFAULT_LOGIN_LOCK).toEqual({ freeAttempts: 5, baseSeconds: 60, maxSeconds: 86_400 });
  });
  it('Restzeit verständlich', () => {
    expect(formatWaitDe(1)).toBe('1 Sekunde');
    expect(formatWaitDe(45)).toBe('45 Sekunden');
    expect(formatWaitDe(60)).toBe('1 Minute');
    expect(formatWaitDe(181)).toBe('4 Minuten');
    expect(formatWaitDe(7200)).toBe('2 Stunden');
    expect(loginLockedText(240)).toBe('Zu viele Fehlversuche. Bitte in 4 Minuten erneut versuchen.');
  });
});
