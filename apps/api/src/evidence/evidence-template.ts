import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVIDENCE_LABELS } from '../i18n/evidence-labels';
import type { Lang } from '../i18n/language';

/** Daten für das Nachweis-PDF (SPEZIFIKATION 4.4, Screen 8). Alle Zeiten bereits formatiert (Europe/Berlin). */
export interface EvidenceData {
  tenantName: string;
  nachweisNr: string;
  createdAt: string;
  verifyUrl: string;
  qrSvg: string;
  training: { titel: string; versionNo: number; rechtsgrundlage: string | null; format: string; pageCount: number; unterweisender: string | null; sha256: string };
  person: { name: string; personalnr: string | null; orgUnit: string | null };
  ablauf: { eingeladen: string; bearbeitet: string; sitzungen: number; lesezeitIst: string; lesezeitSoll: string; plausibel: boolean };
  pages: Array<{ pageNo: number; ist: string; soll: string; erstmals: string; erfuellt: boolean; required?: boolean }>;
  quiz: {
    required: boolean; attempts: Array<{ no: number; right: number; total: number; pct: number; passed: boolean }>; passPct: number; maxAttempts: number;
    /** Wissenscheck wegen Nachschulung geänderter Seiten entfallen (Einstellung quizOnReinvite) */
    skippedOnReinvite?: boolean;
  };
  gueltigBis: string | null;
  wiederholung: string;
  confirmText: string;
  signature: {
    /** Unterschriftsbild (nur EES) */
    pngBase64: string | null; signedAt: string; authMethod: string; device: string; ipHash: string; confirmSha: string;
  };
  seal: { label: string };
  /** Sprache der Beschriftungen (E-39), Standard Deutsch */
  lang?: Lang;
  /** Neueinladung „nur geänderte Seiten“ (E-38) */
  reinvite?: { pages: number[] } | null;
  /** Signaturniveau (E-40); bei FES/QES Angaben des Anbieters */
  level?: {
    typ: 'ees' | 'fes' | 'qes';
    provider?: string | null; transactionId?: string | null; signer?: string | null; format?: string | null; sha256?: string | null; test?: boolean;
  };
}

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-8)}`;

let fontCss: string | null = null;
/** Schriften als data:-URLs einbetten – das PDF braucht keine Netzwerkzugriffe. */
export function fonts(fontDir: string): string {
  if (fontCss) return fontCss;
  const face = (family: string, file: string, weight: number) => {
    try {
      const b64 = readFileSync(join(fontDir, file)).toString('base64');
      return `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
    } catch {
      return '';
    }
  };
  fontCss = [400, 500, 600, 700]
    .flatMap((w) => [
      face('Inter', `inter-latin-${w}-normal.woff2`, w),
      face('Inter', `inter-latin-ext-${w}-normal.woff2`, w),
      face('Plus Jakarta Sans', `plus-jakarta-sans-latin-${w}-normal.woff2`, w),
      face('Plus Jakarta Sans', `plus-jakarta-sans-latin-ext-${w}-normal.woff2`, w),
    ])
    .join('');
  return fontCss;
}

/** Seitenliste „3, 7, 8“ bzw. Bereiche „3–5, 9“ */
export function pageList(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    out.push(j - i >= 2 ? `${sorted[i]}–${sorted[j]}` : sorted.slice(i, j + 1).join(', '));
    i = j;
  }
  return out.join(', ');
}

