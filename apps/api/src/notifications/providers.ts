import { Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}
export interface MailProvider {
  readonly name: string;
  send(m: OutgoingMail): Promise<{ messageId: string }>;
}
export interface SmsProvider {
  readonly name: string;
  send(to: string, text: string): Promise<{ messageId: string }>;
}

export const MAIL_PROVIDER = Symbol('MAIL_PROVIDER');
export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

/**
 * Standard, solange kein Versand eingerichtet ist: schreibt ins Log.
 * Außerhalb von Produktion hält er die letzten Nachrichten im Speicher (Entwicklung, E2E-Tests lesen OTP-Codes).
 */
export class LogMailProvider implements MailProvider {
  readonly name = 'log';
  private readonly log = new Logger('Mail');
  readonly recent: Array<OutgoingMail & { at: Date }> = [];
  constructor(private readonly keepContent: boolean) {}
  async send(m: OutgoingMail) {
    const id = `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (this.keepContent) {
      this.recent.unshift({ ...m, at: new Date() });
      this.recent.splice(50);
      this.log.log(`→ ${m.to}: ${m.subject}`);
    } else {
      this.log.log(`→ (Mailversand nicht eingerichtet) Nachricht ${id} an ${m.to.replace(/^(.).*@/, '$1…@')}`);
    }
    return { messageId: id };
  }
}

export class SmtpMailProvider implements MailProvider {
  readonly name = 'smtp';
  private readonly transport: nodemailer.Transporter;
  constructor(
    url: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(url);
  }
  async send(m: OutgoingMail) {
    const info = await this.transport.sendMail({ from: this.from, to: m.to, subject: m.subject, text: m.text, html: m.html });
    return { messageId: String(info.messageId) };
  }
}

export class LogSmsProvider implements SmsProvider {
  readonly name = 'log';
  private readonly log = new Logger('SMS');
  async send(to: string, _text: string) {
    this.log.log(`→ (SMS-Versand nicht eingerichtet) an …${to.slice(-3)}`);
    return { messageId: `log-${Date.now()}` };
  }
}

/** Web-Push (E-12). Empfänger: „person:<uuid>“ oder „account:<uuid>“; der Provider löst die Abos auf. */
export interface PushProvider {
  readonly name: string;
  send(recipient: string, msg: { title: string; body: string; url?: string }): Promise<{ messageId: string }>;
}
export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');

/** Platzhalter, bis Web-Push (VAPID) eingerichtet ist (Schritt 2.2). */
export class LogPushProvider implements PushProvider {
  readonly name = 'log';
  private readonly log = new Logger('Push');
  readonly recent: Array<{ recipient: string; title: string; body: string; url?: string; at: Date }> = [];
  async send(recipient: string, msg: { title: string; body: string; url?: string }) {
    this.recent.unshift({ recipient, ...msg, at: new Date() });
    this.recent.splice(50);
    this.log.log(`→ ${recipient}: ${msg.title}`);
    return { messageId: `log-${Date.now()}` };
  }
}
