import { SCHEMA } from './scim-http';

/** Discovery-Ressourcen (RFC 7643 §5–7) für die unterstützte Teilmenge. */
export function serviceProviderConfig(base: string) {
  return {
    schemas: [SCHEMA.spc],
    documentationUri: 'https://datatracker.ietf.org/doc/html/rfc7644',
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: 'oauthbearertoken',
        name: 'Bearer-Token',
        description: 'Token je Organisation aus den Einstellungen („Anmeldung & Benutzerverwaltung“)',
        primary: true,
      },
    ],
    meta: { resourceType: 'ServiceProviderConfig', location: `${base}/ServiceProviderConfig` },
  };
}

const attr = (
  name: string,
  type: string,
  extra: Partial<{ multiValued: boolean; required: boolean; caseExact: boolean; mutability: string; uniqueness: string; returned: string; description: string; subAttributes: unknown[] }> = {},
) => ({
  name,
  type,
  multiValued: false,
  required: false,
  caseExact: false,
  mutability: 'readWrite',
  returned: 'default',
  uniqueness: 'none',
  ...extra,
});

export const SCHEMAS = [
  {
    schemas: [SCHEMA.schema],
    id: SCHEMA.user,
    name: 'User',
    description: 'Person (Mitarbeitende) im Mandanten',
    attributes: [
      attr('userName', 'string', { required: true, uniqueness: 'server', description: 'Eindeutiger Anmeldename (meist E-Mail/UPN)' }),
      attr('name', 'complex', {
        subAttributes: [attr('formatted', 'string'), attr('givenName', 'string'), attr('familyName', 'string')],
      }),
      attr('displayName', 'string'),
      attr('active', 'boolean', { description: 'false = ausgetreten (Austrittsdatum, Mitgliedschaft gelöst)' }),
      attr('emails', 'complex', {
        multiValued: true,
        subAttributes: [attr('value', 'string'), attr('type', 'string'), attr('primary', 'boolean')],
      }),
      attr('phoneNumbers', 'complex', { multiValued: true, subAttributes: [attr('value', 'string'), attr('type', 'string')] }),
      attr('groups', 'complex', { multiValued: true, mutability: 'readOnly', subAttributes: [attr('value', 'string'), attr('display', 'string')] }),
    ],
  },
  {
    schemas: [SCHEMA.schema],
    id: SCHEMA.enterprise,
    name: 'EnterpriseUser',
    description: 'Unternehmenserweiterung: Personalnummer, Abteilung (→ Org-Einheit), Vorgesetzte (→ Leitung der Org-Einheit)',
    attributes: [
      attr('employeeNumber', 'string'),
      attr('department', 'string'),
      attr('manager', 'complex', { subAttributes: [attr('value', 'string'), attr('displayName', 'string', { mutability: 'readOnly' })] }),
    ],
  },
  {
    schemas: [SCHEMA.schema],
    id: SCHEMA.group,
    name: 'Group',
    description: 'Org-Einheit; Mitglieder sind Personen (eine Person gehört zu genau einer Org-Einheit)',
    attributes: [
      attr('displayName', 'string', { required: true }),
      attr('members', 'complex', { multiValued: true, subAttributes: [attr('value', 'string'), attr('display', 'string', { mutability: 'readOnly' })] }),
    ],
  },
];

export const RESOURCE_TYPES = [
  {
    schemas: [SCHEMA.resourceType],
    id: 'User',
    name: 'User',
    endpoint: '/Users',
    schema: SCHEMA.user,
    schemaExtensions: [{ schema: SCHEMA.enterprise, required: false }],
  },
  { schemas: [SCHEMA.resourceType], id: 'Group', name: 'Group', endpoint: '/Groups', schema: SCHEMA.group },
];
