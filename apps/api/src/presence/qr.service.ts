import { Inject, Injectable } from '@nestjs/common';
import {
  checkQrScan, makeQrToken, peekQrToken, printedWindow, QR_REJECT_TEXT, QR_SLOT_MS, secondsToNextSlot, slotOf, verifyQrSignature,
  type QrKind, type QrPayload, type QrRejectReason, type QrSigner,
} from '@sn/shared';
import { createHmac } from 'node:crypto';
import QRCode from 'qrcode';
import { Clock } from '../common/clock';
import { deriveKey } from '../common/crypto';
import { APP_CONFIG, type AppConfig } from '../config';

export interface QrRunInfo {
  id: string;
  tenantId: string;
  startAt: Date;
  endAt: Date;
  endedAt: Date | null;
}

export class QrRejected extends Error {
  constructor(readonly reason: QrRejectReason) {
    super(QR_REJECT_TEXT[reason]);
  }
}

/** QR-Tokens (E-16): HMAC-Schlüssel je Mandant aus dem Master-Secret, Prüfregeln aus @sn/shared. */
@Injectable()
export class QrService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {}

  private signer(tenantId: string): QrSigner {
    const key = deriveKey(this.config.HMAC_MASTER_SECRET, `qr:${tenantId}`);
    return (body) => new Uint8Array(createHmac('sha256', key).update(body).digest());
  }

  url(token: string) {
    return `${this.config.PUBLIC_BASE_URL}/q/${token}`;
  }

  svg(url: string) {
    return QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1D2433', light: '#FFFFFF' } });
  }

  /** Rotierendes Token für den aktuellen 30-s-Slot. */
  async rotating(run: QrRunInfo, kind: QrKind) {
    const now = this.clock.now().getTime();
    const slot = slotOf(now);
    const token = makeQrToken({ runId: run.id, kind, mode: 'rotierend', slot }, this.signer(run.tenantId));
    const url = this.url(token);
    const w = printedWindow({ startAt: run.startAt.getTime(), endAt: run.endAt.getTime() });
    return {
      token, url, svg: await this.svg(url), kind, mode: 'rotierend' as const, slot,
      rotatesEverySeconds: QR_SLOT_MS / 1000,
      expiresInSeconds: secondsToNextSlot(now),
      validWindow: { from: new Date(w.from), until: new Date(w.until) },
      serverTime: new Date(now),
    };
  }

  /** Statisches Token für den gedruckten Aushang (gültig im Zeitfenster des Termins). */
  async printed(run: QrRunInfo, kind: QrKind) {
    const now = this.clock.now().getTime();
    const token = makeQrToken({ runId: run.id, kind, mode: 'gedruckt', slot: slotOf(now) }, this.signer(run.tenantId));
    const url = this.url(token);
    const w = printedWindow({ startAt: run.startAt.getTime(), endAt: run.endAt.getTime() });
    return { token, url, svg: await this.svg(url), kind, mode: 'gedruckt' as const, validWindow: { from: new Date(w.from), until: new Date(w.until) } };
  }

  /** Nur Termin ermitteln (ohne Prüfung) – um Mandant und Schlüssel zu finden. */
  peek(token: string): QrPayload {
    const p = peekQrToken(token);
    if (!p) throw new QrRejected('format');
    return p;
  }

  /** Signatur + Zeitregeln prüfen. Liefert die maßgebliche Scanzeit (Serverzeit bzw. signierter Slot-Beginn). */
  verify(token: string, run: QrRunInfo, expectedKind: QrKind, offline = false) {
    const p = verifyQrSignature(token, this.signer(run.tenantId));
    if (!p) throw new QrRejected('signatur');
    const r = checkQrScan({
      payload: p,
      expectedKind,
      run: { runId: run.id, startAt: run.startAt.getTime(), endAt: run.endAt.getTime(), endedAt: run.endedAt?.getTime() ?? null },
      nowMs: this.clock.now().getTime(),
      offline,
    });
    if (!r.ok) throw new QrRejected(r.reason);
    return { payload: p, scanAt: new Date(r.scanAtMs), offline: r.offline };
  }
}
