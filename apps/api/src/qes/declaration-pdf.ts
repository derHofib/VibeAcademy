import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';

/** Inhalt der Erklärung, die beim FES/QES-Anbieter signiert wird (E-40). */
export interface DeclarationInput {
  lang: 'de' | 'en';
  tenantName: string;
  trainingTitle: string;
  versionNo: number;
  documentSha256: string;
  personName: string;
  personEmail: string | null;
  confirmText: string;
  confirmTextSha256: string;
  invitationId: string;
  requestId: string;
  level: 'fes' | 'qes';
  createdAt: string;
  test: boolean;
}

const T = {
  de: {
    title: 'Erklärung zur Unterweisung',
    level: { fes: 'Zur fortgeschrittenen elektronischen Signatur (FES)', qes: 'Zur qualifizierten elektronischen Signatur (QES)' },
    org: 'Organisation', training: 'Schulung', version: 'Version', doc: 'Dokument SHA-256', person: 'Teilnehmer/in', email: 'E-Mail',
    statement: 'Bestätigung im Wortlaut', confirmSha: 'Bestätigungstext SHA-256', ref: 'Einladung / Vorgang', created: 'Erstellt',
    test: 'TEST – Diese Erklärung wird von einem Test-Anbieter signiert und hat keine Rechtswirkung.',
  },
  en: {
    title: 'Declaration on the instruction',
    level: { fes: 'For an advanced electronic signature (AdES)', qes: 'For a qualified electronic signature (QES)' },
    org: 'Organisation', training: 'Training', version: 'Version', doc: 'Document SHA-256', person: 'Participant', email: 'E-mail',
    statement: 'Confirmation (verbatim)', confirmSha: 'Confirmation text SHA-256', ref: 'Invitation / transaction', created: 'Created',
    test: 'TEST – this declaration is signed by a test provider and has no legal effect.',
  },
} as const;

/** Zeichen, die die Standardschrift (WinAnsi) nicht kennt, durch die Grundform bzw. „?“ ersetzen. */
function encodable(font: PDFFont, text: string): string {
  let out = '';
  for (const ch of text) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
      try {
        font.encodeText(base);
        out += base;
      } catch {
        out += ch === 'ı' ? 'i' : '?';
      }
    }
  }
  return out;
}

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\n/)) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

/** Einseitiges PDF mit der Erklärung (wird beim Anbieter signiert und dem Nachweis beigefügt). */
export async function buildDeclarationPdf(d: DeclarationInput): Promise<Buffer> {
  const t = T[d.lang];
  const doc = await PDFDocument.create();
  doc.setTitle(t.title);
  doc.setSubject(`${d.trainingTitle} · ${d.requestId}`);
  doc.setCreator('Schulungsnachweis');
  doc.setProducer('Schulungsnachweis');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595, 842]);
  const left = 56;
  const width = 595 - 2 * left;
  let y = 780;
  const ink = rgb(0.11, 0.14, 0.2);
  const muted = rgb(0.37, 0.42, 0.49);
  const text = (s: string, o: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; gap?: number } = {}) => {
    const size = o.size ?? 10.5;
    const f = o.f ?? font;
    for (const line of wrap(f, encodable(f, s), size, width)) {
      page.drawText(line, { x: left, y, size, font: f, color: o.color ?? ink });
      y -= size * 1.45;
    }
    y -= o.gap ?? 4;
  };
  if (d.test) {
    page.drawRectangle({ x: left - 8, y: y - 8, width: width + 16, height: 26, color: rgb(1, 0.96, 0.87) });
    text(t.test, { size: 9.5, f: bold, color: rgb(0.35, 0.23, 0), gap: 14 });
  }
  text(t.title, { size: 20, f: bold, gap: 2 });
  text(t.level[d.level], { size: 11, color: muted, gap: 16 });
  const row = (label: string, value: string) => {
    text(label, { size: 8.5, f: bold, color: muted, gap: 0 });
    text(value, { gap: 8 });
  };
  row(t.org, d.tenantName);
  row(t.training, `${d.trainingTitle} · ${t.version} ${d.versionNo}`);
  row(t.doc, d.documentSha256);
  row(t.person, d.personEmail ? `${d.personName} · ${d.personEmail}` : d.personName);
  row(t.statement, `„${d.confirmText}“`);
  row(t.confirmSha, d.confirmTextSha256);
  row(t.ref, `${d.invitationId} / ${d.requestId}`);
  row(t.created, d.createdAt);
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}
