import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Daten für den Nachweis eines externen Schulungsnachweises (SPEZIFIKATION 4.4/4.7). Zeiten bereits formatiert. */
export interface ExternalEvidenceData {
  tenantName: string;
  nachweisNr: string;
  createdAt: string;
  verifyUrl: string;
  qrSvg: string;
  person: { name: string; personalnr: string | null; orgUnit: string | null };
  course: { title: string; qualification: string | null; provider: string | null; heldOn: string; duration: string | null; location: string | null };
  isMedical: boolean;
  validUntil: string | null;
  validityNote: string | null;
  source: string;
  submitted: string | null;
  reviewed: string;
  receipts: Array<{ name: string; sha256: string; pages: number; kind: string }>;
  sealLabel: string;
}

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-8)}`;

let fontCss: string | null = null;
function fonts(fontDir: string): string {
  if (fontCss !== null) return fontCss;
  const face = (family: string, file: string, weight: number) => {
    try {
      return `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${readFileSync(join(fontDir, file)).toString('base64')}) format('woff2');}`;
    } catch {
      return '';
    }
  };
  fontCss = [400, 600, 700]
    .flatMap((w) => [face('Inter', `inter-latin-${w}-normal.woff2`, w), face('Inter', `inter-latin-ext-${w}-normal.woff2`, w),
      face('Plus Jakarta Sans', `plus-jakarta-sans-latin-${w}-normal.woff2`, w), face('Plus Jakarta Sans', `plus-jakarta-sans-latin-ext-${w}-normal.woff2`, w)])
    .join('');
  return fontCss;
}

export function renderExternalEvidenceHtml(d: ExternalEvidenceData, fontDir: string): string {
  const row = (k: string, v: string | null) => (v ? `<tr><th>${esc(k)}</th><td>${v}</td></tr>` : '');
  const receipts = d.receipts.length
    ? d.receipts.map((r, i) => `<tr><td>Anlage ${i + 1}</td><td>${esc(r.name)}<br><span class="m">${esc(r.kind)} · ${r.pages} ${r.pages === 1 ? 'Seite' : 'Seiten'} · SHA-256 ${esc(short(r.sha256))}</span></td></tr>`).join('')
    : '<tr><td colspan="2" class="m">Kein Beleg hinterlegt</td></tr>';
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Nachweis ${esc(d.nachweisNr)}</title>
<style>
${fonts(fontDir)}
@page{size:A4;margin:16mm 16mm 14mm}
*{box-sizing:border-box}
body{font-family:Inter,Arial,sans-serif;color:#1D2433;font-size:10pt;line-height:1.45;margin:0}
h1{font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:19pt;line-height:1.2;margin:4px 0 6px;letter-spacing:-.01em}
h2{font-size:9.5pt;letter-spacing:.06em;text-transform:uppercase;margin:18px 0 6px;font-weight:700}
.m{color:#5F6B7D}
.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2.5px solid #1D2433;padding-bottom:12px}
.qr{width:90px;text-align:center;font-size:8pt;color:#5F6B7D}.qr svg{width:90px;height:90px;display:block}
.cols{display:flex;gap:28px}.cols>div{flex:1}
table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:4px 8px 4px 0}th{width:38%;font-weight:600;color:#3A4456}
.box{border:1.5px solid #1D2433;border-radius:10px;padding:12px 16px;margin-top:16px;break-inside:avoid}
.note{background:#EAF0FE;color:#223C8F;border-radius:8px;padding:8px 12px;font-size:9pt;margin-top:10px}
.foot{position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #D5DBE6;padding-top:6px;font-size:7.5pt;color:#5F6B7D}
</style></head><body>
<div class="head"><div>
<div class="m">${esc(d.tenantName)}</div>
<h1>${d.isMedical ? 'Nachweis über die Teilnahme an arbeitsmedizinischer Vorsorge' : 'Nachweis über eine externe Schulung'}</h1>
<div class="m" style="color:#3A4456">Nachweis-Nr. ${esc(d.nachweisNr)} · erstellt ${esc(d.createdAt)}</div>
</div><div class="qr">${d.qrSvg}Echtheit prüfen</div></div>

<div class="cols"><div>
<h2>Teilnehmer/in</h2>
<b>${esc(d.person.name)}</b>${d.person.personalnr ? `, Pers.-Nr. ${esc(d.person.personalnr)}` : ''}<br>
${d.person.orgUnit ? `${esc(d.person.orgUnit)}<br>` : ''}
</div><div>
<h2>Gültigkeit</h2>
${d.validUntil ? `Gültig bis: <b>${esc(d.validUntil)}</b>` : 'Ohne Ablaufdatum (nur Dokumentation)'}
${d.validityNote ? `<br><span class="m">${esc(d.validityNote)}</span>` : ''}
</div></div>

<h2>${d.isMedical ? 'Vorsorge' : 'Schulung'}</h2>
<table>
${row(d.isMedical ? 'Art' : 'Kurs', `<b>${esc(d.course.title)}</b>`)}
${row('Angerechnet auf', d.course.qualification ? esc(d.course.qualification) : null)}
${row('Datum', esc(d.course.heldOn))}
${d.isMedical ? '' : row('Anbieter', d.course.provider ? esc(d.course.provider) : null)}
${d.isMedical ? '' : row('Umfang', d.course.duration ? esc(d.course.duration) : null)}
${d.isMedical ? '' : row('Ort', d.course.location ? esc(d.course.location) : null)}
</table>
${d.isMedical ? '<div class="note">Arbeitsmedizinische Vorsorge: dokumentiert sind ausschließlich Teilnahme und Datum, keine Befunde (ArbMedVV).</div>' : ''}

<h2>Erfassung und Prüfung</h2>
<table>
${row('Erfasst', esc(d.source))}
${row('Eingereicht', d.submitted ? esc(d.submitted) : null)}
${row('Geprüft und freigegeben', esc(d.reviewed))}
</table>

<div class="box">
<h2 style="margin-top:0">Belege (als Anlage beigefügt)</h2>
<table>${receipts}</table>
<div class="m" style="font-size:8.5pt;margin-top:6px">Die Original-Belege folgen auf den nächsten Seiten. Der SHA-256-Wert belegt, dass sie seit dem Hochladen unverändert sind.</div>
</div>

<div class="foot">${esc(d.sealLabel)}<br>Echtheit prüfen: QR-Code oben rechts oder ${esc(d.verifyUrl)}</div>
</body></html>`;
}
