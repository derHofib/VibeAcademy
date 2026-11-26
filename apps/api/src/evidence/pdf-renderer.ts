import type { Browser } from 'playwright-core';

/** HTML → PDF (E-09). */
export interface PdfRenderer {
  render(html: string): Promise<Buffer>;
  close?(): Promise<void>;
}
export const PDF_RENDERER = Symbol('PDF_RENDERER');

/** Lokales Chromium über playwright-core (Entwicklung, Tests, Einzelserver). */
export class PlaywrightRenderer implements PdfRenderer {
  private browser: Promise<Browser> | null = null;
  private async getBrowser() {
    if (!this.browser) {
      const { chromium } = await import('playwright-core');
      this.browser = chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
    }
    return this.browser;
  }
  async render(html: string) {
    const page = await (await this.getBrowser()).newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate('document.fonts.ready');
      return Buffer.from(await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true }));
    } finally {
      await page.close();
    }
  }
  async close() {
    if (this.browser) await (await this.browser).close().catch(() => undefined);
  }
}

/** Gotenberg-Dienst (Docker Compose). */
export class GotenbergRenderer implements PdfRenderer {
  constructor(private readonly url: string) {}
  async render(html: string) {
    const form = new FormData();
    form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
    form.append('preferCssPageSize', 'true');
    form.append('printBackground', 'true');
    const r = await fetch(`${this.url}/forms/chromium/convert/html`, { method: 'POST', body: form });
    if (!r.ok) throw new Error(`Gotenberg antwortet mit ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }
}
