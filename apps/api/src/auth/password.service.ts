import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

/** argon2id nach OWASP-Empfehlung (19 MiB, t=2, p=1). */
@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  }
  async verify(hash: string | null | undefined, plain: string): Promise<boolean> {
    if (!hash) {
      // Gleiche Laufzeit wie bei vorhandenem Konto (keine Konto-Erkennung über Zeitmessung)
      await argon2.hash(plain, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
      return false;
    }
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
}
