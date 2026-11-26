/**
 * Verwaltungstexte für Phase 3, Paket C (E-38–E-40): Seiten-Diff im Assistenten, Sprachfassungen, Signaturniveau.
 * Die Verwaltung bleibt Deutsch (E-39).
 */
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const ac = {
  diff: {
    title: (prev: number) => `Vergleich mit Version ${prev}`,
    loading: 'Seiten werden verglichen …',
    failed: 'Der Vergleich ist nicht möglich.',
    summary: (s: { unveraendert: number; geaendert: number; neu: number; entfernt: number }) =>
      [
        `${s.geaendert} ${plural(s.geaendert, 'Seite', 'Seiten')} geändert`,
        `${s.neu} neu`,
        `${s.entfernt} entfernt`,
        `${s.unveraendert} unverändert`,
      ].join(' · '),
    nothing: 'Kein Textunterschied gefunden – vermutlich nur Layout oder Bilder geändert.',
    suggestion: (kind: string, pages: string) => (pages ? `Vorschlag: ${kind}, geänderte Seiten ${pages}` : `Vorschlag: ${kind}`),
    kind: { inhaltlich: 'inhaltlich', redaktionell: 'redaktionell' } as Record<string, string>,
    apply: 'Vorschlag übernehmen',
    applied: 'Vorschlag übernommen – bitte prüfen und bei Bedarf anpassen.',
    status: { unveraendert: 'unverändert', geaendert: 'geändert', neu: 'neu', entfernt: 'entfernt' } as Record<string, string>,
    page: (no: number | null, old: number | null) =>
      no === null ? `alt S. ${old}` : old === null || old === no ? `S. ${no}` : `S. ${no} (vorher S. ${old})`,
    similarity: (pct: number) => `${pct} % gleich`,
    moved: 'verschoben',
    noText: 'ohne Text – bitte selbst prüfen',
    removed: 'entfernt:',
    added: 'neu:',
    showAll: (n: number) => `Alle ${n} Seiten zeigen`,
    showChanged: 'Nur Änderungen zeigen',
    listLabel: 'Seitenvergleich',
  },
  languages: {
    title: 'Sprachfassungen',
    intro: (no: number) =>
      `Englischsprachige Personen erhalten die englische Fassung von Version ${no}, sobald sie veröffentlicht ist – sonst die deutsche.`,
    de: 'Deutsch',
    en: 'Englisch',
    none: 'Noch keine englische Fassung.',
    upload: 'Englische Fassung hochladen',
    replace: 'Englische Fassung ersetzen',
    uploading: 'Wird hochgeladen …',
    analysing: 'Seitenanalyse läuft …',
    ready: (pages: number) => `${pages} ${plural(pages, 'Seite', 'Seiten')} · bereit zur Veröffentlichung`,
    published: (pages: number) => `${pages} ${plural(pages, 'Seite', 'Seiten')} · veröffentlicht`,
    failed: 'Analyse fehlgeschlagen',
    publish: 'Englische Fassung veröffentlichen',
    publishing: 'Wird veröffentlicht …',
    publishedNotice: 'Englische Fassung veröffentlicht.',
    changedPages: 'Geänderte Seiten der englischen Fassung',
    changedPagesHint: 'z. B. 3, 7–8; leer = alle Seiten bei einer Neueinladung',
    needGerman: 'Zuerst die deutsche Fassung hochladen.',
  },
  rules: {
    quizOnReinvite: 'Quiz auch bei Nachschulung',
    quizOnReinviteText: 'Neueinladung „nur geänderte Seiten“ verlangt den Wissenscheck erneut',
    signatureLevel: 'Signaturniveau',
    signatureLevelHint: 'FES/QES: Weiterleitung zum Signaturanbieter (derzeit nur Test-Anbieter ohne Rechtswirkung)',
    levels: {
      ees: 'Einfach (EES) – Unterschrift + Code/Passwort',
      fes: 'Fortgeschritten (FES) – Signaturanbieter',
      qes: 'Qualifiziert (QES) – Signaturanbieter',
    },
  },
  person: {
    language: 'Sprache',
    languageHint: 'Teilnehmeroberfläche, E-Mails und Nachweis',
    de: 'Deutsch',
    en: 'Englisch',
  },
};
