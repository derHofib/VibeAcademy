/**
 * Nachrichtenvorlagen (E-12). Alle Texte auf Deutsch. Geheimnisse (Codes, Token-Links) kommen getrennt
 * von den protokollierten Daten herein und werden nie in der Outbox gespeichert.
 */
export interface Rendered {
  subject: string;
  text: string;
  html: string;
}

type Data = Record<string, unknown>;
type Secret = Record<string, string> | null;

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** Gemeinsamer Rahmen im weichen Stil (Design-Tokens, Inline-CSS für Mail-Clients). */
function frame(title: string, body: string, footer = 'Diese Nachricht wurde automatisch versendet.'): string {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${esc(title)}</title></head>
<body style="margin:0;background:#F4F6FB;font-family:Inter,Arial,sans-serif;color:#1D2433">
<div style="max-width:560px;margin:0 auto;padding:32px 16px">
<div style="background:#FFFFFF;border-radius:24px;padding:32px;box-shadow:0 1px 2px rgba(29,36,51,.04),0 10px 30px rgba(29,36,51,.06)">
<h1 style="font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:22px;line-height:1.3;margin:0 0 16px;letter-spacing:-0.01em">${esc(title)}</h1>
${body}
</div>
<p style="color:#5F6B7D;font-size:12px;line-height:1.5;margin:16px 8px 0">${esc(footer)}</p>
</div></body></html>`;
}

const p = (s: string) => `<p style="font-size:15px;line-height:1.6;color:#3A4456;margin:0 0 16px">${s}</p>`;
const button = (href: string, label: string) =>
  `<p style="margin:24px 0"><a href="${esc(href)}" style="display:inline-block;background:#3D63DD;color:#FFFFFF;text-decoration:none;font-weight:600;padding:14px 28px;border-radius:999px">${esc(label)}</a></p>`;

export const TEMPLATES = {
  otp: (d: Data, s: Secret): Rendered => {
    const code = s?.code ?? '••••••';
    return {
      subject: `Ihr Bestätigungscode: ${code}`,
      text: `Ihr Bestätigungscode lautet ${code}.\nEr ist 10 Minuten gültig. Zweck: ${d.purposeLabel ?? 'Bestätigung'}.\nWenn Sie das nicht angefordert haben, ignorieren Sie diese Nachricht.`,
      html: frame(
        'Ihr Bestätigungscode',
        p(`Zweck: ${esc(d.purposeLabel ?? 'Bestätigung')}`) +
          `<p style="font-size:32px;font-weight:700;letter-spacing:.2em;font-variant-numeric:tabular-nums;margin:8px 0 16px">${esc(code)}</p>` +
          p('Der Code ist 10 Minuten gültig. Wenn Sie das nicht angefordert haben, ignorieren Sie diese Nachricht.'),
      ),
    };
  },
  'member-invite': (d: Data, s: Secret): Rendered => {
    const link = s?.link ?? '#';
    return {
      subject: `Einladung zu ${d.tenantName} – Schulungsnachweis`,
      text: `${d.inviterName} hat Sie zu „${d.tenantName}“ eingeladen.\nPasswort festlegen und loslegen: ${link}\nDer Link ist 7 Tage gültig.`,
      html: frame(
        `Einladung zu ${d.tenantName}`,
        p(`${esc(d.inviterName)} hat Sie als ${esc(d.rolesLabel)} zu „${esc(d.tenantName)}“ eingeladen.`) +
          button(link, 'Passwort festlegen') +
          p('Der Link ist 7 Tage gültig.'),
      ),
    };
  },
  'member-added': (d: Data): Rendered => ({
    subject: `Sie wurden zu ${d.tenantName} hinzugefügt`,
    text: `${d.inviterName} hat Sie zu „${d.tenantName}“ hinzugefügt. Melden Sie sich wie gewohnt an: ${d.loginUrl}`,
    html: frame(
      `Neu in ${d.tenantName}`,
      p(`${esc(d.inviterName)} hat Sie als ${esc(d.rolesLabel)} zu „${esc(d.tenantName)}“ hinzugefügt.`) +
        button(String(d.loginUrl), 'Anmelden'),
    ),
  }),
} satisfies Record<string, (d: Data, s: Secret) => Rendered>;

export type TemplateName = keyof typeof TEMPLATES;

export function render(template: string, data: Data, secret: Secret): Rendered {
  const fn = (TEMPLATES as Record<string, (d: Data, s: Secret) => Rendered>)[template];
  if (!fn) throw new Error(`Unbekannte Vorlage: ${template}`);
  return fn(data, secret);
}

/** Beispieldaten für die Vorschau-Route (nur Entwicklung). */
export const SAMPLE_DATA: Record<TemplateName, { data: Data; secret: Secret }> = {
  otp: { data: { purposeLabel: 'Unterschrift „Sicherheitsunterweisung 2026“' }, secret: { code: '482913' } },
  'member-invite': {
    data: { tenantName: 'Muster Elektro GmbH', inviterName: 'Dennis Hofmann', rolesLabel: 'Trainer / Dozent' },
    secret: { link: 'http://localhost:5173/passwort-festlegen#token=beispiel' },
  },
  'member-added': {
    data: { tenantName: 'Muster Elektro GmbH', inviterName: 'Dennis Hofmann', rolesLabel: 'Vorgesetzter', loginUrl: 'http://localhost:5173/anmelden' },
    secret: null,
  },
};
