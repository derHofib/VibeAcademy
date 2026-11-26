import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomToken } from '../common/crypto';
import { Clock } from '../common/clock';
import { SEALER, type Sealer } from '../evidence/sealer';
import { RedisService } from '../redis/redis.service';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage';
import type { SignatureProvider, SigningResult, StartSigningInput, StartSigningResult } from './signature-provider';

const TTL_S = 30 * 60;

interface TestTx {
  requestId: string;
  level: 'fes' | 'qes';
  signerName: string;
  documentName: string;
  returnUrl: string;
  nonce: string;
  lang: 'de' | 'en';
  status: 'pending' | 'signed' | 'cancelled' | 'failed';
  signer?: string;
  signedAt?: string;
  error?: string;
}

/**
 * TEST-Anbieter für FES/QES (E-40): simuliert die Signaturseite eines Vertrauensdiensteanbieters innerhalb der API
 * (`/api/qes/test/sign/:tx`). „Signieren“ erzeugt eine PAdES-Signatur mit dem Entwicklungs-Siegelzertifikat als
 * Platzhalter – ausdrücklich ohne Rechtswirkung und im Nachweis als TEST gekennzeichnet.
 */
@Injectable()
export class TestQesProvider implements SignatureProvider {
  private readonly log = new Logger(TestQesProvider.name);
  readonly info = { name: 'test', label: 'TEST-Signaturanbieter', levels: ['fes', 'qes'] as Array<'fes' | 'qes'>, test: true };
  readonly sameOrigin = true;
  /** Simulierter Webhook „Vorgang signiert“ (der Dienst schließt den Vorgang dann auch ohne Rückleitung ab) */
  private listeners: Array<(transactionId: string) => Promise<void>> = [];

  constructor(
    private readonly redis: RedisService,
    private readonly clock: Clock,
    @Inject(SEALER) private readonly sealer: Sealer,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  onSigned(fn: (transactionId: string) => Promise<void>) {
    this.listeners.push(fn);
  }

  private key(tx: string) {
    return `qes-test:${tx}`;
  }
  private docKey(tx: string, kind: 'document' | 'signed') {
    return `qes-test/${tx}/${kind}.pdf`;
  }

  async start(input: StartSigningInput): Promise<StartSigningResult> {
    const tx = `TEST-${randomToken(12).replace(/[^A-Za-z0-9]/g, '').slice(0, 16).toUpperCase()}`;
    await this.storage.put('uploads', this.docKey(tx, 'document'), input.document, { contentType: 'application/pdf' });
    const state: TestTx = {
      requestId: input.requestId, level: input.level, signerName: input.signer.name, documentName: input.documentName,
      returnUrl: input.returnUrl, nonce: randomToken(16), lang: input.lang, status: 'pending',
    };
    await this.redis.client.set(this.key(tx), JSON.stringify(state), 'EX', TTL_S);
    return { transactionId: tx, redirectUrl: `/api/qes/test/sign/${encodeURIComponent(tx)}` };
  }

  async state(tx: string): Promise<TestTx | null> {
    const raw = await this.redis.client.get(this.key(tx));
    return raw ? (JSON.parse(raw) as TestTx) : null;
  }

  private async save(tx: string, s: TestTx) {
    await this.redis.client.set(this.key(tx), JSON.stringify(s), 'EX', TTL_S);
  }

  /** „Signieren“ auf der Testseite: Dokument mit dem Entwicklungs-Siegelzertifikat signieren (Platzhalter). */
  async approve(tx: string, nonce: string): Promise<TestTx | null> {
    const s = await this.state(tx);
    if (!s || s.nonce !== nonce) return null;
    if (s.status !== 'pending') return s;
    try {
      const doc = await this.storage.get('uploads', this.docKey(tx, 'document'));
      const sealed = await this.sealer.seal(doc);
      await this.storage.put('uploads', this.docKey(tx, 'signed'), sealed.pdf, { contentType: 'application/pdf' });
      s.status = 'signed';
      s.signer = `${s.signerName} (TEST, ${sealed.info.signer ?? 'unsigniert – SEAL_MODE=none'})`;
      s.signedAt = this.clock.now().toISOString();
    } catch (e) {
      s.status = 'failed';
      s.error = (e as Error).message.slice(0, 300);
    }
    await this.save(tx, s);
    for (const fn of this.listeners) await fn(tx).catch((e) => this.log.warn(`Webhook-Simulation ${tx}: ${(e as Error).message}`));
    return s;
  }

  async cancel(tx: string, nonce: string): Promise<TestTx | null> {
    const s = await this.state(tx);
    if (!s || s.nonce !== nonce) return null;
    if (s.status === 'pending') {
      s.status = 'cancelled';
      await this.save(tx, s);
    }
    return s;
  }

  async result(tx: string): Promise<SigningResult> {
    const s = await this.state(tx);
    if (!s) return { status: 'failed', error: 'Vorgang beim Test-Anbieter unbekannt oder abgelaufen' };
    if (s.status !== 'signed') return { status: s.status, error: s.error };
    return {
      status: 'signed',
      signedDocument: await this.storage.get('uploads', this.docKey(tx, 'signed')),
      format: 'PAdES',
      signer: { subject: s.signer ?? s.signerName, issuer: 'Schulungsnachweis Dev-CA (TEST)', serial: null, test: true },
      signedAt: s.signedAt ? new Date(s.signedAt) : this.clock.now(),
    };
  }
}
