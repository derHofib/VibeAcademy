/**
 * Wer handelt: angemeldete Sitzung (Audit über actor_account_id) oder API-Schlüssel.
 * API-Schlüssel haben kein Konto – das Audit trägt dann `actor: "api-key:<id>"` in der Nutzlast (E-11 bleibt unverändert).
 */
export type Actor = { kind: 'session' } | { kind: 'api-key'; keyId: string };

export const SESSION_ACTOR: Actor = { kind: 'session' };

export function actorPayload(actor: Actor, payload: Record<string, unknown> = {}): Record<string, unknown> {
  return actor.kind === 'api-key' ? { ...payload, actor: `api-key:${actor.keyId}` } : payload;
}
