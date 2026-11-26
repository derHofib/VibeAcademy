import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
  pages: Array<{ pageNo: number; ist: string; soll: string; erstmals: string; erfuellt: boolean }>;
  quiz: { required: boolean; attempts: Array<{ no: number; right: number; total: number; pct: number; passed: boolean }>; passPct: number; maxAttempts: number };
  gueltigBis: string | null;
  wiederholung: string;
  confirmText: string;
  signature: { pngBase64: string; signedAt: string; authMethod: string; device: string; ipHash: string; confirmSha: string };
  seal: { label: string };
}

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-8)}`;

let fontCss: string | null = null;
/** Schriften als data:-URLs einbetten – das PDF braucht keine Netzwerkzugriffe. */
function fonts(fontDir: string): string {
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

export function renderEvidenceHtml(d: EvidenceData, fontDir: string): string {
  const pages = d.pages
    .map(
      (p) => `<div class="pg"><b>S. ${p.pageNo}</b> ${p.erfuellt ? '<span class="ok">✓</span>' : '<span class="no">–</span>'}<br>${esc(p.ist)} / ${esc(p.soll)}<br><span class="m">${esc(p.erstmals)}</span></div>`,
    )
    .join('');
  const quiz = d.quiz.required
    ? d.quiz.attempts
        .map((a) => `Versuch ${a.no}: ${a.right} von ${a.total} (${a.pct} %) – ${a.passed ? '<b>bestanden</b>' : 'nicht bestanden'}`)
        .join('<br>') + `<br><span class="m">Bestehensgrenze ${d.quiz.passPct} %, max. ${d.quiz.maxAttempts} Versuche</span>`
    : '<span class="m">Für diese Unterweisung nicht vorgesehen</span>';
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Nachweis ${esc(d.nachweisNr)}</title>
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
.ok{color:#1E7A50}.no{color:#A1271B}
.box{border:1.5px solid #1D2433;border-radius:10px;padding:14px 18px;margin-top:16px;break-inside:avoid}
.sig{display:flex;gap:28px;align-items:flex-end;margin-top:10px}.sig>div{flex:1}
.sig img{height:60px;display:block}
.line{border-top:1.5px solid #1D2433;padding-top:4px;margin-top:4px}
.warn{background:#FFF4DF;color:#5A3A00;border-radius:6px;padding:4px 8px;font-size:8.5pt;display:inline-block;margin-top:4px}
.foot{position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #D5DBE6;padding-top:6px;font-size:7.5pt;color:#5F6B7D}
</style></head><body>
<div class="head"><div>
<div class="m">${esc(d.tenantName)}</div>
<h1>Nachweis über Unterweisung und Kenntnisnahme</h1>
<div class="m" style="color:#3A4456">Nachweis-Nr. ${esc(d.nachweisNr)} · erstellt ${esc(d.createdAt)}</div>
</div><div class="qr">${d.qrSvg}Echtheit prüfen</div></div>

<div class="cols"><div>
<h2>Schulung</h2>
<b>${esc(d.training.titel)}</b>, Version ${d.training.versionNo}<br>
${d.training.rechtsgrundlage ? `Rechtsgrundlage: ${esc(d.training.rechtsgrundlage)}<br>` : ''}
Format: ${esc(d.training.format)} · ${d.training.pageCount} Seiten<br>
${d.training.unterweisender ? `Unterweisender: ${esc(d.training.unterweisender)}<br>` : ''}
<span class="m">Dokument SHA-256: ${esc(short(d.training.sha256))}</span>
</div><div>
<h2>Teilnehmer/in</h2>
<b>${esc(d.person.name)}</b>${d.person.personalnr ? `, Pers.-Nr. ${esc(d.person.personalnr)}` : ''}<br>
${d.person.orgUnit ? `${esc(d.person.orgUnit)}<br>` : ''}
Eingeladen: ${esc(d.ablauf.eingeladen)}<br>
Bearbeitet: ${esc(d.ablauf.bearbeitet)} in ${d.ablauf.sitzungen} ${d.ablauf.sitzungen === 1 ? 'Sitzung' : 'Sitzungen'}<br>
Lesezeit gesamt: ${esc(d.ablauf.lesezeitIst)} (Mindestzeit ${esc(d.ablauf.lesezeitSoll)})
${d.ablauf.plausibel ? '' : '<br><span class="warn">Hinweis: Lesezeit auffällig kurz (Plausibilitätsprüfung)</span>'}
</div></div>

<h2>Seitenprotokoll</h2>
<div class="grid">${pages}</div>
<div class="m" style="font-size:8pt;margin-top:4px">Ist-Verweildauer / Soll · erstmals angezeigt (Datum). Gezählt nur bei sichtbarer Seite, aktivem Fenster und Interaktion; maßgeblich ist die Serverzeit.</div>

<div class="cols"><div>
<h2>Wissenscheck</h2>${quiz}
</div><div>
<h2>Gültigkeit</h2>
${d.gueltigBis ? `Gültig bis: <b>${esc(d.gueltigBis)}</b><br>` : ''}Wiederholung: ${esc(d.wiederholung)}
</div></div>

<div class="box">
<h2 style="margin-top:0">Bestätigung</h2>
<div style="font-size:10.5pt">„${esc(d.confirmText)}“</div>
<div class="sig"><div>
<img src="data:image/png;base64,${d.signature.pngBase64}" alt="Unterschrift">
<div class="line">${esc(d.person.name)} · ${esc(d.signature.signedAt)}</div>
</div><div class="m" style="color:#3A4456">
Authentifizierung: ${esc(d.signature.authMethod)}<br>
Gerät: ${esc(d.signature.device)} · IP-Hash ${esc(d.signature.ipHash)}<br>
Best.-Text SHA-256: ${esc(short(d.signature.confirmSha))}
</div></div></div>

<div class="foot">${esc(d.seal.label)}<br>Jede nachträgliche Änderung macht die Versiegelung ungültig. Prüfung über den QR-Code oben rechts: ${esc(d.verifyUrl)}</div>
</body></html>`;
}
