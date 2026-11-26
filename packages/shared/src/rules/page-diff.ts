/**
 * Seiten-Diff zwischen zwei Versionen einer Schulung (ENTSCHEIDUNGEN E-38).
 *
 * Reine Funktionen ohne I/O: Eingabe ist der Text je Seite (beim Upload per Text-Layer extrahiert), Ausgabe ist
 * je Seite der neuen Version ein Status (unverändert / geändert / neu) plus die entfernten Seiten der alten Version.
 *
 * Verfahren:
 *  1. Text normalisieren (Unicode, Silbentrennung, Anführungszeichen, Leerraum, Seitenzahlen in Kopf-/Fußzeilen)
 *     und je Seite einen Fingerabdruck bilden.
 *  2. Längste gemeinsame Teilfolge (LCS) über die Fingerabdrücke → identische Seiten in gleicher Reihenfolge
 *     sind Anker („unverändert“). Das erkennt eingefügte und entfernte Seiten.
 *  3. Zwischen zwei Ankern werden die übrigen Seiten per gewichteter Ausrichtung (Ähnlichkeit ≥ Schwelle,
 *     Reihenfolge bleibt erhalten) einander zugeordnet → „geändert“.
 *  4. Was dann noch übrig ist, wird ohne Reihenfolge zugeordnet (verschobene Seiten), sonst „neu“ bzw. „entfernt“.
 *
 * Seiten ohne Text (Bilder, Scans) lassen sich nicht vergleichen; sie werden als `noText` markiert.
 */

export type PageDiffStatus = 'unveraendert' | 'geaendert' | 'neu' | 'entfernt';

export interface PageTextInput {
  pageNo: number;
  /** Rohtext oder bereits normalisierter Text der Seite */
  text: string;
}

export interface PageDiffExcerpt {
  /** Entfernter Text (gekürzt), leer wenn nichts entfernt wurde */
  removed: string;
  /** Hinzugefügter Text (gekürzt), leer wenn nichts hinzugefügt wurde */
  added: string;
}

export interface PageDiffEntry {
  /** Seite in der neuen Version (null bei „entfernt“) */
  pageNo: number | null;
  /** Zugeordnete Seite der alten Version (null bei „neu“) */
  oldPageNo: number | null;
  status: PageDiffStatus;
  /** Ähnlichkeit 0..1 (1 = identisch, 0 bei neu/entfernt) */
  similarity: number;
  /** Seite steht an anderer relativer Position als in der alten Version */
  moved: boolean;
  /** Seite (alt und/oder neu) hat keinen auswertbaren Text → bitte selbst prüfen */
  noText: boolean;
  excerpt: PageDiffExcerpt | null;
}

export interface PageDiffSummary {
  unveraendert: number;
  geaendert: number;
  neu: number;
  entfernt: number;
}

export interface PageDiffResult {
  /** Neue Seiten in Reihenfolge, entfernte Seiten an der Stelle ihrer alten Position eingereiht */
  pages: PageDiffEntry[];
  /** Vorschlag für `changed_pages`: Seiten der neuen Version mit Status „geändert“ oder „neu“ */
  changedPages: number[];
  summary: PageDiffSummary;
  /** Vorschlag für die Art der Änderung; null wenn sich nichts geändert hat */
  suggestedChangeKind: 'redaktionell' | 'inhaltlich' | null;
}

export interface PageDiffOptions {
  /** Mindestähnlichkeit, damit zwei unterschiedliche Seiten als „dieselbe Seite, geändert“ gelten (Standard 0,5) */
  matchThreshold?: number;
  /** Ab dieser Ähnlichkeit gilt eine Änderung als redaktionell (Standard 0,97) */
  editorialThreshold?: number;
  /** Höchstlänge eines Auszugs in Zeichen (Standard 160) */
  excerptLength?: number;
}

/** Seiten mit weniger Wörtern gelten als „ohne Text“ (wie die Lesezeit-Regel, E-06). */
const MIN_WORDS = 5;

/**
 * Normalisiert den Text einer Seite für den Vergleich. Ziel: Unterschiede, die beim erneuten Export eines
 * unveränderten Dokuments entstehen (Umbruch, Silbentrennung, typografische Zeichen, Seitenzahlen), zählen nicht.
 */
