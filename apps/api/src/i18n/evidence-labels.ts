import type { Lang } from './language';

/** Beschriftungen des Nachweis-PDFs (Online-Unterweisung) je Sprache (E-39). Inhalte (Titel, Bestätigungstext) bleiben im Original. */
export interface EvidenceLabels {
  htmlLang: string;
  docTitle: (nr: string) => string;
  title: string;
  nrCreated: (nr: string, at: string) => string;
  verifyQr: string;
  training: string;
  version: (n: number) => string;
  legalBasis: string;
  format: string;
  pages: (n: number) => string;
  instructor: string;
  docSha: string;
  participant: string;
  personnelNo: string;
  invited: string;
  processed: (range: string, sessions: number) => string;
  readingTotal: (ist: string, soll: string) => string;
  plausibilityWarn: string;
  pageLog: string;
  pageShort: string;
  pageOptional: string;
  pageLogNote: string;
  quiz: string;
  attempt: (no: number, right: number, total: number, pct: number, passed: boolean) => string;
  passRule: (pct: number, max: number) => string;
  quizNotRequired: string;
  quizNotRequiredReinvite: string;
  validity: string;
  validUntil: string;
  repetition: string;
  repetitionText: (months: number) => string;
  confirmation: string;
  signatureAlt: string;
  auth: string;
  device: string;
  ipHash: string;
  confirmSha: string;
  footerTamper: (url: string) => string;
  authMethods: Record<string, string>;
  formats: Record<string, string>;
  deviceUnknown: string;
  deviceMobile: string;
  deviceDesktop: string;
  reinviteTitle: string;
  reinviteText: (pages: string) => string;
  levelLabel: string;
  levels: Record<'ees' | 'fes' | 'qes', string>;
  provider: (name: string, tx: string) => string;
  signer: (subject: string) => string;
  signedDocument: (format: string, sha: string) => string;
  signedDocumentAttached: string;
  testProvider: string;
  signedAtProvider: string;
  sealed: (tenant: string, qualifiedTsa: boolean) => string;
  unsealed: string;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const EVIDENCE_LABELS: Record<Lang, EvidenceLabels> = {
  de: {
    htmlLang: 'de',
    docTitle: (nr) => `Nachweis ${nr}`,
    title: 'Nachweis über Unterweisung und Kenntnisnahme',
    nrCreated: (nr, at) => `Nachweis-Nr. ${nr} · erstellt ${at}`,
    verifyQr: 'Echtheit prüfen',
    training: 'Schulung',
    version: (n) => `Version ${n}`,
    legalBasis: 'Rechtsgrundlage',
    format: 'Format',
    pages: (n) => `${n} ${plural(n, 'Seite', 'Seiten')}`,
    instructor: 'Unterweisender',
    docSha: 'Dokument SHA-256',
    participant: 'Teilnehmer/in',
    personnelNo: 'Pers.-Nr.',
    invited: 'Eingeladen',
    processed: (range, n) => `Bearbeitet: ${range} in ${n} ${plural(n, 'Sitzung', 'Sitzungen')}`,
    readingTotal: (ist, soll) => `Lesezeit gesamt: ${ist} (Mindestzeit ${soll})`,
    plausibilityWarn: 'Hinweis: Lesezeit auffällig kurz (Plausibilitätsprüfung)',
    pageLog: 'Seitenprotokoll',
    pageShort: 'S.',
    pageOptional: 'freiwillig',
    pageLogNote:
      'Ist-Verweildauer / Soll · erstmals angezeigt (Datum). Gezählt nur bei sichtbarer Seite, aktivem Fenster und Interaktion; maßgeblich ist die Serverzeit.',
    quiz: 'Wissenscheck',
    attempt: (no, right, total, pct, passed) => `Versuch ${no}: ${right} von ${total} (${pct} %) – ${passed ? '<b>bestanden</b>' : 'nicht bestanden'}`,
    passRule: (pct, max) => `Bestehensgrenze ${pct} %, max. ${max} Versuche`,
    quizNotRequired: 'Für diese Unterweisung nicht vorgesehen',
    quizNotRequiredReinvite: 'Bei der Nachschulung geänderter Seiten nicht verlangt',
    validity: 'Gültigkeit',
    validUntil: 'Gültig bis',
    repetition: 'Wiederholung',
    repetitionText: (m) => (m === 12 ? 'jährlich, automatische Einladung' : `alle ${m} Monate, automatische Einladung`),
    confirmation: 'Bestätigung',
    signatureAlt: 'Unterschrift',
    auth: 'Authentifizierung',
    device: 'Gerät',
    ipHash: 'IP-Hash',
    confirmSha: 'Best.-Text SHA-256',
    footerTamper: (url) => `Jede nachträgliche Änderung macht die Versiegelung ungültig. Prüfung über den QR-Code oben rechts: ${url}`,
    authMethods: {
      password: 'Passwort (Re-Auth)', otp_mail: 'Einmalcode per E-Mail', otp_sms: 'Einmalcode per SMS', sso: 'Single Sign-on (Step-up)',
      provider: 'Identifizierung beim Signaturanbieter',
    },
    formats: { online: 'Online mit Wissenscheck', praesenz: 'Präsenz', hybrid: 'Hybrid', extern: 'Extern' },
    deviceUnknown: 'unbekannt',
    deviceMobile: 'Mobil',
    deviceDesktop: 'PC',
    reinviteTitle: 'Nachschulung geänderter Seiten',
    reinviteText: (pages) => `Neueinladung nach inhaltlicher Änderung. Verlangt waren nur die geänderten Seiten ${pages}; die übrigen Seiten waren freiwillig.`,
    levelLabel: 'Signaturniveau',
    levels: {
      ees: 'Einfache elektronische Signatur (EES)',
      fes: 'Fortgeschrittene elektronische Signatur (FES)',
      qes: 'Qualifizierte elektronische Signatur (QES)',
    },
    provider: (name, tx) => `Anbieter: ${name} · Vorgang ${tx}`,
    signer: (subject) => `Zertifikat: ${subject}`,
    signedDocument: (format, sha) => `Signiertes Dokument (${format}), SHA-256 ${sha}`,
    signedDocumentAttached: 'Das vom Anbieter signierte Dokument ist diesem PDF als Dateianhang beigefügt.',
    testProvider: 'TEST-ANBIETER – keine rechtsgültige fortgeschrittene oder qualifizierte Signatur',
    signedAtProvider: 'Elektronisch signiert beim Signaturanbieter',
    sealed: (tenant, q) => `Elektronisch versiegelt (PAdES-B-T) für ${tenant} · Zeitstempel nach RFC 3161 in der Signatur${q ? '' : ' (Test-Zeitstempeldienst, nicht qualifiziert)'}.`,
    unsealed: 'ENTWICKLUNGSVERSION – nicht versiegelt.',
  },
  en: {
    htmlLang: 'en',
    docTitle: (nr) => `Record ${nr}`,
    title: 'Record of Instruction and Acknowledgement',
    nrCreated: (nr, at) => `Record no. ${nr} · created ${at}`,
    verifyQr: 'Verify authenticity',
    training: 'Training',
    version: (n) => `Version ${n}`,
    legalBasis: 'Legal basis',
    format: 'Format',
    pages: (n) => `${n} ${plural(n, 'page', 'pages')}`,
    instructor: 'Instructor',
    docSha: 'Document SHA-256',
    participant: 'Participant',
    personnelNo: 'Staff no.',
    invited: 'Invited',
    processed: (range, n) => `Completed: ${range} in ${n} ${plural(n, 'session', 'sessions')}`,
    readingTotal: (ist, soll) => `Total reading time: ${ist} (minimum ${soll})`,
    plausibilityWarn: 'Note: reading time unusually short (plausibility check)',
    pageLog: 'Page log',
    pageShort: 'p.',
    pageOptional: 'optional',
    pageLogNote:
      'Actual time on page / required · first shown (date). Counted only while the page was visible, the window active and the reader interacting; server time is authoritative.',
    quiz: 'Knowledge check',
    attempt: (no, right, total, pct, passed) => `Attempt ${no}: ${right} of ${total} (${pct} %) – ${passed ? '<b>passed</b>' : 'not passed'}`,
    passRule: (pct, max) => `Pass mark ${pct} %, max. ${max} attempts`,
    quizNotRequired: 'Not required for this training',
    quizNotRequiredReinvite: 'Not required for the refresher on changed pages',
    validity: 'Validity',
    validUntil: 'Valid until',
    repetition: 'Repetition',
    repetitionText: (m) => (m === 12 ? 'yearly, automatic invitation' : `every ${m} months, automatic invitation`),
    confirmation: 'Confirmation',
    signatureAlt: 'Signature',
    auth: 'Authentication',
    device: 'Device',
    ipHash: 'IP hash',
    confirmSha: 'Confirmation text SHA-256',
    footerTamper: (url) => `Any subsequent change invalidates the seal. Verify via the QR code at the top right: ${url}`,
    authMethods: {
      password: 'Password (re-authentication)', otp_mail: 'One-time code by e-mail', otp_sms: 'One-time code by SMS',
      sso: 'Single sign-on (step-up)', provider: 'Identification by the signature provider',
    },
    formats: { online: 'Online with knowledge check', praesenz: 'Classroom', hybrid: 'Hybrid', extern: 'External' },
    deviceUnknown: 'unknown',
    deviceMobile: 'Mobile',
    deviceDesktop: 'PC',
    reinviteTitle: 'Refresher on changed pages',
    reinviteText: (pages) => `Re-invitation after a change of content. Only the changed pages ${pages} were required; all other pages were optional.`,
    levelLabel: 'Signature level',
    levels: {
      ees: 'Simple electronic signature (SES)',
      fes: 'Advanced electronic signature (AdES)',
      qes: 'Qualified electronic signature (QES)',
    },
    provider: (name, tx) => `Provider: ${name} · transaction ${tx}`,
    signer: (subject) => `Certificate: ${subject}`,
    signedDocument: (format, sha) => `Signed document (${format}), SHA-256 ${sha}`,
    signedDocumentAttached: 'The document signed by the provider is embedded in this PDF as a file attachment.',
    testProvider: 'TEST PROVIDER – not a legally valid advanced or qualified signature',
    signedAtProvider: 'Signed electronically with the signature provider',
    sealed: (tenant, q) => `Electronically sealed (PAdES-B-T) for ${tenant} · RFC 3161 timestamp in the signature${q ? '' : ' (test timestamp service, not qualified)'}.`,
    unsealed: 'DEVELOPMENT VERSION – not sealed.',
  },
};
