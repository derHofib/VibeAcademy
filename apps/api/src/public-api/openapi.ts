import { WEBHOOK_EVENT_DESCRIPTIONS, WEBHOOK_EVENTS } from '../webhooks/events';
import { MAX_LIMIT } from './pagination';
import { API_SCOPES, SCOPE_DESCRIPTIONS, type ApiScope } from './scopes';

/* Handgeschriebene OpenAPI-3.1-Beschreibung der öffentlichen API (E-37). Ein Integrationstest prüft, dass jede
   Route unter /api/v1 hier beschrieben ist und umgekehrt. */

type Schema = Record<string, unknown>;
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const str = (extra: Schema = {}): Schema => ({ type: 'string', ...extra });
const nstr = (extra: Schema = {}): Schema => ({ type: ['string', 'null'], ...extra });
const uuid: Schema = str({ format: 'uuid' });
const nuuid: Schema = nstr({ format: 'uuid' });
const dateTime: Schema = str({ format: 'date-time' });
const ndateTime: Schema = nstr({ format: 'date-time' });
const ndate: Schema = nstr({ format: 'date' });
const bool: Schema = { type: 'boolean' };
const int: Schema = { type: 'integer' };
const nint: Schema = { type: ['integer', 'null'] };
const obj = (properties: Record<string, Schema>, required: string[] = Object.keys(properties), extra: Schema = {}): Schema => ({
  type: 'object', properties, required, additionalProperties: false, ...extra,
});
const page = (item: string): Schema => obj({ data: { type: 'array', items: ref(item) }, nextCursor: nstr({ description: 'Für die nächste Seite als `cursor` übergeben; null = letzte Seite' }) });

const INV_STATUS = ['offen', 'geoeffnet', 'gelesen', 'bestanden', 'bestaetigt', 'ueberfaellig', 'befreit'];
const EXT_STATUS = ['entwurf', 'eingereicht', 'freigegeben', 'zurueckgegeben', 'abgelaufen', 'widerrufen'];
const STATES = ['gueltig', 'laeuft_ab', 'abgelaufen', 'fehlt', 'befreit'];

