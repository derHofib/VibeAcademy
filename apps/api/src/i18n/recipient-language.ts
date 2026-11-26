import type pg from 'pg';
import { participantLanguage, type Lang } from './language';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Sprache des Empfängers einer Teilnehmer-Nachricht (E-39): Person des Mandanten per E-Mail-Adresse bzw. „person:<id>“.
 * Läuft in der Transaktion des Aufrufers (dessen RLS-Kontext); ohne Treffer Deutsch.
 */
export async function recipientLanguage(c: pg.PoolClient, tenantId: string | null, recipient: string): Promise<Lang> {
  if (!tenantId) return 'de';
  const personId = recipient.startsWith('person:') ? recipient.slice(7) : null;
  if (personId !== null && !UUID.test(personId)) return 'de';
  const r = personId
    ? await c.query('SELECT sprache FROM person WHERE id = $1 AND tenant_id = $2', [personId, tenantId])
    : await c.query('SELECT sprache FROM person WHERE tenant_id = $1 AND lower(email) = lower($2) LIMIT 1', [tenantId, recipient]);
  return participantLanguage(r.rows[0]?.sprache);
}
