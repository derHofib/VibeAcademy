/**
 * Kalendereinträge (iCalendar, RFC 5545) für Einladungen zu externen Schulungen (E-55).
 * Je Schulungstag ein VEVENT mit stabiler UID; Änderungen erhöhen SEQUENCE, Absagen senden METHOD:CANCEL.
 */
export interface IcsEvent {
  /** stabile Kennung je Tag, z. B. „<buchung>-<person>-1“ */
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  location?: string | null;
  description?: string | null;
  url?: string | null;
}

export interface IcsInput {
  method: 'REQUEST' | 'CANCEL' | 'PUBLISH';
  sequence: number;
  events: IcsEvent[];
  organizer?: { name: string; email: string } | null;
  attendee?: { name: string; email: string } | null;
  now: Date;
  prodId?: string;
}

/** Text nach RFC 5545 maskieren (Backslash, Semikolon, Komma, Zeilenumbruch). */
export function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** UTC-Zeitstempel „20261118T080000Z“. */
export function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Zeilen über 75 Oktette falten (Fortsetzung mit Leerzeichen), UTF-8-sicher. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = '';
  for (const ch of line) {
    const limit = parts.length ? 74 : 75;
    if (enc.encode(cur + ch).length > limit) {
      parts.push(cur);
      cur = ch;
    } else cur += ch;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

export function buildIcs(i: IcsInput): string {
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${i.prodId ?? '-//Schulungsnachweis//Externe Schulung//DE'}`, 'CALSCALE:GREGORIAN', `METHOD:${i.method}`];
  for (const e of i.events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `SEQUENCE:${i.sequence}`,
      `DTSTAMP:${icsDate(i.now)}`,
      `DTSTART:${icsDate(e.start)}`,
      `DTEND:${icsDate(e.end)}`,
      `SUMMARY:${icsEscape(e.summary)}`,
    );
    if (e.location) lines.push(`LOCATION:${icsEscape(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    if (i.organizer) lines.push(`ORGANIZER;CN=${icsEscape(i.organizer.name)}:mailto:${i.organizer.email}`);
    if (i.attendee) lines.push(`ATTENDEE;CN=${icsEscape(i.attendee.name)};ROLE=REQ-PARTICIPANT:mailto:${i.attendee.email}`);
    lines.push(`STATUS:${i.method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