const schemas: Record<string, Schema> = {
  Error: obj(
    {
      statusCode: int,
      message: { description: 'Deutsche Fehlermeldung', oneOf: [str(), { type: 'array', items: str() }] },
      error: str(),
      fields: { type: 'array', items: obj({ path: str(), message: str() }) },
    },
    ['statusCode', 'message'],
    { additionalProperties: true },
  ),
  KeyInfo: obj({ keyId: uuid, name: str(), tenantId: uuid, scopes: { type: 'array', items: str({ enum: [...API_SCOPES] }) } }),
  Person: obj({
    id: uuid, externalId: nstr({ description: 'Kennung im Fremdsystem (z. B. HR/IdP), eindeutig je Mandant' }), name: str(), personalnr: nstr(),
    email: nstr({ format: 'email' }), mobile: nstr(), orgUnitId: nuuid, external: bool, language: str({ enum: ['de', 'en'] }), exitDate: ndate,
    hasAccount: bool, createdAt: dateTime, updatedAt: dateTime,
  }),
  PersonInput: obj(
    {
      name: str({ minLength: 1, maxLength: 200 }), externalId: nstr({ maxLength: 255 }), personalnr: nstr({ maxLength: 50 }), email: nstr({ format: 'email' }),
      mobile: nstr({ maxLength: 50 }), orgUnitId: nuuid, external: bool, language: str({ enum: ['de', 'en'] }), exitDate: ndate,
    },
    ['name'],
  ),
  PersonPatch: obj(
    {
      name: str({ minLength: 1, maxLength: 200 }), externalId: nstr({ maxLength: 255 }), personalnr: nstr({ maxLength: 50 }), email: nstr({ format: 'email' }),
      mobile: nstr({ maxLength: 50 }), orgUnitId: nuuid, external: bool, language: str({ enum: ['de', 'en'] }), exitDate: ndate,
    },
    [],
    { minProperties: 1 },
  ),
  OrgUnit: obj({ id: uuid, name: str(), parentId: nuuid, managerPersonId: nuuid, createdAt: dateTime }),
  VersionRef: obj({ id: uuid, versionNo: int, publishedAt: ndateTime }),
  Training: obj({
    id: uuid, title: str(), category: nstr(), legalBasis: nstr(), format: str({ enum: ['online', 'praesenz', 'hybrid', 'extern'] }), quizRequired: bool,
    archived: bool, archivedAt: ndateTime, currentVersion: { oneOf: [ref('VersionRef'), { type: 'null' }] }, createdAt: dateTime, updatedAt: dateTime,
  }),
  TrainingVersion: obj({
    id: uuid, trainingId: uuid, versionNo: int, status: str({ enum: ['hochgeladen', 'analyse', 'bereit', 'fehler', 'veroeffentlicht'] }), fileName: str(),
    fileSize: int, sha256: str({ pattern: '^[0-9a-f]{64}$' }), pageCount: nint, wordCount: nint, changeKind: nstr({ enum: ['redaktionell', 'inhaltlich', null] }),
    changeNote: nstr(), changedPages: { type: ['array', 'null'], items: int }, publishedAt: ndateTime, createdAt: dateTime,
  }),
  TrainingDetail: { allOf: [ref('Training'), obj({ versions: { type: 'array', items: ref('TrainingVersion') } })] },
  Run: obj({
    id: uuid, type: str({ enum: ['kampagne', 'termin', 'live_extern'] }), trainingId: nuuid, trainingVersionId: nuuid, title: nstr(),
    status: str({ enum: ['geplant', 'laeuft', 'beendet'] }), deadline: ndateTime, startAt: ndateTime, endAt: ndateTime, location: nstr(), endedAt: ndateTime,
    invitationCount: int, completedCount: int, createdAt: dateTime,
  }),
  InviteInput: obj(
    {
      personIds: { type: 'array', items: uuid, maxItems: 5000 }, orgUnitIds: { type: 'array', items: uuid, maxItems: 500, description: 'inkl. Unterbäume' },
      sendMail: { type: 'boolean', default: true },
    },
    [],
  ),
  InviteResult: obj({
    created: { type: 'array', items: obj({ id: uuid, personId: uuid }) }, skipped: { ...int, description: 'bereits eingeladen' },
    mailsQueued: int, withoutEmail: { type: 'array', items: uuid, description: 'Personen ohne E-Mail-Adresse (Link über die Verwaltung)' },
  }),
  RunCreate: obj(
    {
      trainingId: uuid, title: nstr({ maxLength: 300 }), deadline: nstr({ description: 'ISO-Zeitpunkt oder Datum (JJJJ-MM-TT); Standard aus den Einstellungen der Schulung' }),
      personIds: { type: 'array', items: uuid }, orgUnitIds: { type: 'array', items: uuid }, sendMail: { type: 'boolean', default: true },
    },
    ['trainingId'],
  ),
  RunCreated: { allOf: [ref('Run'), obj({ invitations: ref('InviteResult') })] },
  Invitation: obj({
    id: uuid, runId: uuid, personId: uuid, status: str({ enum: INV_STATUS }), overdue: bool, autoReason: nstr({ enum: ['fehlt', 'ablauf', 'neue_version', null] }),
    dueAt: ndateTime, sentAt: ndateTime, openedAt: ndateTime, readCompletedAt: ndateTime, completedAt: ndateTime, createdAt: dateTime, updatedAt: dateTime,
  }),
  Evidence: obj({
    id: uuid, kind: str({ enum: ['online', 'praesenz', 'live', 'extern'] }), status: str({ enum: ['ausstehend', 'erzeugt', 'fehler', 'widerrufen'] }),
    revokedAt: ndateTime, revokedReason: nstr(), nachweisNr: str(), verifyCode: str({ pattern: '^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$' }),
    sha256: nstr({ description: 'SHA-256 des Nachweis-PDFs' }), sealedAt: ndateTime, personId: nuuid, invitationId: nuuid, attendanceId: nuuid,
    externalRecordId: nuuid, retainUntil: ndate, pdfUrl: nstr(), createdAt: dateTime,
  }),
  EvidenceVerification: { allOf: [obj({ valid: bool }), ref('Evidence')] },
  Receipt: obj({ name: str(), mime: str({ enum: ['application/pdf', 'image/jpeg', 'image/png'] }), size: int, pages: int, sha256: nstr() }),
  ExternalRecord: obj({
    id: uuid, personId: uuid, groupId: nuuid, requirementId: nuuid, qualificationId: nuuid, trainingId: nuuid, title: nstr({ description: 'freier Kurstitel' }),
    provider: nstr(), heldOn: ndate, durationHours: { type: ['number', 'null'] }, durationLabel: nstr(), location: nstr(), validUntil: ndate, isMedical: bool,
    source: str({ enum: ['verwaltung', 'selbst', 'import'] }), status: str({ enum: EXT_STATUS }), receipts: { type: 'array', items: ref('Receipt') },
    submittedAt: ndateTime, reviewedAt: ndateTime, reviewNote: nstr(), supersedes: nuuid, createdAt: dateTime, updatedAt: dateTime,
  }),
  ExternalRecordCreate: obj(
    {
      personIds: { type: 'array', items: uuid, minItems: 1, maxItems: 500 }, requirementId: nuuid, trainingId: nuuid, title: nstr({ maxLength: 300 }),
      provider: nstr(), heldOn: ndate, durationHours: { type: ['number', 'null'] }, durationLabel: nstr(), location: nstr(),
      validUntil: { ...ndate, description: 'Standard: Schulungsdatum + Intervall der Anforderung bzw. Schulung' }, isMedical: bool,
      review: { type: 'boolean', default: false, description: 'true: zur Prüfung einreichen statt sofort freigeben' },
    },
    ['personIds'],
  ),
  ExternalRecordCreated: obj({
    groupId: nuuid, status: str({ enum: ['freigegeben', 'eingereicht'] }),
    records: { type: 'array', items: { allOf: [ref('ExternalRecord'), obj({ evidenceId: nuuid })] } },
  }),
  ComplianceRow: obj({
    personId: uuid, requirementId: uuid, qualificationId: uuid, trainingId: uuid, state: str({ enum: STATES }), exempt: bool, lastCompletedOn: ndate,
    validUntil: ndate, expiresOn: ndate, intervalMonths: int, graceDays: int, source: nstr({ enum: ['online', 'extern', 'praesenz', 'live', null] }), sourceId: nuuid,
  }),
  CompliancePage: { allOf: [obj({ at: dateTime }), page('ComplianceRow')] },
  Qualification: obj({ id: uuid, name: str(), description: nstr(), createdAt: dateTime }),
  Requirement: obj({
    id: uuid, qualificationId: uuid, trainingId: uuid, intervalMonths: int, graceDays: int, reinviteDays: int, autoInvite: bool, active: bool, createdAt: dateTime,
  }),
  WebhookEndpoint: obj({
    id: uuid, url: str({ format: 'uri' }), description: nstr(), events: { type: 'array', items: str({ enum: [...WEBHOOK_EVENTS] }) }, active: bool,
    failureCount: { ...int, description: 'Fehlversuche in Folge' }, disabledAt: ndateTime, disabledReason: nstr(), lastSuccessAt: ndateTime,
    lastFailureAt: ndateTime, createdAt: dateTime, updatedAt: dateTime,
  }),
  WebhookEndpointCreated: { allOf: [ref('WebhookEndpoint'), obj({ secret: str({ description: 'Signaturgeheimnis (whsec_…) – wird nur einmal angezeigt' }) })] },
  WebhookEndpointInput: obj(
    {
      url: str({ format: 'uri', description: 'https://… (http nur zu localhost in Entwicklung)' }), description: nstr({ maxLength: 200 }),
      events: { type: 'array', items: str({ enum: [...WEBHOOK_EVENTS] }), minItems: 1 }, active: { type: 'boolean', default: true },
    },
    ['url', 'events'],
  ),
  WebhookEndpointPatch: obj(
    {
      url: str({ format: 'uri' }), description: nstr({ maxLength: 200 }), events: { type: 'array', items: str({ enum: [...WEBHOOK_EVENTS] }), minItems: 1 },
      active: { type: 'boolean', description: 'true setzt auch den Fehlerzähler zurück' },
    },
    [],
    { minProperties: 1 },
  ),
  WebhookSecret: obj({ secret: str() }),
  WebhookPing: obj({ eventId: uuid, deliveryId: uuid }),
  WebhookDelivery: obj({
    id: uuid, eventId: uuid, eventType: str(), status: str({ enum: ['pending', 'sending', 'succeeded', 'failed'] }), attempts: int, nextAttemptAt: ndateTime,
    lastAttemptAt: ndateTime, responseCode: nint, lastError: nstr(), durationMs: nint, deliveredAt: ndateTime, redeliveryOf: nuuid, createdAt: dateTime,
    data: { type: 'object', additionalProperties: true },
  }),
  WebhookEnvelope: obj({
    id: { ...uuid, description: 'Ereignis-ID – gleich bei Wiederholungen und manueller erneuter Zustellung' },
    type: str({ enum: [...WEBHOOK_EVENTS, 'test.ping'] }), createdAt: dateTime, tenantId: uuid, data: { type: 'object', additionalProperties: true },
  }),
  InvitationCompletedData: obj({ invitationId: uuid, runId: uuid, personId: uuid, trainingId: nuuid, status: str(), completedAt: ndateTime }),
  EvidenceCreatedData: obj({
    evidenceId: uuid, kind: str(), status: str(), personId: nuuid, invitationId: nuuid, attendanceId: nuuid, externalRecordId: nuuid, nachweisNr: str(), sha256: nstr(),
  }),
  ExternalRecordApprovedData: obj({
    externalRecordId: uuid, personId: uuid, requirementId: nuuid, qualificationId: nuuid, trainingId: nuuid, status: str(), heldOn: ndate, validUntil: ndate,
  }),
  AttendanceConfirmedData: obj({
    attendanceId: uuid, runId: uuid, personId: uuid, invitationId: nuuid, completeness: str({ enum: ['vollstaendig', 'teilweise'] }), credited: bool, confirmedAt: ndateTime,
  }),
  ComplianceStateChangedData: obj({
    personId: uuid, requirementId: uuid, qualificationId: uuid, trainingId: uuid, previousState: nstr({ enum: [...STATES, null] }), state: str({ enum: STATES }),
    validUntil: ndate, checkedAt: dateTime,
  }),
  TestPingData: obj({ endpointId: uuid, message: str() }),
};