export function normalizePageText(raw: string): string {
  return (
    raw
      .normalize('NFKC')
      .replace(/­/g, '') // weiches Trennzeichen
      .replace(/(\p{L})-\s+(\p{Ll})/gu, '$1$2') // Silbentrennung am Zeilenende
      .replace(/[‘’‚‛′]/g, "'")
      .replace(/[“”„‟«»″]/g, '"')
      .replace(/[‐-―−]/g, '-')
      .replace(/[•●▪‣⁃]/g, '•')
      // Seitenzahlen in Kopf-/Fußzeilen („Seite 3 von 14“, „Page 3 of 14“, „3 / 14“)
      .replace(/\b(seite|page|s\.)\s*\d+(\s*(von|of|\/)\s*\d+)?\b/giu, ' ')
      .replace(/(^|\s)\d+\s*\/\s*\d+(?=\s|$)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      // alleinstehende Zahl am Seitenanfang/-ende (Seitenzahl)
      .replace(/^\d{1,4}\s+/, '')
      .replace(/\s+\d{1,4}$/, '')
  );
}

/** Deterministischer 64-Bit-Fingerabdruck (zwei FNV-1a-32-Durchläufe) als 16-stelliger Hex-Wert. */
export function pageFingerprint(normalized: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ normalized.length;
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
    h2 ^= h2 >>> 13;
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

export function tokenize(normalized: string): string[] {
  return normalized ? normalized.split(' ').filter(Boolean) : [];
}

interface Prepared {
  pageNo: number;
  norm: string;
  fp: string;
  tokens: string[];
  bigrams: Map<string, number>;
  noText: boolean;
}

function prepare(p: PageTextInput): Prepared {
  const norm = normalizePageText(p.text);
  const tokens = tokenize(norm);
  const lower = tokens.map((t) => t.toLowerCase());
  const bigrams = new Map<string, number>();
  const grams = lower.length === 1 ? [lower[0]!] : lower.slice(1).map((t, i) => `${lower[i]} ${t}`);
  for (const g of grams) bigrams.set(g, (bigrams.get(g) ?? 0) + 1);
  return { pageNo: p.pageNo, norm, fp: pageFingerprint(norm), tokens, bigrams, noText: tokens.filter((t) => /[\p{L}\p{N}]/u.test(t)).length < MIN_WORDS };
}

/** Schnelle Ähnlichkeit (Dice-Koeffizient über Wort-Bigramme als Multimenge), 0..1. */
function diceSimilarity(a: Prepared, b: Prepared): number {
  if (a.fp === b.fp) return 1;
  const na = sumValues(a.bigrams);
  const nb = sumValues(b.bigrams);
  if (!na || !nb) return 0;
  const [small, large] = a.bigrams.size <= b.bigrams.size ? [a.bigrams, b.bigrams] : [b.bigrams, a.bigrams];
  let common = 0;
  for (const [g, n] of small) common += Math.min(n, large.get(g) ?? 0);
  return (2 * common) / (na + nb);
}

function sumValues(m: Map<string, number>): number {
  let s = 0;
  for (const v of m.values()) s += v;
  return s;
}

type Op = { kind: 'same' | 'del' | 'ins'; tokens: string[] };

/** Höchstzahl Zellen der Token-DP; darüber wird nur grob verglichen (Dice). */
const MAX_DP_CELLS = 4_000_000;

/** Token-Diff (LCS) mit Abschneiden gemeinsamer Anfangs-/Endstücke. Liefert null, wenn der Rest zu groß ist. */
export function diffTokens(a: readonly string[], b: readonly string[]): Op[] | null {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const ma = a.slice(pre, a.length - suf);
  const mb = b.slice(pre, b.length - suf);
  const ops: Op[] = [];
  const push = (kind: Op['kind'], t: string) => {
    const last = ops[ops.length - 1];
    if (last && last.kind === kind) last.tokens.push(t);
    else ops.push({ kind, tokens: [t] });
  };
  for (let i = 0; i < pre; i++) push('same', a[i]!);
  if ((ma.length + 1) * (mb.length + 1) > MAX_DP_CELLS) return null;
  const n = ma.length;
  const m = mb.length;
  // LCS-Tabelle von hinten, damit die Rückverfolgung vorwärts läuft
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = ma[i] === mb[j] ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (ma[i] === mb[j]) {
      push('same', ma[i]!);
      i++;
      j++;
    } else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) push('del', ma[i++]!);
    else push('ins', mb[j++]!);
  }
  while (i < n) push('del', ma[i++]!);
  while (j < m) push('ins', mb[j++]!);
  for (let k = a.length - suf; k < a.length; k++) push('same', a[k]!);
  return ops;
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function detail(a: Prepared, b: Prepared, excerptLength: number): { similarity: number; excerpt: PageDiffExcerpt | null } {
  if (a.fp === b.fp) return { similarity: 1, excerpt: null };
  const ops = diffTokens(a.tokens, b.tokens);
  if (!ops) return { similarity: round(diceSimilarity(a, b)), excerpt: null };
  const same = ops.filter((o) => o.kind === 'same').reduce((s, o) => s + o.tokens.length, 0);
  const total = a.tokens.length + b.tokens.length;
  // Identische Token-Folge, aber anderer Fingerabdruck kommt praktisch nicht vor → 1
  const similarity = total ? (2 * same) / total : 1;
  const removed = ops.filter((o) => o.kind === 'del').map((o) => o.tokens.join(' '));
  const added = ops.filter((o) => o.kind === 'ins').map((o) => o.tokens.join(' '));
  return {
    similarity: round(similarity),
    excerpt: removed.length || added.length ? { removed: clip(removed.join(' … '), excerptLength), added: clip(added.join(' … '), excerptLength) } : null,
  };
}

const round = (x: number) => Math.round(x * 1000) / 1000;

/** LCS über Fingerabdrücke → Paare (Index alt, Index neu) identischer Seiten in Reihenfolge. */
function anchorPairs(a: readonly Prepared[], b: readonly Prepared[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i]!.fp === b[j]!.fp ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i]!.fp === b[j]!.fp) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) i++;
    else j++;
  }
  return pairs;
}

