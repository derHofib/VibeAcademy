import { Logger } from '@nestjs/common';
import webpush from 'web-push';
import type { DbService } from '../db/db.service';
import type { PushProvider } from '../notifications/providers';

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}
/** Versand an genau ein Abo. Austauschbar (Tests). Fehler mit statusCode 404/410 = Abo existiert nicht mehr. */
export interface WebPushSender {
  send(target: PushTarget, payload: string, vapid: VapidConfig): Promise<{ statusCode: number }>;
}
export const WEB_PUSH_SENDER = Symbol('WEB_PUSH_SENDER');

export const defaultWebPushSender: WebPushSender = {
  async send(target, payload, vapid) {
    const r = await webpush.sendNotification(target, payload, {
      vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
      TTL: 24 * 3600,
      urgency: 'normal',
    });
    return { statusCode: r.statusCode };
  },
};

const GONE = new Set([404, 410]);

/**
 * Web-Push über VAPID (E-12). Empfänger „person:<uuid>“ (Abos der Person und ihres verknüpften Kontos) oder „account:<uuid>“.
 * Abgelaufene Abos (404/410) werden gelöscht. Ohne Abo gilt die Nachricht als zugestellt (nichts zu tun).
 */
export class WebPushProvider implements PushProvider {
  readonly name = 'webpush';
  private readonly log = new Logger('WebPush');

  constructor(
    private readonly db: DbService,
    private readonly vapid: VapidConfig,
    private readonly sender: WebPushSender = defaultWebPushSender,
  ) {}

  async send(recipient: string, msg: { title: string; body: string; url?: string }) {
    const m = /^(person|account):([0-9a-f-]{36})$/i.exec(recipient);
    if (!m) throw new Error(`Ungültiger Push-Empfänger: ${recipient}`);
    const targets = (await this.db.txAs({}, (c) => c.query('SELECT * FROM app.push_targets($1, $2)', [m[1]!.toLowerCase(), m[2]]))).rows as Array<{
      endpoint: string; p256dh: string; auth: string;
    }>;
    if (!targets.length) return { messageId: 'kein-abo' };
    const payload = JSON.stringify({ title: msg.title, body: msg.body, url: msg.url ?? '/' });
    let ok = 0;
    let gone = 0;
    const errors: string[] = [];
    for (const t of targets) {
      try {
        await this.sender.send({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, payload, this.vapid);
        ok++;
        await this.db.txAs({}, (c) => c.query('SELECT app.push_result($1, true)', [t.endpoint]));
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status && GONE.has(status)) {
          gone++;
          await this.db.txAs({}, (c) => c.query('SELECT app.push_result($1, false)', [t.endpoint]));
        } else {
          errors.push(`${status ?? ''} ${(e as Error).message}`.trim());
        }
      }
    }
    if (!ok && errors.length) throw new Error(`Web-Push fehlgeschlagen: ${errors[0]}`);
    if (gone) this.log.log(`${gone} abgelaufene Push-Abos entfernt`);
    return { messageId: `webpush-${ok}/${targets.length}` };
  }
}