const parameters: Record<string, Schema> = {
  id: { name: 'id', in: 'path', required: true, schema: uuid },
  deliveryId: { name: 'deliveryId', in: 'path', required: true, schema: uuid },
  code: { name: 'code', in: 'path', required: true, schema: str({ pattern: '^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$' }), description: 'Prüfcode vom Nachweis' },
  limit: { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: 50 } },
  cursor: { name: 'cursor', in: 'query', schema: str(), description: '`nextCursor` der vorherigen Seite' },
};
const q = (name: string, schema: Schema, description?: string): Schema => ({ name, in: 'query', schema, ...(description ? { description } : {}) });
const pRef = (n: string): Schema => ({ $ref: `#/components/parameters/${n}` });
const PAGING = [pRef('limit'), pRef('cursor')];

const ERR: Record<number, string> = {
  400: 'Ungültige Eingabe', 401: 'API-Schlüssel fehlt, ist ungültig, widerrufen oder abgelaufen', 403: 'Scope fehlt', 404: 'Nicht gefunden',
  409: 'Konflikt', 429: 'Rate-Limit überschritten (Header Retry-After)',
};
const errors = (...codes: number[]) =>
  Object.fromEntries([401, 429, ...codes].map((c) => [String(c), { description: ERR[c], content: { 'application/json': { schema: ref('Error') } } }]));

