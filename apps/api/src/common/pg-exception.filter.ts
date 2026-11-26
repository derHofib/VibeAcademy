import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { DatabaseError } from 'pg';

/** Übersetzt bekannte Datenbankfehler in verständliche HTTP-Antworten (keine SQL-Details nach außen). */
@Catch(DatabaseError)
export class PgExceptionFilter extends BaseExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger('Datenbank');
  override catch(e: DatabaseError, host: ArgumentsHost) {
    const map: Record<string, [number, string]> = {
      P0001: [409, e.message], // RAISE EXCEPTION aus Triggern (z. B. „unveränderlich“)
      '23505': [409, 'Eintrag existiert bereits'],
      '23503': [400, 'Verweis auf einen nicht vorhandenen Eintrag'],
      '23514': [400, 'Eingaben verletzen eine Prüfregel'],
      '42501': [403, 'Keine Berechtigung'],
      '22P02': [400, 'Ungültiges Format'],
    };
    const hit = e.code ? map[e.code] : undefined;
    if (!hit) {
      this.log.error(`${e.code} ${e.message}`);
      return super.catch(e, host);
    }
    return super.catch(new HttpException({ statusCode: hit[0], message: hit[1] }, hit[0]), host);
  }
}
