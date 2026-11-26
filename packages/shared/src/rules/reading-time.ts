/**
 * Mindestverweildauer je Seite (SPEZIFIKATION 4.1, ENTSCHEIDUNGEN E-06).
 *
 *   t_min = max(t_floor, min(t_cap, W / v · 60 · f))   [Sekunden]
 *
 * W = Wörter der Seite, v = Wörter je Minute, f = Faktor (Überfliegen).
 * Seiten ohne Text erhalten t_floor bzw. einen manuell gesetzten Wert.
 */
export interface ReadingTimeSettings {
  /** Lesegeschwindigkeit in Wörtern pro Minute */
  wordsPerMinute: number;
  /** Faktor für Überfliegen (0 < f ≤ 1) */
  factor: number;
  /** Untergrenze je Seite in Sekunden */
  floorSeconds: number;
  /** Obergrenze je Seite in Sekunden */
  capSeconds: number;
}

export const DEFAULT_READING_TIME: ReadingTimeSettings = {
  wordsPerMinute: 200,
  factor: 0.6,
  floorSeconds: 4,
  capSeconds: 90,
};

/** Seiten mit weniger Wörtern gelten als „ohne Text“ und werden zur manuellen Prüfung markiert. */
export const MIN_WORDS_FOR_TEXT_PAGE = 5;

export function hasText(wordCount: number): boolean {
  return wordCount >= MIN_WORDS_FOR_TEXT_PAGE;
}

export function minReadingSeconds(
  wordCount: number,
  settings: ReadingTimeSettings = DEFAULT_READING_TIME,
  options: { manualSeconds?: number | null; personFactor?: number } = {},
): number {
  const { wordsPerMinute, factor, floorSeconds, capSeconds } = settings;
  if (wordsPerMinute <= 0) throw new RangeError('wordsPerMinute muss > 0 sein');
  if (floorSeconds > capSeconds) throw new RangeError('floorSeconds darf capSeconds nicht übersteigen');
  let base: number;
  if (!hasText(wordCount)) {
    base = options.manualSeconds ?? floorSeconds;
  } else {
    const raw = (wordCount / wordsPerMinute) * 60 * factor;
    base = Math.max(floorSeconds, Math.min(capSeconds, raw));
  }
  // Verlängerung je Person (Barrierefreiheit) wirkt nach dem Clamping.
  const personFactor = options.personFactor ?? 1;
  return Math.round(base * Math.max(1, personFactor));
}

/** Wörter zählen: Tokens, die mindestens einen Buchstaben oder eine Ziffer enthalten. */
export function countWords(text: string): number {
  const tokens = text.split(/\s+/u);
  let n = 0;
  for (const t of tokens) if (/[\p{L}\p{N}]/u.test(t)) n++;
  return n;
}