interface Op {
  tag: string;
  summary: string;
  description?: string;
  scope: ApiScope | null;
  params?: Schema[];
  body?: Schema;
  multipart?: boolean;
  status?: number;
  response?: Schema | null;
  responseType?: string;
  errors?: number[];
}
function op(o: Op) {
  const status = String(o.status ?? 200);
  const scopeNote = o.scope ? `Scope: \`${o.scope}\`` : 'Jeder gültige API-Schlüssel';
  return {
    tags: [o.tag],
    summary: o.summary,
    description: [o.description, scopeNote].filter(Boolean).join('\n\n'),
    'x-required-scope': o.scope,
    security: [{ bearerAuth: [] }],
    ...(o.params?.length ? { parameters: o.params } : {}),
    ...(o.body
      ? {
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: o.body },
              ...(o.multipart
                ? {
                    'multipart/form-data': {
                      schema: obj(
                        {
                          data: str({ description: 'JSON wie bei application/json' }),
                          receipts: { type: 'array', items: str({ contentMediaType: 'application/octet-stream' }), maxItems: 10, description: 'Belege (PDF/JPG/PNG)' },
                        },
                        ['data'],
                      ),
                    },
                  }
                : {}),
            },
          },
        }
      : {}),
    responses: {
      [status]: {
        description: o.status === 204 ? 'Erledigt' : 'Erfolg',
        ...(o.response === null || o.status === 204
          ? {}
          : { content: { [o.responseType ?? 'application/json']: { schema: o.response ?? { type: 'object' } } } }),
      },
      ...errors(...(o.scope ? [403] : []), ...(o.errors ?? [])),
    },
  };
}

