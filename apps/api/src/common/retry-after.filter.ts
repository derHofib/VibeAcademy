import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { LoginLockedException } from '../auth/login-lock.service';

/** Sperren mit Restzeit: Status 429, Header `Retry-After` (Sekunden) und Meldung mit Restzeit. */
@Catch(LoginLockedException)
export class RetryAfterFilter implements ExceptionFilter {
  catch(e: LoginLockedException, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    res.setHeader('Retry-After', String(e.retryAfterSeconds));
    res.status(e.getStatus()).json(e.getResponse());
  }
}
