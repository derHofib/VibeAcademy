import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomToken, sha256 } from '../common/crypto';
import { RedisService } from '../redis/redis.service';

export interface StepUpBinding {
  /** Konto (Passwort-Step-up) oder Person (OTP-Step-up bei Teilnehmern ohne Konto) */
  subject: string;
  /** Wofür: z. B. „signature:<invitationId>“ */
  purpose: string;
  method: 'password' | 'otp_mail' | 'otp_sms' | 'sso';
}

const TTL_S = 5 * 60;

/** Step-up-Token vor der Unterschrift (E-08): 5 min gültig, einmal verwendbar, an Subjekt + Zweck gebunden. */
@Injectable()
export class StepUpService {
  constructor(private readonly redis: RedisService) {}

  async issue(b: StepUpBinding): Promise<string> {
    const token = randomToken();
    await this.redis.client.set(`stepup:${sha256(token)}`, JSON.stringify(b), 'EX', TTL_S);
    return token;
  }

  /** Verbraucht das Token (GETDEL) und prüft die Bindung. Liefert die Auth-Methode für den Nachweis. */
  async consume(token: string, expected: Omit<StepUpBinding, 'method'>): Promise<StepUpBinding['method']> {
    const raw = await this.redis.client.getdel(`stepup:${sha256(token)}`);
    if (!raw) throw new UnauthorizedException('Bestätigung abgelaufen. Bitte erneut anmelden.');
    const b = JSON.parse(raw) as StepUpBinding;
    if (b.subject !== expected.subject || b.purpose !== expected.purpose) {
      throw new UnauthorizedException('Bestätigung passt nicht zu diesem Vorgang.');
    }
    return b.method;
  }
}