const paths: Record<string, Record<string, unknown>> = {
  '/openapi.json': {
    get: {
      tags: ['Allgemein'], summary: 'Diese Beschreibung (OpenAPI 3.1)', security: [],
      responses: { '200': { description: 'OpenAPI-Dokument', content: { 'application/json': { schema: { type: 'object' } } } } },
    },
  },
  '/me': { get: op({ tag: 'Allgemein', summary: 'Angaben zum verwendeten API-Schlüssel', scope: null, response: ref('KeyInfo') }) },
  '/persons': {
    get: op({
      tag: 'Personen', summary: 'Personen auflisten (sortiert nach updatedAt)', scope: 'persons:read', response: page('Person'), errors: [400],
      params: [
        q('externalId', str()), q('personalnr', str()), q('email', str({ format: 'email' })), q('orgUnitId', uuid),
        q('updatedSince', dateTime, 'nur Personen, die seitdem geändert wurden'), ...PAGING,
      ],
    }),
    post: op({ tag: 'Personen', summary: 'Person anlegen', scope: 'persons:write', body: ref('PersonInput'), status: 201, response: ref('Person'), errors: [400, 409] }),
  },
  '/persons/{id}': {
    get: op({ tag: 'Personen', summary: 'Person lesen', scope: 'persons:read', params: [pRef('id')], response: ref('Person'), errors: [400, 404] }),
    patch: op({ tag: 'Personen', summary: 'Person ändern', scope: 'persons:write', params: [pRef('id')], body: ref('PersonPatch'), response: ref('Person'), errors: [400, 404, 409] }),
  },
  '/org-units': { get: op({ tag: 'Personen', summary: 'Org-Einheiten auflisten', scope: 'persons:read', params: PAGING, response: page('OrgUnit'), errors: [400] }) },
  '/trainings': {
    get: op({
      tag: 'Schulungen', summary: 'Schulungen auflisten', scope: 'trainings:read', response: page('Training'), errors: [400],
      params: [q('format', str({ enum: ['online', 'praesenz', 'hybrid', 'extern'] })), q('archived', str({ enum: ['true', 'false'] })), q('updatedSince', dateTime), ...PAGING],
    }),
  },
  '/trainings/{id}': {
    get: op({ tag: 'Schulungen', summary: 'Schulung mit Versionen (Metadaten)', scope: 'trainings:read', params: [pRef('id')], response: ref('TrainingDetail'), errors: [400, 404] }),
  },
  '/trainings/{id}/versions': {
    get: op({ tag: 'Schulungen', summary: 'Versionen einer Schulung', scope: 'trainings:read', params: [pRef('id')], response: page('TrainingVersion'), errors: [400, 404] }),
  },
  '/runs': {
    get: op({
      tag: 'Durchführungen', summary: 'Durchführungen auflisten', scope: 'runs:read', response: page('Run'), errors: [400],
      params: [q('trainingId', uuid), q('type', str({ enum: ['kampagne', 'termin', 'live_extern'] })), q('status', str({ enum: ['geplant', 'laeuft', 'beendet'] })), q('createdSince', dateTime), ...PAGING],
    }),
    post: op({
      tag: 'Durchführungen', summary: 'Online-Kampagne anlegen (aktuelle veröffentlichte Version) und optional einladen', scope: 'runs:write',
      body: ref('RunCreate'), status: 201, response: ref('RunCreated'), errors: [400],
    }),
  },
  '/runs/{id}': { get: op({ tag: 'Durchführungen', summary: 'Durchführung lesen', scope: 'runs:read', params: [pRef('id')], response: ref('Run'), errors: [400, 404] }) },
  '/runs/{id}/invitations': {
    post: op({
      tag: 'Durchführungen', summary: 'Personen/Org-Einheiten zu einer Kampagne einladen (bereits Eingeladene werden übersprungen)', scope: 'runs:write',
      params: [pRef('id')], body: ref('InviteInput'), status: 201, response: ref('InviteResult'), errors: [400, 404],
    }),
  },
  '/invitations': {
    get: op({
      tag: 'Durchführungen', summary: 'Einladungen und Status (sortiert nach updatedAt – für Abgleich mit updatedSince)', scope: 'runs:read', response: page('Invitation'), errors: [400],
      params: [q('personId', uuid), q('runId', uuid), q('status', str({ enum: INV_STATUS })), q('updatedSince', dateTime), ...PAGING],
    }),
  },
  '/invitations/{id}': {
    get: op({ tag: 'Durchführungen', summary: 'Einladung lesen', scope: 'runs:read', params: [pRef('id')], response: ref('Invitation'), errors: [400, 404] }),
  },
  '/evidence': {
    get: op({
      tag: 'Nachweise', summary: 'Nachweise auflisten', scope: 'evidence:read', response: page('Evidence'), errors: [400],
      params: [
        q('personId', uuid), q('kind', str({ enum: ['online', 'praesenz', 'live', 'extern'] })), q('status', str({ enum: ['ausstehend', 'erzeugt', 'fehler', 'widerrufen'] })),
        q('invitationId', uuid), q('externalRecordId', uuid), q('createdSince', dateTime), ...PAGING,
      ],
    }),
  },
  '/evidence/{id}': { get: op({ tag: 'Nachweise', summary: 'Nachweis (Metadaten)', scope: 'evidence:read', params: [pRef('id')], response: ref('Evidence'), errors: [400, 404] }) },
  '/evidence/{id}/pdf': {
    get: op({
      tag: 'Nachweise', summary: 'Nachweis-PDF herunterladen', description: 'Header `X-Content-SHA256` = SHA-256 der Datei (wie `sha256`).',
      scope: 'evidence:read', params: [pRef('id')], response: str({ contentMediaType: 'application/pdf' }), responseType: 'application/pdf', errors: [400, 404],
    }),
  },
  '/evidence/verify/{code}': {
    get: op({ tag: 'Nachweise', summary: 'Prüfcode im eigenen Mandanten auflösen', scope: 'evidence:read', params: [pRef('code')], response: ref('EvidenceVerification'), errors: [404] }),
  },
  '/external-records': {
    get: op({
      tag: 'Externe Nachweise', summary: 'Externe Nachweise auflisten', scope: 'external:read', response: page('ExternalRecord'), errors: [400],
      params: [q('personId', uuid), q('status', str({ enum: EXT_STATUS })), q('updatedSince', dateTime), ...PAGING],
    }),
    post: op({
      tag: 'Externe Nachweise',
      summary: 'Externen Nachweis erfassen (wie „Verwaltung erfasst“)',
      description:
        'Gilt sofort (Status `freigegeben`, Nachweis wird erzeugt, Webhook `external_record.approved`) oder mit `review: true` zur Prüfung. ' +
        'Belege als `multipart/form-data` (Feld `data` = JSON, Dateien `receipts`); ein Beleg gilt für alle angegebenen Personen.',
      scope: 'external:write', body: ref('ExternalRecordCreate'), multipart: true, status: 201, response: ref('ExternalRecordCreated'), errors: [400, 413],
    }),
  },
  '/external-records/{id}': {
    get: op({ tag: 'Externe Nachweise', summary: 'Externen Nachweis lesen', scope: 'external:read', params: [pRef('id')], response: ref('ExternalRecord'), errors: [400, 404] }),
  },
  '/compliance': {
    get: op({
      tag: 'Pflichtmatrix', summary: 'Erfüllungsstand je Person × Anforderung (Stichtag jetzt)', scope: 'compliance:read', response: ref('CompliancePage'), errors: [400],
      params: [q('personId', uuid), q('requirementId', uuid), q('qualificationId', uuid), q('state', str({ enum: STATES })), q('orgUnitId', uuid, 'inkl. Unterbäume'), ...PAGING],
    }),
  },
  '/qualifications': { get: op({ tag: 'Pflichtmatrix', summary: 'Qualifikationen/Tätigkeiten', scope: 'compliance:read', params: PAGING, response: page('Qualification'), errors: [400] }) },
  '/requirements': {
    get: op({
      tag: 'Pflichtmatrix', summary: 'Anforderungen (Qualifikation → Schulung, Intervall)', scope: 'compliance:read', response: page('Requirement'), errors: [400],
      params: [q('qualificationId', uuid), q('trainingId', uuid), ...PAGING],
    }),
  },
  '/webhooks': {
    get: op({ tag: 'Webhooks', summary: 'Webhook-Endpunkte', scope: 'webhooks:manage', response: page('WebhookEndpoint') }),
    post: op({ tag: 'Webhooks', summary: 'Endpunkt anlegen (Geheimnis nur in dieser Antwort)', scope: 'webhooks:manage', body: ref('WebhookEndpointInput'), status: 201, response: ref('WebhookEndpointCreated'), errors: [400, 409] }),
  },
  '/webhooks/{id}': {
    get: op({ tag: 'Webhooks', summary: 'Endpunkt lesen', scope: 'webhooks:manage', params: [pRef('id')], response: ref('WebhookEndpoint'), errors: [400, 404] }),
    patch: op({ tag: 'Webhooks', summary: 'Endpunkt ändern / (re)aktivieren', scope: 'webhooks:manage', params: [pRef('id')], body: ref('WebhookEndpointPatch'), response: ref('WebhookEndpoint'), errors: [400, 404] }),
    delete: op({ tag: 'Webhooks', summary: 'Endpunkt löschen (inkl. Zustellprotokoll)', scope: 'webhooks:manage', params: [pRef('id')], status: 204, response: null, errors: [400, 404] }),
  },
  '/webhooks/{id}/rotate-secret': {
    post: op({ tag: 'Webhooks', summary: 'Neues Signaturgeheimnis (altes sofort ungültig)', scope: 'webhooks:manage', params: [pRef('id')], response: ref('WebhookSecret'), errors: [400, 404] }),
  },
  '/webhooks/{id}/ping': {
    post: op({ tag: 'Webhooks', summary: 'Testereignis `test.ping` senden (ein Versuch)', scope: 'webhooks:manage', params: [pRef('id')], status: 202, response: ref('WebhookPing'), errors: [400, 404] }),
  },
  '/webhooks/{id}/deliveries': {
    get: op({
      tag: 'Webhooks', summary: 'Zustellprotokoll (neueste zuerst)', scope: 'webhooks:manage', response: page('WebhookDelivery'), errors: [400, 404],
      params: [pRef('id'), q('status', str({ enum: ['pending', 'sending', 'succeeded', 'failed'] })), ...PAGING],
    }),
  },
  '/webhooks/{id}/deliveries/{deliveryId}/redeliver': {
    post: op({
      tag: 'Webhooks', summary: 'Ereignis erneut zustellen (neue Zustellung, gleiche Ereignis-ID)', scope: 'webhooks:manage', params: [pRef('id'), pRef('deliveryId')],
      status: 202, response: ref('WebhookDelivery'), errors: [400, 404, 409],
    }),
  },
};

