/**
 * SCIM-Filter und PATCH-Pfade (RFC 7644 §3.4.2.2, §3.5.2) – bewusst kleine Teilmenge:
 *  - Filter: genau ein Vergleich `<attribut> eq "<wert>"` (z. B. `userName eq "a@b.de"`, `externalId eq "123"`)
 *  - PATCH-Pfade: einfache Attribute, Unterattribute (`name.givenName`), Erweiterungs-URN-Attribute und
 *    Wertefilter der Form `emails[type eq "work"].value` bzw. `members[value eq "<id>"]`
 */
export interface EqFilter {
  /** Attribut in Kleinschreibung, z. B. `username`, `emails.value` */
  attr: string;
  value: string | boolean;
}

export class FilterError extends Error {}

const ATTR = String.raw`[A-Za-z][\w$-]*(?::[\w.$-]+)*(?:\.[A-Za-z][\w$-]*)?`;
const EQ = new RegExp(String.raw`^\s*(${ATTR})\s+eq\s+("(?:[^"\\]|\\.)*"|true|false)\s*$`, 'i');

export function parseEqFilter(filter: string, allowed: readonly string[]): EqFilter {
  const m = EQ.exec(filter);
  if (!m) throw new FilterError('Unterstützt wird nur ein Vergleich der Form: attribut eq "wert"');
  const attr = m[1]!.toLowerCase();
  if (!allowed.includes(attr)) throw new FilterError(`Filter auf „${m[1]}“ wird nicht unterstützt`);
  const raw = m[2]!;
  const value = raw.startsWith('"') ? (JSON.parse(raw) as string) : raw.toLowerCase() === 'true';
  return { attr, value };
}

export interface PatchPath {
  /** Attribut in Kleinschreibung inkl. Unterattribut, z. B. `name.givenname`, `emails`, `members`, `enterprise:department` */
  attr: string;
  /** Wertefilter in eckigen Klammern, z. B. `{ attr: 'type', value: 'work' }` */
  where?: EqFilter;
  /** Unterattribut nach dem Wertefilter, z. B. `value` bei `emails[type eq "work"].value` */
  sub?: string;
}

const ENTERPRISE = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:user:';
const CORE_USER = 'urn:ietf:params:scim:schemas:core:2.0:user:';
const CORE_GROUP = 'urn:ietf:params:scim:schemas:core:2.0:group:';

export function parsePatchPath(path: string): PatchPath {
  let p = path.trim();
  const lower = p.toLowerCase();
  let prefix = '';
  if (lower.startsWith(ENTERPRISE)) {
    prefix = 'enterprise:';
    p = p.slice(ENTERPRISE.length);
  } else if (lower.startsWith(CORE_USER)) p = p.slice(CORE_USER.length);
  else if (lower.startsWith(CORE_GROUP)) p = p.slice(CORE_GROUP.length);
  const m = /^([A-Za-z][\w$-]*(?:\.[A-Za-z][\w$-]*)?)(?:\[(.+)\](?:\.([A-Za-z][\w$-]*))?)?$/.exec(p);
  if (!m) throw new FilterError(`Ungültiger Pfad „${path}“`);
  const where = m[2] ? parseEqFilter(m[2], ['type', 'value', 'primary']) : undefined;
  return { attr: prefix + m[1]!.toLowerCase(), ...(where ? { where } : {}), ...(m[3] ? { sub: m[3].toLowerCase() } : {}) };
}

/** SCIM-Booleans kommen von manchen Clients als Zeichenkette („False“). */
export function scimBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string' && /^(true|false)$/i.test(v.trim())) return v.trim().toLowerCase() === 'true';
  return undefined;
}

/** Paging (RFC 7644 §3.4.2.4): startIndex ≥ 1, count 0…max. */
export function paging(startIndex: unknown, count: unknown, max = 200): { offset: number; limit: number; startIndex: number } {
  const s = Math.max(1, Math.floor(Number(startIndex ?? 1)) || 1);
  const n = count === undefined || count === '' ? 100 : Math.floor(Number(count));
  const limit = Number.isFinite(n) ? Math.min(Math.max(0, n), max) : 100;
  return { offset: s - 1, limit, startIndex: s };
}
