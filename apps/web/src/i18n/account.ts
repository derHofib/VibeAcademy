/**
 * Texte für „Meine Nachweise“ (optionales Teilnehmerkonto, E-25) und den Teilnehmer-Modus von
 * Registrieren/Anmelden. Getrennt von de.ts/participant.ts (E-20). Ansprache wie in der Teilnehmersicht: „du“.
 */
import { localized } from './lang';
import { taEn } from './en/account';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Deutsch; Englisch für „Meine Nachweise“ in en/account.ts (E-39). Registrieren/Anmelden bleiben Deutsch. */
export const taDe = {
  register: {
    title: 'Konto für deine Nachweise',
    subtitle: 'Sammle deine Schulungsnachweise an einem Ort – auch von verschiedenen Firmen.',
    infoTitle: 'Nachweise sammeln – kein Arbeitgeberzugang',
    infoText:
      'Mit dem Konto siehst du nur deine eigenen Schulungen und Nachweise. Du bekommst damit keinen Zugang zur Verwaltung einer Firma, und keine Firma sieht über dein Konto mehr als vorher.',
    emailHint: 'Am besten die Adresse, an die deine Einladung ging – dann wird die Schulung direkt verknüpft.',
    submit: 'Konto erstellen',
    haveAccount: 'Schon ein Konto?',
    login: 'Anmelden',
    trainerQuestion: 'Du leitest Schulungen?',
    trainerLink: 'Konto für Dozenten erstellen',
    participantQuestion: 'Du nimmst nur an Schulungen teil?',
    participantLink: 'Konto für deine Nachweise',
  },

  login: {
    title: 'Anmelden',
    subtitle: 'Melde dich an, um deine Schulungsnachweise zu sehen.',
    noAccount: 'Noch kein Konto?',
    register: 'Konto für deine Nachweise erstellen',
  },

  page: {
    title: 'Meine Nachweise',
    eyebrow: (name: string) => name,
    greeting: (first: string | null) => (first ? `Hallo ${first}!` : 'Hallo!'),
    intro: 'Hier findest du deine Schulungen und Nachweise aus allen Firmen, mit denen dein Konto verknüpft ist.',
    stats: {
      done: 'erledigt',
      open: 'offen',
      expiring: (n: number) => plural(n, 'läuft bald ab', 'laufen bald ab'),
    },
    toAdmin: 'Zur Verwaltung',
    logout: 'Abmelden',
    loading: 'Nachweise werden geladen …',
    loadError: 'Deine Nachweise konnten nicht geladen werden.',
    retry: 'Erneut versuchen',
  },

  groups: {
    open: 'Offen',
    openHint: 'Diese Schulungen warten noch auf dich.',
    done: 'Erledigt',
  },

  empty: {
    title: 'Noch keine Nachweise',
    text: 'Sobald dein Konto mit einer Einladung verknüpft ist, erscheinen deine Schulungen hier. Verknüpfe sie unten über deine E-Mail-Adresse.',
  },

  status: {
    offen: 'Neu',
    geoeffnet: 'Begonnen',
    gelesen: 'Gelesen',
    bestanden: 'Unterschrift fehlt',
    ueberfaellig: 'Überfällig',
    befreit: 'Befreit',
    bestaetigt: 'Erledigt',
  } as Record<string, string>,

  card: {
    version: (n: number) => `Version ${n}`,
    versionLabel: 'Version',
    continue: 'Weiter',
    continueAria: (title: string) => `Weiter: ${title}`,
    nr: 'Nachweis-Nr.',
    completedAt: 'Abgeschlossen am',
    validUntil: 'Gültig bis',
    daysLeft: (n: number) => (n <= 0 ? 'heute' : `noch ${n} ${plural(n, 'Tag', 'Tage')}`),
    valid: 'Gültig',
    expiring: 'Läuft bald ab',
    expired: 'Abgelaufen',
    exempt: 'Befreit',
    exemptText: 'Für diese Schulung bist du befreit – es gibt keinen Nachweis.',
    download: 'Nachweis herunterladen',
    downloadAria: (title: string) => `Nachweis herunterladen: ${title}`,
    verify: 'Echtheit prüfen',
    verifyAria: (title: string) => `Echtheit prüfen: ${title}`,
    pending: 'Nachweis wird erstellt …',
    failed: 'Der Nachweis wird noch erstellt. Schau später noch einmal vorbei.',
  },

  link: {
    title: 'Weitere Nachweise verknüpfen',
    intro: 'Hast du Schulungen bei weiteren Firmen gemacht? Wir suchen Einladungen mit deiner E-Mail-Adresse.',
    verifyTitle: 'Zuerst E-Mail-Adresse bestätigen',
    verifyText: (email: string) => `Wir schicken dir einen 6-stelligen Code an ${email}.`,
    requestCode: 'Code senden',
    codeLabel: 'Code aus deiner E-Mail',
    codePlaceholder: '6-stelliger Code',
    codeSent: 'Code ist unterwegs – schau in dein Postfach.',
    resend: 'Code erneut senden',
    confirmCode: 'Bestätigen',
    codeInvalid: 'Bitte den 6-stelligen Code eingeben.',
    verified: 'E-Mail-Adresse bestätigt',
    candidatesLoading: 'Einträge werden gesucht …',
    noCandidates: 'Keine weiteren Einträge mit deiner E-Mail-Adresse gefunden.',
    allLinked: 'Alle Einträge mit deiner E-Mail-Adresse sind verknüpft.',
    linkedChip: 'Verknüpft',
    listLabel: 'Gefundene Einträge',
    consent:
      'Nur Personen mit deiner bestätigten E-Mail-Adresse. Die jeweilige Organisation sieht dadurch nichts Zusätzliches.',
    submit: 'Auswahl verknüpfen',
    submitCount: (n: number) => (n ? `${n} ${plural(n, 'Eintrag', 'Einträge')} verknüpfen` : 'Auswahl verknüpfen'),
    selectFirst: 'Wähle mindestens einen Eintrag aus.',
    linked: (n: number) => `${n} ${plural(n, 'Eintrag', 'Einträge')} verknüpft.`,
    linkedNone: 'Es wurde nichts Neues verknüpft.',
  },

  account: {
    title: 'Konto',
    emailVerified: 'bestätigt',
    emailUnverified: 'nicht bestätigt',
    delete: 'Konto löschen',
  },

  deleteSheet: {
    title: 'Konto löschen?',
    description: 'Das kann nicht rückgängig gemacht werden.',
    stays: 'Deine Nachweise bleiben bei der jeweiligen Firma gespeichert – sie ist gesetzlich zur Aufbewahrung verpflichtet.',
    removed: 'Gelöscht werden nur dein Konto und die Verknüpfung zu deinen Nachweisen.',
    later: 'An Schulungen kannst du weiterhin über deinen persönlichen Einladungslink teilnehmen.',
    confirm: 'Konto endgültig löschen',
    deleting: 'Wird gelöscht …',
    cancel: 'Abbrechen',
    membership: 'Dein Konto gehört noch zur Verwaltung einer Organisation. Bitte wende dich an deren Administrator.',
  },

  deleted: {
    title: 'Konto gelöscht',
    text: 'Dein Konto ist gelöscht. Deine Nachweise liegen weiterhin bei den Firmen, für die du die Schulungen gemacht hast.',
    back: 'Zur Anmeldung',
  },

  nav: {
    myEvidence: 'Meine Nachweise',
  },
};

export type AccountStrings = typeof taDe;

export const ta: AccountStrings = localized({ de: taDe, en: { ...taEn, register: taDe.register, login: taDe.login, nav: taDe.nav } });