const DATA_SCHEMA: Record<string, string> = {
  'invitation.completed': 'InvitationCompletedData',
  'evidence.created': 'EvidenceCreatedData',
  'external_record.approved': 'ExternalRecordApprovedData',
  'attendance.confirmed': 'AttendanceConfirmedData',
  'compliance.state_changed': 'ComplianceStateChangedData',
  'test.ping': 'TestPingData',
};
const webhooks = Object.fromEntries(
  [...WEBHOOK_EVENTS, 'test.ping' as const].map((type) => [
    type,
    {
      post: {
        summary: WEBHOOK_EVENT_DESCRIPTIONS[type],
        parameters: [
          { name: 'Schulungsnachweis-Event', in: 'header', required: true, schema: str({ const: type }) },
          { name: 'Schulungsnachweis-Delivery', in: 'header', required: true, schema: uuid, description: 'Zustell-ID (gleich bei automatischen Wiederholungen)' },
          { name: 'Schulungsnachweis-Signature', in: 'header', required: true, schema: str({ pattern: '^t=\\d+,v1=[0-9a-f]{64}$' }) },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: { allOf: [ref('WebhookEnvelope'), obj({ type: str({ const: type }), data: ref(DATA_SCHEMA[type]!) }, ['type', 'data'], { additionalProperties: true })] },
            },
          },
        },
        responses: { '2XX': { description: 'Empfang bestätigt (alles andere gilt als Fehlversuch)' } },
      },
    },
  ]),
);

