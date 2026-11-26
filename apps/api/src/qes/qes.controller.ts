import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ParticipantRoute, Public } from '../auth/decorators';
import { ZodBody } from '../common/errors';
import { QesService } from './qes.service';
import { TestQesProvider } from './test-qes.provider';

const StartBody = z.object({
  confirmed: z.literal(true, { error: 'Bitte den Bestätigungstext ankreuzen' }),
  confirmTextSha256: z.string().regex(/^[0-9a-f]{64}$/),
});

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** Nach der Rückleitung zurück in die Teilnehmersicht (relativ: gleicher Origin wie die Web-App). */
const donePath = (invitationId: string, outcome: string) =>
  `/teilnahme/${invitationId}/abschluss?signatur=${outcome === 'abgeschlossen' ? 'ok' : encodeURIComponent(outcome)}`;

/** FES/QES über einen Signaturanbieter (E-40): Start, Rückleitung, Nachfrage. */
@Controller()
export class QesController {
  constructor(private readonly qes: QesService) {}

  /** Bestätigungstext angenommen → Vorgang beim Anbieter starten, Antwort enthält die Weiterleitungs-URL. */
  @ParticipantRoute()
  @Post('me/invitations/:id/signature/provider')
  start(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(StartBody)) b: z.infer<typeof StartBody>) {
    return this.qes.start(id, b);
  }

  /** Status nachfragen bzw. Vorgang abschließen, falls die Rückleitung nicht ankam. */
  @ParticipantRoute()
  @Post('me/invitations/:id/signature/provider/complete')
  @HttpCode(200)
  complete(@Param('id', ParseUUIDPipe) id: string) {
    return this.qes.completeForInvitation(id);
  }

  /** Rückleitung des Anbieters (Browser). Signiertes Token statt Sitzung, danach weiter in die Teilnehmersicht. */
  @Public()
  @Get('qes/callback/:requestId')
  async callback(@Param('requestId', ParseUUIDPipe) requestId: string, @Query('t') t: string | undefined, @Res() res: Response) {
    const r = await this.qes.callback(requestId, t);
    res.redirect(303, donePath(r.invitationId, r.outcome));
  }
}

/**
 * Signaturseite des TEST-Anbieters (E-40) – simuliert die Weiterleitung zu einem Vertrauensdiensteanbieter.
 * Bestätigen/Abbrechen per Link mit Einmal-Nonce (die Seite ist ohne Skript, CSP bleibt streng).
 */
@Controller('qes/test/sign')
export class TestQesController {
  constructor(private readonly provider: TestQesProvider) {}

  @Public()
  @Get(':tx')
  async page(@Param('tx') tx: string, @Res() res: Response) {
    const s = await this.provider.state(tx);
    if (!s) throw new NotFoundException('Signaturvorgang unbekannt oder abgelaufen');
    const en = s.lang === 'en';
    const level = s.level === 'qes' ? (en ? 'Qualified electronic signature (QES)' : 'Qualifizierte elektronische Signatur (QES)')
      : en ? 'Advanced electronic signature (AdES)' : 'Fortgeschrittene elektronische Signatur (FES)';
    const q = `?n=${encodeURIComponent(s.nonce)}`;
    const action = s.status === 'pending'
      ? `<a class="btn" href="/api/qes/test/sign/${esc(encodeURIComponent(tx))}/approve${q}">${en ? 'Sign' : 'Signieren'}</a>
<a class="link" href="/api/qes/test/sign/${esc(encodeURIComponent(tx))}/cancel${q}">${en ? 'Cancel' : 'Abbrechen'}</a>`
      : `<a class="btn" href="${esc(s.returnUrl)}">${en ? 'Back' : 'Zurück'}</a>`;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-robots-tag', 'noindex');
    res.send(`<!doctype html><html lang="${en ? 'en' : 'de'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${en ? 'TEST signature provider' : 'TEST-Signaturanbieter'}</title>
<style>
body{margin:0;background:#F4F6FB;font-family:Inter,Arial,sans-serif;color:#1D2433}
main{max-width:480px;margin:0 auto;padding:24px 16px}
.card{background:#fff;border-radius:24px;padding:24px;box-shadow:0 10px 30px rgba(29,36,51,.06)}
.test{background:#FFF4DF;color:#5A3A00;border-radius:12px;padding:10px 14px;font-size:14px;font-weight:600;margin-bottom:16px}
h1{font-size:22px;margin:0 0 4px}.m{color:#5F6B7D;font-size:14px}
dl{margin:16px 0;font-size:15px}dt{color:#5F6B7D;font-size:12px;text-transform:uppercase;letter-spacing:.05em;margin-top:10px}dd{margin:2px 0 0}
.btn{display:block;text-align:center;background:#3D63DD;color:#fff;text-decoration:none;font-weight:600;padding:14px;border-radius:999px;margin-top:20px}
.link{display:block;text-align:center;color:#3D63DD;margin-top:14px;font-size:15px}
</style></head><body><main><div class="card">
<div class="test">${en ? 'TEST PROVIDER – no legal effect' : 'TEST-ANBIETER – ohne Rechtswirkung'}</div>
<h1>${en ? 'Sign document' : 'Dokument signieren'}</h1>
<div class="m">${esc(level)}</div>
<dl><dt>${en ? 'Document' : 'Dokument'}</dt><dd>${esc(s.documentName)}</dd>
<dt>${en ? 'Signer' : 'Unterzeichner/in'}</dt><dd>${esc(s.signerName)}</dd>
<dt>${en ? 'Transaction' : 'Vorgang'}</dt><dd>${esc(tx)}</dd>
<dt>Status</dt><dd>${esc(s.status)}</dd></dl>
${action}
</div></main></body></html>`);
  }

  @Public()
  @Get(':tx/approve')
  async approve(@Param('tx') tx: string, @Query('n') n: string | undefined, @Res() res: Response) {
    const s = await this.provider.approve(tx, n ?? '');
    if (!s) throw new NotFoundException('Signaturvorgang unbekannt oder abgelaufen');
    res.redirect(303, s.returnUrl);
  }

  @Public()
  @Get(':tx/cancel')
  async cancel(@Param('tx') tx: string, @Query('n') n: string | undefined, @Res() res: Response) {
    const s = await this.provider.cancel(tx, n ?? '');
    if (!s) throw new NotFoundException('Signaturvorgang unbekannt oder abgelaufen');
    res.redirect(303, s.returnUrl);
  }
}
