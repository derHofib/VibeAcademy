/**
 * Anbieter-Schnittstelle für fortgeschrittene/qualifizierte elektronische Signaturen (FES/QES, E-40).
 *
 * Ablauf: Vorgang starten (Dokument + Unterzeichner) → Weiterleitung des Teilnehmers auf die Seite des Anbieters
 * (Identifizierung, Signieren) → Rückleitung auf `returnUrl` bzw. Webhook → Ergebnis abholen (signiertes Dokument,
 * Zertifikatsangaben). Ein echter Vertrauensdiensteanbieter wird als weitere Implementierung angebunden; ohne
 * Vertrag gibt es nur den Test-Anbieter (`TestQesProvider`).
 */
export type SignatureLevel = 'ees' | 'fes' | 'qes';
export type ProviderLevel = Exclude<SignatureLevel, 'ees'>;

export interface SignatureProviderInfo {
  /** technischer Name (wird in signature.provider gespeichert) */
  name: string;
  /** Anzeigename */
  label: string;
  levels: ProviderLevel[];
  /** Test-Anbieter: Signatur ohne Rechtswirkung, im Nachweis gekennzeichnet */
  test: boolean;
}

export interface StartSigningInput {
  /** eigene Vorgangs-ID (signature_request.id) */
  requestId: string;
  level: ProviderLevel;
  /** zu signierendes Dokument (PDF) */
  document: Buffer;
  documentName: string;
  signer: { name: string; email: string | null };
  /** Rückleitung des Browsers nach Abschluss/Abbruch beim Anbieter */
  returnUrl: string;
  lang: 'de' | 'en';
}

export interface StartSigningResult {
  transactionId: string;
  /** Hierhin wird der Teilnehmer weitergeleitet */
  redirectUrl: string;
}

export interface SigningResult {
  status: 'pending' | 'signed' | 'failed' | 'cancelled';
  signedDocument?: Buffer;
  format?: 'PAdES' | 'CAdES';
  signer?: { subject: string; issuer?: string | null; serial?: string | null; test?: boolean };
  signedAt?: Date;
  error?: string;
}

export interface SignatureProvider {
  readonly info: SignatureProviderInfo;
  /** Relative Rückleitungs-URLs genügen (Anbieterseite läuft im selben Origin, z. B. der Test-Anbieter) */
  readonly sameOrigin?: boolean;
  start(input: StartSigningInput): Promise<StartSigningResult>;
  result(transactionId: string): Promise<SigningResult>;
  /** Webhook des Anbieters prüfen → Transaktions-ID (optional) */
  parseWebhook?(body: unknown, headers: Record<string, string | string[] | undefined>): Promise<{ transactionId: string } | null>;
}

export const SIGNATURE_PROVIDER_LIST = Symbol('SIGNATURE_PROVIDER_LIST');
