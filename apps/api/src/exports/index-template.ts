import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface IndexRow {
  nachweisNr: string;
  person: string;
  personalnr: string | null;
  orgUnit: string | null;
  titel: string;
  art: string;
  datum: string;
  versiegelt: string;
  verifyCode: string;
  sha256: string;
  intact: boolean;
  file: string;
}
export interface IndexData {
  tenantName: string;
  from: string;
  to: string;
  createdAt: string;
  filter: string[];
  rows: IndexRow[];
  verifyBase: string;
}

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

let fontCss: string | null = null;
function fonts(dir: string) {
  if (fontCss !== null) return fontCss;
  const face = (family: string, file: string, w: number) => {
    try {
      return `@font-face{font-family:'${family}';font-weight:${w};src:url(data:font/woff2;base64,${readFileSync(join(dir, file)).toString('base64')}) format('woff2');}`;
    } catch {
      return '';
    }
  };
  fontCss = [400, 600, 700].flatMap((w) => [face('Inter', `inter-latin-${w}-normal.woff2`, w), face('Inter', `inter-latin-ext-${w}-normal.woff2`, w), face('Plus Jakarta Sans', `plus-jakarta-sans-latin-${w}-normal.woff2`, w)]).join('');
  return fontCss;
}

/** Verzeichnis der Nachweismappe (A4 quer): je Nachweis Nr., Person, Schulung, Datum, Prüfcode und SHA-256. */
export function renderIndexHtml(d: IndexData, fontDir: string): string {
  const rows = d.rows
    .map(
      (r, i) => `<tr><td>${i + 1}</td><td><b>${esc(r.nachweisNr)}</b><br><span class="m">${esc(r.art)}</span></td>
<td>${esc(r.person)}${r.personalnr ? `<br><span class="m">Pers.-Nr. ${esc(r.personalnr)}</span>` : ''}${r.orgUnit ? `<br><span class="m">${esc(r.orgUnit)}</span>` : ''}</td>
<td>${esc(r.titel)}</td><td>${esc(r.datum)}</td><td>${esc(r.versiegelt)}</td>
<td><b>${esc(r.verifyCode)}</b></td><td class="h">${esc(r.sha256)}${r.intact ? '' : '<br><b class="bad">Prüfsumme weicht ab!</b>'}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Nachweismappe</title><style>
${fonts(fontDir)}
@page{size:A4 landscape;margin:14mm 12mm}
body{font-family:Inter,Arial,sans-serif;color:#1D2433;font-size:8.5pt;line-height:1.4;margin:0}
h1{font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:17pt;margin:2px 0 4px}
.m{color:#5F6B7D}.bad{color:#A1271B}
table{border-collapse:collapse;width:100%;margin-top:12px}
th{text-align:left;font-size:7.5pt;letter-spacing:.05em;text-transform:uppercase;color:#5F6B7D;border-bottom:1.5px solid #1D2433;padding:4px 6px}
td{border-bottom:1px solid #D5DBE6;padding:5px 6px;vertical-align:top}
tr{break-inside:avoid}
.h{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:7pt;word-break:break-all;width:30%}
</style></head><body>
<div class="m">${esc(d.tenantName)}</div>
<h1>Nachweismappe ${esc(d.from)} – ${esc(d.to)}</h1>
<div class="m">${d.rows.length} Nachweise · erstellt ${esc(d.createdAt)}${d.filter.length ? ` · ${esc(d.filter.join(' · '))}` : ''}</div>
<div class="m" style="margin-top:4px">Jeder Nachweis liegt als versiegeltes PDF im Ordner „nachweise“. Echtheit prüfen: ${esc(d.verifyBase)}&lt;Prüfcode&gt; – der dort angezeigte SHA-256-Wert muss mit dieser Liste und der Datei übereinstimmen.</div>
<table><thead><tr><th>#</th><th>Nachweis</th><th>Person</th><th>Schulung</th><th>Datum</th><th>Versiegelt</th><th>Prüfcode</th><th>SHA-256 (PDF)</th></tr></thead>
<tbody>${rows}</tbody></table>
</body></html>`;
}
