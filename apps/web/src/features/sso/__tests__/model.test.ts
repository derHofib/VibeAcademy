import {
  emailDomain,
  parseDomains,
  parseSsoFragment,
  safeTarget,
  ssoErrorMessage,
  ssoPayload,
  ssoStartUrl,
  stepUpStartUrl,
  validateSsoForm,
  type SsoFormValues,
} from '../model';

const form = (over: Partial<SsoFormValues> = {}): SsoFormValues => ({
  enabled: true,
  slug: 'muster',
  issuer: 'https://login.firma.de',
  clientId: 'client',
  clientSecret: '',
  hasClientSecret: true,
  scopes: 'openid email profile',
  domains: 'firma.de',
  ssoOnly: false,
  emergencyAdminAccountId: null,
  jitEnabled: true,
  defaultRoles: ['teilnehmer'],
  ...over,
});

describe('SSO-Logik', () => {
  it('E-Mail-Domain', () => {
    expect(emailDomain(' Max@Firma.DE ')).toBe('firma.de');
    expect(emailDomain('max@')).toBeNull();
    expect(emailDomain('')).toBeNull();
  });

  it('Start-URLs mit sicherem Ziel', () => {
    expect(ssoStartUrl({ email: 'max@firma.de', weiter: '/konto' })).toBe('/api/auth/sso/start?email=max%40firma.de&weiter=%2Fkonto');
    expect(ssoStartUrl({ tenant: 'muster', weiter: '//evil.example' })).toBe('/api/auth/sso/start?tenant=muster');
    expect(safeTarget('/\\evil')).toBeNull();
    expect(stepUpStartUrl('abc')).toBe('/api/auth/sso/step-up/start?purpose=signature%3Aabc');
  });

  it('Fehlertexte auf Deutsch, unbekannte Codes mit Standardtext', () => {
    expect(ssoErrorMessage('domain_not_allowed')).toContain('freigegebenen Domains');
    expect(ssoErrorMessage('reauth_required')).toContain('erneute Anmeldung');
    expect(ssoErrorMessage('quatsch')).toContain('fehlgeschlagen');
    expect(ssoErrorMessage(null)).toContain('fehlgeschlagen');
  });

  it('Rückleitungs-Fragment', () => {
    expect(parseSsoFragment('#sso=abcdefghijklmnopqrstuvwxyz012345')).toEqual({ ticket: 'abcdefghijklmnopqrstuvwxyz012345' });
    expect(parseSsoFragment('#sso-fehler=reauth_required')).toEqual({ error: 'reauth_required' });
    expect(parseSsoFragment('#sso=<script>')).toEqual({});
    expect(parseSsoFragment('')).toEqual({});
  });

  it('Domains aus dem Textfeld', () => {
    expect(parseDomains('Firma.de, @firma-gruppe.de;firma.de  werk.firma.de')).toEqual(['firma.de', 'firma-gruppe.de', 'werk.firma.de']);
  });

  it('Formularprüfung', () => {
    expect(validateSsoForm(form())).toEqual({});
    expect(Object.keys(validateSsoForm(form({ issuer: '', clientId: '', domains: '' })))).toEqual(['issuer', 'clientId', 'emailDomains']);
    expect(validateSsoForm(form({ domains: 'firma.de, kaputt' })).emailDomains).toContain('kaputt');
    expect(validateSsoForm(form({ scopes: 'email' })).scopes).toBeTruthy();
    expect(validateSsoForm(form({ enabled: false, ssoOnly: true })).ssoOnly).toBeTruthy();
    expect(validateSsoForm(form({ slug: 'A b' })).slug).toBeTruthy();
    // deaktiviert: Pflichtfelder entfallen
    expect(validateSsoForm(form({ enabled: false, issuer: '', clientId: '', domains: '' }))).toEqual({});
  });

  it('Payload: leeres Secret bleibt unverändert, Notfall-Admin nur bei „nur SSO“', () => {
    const p = ssoPayload(form({ emergencyAdminAccountId: 'x', domains: 'A.de b.de', slug: ' Muster ' }));
    expect(p).not.toHaveProperty('clientSecret');
    expect(p).toMatchObject({ emailDomains: ['a.de', 'b.de'], slug: 'muster', emergencyAdminAccountId: null });
    expect(ssoPayload(form({ clientSecret: 'geheim', ssoOnly: true, emergencyAdminAccountId: 'x' }))).toMatchObject({
      clientSecret: 'geheim',
      emergencyAdminAccountId: 'x',
    });
  });
});
