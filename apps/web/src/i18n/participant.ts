/**
 * Texte der Teilnehmersicht (Startbildschirm, Lesen, Wissenscheck, Unterschrift, Prüfseite).
 * Getrennt von de.ts, damit Verwaltung und Teilnehmersicht parallel gepflegt werden können (E-20).
 * Englisch: `en/participant.ts` (E-39); `tp` löst in der aktuellen Sprache auf (siehe lang.ts).
 */
import { getLang, localized, LOCALE } from './lang';
import { tpEn } from './en/participant';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const tpDe = {
  common: {
    loading: 'Wird geladen …',
    retry: 'Erneut versuchen',
    backToStart: 'Zur Übersicht',
    errorTitle: 'Das hat nicht geklappt',
    close: 'Schließen',
    closeTraining: 'Unterbrechen und schließen',
    back: 'Zurück',
  },

  /** Sprachumschalter (E-39); Sprachnamen immer in der eigenen Sprache */
  lang: {
    label: 'Sprache',
    de: 'Deutsch',
    en: 'English',
  },

  link: {
    opening: 'Einladung wird geöffnet …',
    invalidTitle: 'Link ungültig',
    expiredTitle: 'Link abgelaufen',
    hint: 'Bitte öffne den neuesten Link aus deiner E-Mail oder wende dich an die verantwortliche Person.',
  },

  start: {
    defaultCategory: 'Pflichtunterweisung',
    due: (d: string) => `Frist ${d}`,
    greeting: (first: string | null, minutes: number) =>
      `${first ? `Hallo ${first}, schön dass du da bist.` : 'Schön, dass du da bist.'} Plane etwa ${minutes} ${plural(minutes, 'Minute', 'Minuten')} ein – du kannst jederzeit pausieren.`,
    pages: (n: number) => plural(n, 'Seite', 'Seiten'),
    readingTime: 'Lesezeit',
    minutesShort: (n: number) => `${n} Min.`,
    questions: (n: number) => plural(n, 'Frage', 'Fragen'),
    stepsTitle: 'So läuft es ab',
    stepRead: 'Lesen',
    stepReadText: 'Jede Seite braucht eine kurze Mindestzeit.',
    stepQuiz: 'Wissenscheck',
    stepQuizText: (need: number, total: number) => `Bestanden ab ${need} von ${total} richtigen Antworten.`,
    stepSign: 'Unterschreiben',
    stepSignText: 'Deinen Nachweis bekommst du als PDF.',
    trackedLabel: 'Was erfasst wird:',
    trackedText:
      'nur welche Seite wie lange sichtbar war, deine Antworten und deine Bestätigung. Keine Kamera, kein Standort, keine Tastatureingaben.',
    cta: {
      start: 'Los geht’s',
      continue: 'Weiterlesen',
      quiz: 'Zum Wissenscheck',
      sign: 'Zur Unterschrift',
      evidence: 'Nachweis ansehen',
    },
    contact: (c: string) => `Fragen? ${c}`,
    exempt: 'Für diese Schulung ist nichts mehr zu tun – du bist befreit.',
    progressNote: (done: number, total: number) => `${done} von ${total} Seiten bereits erfasst.`,
    onlyPages: (list: string) => `Nur geänderte Seiten: ${list}`,
    onlyPagesText: 'Die Unterweisung wurde inhaltlich geändert. Bitte lies die geänderten Seiten – alle anderen kannst du freiwillig ansehen.',
    documentGerman: 'Diese Unterweisung gibt es nur auf Deutsch.',
    pagesRequired: (n: number) => `${plural(n, 'Seite', 'Seiten')} zu lesen`,
  },

  reader: {
    chapterOf: (n: number, total: number) => `Kapitel ${n} von ${total}`,
    chapter: (n: number) => `Kapitel ${n}`,
    pageOf: (n: number, total: number) => `Seite ${n} von ${total}`,
    pageLabel: (n: number) => `Seite ${n}`,
    pagesCaptured: (done: number, total: number) => `${done} von ${total} Seiten erfasst`,
    overall: (pct: number) => `Gesamtfortschritt ${pct} Prozent`,
    pageRender: (n: number) => `Inhalt von Seite ${n}`,
    pageLoading: 'Seite wird geladen …',
    pageError: 'Die Seite konnte nicht geladen werden.',
    pageLocked: 'Diese Seite ist noch gesperrt. Bitte zuerst die vorherigen Seiten lesen.',
    status: {
      capturing: 'Seite wird erfasst',
      capturingSeconds: (s: number) => `Seite wird erfasst · noch ${s} s`,
      captured: 'Seite erfasst – weiter geht’s',
      capturedDesktop: (n: number) => `Seite ${n} erfasst`,
      allCaptured: 'Alle Seiten erfasst – weiter zum Wissenscheck',
      allCapturedNoQuiz: 'Alle Seiten erfasst – weiter zur Unterschrift',
      pausedWindow: 'Pausiert – Fenster nicht aktiv',
      pausedToc: 'Inhalt geöffnet – Erfassung pausiert',
      pausedSheet: 'Erfassung pausiert',
      pausedNotVisible: 'Pausiert – Seite nicht im Blick',
      idle: 'Noch da? Tippe kurz auf die Seite',
      offline: 'Offline – Erfassung pausiert',
      starting: 'Erfassung wird gestartet …',
    },
    stillThere: {
      title: 'Noch da?',
      text: 'Seit 30 Sekunden keine Bedienung – die Erfassung pausiert. Tippe auf die Seite oder scrolle, um weiterzulesen.',
      action: 'Ich bin da',
    },
    ring: {
      nextPage: 'Nächste Seite',
      toQuiz: 'Zum Wissenscheck',
      toSign: 'Weiter zur Unterschrift',
      waiting: (s: number) => `Weiter in ${s} Sekunden`,
    },
    dock: {
      label: 'Lese-Dock',
      toc: 'Inhalt',
      back: 'Zurück',
      ask: 'Frage',
      askAria: 'Frage stellen',
      zoomGroup: 'Schriftgröße',
      zoomOut: 'Schrift kleiner',
      zoomIn: 'Schrift größer',
      zoom: (pct: number) => `${pct} %`,
    },
    toc: {
      title: 'Inhalt',
      pausedHint: 'Erfassung pausiert, solange das Inhaltsverzeichnis offen ist.',
      captured: 'erfasst',
      current: 'aktuell',
      locked: 'gesperrt',
      open: 'offen',
      capturedAria: 'erfasst',
      optional: 'freiwillig',
    },
    rail: {
      label: 'Kapitel',
      chapterAria: (n: number, name: string, done: boolean) => `Kapitel ${n}: ${name}${done ? ', erledigt' : ''}`,
      quiz: 'Quiz',
      quizAria: (state: string) => `Wissenscheck ${state}`,
      sign: 'Abschluss',
      signAria: (state: string) => `Unterschrift ${state}`,
      locked: 'gesperrt',
      unlocked: 'freigeschaltet',
      passed: 'bestanden',
    },
    ask: {
      title: (ref: string) => `Frage zu ${ref}`,
      role: 'Ansprechpartner',
      roleMail: 'Ansprechpartner · antwortet per Mail',
      noContact: 'Für diese Schulung ist kein Ansprechpartner hinterlegt. Bitte wende dich an deine Führungskraft.',
      intro: 'Fragen direkt in der App folgen bald. Bis dahin erreichst du den Ansprechpartner so:',
      questionLabel: 'Deine Frage',
      placeholder: 'Was ist unklar?',
      sendMail: 'Frage per E-Mail senden',
      call: (phone: string) => `Anrufen: ${phone}`,
      mailSubject: (training: string, ref: string) => `Frage zu ${ref} – ${training}`,
      trackingNote: 'Erfasst wird nur, welche Seite wie lange sichtbar war. Wechselst du den Tab, pausiert die Erfassung.',
    },
    superseded: {
      title: 'In einem anderen Fenster geöffnet',
      text: 'Die Schulung ist gerade in einem anderen Fenster oder auf einem anderen Gerät geöffnet. Die Erfassung läuft dort weiter – dein Fortschritt bleibt erhalten.',
      action: 'Hier weiterlesen',
    },
    sessionError: 'Die Lesesitzung konnte nicht gestartet werden.',
    onlyPages: (list: string) => `Nur geänderte Seiten: ${list}`,
    optionalPage: 'Freiwillige Seite – für den Abschluss nicht nötig',
  },

  quiz: {
    title: 'Wissenscheck',
    resultTitle: 'Ergebnis',
    badge: 'Wissenscheck',
    meta: (n: number, total: number, attempt: number) => `Frage ${n} von ${total} · Versuch ${attempt}`,
    right: 'Richtig.',
    wrong: 'Nicht ganz.',
    options: 'Antworten',
    questionRef: (n: number) => `Frage ${n}`,
    status: {
      pick: 'Wähle eine Antwort',
      next: 'Weiter mit dem Pfeil',
      passed: 'Bestanden – jetzt unterschreiben',
      failed: 'Noch nicht bestanden',
      locked: 'Keine Versuche mehr',
      saving: 'Wird gespeichert …',
    },
    ring: {
      next: 'Nächste Frage',
      finish: 'Auswerten',
      retry: 'Erneut versuchen',
      sign: 'Weiter zur Unterschrift',
    },
    passedTitle: 'Bestanden!',
    passedText: (c: number, t: number) => `${c} von ${t} Fragen richtig. Tippe auf den grünen Button, um zu unterschreiben.`,
    passedTextShort: 'Du hast den Wissenscheck bestanden. Tippe auf den grünen Button, um zu unterschreiben.',
    failedTitle: 'Fast geschafft',
    failedText: (c: number, t: number, pct: number, left: number) =>
      `${c} von ${t} richtig. Bestanden ist ab ${pct} %. Schau dir die Erklärungen an und versuch es noch einmal – ${left} ${plural(left, 'Versuch', 'Versuche')} übrig.`,
    lockedTitle: 'Keine Versuche mehr',
    lockedText: 'Du hast alle Versuche gebraucht. Die verantwortliche Person ist informiert und meldet sich bei dir.',
    readFirstTitle: 'Erst lesen, dann der Wissenscheck',
    readFirstText: 'Der Wissenscheck wird freigeschaltet, sobald alle Seiten erfasst sind.',
    toReading: 'Weiterlesen',
    noQuestions: 'Für diese Schulung sind noch keine Fragen hinterlegt. Bitte wende dich an die verantwortliche Person.',
  },

  sign: {
    title: 'Fast geschafft',
    progressLabel: 'Fortschritt',
    stepPages: (n: number) => `${n} ${plural(n, 'Seite', 'Seiten')}`,
    stepQuiz: 'Quiz',
    stepSign: 'Unterschrift',
    padTitle: 'Deine Unterschrift',
    padClear: 'Löschen',
    padPlaceholder: 'Mit Finger oder Maus hier unterschreiben',
    padAria: 'Unterschriftsfeld. Mit Finger, Stift oder Maus unterschreiben.',
    passwordLabel: 'Zur Bestätigung: dein Passwort',
    passwordPlaceholder: 'Passwort',
    codeLabel: 'Zur Bestätigung: Code aus deiner E-Mail',
    codeHint: 'Wir schicken dir einen 6-stelligen Code an deine E-Mail-Adresse.',
    codeRequest: 'Code anfordern',
    codeResend: 'Code erneut senden',
    codeSent: 'Code ist unterwegs – bitte in deinem Postfach nachsehen.',
    codePlaceholder: '6-stelliger Code',
    noAuth: 'Für dich ist keine E-Mail-Adresse hinterlegt. Bitte wende dich an die verantwortliche Person.',
    missing: (items: string[]) => `Noch offen: ${items.join(', ')}`,
    missingConfirm: 'Bestätigung ankreuzen',
    missingSignature: 'unterschreiben',
    missingPassword: 'Passwort eingeben',
    missingCode: 'Code eingeben',
    ready: 'Alles bereit – Zeitpunkt und Dokumentversion werden gespeichert.',
    submit: 'Verbindlich unterschreiben',
    submitting: 'Wird unterschrieben …',
    notReadyTitle: 'Noch nicht so weit',
    notReadyPages: 'Bitte zuerst alle Seiten lesen.',
    notReadyQuiz: 'Bitte zuerst den Wissenscheck bestehen.',
    toReading: 'Weiterlesen',
    toQuiz: 'Zum Wissenscheck',
    stepDone: ' (erledigt)',
    // FES/QES über einen Signaturanbieter (E-40)
    providerTitle: 'Signieren beim Signaturanbieter',
    providerText: (level: string) =>
      `Für diese Unterweisung unterschreibst du mit einer ${level}. Nach dem Bestätigen wirst du zum Signaturanbieter weitergeleitet und kommst danach automatisch hierher zurück.`,
    providerLevel: { fes: 'fortgeschrittenen elektronischen Signatur (FES)', qes: 'qualifizierten elektronischen Signatur (QES)' },
    providerTest: 'Test-Anbieter: Diese Signatur hat keine Rechtswirkung.',
    providerReady: 'Bestätigt – weiter zum Signaturanbieter.',
    providerSubmit: 'Weiter zum Signaturanbieter',
    providerRedirecting: 'Weiterleitung …',
    providerCancelled: 'Die Signatur wurde beim Anbieter abgebrochen. Du kannst es erneut versuchen.',
    providerFailed: 'Die Signatur beim Anbieter ist fehlgeschlagen. Bitte erneut versuchen.',
    providerChecking: 'Signatur wird abgeschlossen …',
  },

  done: {
    title: 'Unterschrieben',
    text: 'Danke! Deine Teilnahme ist bestätigt. Dein Nachweis wird gerade versiegelt.',
    textReady: 'Danke! Deine Teilnahme ist bestätigt. Dein Nachweis ist versiegelt und bereit.',
    nr: 'Nachweis-Nr.',
    code: 'Prüfcode',
    signedAt: 'Unterschrieben am',
    pending: 'Nachweis wird erstellt …',
    failed: 'Der Nachweis konnte noch nicht erstellt werden. Wir versuchen es automatisch erneut.',
    download: 'Nachweis herunterladen',
    verify: 'Echtheit prüfen',
    accountTitle: 'Nachweise in einem Konto sammeln',
    accountText: 'Mit einem kostenlosen Konto findest du alle deine Schulungsnachweise an einem Ort – auch von anderen Firmen.',
    accountAction: 'Konto anlegen',
    level: 'Signaturniveau',
    levels: { ees: 'Einfache elektronische Signatur', fes: 'Fortgeschrittene elektronische Signatur', qes: 'Qualifizierte elektronische Signatur' },
  },

  verify: {
    title: 'Nachweis prüfen',
    eyebrow: 'Echtheitsprüfung',
    loading: 'Nachweis wird geprüft …',
    notFoundTitle: 'Nachweis nicht gefunden',
    notFoundText: 'Zu diesem Prüfcode gibt es keinen Nachweis. Bitte den Code auf dem Nachweis vergleichen.',
    valid: 'Gültig – der Nachweis ist echt',
    pending: 'Nachweis wird noch erstellt',
    otherStatus: (s: string) => `Status: ${s}`,
    nr: 'Nachweis-Nr.',
    training: 'Schulung',
    version: (v: number | string) => `Version ${v}`,
    participant: 'Teilnehmer (Initialen)',
    issuer: 'Aussteller',
    sealedAt: 'Versiegelt am',
    hash: 'SHA-256 der Datei',
    fileTitle: 'Datei vergleichen',
    fileText: 'Wähle die PDF-Datei des Nachweises. Sie wird nur in deinem Browser geprüft und nicht hochgeladen.',
    fileLabel: 'PDF-Datei wählen',
    fileChecking: 'Datei wird geprüft …',
    fileMatch: 'Die Datei stimmt mit dem versiegelten Nachweis überein.',
    fileMismatch: 'Die Datei weicht vom versiegelten Nachweis ab. Sie wurde verändert oder ist ein anderer Nachweis.',
    fileHash: (h: string) => `SHA-256 der gewählten Datei: ${h}`,
    privacy: 'Öffentlich sichtbar sind nur Status, Nummer, Datum, Schulung, Prüfsumme und Initialen.',
  },
};

export type ParticipantStrings = typeof tpDe;

export const tp: ParticipantStrings = localized({ de: tpDe, en: tpEn });

/** Datum kurz „17.11.“ bzw. „17/11“ */
export const formatDayMonth = (iso: string) =>
  new Intl.DateTimeFormat(LOCALE[getLang()], { day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin' }).format(new Date(iso));

/** Datum + Uhrzeit „26.11.2026, 14:05 Uhr“ bzw. „26 Nov 2026, 14:05“ */
export const formatDateTime = (iso: string) => {
  const s = new Intl.DateTimeFormat(LOCALE[getLang()], { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(new Date(iso));
  return getLang() === 'de' ? `${s} Uhr` : s;
};
