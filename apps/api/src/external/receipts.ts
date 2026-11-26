import { PDFDocument, PageSizes } from 'pdf-lib';

export type ReceiptMime = 'application/pdf' | 'image/jpeg' | 'image/png';

export interface ReceiptFile {
  key: string;
  sha256: string;
  name: string;
  mime: ReceiptMime;
  size: number;
  pages: number;
}

/** Dateityp anhand der ersten Bytes (nicht der Endung) bestimmen. */
export function sniffMime(b: Buffer): ReceiptMime | null {
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}

export const extFor = (m: ReceiptMime) => (m === 'application/pdf' ? 'pdf' : m === 'image/png' ? 'png' : 'jpg');

export async function pageCount(b: Buffer, mime: ReceiptMime): Promise<number> {
  if (mime !== 'application/pdf') return 1;
  const doc = await PDFDocument.load(b, { ignoreEncryption: true });
  return doc.getPageCount();
}

/** Belegname säubern (Anzeige und Dateiname im ZIP) */
export function cleanName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'beleg';
  return base.replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 120) || 'beleg';
}

/**
 * Beleg als PDF für die Anlage des Nachweises (E-09): PDFs unverändert, Fotos/Scans als A4-Seite (eingepasst, 12 mm Rand).
 */
export async function receiptAsPdf(b: Buffer, mime: ReceiptMime): Promise<Buffer> {
  if (mime === 'application/pdf') return b;
  const doc = await PDFDocument.create();
  const img = mime === 'image/png' ? await doc.embedPng(b) : await doc.embedJpg(b);
  const landscape = img.width > img.height;
  const [w, h] = landscape ? [PageSizes.A4[1], PageSizes.A4[0]] : PageSizes.A4;
  const margin = 34; // ≈ 12 mm
  const scale = Math.min((w - 2 * margin) / img.width, (h - 2 * margin) / img.height, 1.5);
  const page = doc.addPage([w, h]);
  const dw = img.width * scale;
  const dh = img.height * scale;
  page.drawImage(img, { x: (w - dw) / 2, y: (h - dh) / 2, width: dw, height: dh });
  return Buffer.from(await doc.save());
}
