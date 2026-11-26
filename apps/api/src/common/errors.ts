import { BadRequestException, ConflictException, ForbiddenException, PipeTransform } from '@nestjs/common';
import { z, type ZodType } from 'zod';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordTooShortText } from '@sn/shared';

/** Validiert Request-Bodies mit Zod; Fehlermeldungen auf Deutsch. */
export class ZodBody<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}
  transform(value: unknown): T {
    const r = this.schema.safeParse(value);
    if (!r.success) {
      throw new BadRequestException({
        message: 'Eingaben unvollständig oder ungültig',
        fields: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return r.data;
  }
}

/** Bekannte Fehler aus SQL-Funktionen in HTTP-Fehler übersetzen. */
export function mapDbError(e: unknown): never {
  const msg = (e as { message?: string })?.message ?? '';
  if (msg.includes('EMAIL_TAKEN')) throw new ConflictException('Diese E-Mail-Adresse ist bereits registriert');
  if (msg.includes('ALREADY_MEMBER')) throw new ConflictException('Diese Person ist bereits Mitglied');
  if (msg.includes('FORBIDDEN')) throw new ForbiddenException('Keine Berechtigung');
  throw e;
}

export const email = z.email('Bitte eine gültige E-Mail-Adresse angeben').trim().toLowerCase().max(254);
export const password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, passwordTooShortText())
  .max(PASSWORD_MAX_LENGTH, 'Das Passwort ist zu lang');
export const displayName = z.string().trim().min(1, 'Bitte einen Namen angeben').max(200);
