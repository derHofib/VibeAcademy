import { BadRequestException, ParseUUIDPipe } from '@nestjs/common';

/** UUID-Parameter mit deutscher Fehlermeldung. */
export const Uuid = new ParseUUIDPipe({ exceptionFactory: () => new BadRequestException('Ungültige ID (UUID erwartet)') });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Optionaler UUID-Filter aus der Query. */
export function uuidFilter(v: unknown, name: string): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw new BadRequestException(`Filter „${name}“: UUID erwartet`);
  return v;
}

/** Optionaler Zeitpunkt (ISO 8601) aus der Query. */
export function dateTimeFilter(v: unknown, name: string): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v)) || !/^\d{4}-\d{2}-\d{2}/.test(v)) {
    throw new BadRequestException(`Filter „${name}“: Zeitpunkt im Format ISO 8601 erwartet (z. B. 2026-11-26T08:00:00Z)`);
  }
  return new Date(v).toISOString();
}

/** Optionaler Wert aus einer festen Liste. */
export function enumFilter<T extends string>(v: unknown, name: string, allowed: readonly T[]): T | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !allowed.includes(v as T)) throw new BadRequestException(`Filter „${name}“: erlaubt sind ${allowed.join(', ')}`);
  return v as T;
}