export function renderEvidenceHtml(d: EvidenceData, fontDir: string): string {
  const L = EVIDENCE_LABELS[d.lang ?? 'de'];
  const pages = d.pages
    .map(
      (p) => `<div class="pg${p.required === false ? ' opt' : ''}"><b>${L.pageShort} ${p.pageNo}</b> ${p.erfuellt ? '<span class="ok">✓</span>' : '<span class="no">–</span>'}${p.required === false ? ` <span class="m">${esc(L.pageOptional)}</span>` : ''}<br>${esc(p.ist)} / ${esc(p.soll)}<br><span class="m">${esc(p.erstmals)}</span></div>`,
    )
    .join('');
  const quiz = d.quiz.required
    ? d.quiz.attempts.map((a) => L.attempt(a.no, a.right, a.total, a.pct, a.passed)).join('<br>') +
      `<br><span class="m">${esc(L.passRule(d.quiz.passPct, d.quiz.maxAttempts))}</span>`
    : `<span class="m">${esc(d.quiz.skippedOnReinvite ? L.quizNotRequiredReinvite : L.quizNotRequired)}</span>`;
  const level = d.level ?? { typ: 'ees' as const };
  const provider = level.typ !== 'ees';
  const reinvite = d.reinvite?.pages.length
    ? `<div class="note"><b>${esc(L.reinviteTitle)}</b><br>${esc(L.reinviteText(pageList(d.reinvite.pages)))}</div>`
    : '';
  const signatureVisual = d.signature.pngBase64
    ? `<img src="data:image/png;base64,${d.signature.pngBase64}" alt="${esc(L.signatureAlt)}">`
    : `<div class="prov">${esc(L.signedAtProvider)}</div>`;
  const levelLines = provider
    ? `${esc(L.levelLabel)}: <b>${esc(L.levels[level.typ])}</b><br>` +
      (level.provider ? `${esc(L.provider(level.provider, level.transactionId ?? '–'))}<br>` : '') +
      (level.signer ? `${esc(L.signer(level.signer))}<br>` : '') +
      (level.sha256 ? `${esc(L.signedDocument(level.format ?? 'PAdES', short(level.sha256)))}<br>` : '') +
      `<span class="m">${esc(L.signedDocumentAttached)}</span>` +
      (level.test ? `<br><span class="warn">${esc(L.testProvider)}</span>` : '') + '<br>'
    : `${esc(L.levelLabel)}: ${esc(L.levels.ees)}<br>`;
  return `<!doctype html><html lang="${L.htmlLang}"><head><meta charset="utf-8"><title>${esc(L.docTitle(d.nachweisNr))}</title>
<style>
${fonts(fontDir)}
@page{size:A4;margin:16mm 16mm 14mm}
*{box-sizing:border-box}
body{font-family:Inter,Arial,sans-serif;color:#1D2433;font-size:10pt;line-height:1.45;margin:0}
h1{font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:19pt;line-height:1.2;margin:4px 0 6px;letter-spacing:-.01em}
h2{font-size:9.5pt;letter-spacing:.06em;text-transform:uppercase;margin:16px 0 6px;font-weight:700}
.m{color:#5F6B7D}
.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2.5px solid #1D2433;padding-bottom:12px}
.qr{width:90px;text-align:center;font-size:8pt;color:#5F6B7D}.qr svg{width:90px;height:90px;display:block}
.cols{display:flex;gap:28px}.cols>div{flex:1}
.grid{display:grid;grid-template-columns:repeat(7,1fr);gap:5px}
.pg{border:1px solid #D5DBE6;border-radius:6px;padding:4px 6px;font-size:8.5pt;line-height:1.35;font-variant-numeric:tabular-nums;break-inside:avoid}
.pg.opt{border-style:dashed;color:#5F6B7D}
.ok{color:#1E7A50}.no{color:#A1271B}
.note{background:#EAF0FE;color:#223C8F;border-radius:8px;padding:8px 12px;margin-top:12px;font-size:9pt;break-inside:avoid}
.box{border:1.5px solid #1D2433;border-radius:10px;padding:14px 18px;margin-top:16px;break-inside:avoid}
.sig{display:flex;gap:28px;align-items:flex-end;margin-top:10px}.sig>div{flex:1}
.sig img{height:60px;display:block}
.prov{height:60px;display:flex;align-items:flex-end;font-weight:600;color:#223C8F}
.line{border-top:1.5px solid #1D2433;padding-top:4px;margin-top:4px}
.warn{background:#FFF4DF;color:#5A3A00;border-radius:6px;padding:4px 8px;font-size:8.5pt;display:inline-block;margin-top:4px}
.foot{position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #D5DBE6;padding-top:6px;font-size:7.5pt;color:#5F6B7D}
</style></head><body>
<div class="head"><div>
<div class="m">${esc(d.tenantName)}</div>
<h1>${esc(L.title)}</h1>
<div class="m" style="color:#3A4456">${esc(L.nrCreated(d.nachweisNr, d.createdAt))}</div>
</div><div class="qr">${d.qrSvg}${esc(L.verifyQr)}</div></div>

<div class="cols"><div>
<h2>${esc(L.training)}</h2>
<b>${esc(d.training.titel)}</b>, ${esc(L.version(d.training.versionNo))}<br>
${d.training.rechtsgrundlage ? `${esc(L.legalBasis)}: ${esc(d.training.rechtsgrundlage)}<br>` : ''}
${esc(L.format)}: ${esc(d.training.format)} · ${esc(L.pages(d.training.pageCount))}<br>
${d.training.unterweisender ? `${esc(L.instructor)}: ${esc(d.training.unterweisender)}<br>` : ''}
<span class="m">${esc(L.docSha)}: ${esc(short(d.training.sha256))}</span>
</div><div>
<h2>${esc(L.participant)}</h2>
<b>${esc(d.person.name)}</b>${d.person.personalnr ? `, ${esc(L.personnelNo)} ${esc(d.person.personalnr)}` : ''}<br>
${d.person.orgUnit ? `${esc(d.person.orgUnit)}<br>` : ''}
${esc(L.invited)}: ${esc(d.ablauf.eingeladen)}<br>
${esc(L.processed(d.ablauf.bearbeitet, d.ablauf.sitzungen))}<br>
${esc(L.readingTotal(d.ablauf.lesezeitIst, d.ablauf.lesezeitSoll))}
${d.ablauf.plausibel ? '' : `<br><span class="warn">${esc(L.plausibilityWarn)}</span>`}
</div></div>
${reinvite}
<h2>${esc(L.pageLog)}</h2>
<div class="grid">${pages}</div>
<div class="m" style="font-size:8pt;margin-top:4px">${esc(L.pageLogNote)}</div>

<div class="cols"><div>
<h2>${esc(L.quiz)}</h2>${quiz}
</div><div>
<h2>${esc(L.validity)}</h2>
${d.gueltigBis ? `${esc(L.validUntil)}: <b>${esc(d.gueltigBis)}</b><br>` : ''}${esc(L.repetition)}: ${esc(d.wiederholung)}
</div></div>

<div class="box">
<h2 style="margin-top:0">${esc(L.confirmation)}</h2>
<div style="font-size:10.5pt">„${esc(d.confirmText)}“</div>
<div class="sig"><div>
${signatureVisual}
<div class="line">${esc(d.person.name)} · ${esc(d.signature.signedAt)}</div>
</div><div class="m" style="color:#3A4456">
${levelLines}${esc(L.auth)}: ${esc(d.signature.authMethod)}<br>
${esc(L.device)}: ${esc(d.signature.device)} · ${esc(L.ipHash)} ${esc(d.signature.ipHash)}<br>
${esc(L.confirmSha)}: ${esc(short(d.signature.confirmSha))}
</div></div></div>

<div class="foot">${esc(d.seal.label)}<br>${esc(L.footerTamper(d.verifyUrl))}</div>
</body></html>`;
}
