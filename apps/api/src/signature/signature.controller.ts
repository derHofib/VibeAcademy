import { BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { ParticipantRoute } from '../auth/decorators';
import { StepUpService } from '../auth/step-up.service';
import { Clock } from '../common/clock';
import { sha256 } from '../common/crypto';
import { ZodBody } from '../common/errors';
import { currentRequest } from '../common/request-context';
import { EvidenceService } from '../evidence/evidence.service';
import { personSubject, signaturePurpose } from '../participant/participant.controller';
import { ParticipantService } from '../participant/participant.service';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage';
import { parseSettings } from '../trainings/settings';
import { SignatureProviders } from '../qes/signature-providers';
import { WebhookEmitter } from '../webhooks/webhook-emitter';

const MAX_PNG_BYTES = 300 * 1024;
const Point = z.object({ x: z.number().finite(), y: z.number().finite(), t: z.number().finite().optional() });
const SignBody = z.object({
  stepUpToken: z.string().min(20).max(100),
  confirmed: z.literal(true, { error: 'Bitte den Bestätigungstext ankreuzen' }),
  confirmTextSha256: z.string().regex(/^[0-9a-f]{64}$/),
  strokes: z.array(z.array(Point).min(1).max(5000)).min(1, 'Bitte unterschreiben').max(200),
  imagePng: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, 'Unterschriftsbild fehlt').max(MAX_PNG_BYTES * 1.4),
});

/** Bestätigung und Unterschrift (SPEZIFIKATION 4.3, E-08). Danach unveränderlich, Nachweis-PDF wird erzeugt. */
@Controller('me/invitations/:id/signature')
export class SignatureController {
  constructor(
    private readonly participants: ParticipantService,
    private readonly stepUp: StepUpService,
    private readonly audit: AuditService,
    private readonly evidence: EvidenceService,
    private readonly clock: Clock,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly providers: SignatureProviders,
  ) {}

  @ParticipantRoute()
  @Get()
  async info(@Param('id', ParseUUIDPipe) id: string) {
    const p = await this.participants.resolve(id);
    return this.participants.read(p, async (c) => {
      const r = (
        await c.query(
          `SELECT i.status, coalesce(v.confirm_text, t.confirm_text) AS confirm_text, t.quiz_required AND (coalesce(cardinality(i.changed_pages), 0) = 0
                    OR coalesce((t.settings->>'quizOnReinvite')::boolean, true)) AS quiz_required, p.email IS NOT NULL AS has_email,
                  (SELECT signed_at FROM signature s WHERE s.invitation_id = i.id) AS signed_at,
                  (SELECT verify_code FROM evidence e WHERE e.invitation_id = i.id) AS verify_code,
                  (SELECT typ FROM signature s WHERE s.invitation_id = i.id) AS signed_typ, t.settings
             FROM invitation i JOIN person p ON p.id = i.person_id JOIN run r ON r.id = i.run_id
             JOIN training t ON t.id = r.training_id JOIN training_version v ON v.id = coalesce(i.training_version_id, r.training_version_id) WHERE i.id = $1`,
          [id],
        )
      ).rows[0];
      if (!r) throw new NotFoundException('Einladung nicht gefunden');
      const pagesComplete = !['offen', 'geoeffnet', 'ueberfaellig'].includes(r.status);
      const quizPassed = ['bestanden', 'bestaetigt'].includes(r.status);
      return {
        confirmText: r.confirm_text,
        confirmTextSha256: sha256(r.confirm_text),
        requirements: { pagesComplete, quizRequired: r.quiz_required, quizPassed },
        ready: quizPassed && !r.signed_at,
        signedAt: r.signed_at,
        verifyCode: r.verify_code,
        authMethods: [...(p.accountId ? ['password'] : []), ...(r.has_email ? ['otp_mail'] : [])],
        // E-40: Signaturniveau der Schulung; bei FES/QES Weiterleitung zum Anbieter statt Unterschriftsfeld
        ...this.providers.levelInfo(r.signed_typ ?? parseSettings(r.settings).signatureLevel),
      };
    });
  }

