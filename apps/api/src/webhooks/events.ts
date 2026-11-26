/** Webhook-Ereignistypen (E-37). Nutzlast: nur IDs und Status, keine Personendaten. */
export const WEBHOOK_EVENTS = [
  'invitation.completed',
  'evidence.created',
  'external_record.approved',
  'attendance.confirmed',
  'compliance.state_changed',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];
/** Zusätzlich: Testereignis, nur auf Anforderung an genau einen Endpunkt. */
export type AnyWebhookEventType = WebhookEventType | 'test.ping';

export const WEBHOOK_EVENT_DESCRIPTIONS: Record<AnyWebhookEventType, string> = {
  'invitation.completed': 'Einladung abgeschlossen (bestätigt/unterschrieben bzw. Anwesenheit angerechnet)',
  'evidence.created': 'Nachweis-PDF erzeugt',
  'external_record.approved': 'Externer Nachweis freigegeben (auch bei direkter Erfassung durch die Verwaltung oder Import)',
  'attendance.confirmed': 'Anwesenheit eines Präsenz-/Live-Termins bestätigt und abgeschlossen',
  'compliance.state_changed': 'Stand Person × Pflichtschulung hat sich seit dem letzten nächtlichen Lauf geändert',
  'test.ping': 'Testereignis („Test senden“)',
};

/** Header (Groß-/Kleinschreibung beliebig, HTTP). */
export const SIGNATURE_HEADER = 'Schulungsnachweis-Signature';
export const EVENT_HEADER = 'Schulungsnachweis-Event';
export const DELIVERY_HEADER = 'Schulungsnachweis-Delivery';