/** Gewichtete Ausrichtung zweier Abschnitte (Reihenfolge bleibt), nur Paare mit Ähnlichkeit ≥ Schwelle. */
function alignGap(a: readonly Prepared[], b: readonly Prepared[], threshold: number): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return [];
  const sim: number[][] = a.map((x) => b.map((y) => (x.noText || y.noText ? 0 : diceSimilarity(x, y))));
  const w = m + 1;
  const dp = new Float64Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const s = sim[i]![j]!;
      const take = s >= threshold ? s + dp[(i + 1) * w + j + 1]! : -Infinity;
      dp[i * w + j] = Math.max(take, dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  const eps = 1e-12;
  while (i < n && j < m) {
    const s = sim[i]![j]!;
    if (s >= threshold && Math.abs(dp[i * w + j]! - (s + dp[(i + 1) * w + j + 1]!)) < eps) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (Math.abs(dp[i * w + j]! - dp[(i + 1) * w + j]!) < eps) i++;
    else j++;
  }
  return pairs;
}

/**
 * Vergleicht die Seiten der alten (veröffentlichten) mit denen der neuen Version.
 * Die Eingaben müssen nicht sortiert sein; verglichen wird in Seitenreihenfolge.
 */
export function diffPages(oldPages: readonly PageTextInput[], newPages: readonly PageTextInput[], opts: PageDiffOptions = {}): PageDiffResult {
  const threshold = opts.matchThreshold ?? 0.5;
  const editorial = opts.editorialThreshold ?? 0.97;
  const excerptLength = opts.excerptLength ?? 160;
  const a = [...oldPages].sort((x, y) => x.pageNo - y.pageNo).map(prepare);
  const b = [...newPages].sort((x, y) => x.pageNo - y.pageNo).map(prepare);

  /** Zuordnung neuer Index → alter Index */
  const match = new Map<number, number>();
  const anchors = anchorPairs(a, b);
  for (const [i, j] of anchors) match.set(j, i);

  // Lücken zwischen den Ankern ausrichten
  const bounds: Array<[number, number]> = [[-1, -1], ...anchors, [a.length, b.length]];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const [i0, j0] = bounds[k]!;
    const [i1, j1] = bounds[k + 1]!;
    const ga = a.slice(i0 + 1, i1);
    const gb = b.slice(j0 + 1, j1);
    for (const [i, j] of alignGap(ga, gb, threshold)) match.set(j0 + 1 + j, i0 + 1 + i);
  }

  // Verschobene Seiten: übrig gebliebene ohne Reihenfolge zuordnen (beste Ähnlichkeit zuerst)
  const usedOld = new Set(match.values());
  const freeNew = b.map((_, j) => j).filter((j) => !match.has(j));
  const freeOld = a.map((_, i) => i).filter((i) => !usedOld.has(i));
  const candidates: Array<{ i: number; j: number; s: number }> = [];
  for (const j of freeNew) {
    for (const i of freeOld) {
      const s = a[i]!.fp === b[j]!.fp ? 1 : a[i]!.noText || b[j]!.noText ? 0 : diceSimilarity(a[i]!, b[j]!);
      if (s >= Math.max(threshold, 0.6)) candidates.push({ i, j, s });
    }
  }
  candidates.sort((x, y) => y.s - x.s || x.j - y.j || x.i - y.i);
  const moved = new Set<number>();
  for (const c of candidates) {
    if (match.has(c.j) || usedOld.has(c.i)) continue;
    match.set(c.j, c.i);
    usedOld.add(c.i);
    moved.add(c.j);
  }

  const entries: PageDiffEntry[] = b.map((nb, j) => {
    const i = match.get(j);
    if (i === undefined) {
      return { pageNo: nb.pageNo, oldPageNo: null, status: 'neu', similarity: 0, moved: false, noText: nb.noText, excerpt: nb.tokens.length ? { removed: '', added: clip(nb.norm, excerptLength) } : null };
    }
    const na = a[i]!;
    const d = detail(na, nb, excerptLength);
    const identical = na.fp === nb.fp;
    return {
      pageNo: nb.pageNo,
      oldPageNo: na.pageNo,
      status: identical ? 'unveraendert' : 'geaendert',
      similarity: identical ? 1 : Math.min(d.similarity, 0.999),
      moved: moved.has(j),
      noText: na.noText || nb.noText,
      excerpt: identical ? null : d.excerpt,
    };
  });

  // Entfernte Seiten hinter dem Vorgänger (alte Reihenfolge) einreihen
  const removed = a.map((x, i) => ({ x, i })).filter(({ i }) => !usedOld.has(i));
  const result: PageDiffEntry[] = [...entries];
  for (const { x, i } of removed) {
    const entry: PageDiffEntry = { pageNo: null, oldPageNo: x.pageNo, status: 'entfernt', similarity: 0, moved: false, noText: x.noText, excerpt: x.tokens.length ? { removed: clip(x.norm, excerptLength), added: '' } : null };
    // Position: nach der letzten neuen Seite, deren alte Seite vor i liegt
    let pos = 0;
    for (let k = 0; k < result.length; k++) {
      const o = result[k]!.oldPageNo;
      if (o !== null && o < x.pageNo) pos = k + 1;
    }
    result.splice(pos, 0, entry);
  }

  const summary: PageDiffSummary = { unveraendert: 0, geaendert: 0, neu: 0, entfernt: 0 };
  for (const e of result) summary[e.status]++;
  const changedPages = entries.filter((e) => e.status === 'geaendert' || e.status === 'neu').map((e) => e.pageNo!);
  return { pages: result, changedPages, summary, suggestedChangeKind: suggestKind(result, editorial) };
}

/**
 * Vorschlag für die Art der Änderung: nichts geändert → null; nur kleine Textänderungen (Ähnlichkeit ≥ 0,97,
 * keine neuen oder entfernten Seiten) → redaktionell; sonst inhaltlich. Der Verantwortliche entscheidet.
 */
export function suggestKind(pages: readonly PageDiffEntry[], editorialThreshold = 0.97): 'redaktionell' | 'inhaltlich' | null {
  const changed = pages.filter((p) => p.status !== 'unveraendert');
  if (!changed.length) return null;
  if (changed.some((p) => p.status === 'neu' || p.status === 'entfernt')) return 'inhaltlich';
  return changed.every((p) => p.similarity >= editorialThreshold) ? 'redaktionell' : 'inhaltlich';
}