  @ParticipantRoute()
  @Post()
  async sign(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(SignBody)) b: z.infer<typeof SignBody>) {
    const p = await this.participants.resolve(id);
    const png = Buffer.from(b.imagePng.split(',')[1]!, 'base64');
    if (png.length > MAX_PNG_BYTES || png.subarray(1, 4).toString() !== 'PNG') throw new BadRequestException('Unterschriftsbild ungültig');
    // Vorbedingungen zuerst prüfen, damit ein Step-up-Token nicht unnötig verbraucht wird.
    const pre = await this.participants.read(p, async (c) =>
      (await c.query(
        `SELECT i.status, coalesce(v.confirm_text, t.confirm_text) AS confirm_text, v.sha256 AS document_sha256, t.settings
           FROM invitation i JOIN run r ON r.id = i.run_id JOIN training t ON t.id = r.training_id
           JOIN training_version v ON v.id = coalesce(i.training_version_id, r.training_version_id) WHERE i.id = $1`,
        [id],
      )).rows[0],
    );
    if (!pre) throw new NotFoundException('Einladung nicht gefunden');
    if (pre.status === 'bestaetigt') throw new ConflictException('Bereits unterschrieben');
    if (pre.status !== 'bestanden') throw new ConflictException('Unterschrift erst nach allen Seiten und bestandenem Wissenscheck');
    if (sha256(pre.confirm_text) !== b.confirmTextSha256) throw new ConflictException('Der Bestätigungstext wurde geändert. Bitte Seite neu laden.');
    if (parseSettings(pre.settings).signatureLevel !== 'ees') {
      throw new ConflictException({ code: 'anbieter', message: 'Für diese Schulung wird beim Signaturanbieter unterschrieben.' });
    }
    const method = await this.stepUp.consume(b.stepUpToken, { subject: personSubject(p.personId), purpose: signaturePurpose(id) });
    const now = this.clock.now();
    const req = currentRequest();
    const imageKey = `signatures/${p.tenantId}/${id}.png`;
    await this.storage.put('evidence', imageKey, png, { contentType: 'image/png' });
    const sigId = await this.participants.write(p, async (c) => {
      const inv = (await c.query('SELECT status FROM invitation WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (inv.status !== 'bestanden') throw new ConflictException('Unterschrift nicht möglich');
      const attempt = (await c.query('SELECT id FROM quiz_attempt WHERE invitation_id = $1 AND passed ORDER BY attempt_no DESC LIMIT 1', [id])).rows[0];
      const r = await c.query(
        `INSERT INTO signature (invitation_id, image_key, image_sha256, stroke_data, auth_method, confirm_text, confirm_text_sha256,
                                document_sha256, quiz_attempt_id, user_agent, ip_hash, signed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [id, imageKey, sha256(png), JSON.stringify(b.strokes), method, pre.confirm_text, b.confirmTextSha256, pre.document_sha256,
         attempt?.id ?? null, req?.userAgent ?? null, req?.ipHash ?? null, now],
      );
      await c.query(`UPDATE invitation SET status = 'bestaetigt', completed_at = $2 WHERE id = $1`, [id, now]);
      await WebhookEmitter.emit(c, p.tenantId, 'invitation.completed', { invitationId: id }); // E-37
      await this.audit.record(c, {
        entity: 'signature', entityId: r.rows[0].id, action: 'signed',
        payload: { invitationId: id, authMethod: method, documentSha256: pre.document_sha256, confirmTextSha256: b.confirmTextSha256, imageSha256: sha256(png) },
      });
      return r.rows[0].id as string;
    });
    const ev = await this.evidence.createForInvitation(p.tenantId, id);
    return { signatureId: sigId, signedAt: now, verifyCode: ev.verifyCode, nachweisNr: ev.nachweisNr };
  }
}