const DESCRIPTION = `
Öffentliche, versionierte REST-API von Schulungsnachweis (E-37). Alle Antworten sind JSON (außer PDF-Download),
Feldnamen englisch in camelCase, Zeitpunkte ISO 8601 in UTC, Kalendertage als \`JJJJ-MM-TT\`. Fachliche Statuswerte
sind die deutschen Schlüssel der Anwendung (z. B. \`bestaetigt\`, \`freigegeben\`). Fehlermeldungen sind deutsch.

## Authentifizierung
API-Schlüssel legt ein Mandanten-Admin unter **Verwaltung → Schnittstellen** an (der Schlüssel wird nur einmal angezeigt):

    Authorization: Bearer sn_live_<präfix>_<geheimnis>

Jeder Schlüssel gehört zu genau einer Organisation (Mandant) und sieht nur deren Daten. Cookie-Sitzungen der
Oberfläche gelten unter \`/api/v1\` nicht; ein CSRF-Token ist nicht nötig. Scopes:

${API_SCOPES.map((s) => `- \`${s}\` – ${SCOPE_DESCRIPTIONS[s]}`).join('\n')}

Fehlender Scope → \`403\`; fehlender, ungültiger, widerrufener oder abgelaufener Schlüssel → \`401\`.

## Rate-Limit
Je Schlüssel und Minute (Standard 600). Header \`X-RateLimit-Limit\`, \`X-RateLimit-Remaining\`, \`X-RateLimit-Reset\`;
bei Überschreitung \`429\` mit \`Retry-After\` (Sekunden).

## Paginierung
Listen liefern \`{ "data": [...], "nextCursor": "…" | null }\`. Parameter \`limit\` (1–${MAX_LIMIT}, Standard 50) und
\`cursor\` (Wert von \`nextCursor\`). Sortierung stabil (z. B. \`updatedAt\`, dann \`id\`); mit \`updatedSince\` lassen sich
Änderungen inkrementell abgleichen.

## Webhooks
Endpunkte (nur \`https://\`) werden in der Oberfläche oder über \`/webhooks\` verwaltet. Jede Zustellung ist ein
\`POST\` mit JSON-Body \`{ id, type, createdAt, tenantId, data }\` – \`data\` enthält **nur IDs und Status**, keine Namen
oder E-Mail-Adressen; Details über die API abrufen. Ereignisse: ${WEBHOOK_EVENTS.map((e) => `\`${e}\``).join(', ')} sowie \`test.ping\`.

Header:
- \`Schulungsnachweis-Event\`: Ereignistyp
- \`Schulungsnachweis-Delivery\`: Zustell-ID (Idempotenzschlüssel, gleich bei Wiederholungen); \`id\` im Body ist die Ereignis-ID
  (gleich auch bei manueller erneuter Zustellung) – Empfänger sollten Duplikate über die Ereignis-ID verwerfen
- \`Schulungsnachweis-Signature\`: \`t=<Unix-Sekunden>,v1=<hex>\`

Antwortet der Empfänger nicht innerhalb von 10 s mit \`2xx\`, wird mit exponentiellem Backoff wiederholt (Standard 6 Versuche:
1, 2, 4, 8, 16 min). Weiterleitungen werden nicht verfolgt. Nach 20 Fehlversuchen in Folge wird der Endpunkt deaktiviert
(Reaktivieren in der Oberfläche oder per \`PATCH /webhooks/{id}\` mit \`active: true\`; ausstehende Zustellungen werden dann nachgeholt).

### Signatur prüfen
\`v1\` ist \`HMAC-SHA256(geheimnis, "<t>.<roher Body>")\` als Hex. Den **rohen** Body (Bytes wie empfangen) verwenden,
in konstanter Zeit vergleichen und Zeitstempel älter als 5 Minuten verwerfen:

\`\`\`js
import { createHmac, timingSafeEqual } from 'node:crypto';
function verify(secret, rawBody, header, toleranceSec = 300) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=')));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(\`\${t}.\${rawBody}\`).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(parts.v1 ?? '');
  return a.length === b.length && timingSafeEqual(a, b);
}
\`\`\`
`.trim();

export function buildOpenApi() {
  return {
    openapi: '3.1.0',
    info: { title: 'Schulungsnachweis API', version: '1.0.0', description: DESCRIPTION },
    servers: [{ url: '/api/v1' }],
    security: [{ bearerAuth: [] }],
    tags: ['Allgemein', 'Personen', 'Schulungen', 'Durchführungen', 'Nachweise', 'Externe Nachweise', 'Pflichtmatrix', 'Webhooks'].map((name) => ({ name })),
    paths,
    webhooks,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'sn_live_<prefix>_<secret>' } },
      schemas,
      parameters,
    },
  };
}
