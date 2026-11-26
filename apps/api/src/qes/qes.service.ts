import { ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { sha256 } from '../common/crypto';
import { currentRequest } from '../common/request-context';
import { SignedTokens } from '../common/signed-token';
import { APP_CONFIG, type AppConfig } from '../config';
import { DbService } from '../db/db.service';
import { EvidenceService } from '../evidence/evidence.service';
import { formatDate, participantLanguage } from '../i18n/language';
import { ParticipantService } from '../participant/participant.service';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage';
import { parseSettings } from '../trainings/settings';
import { buildDeclarationPdf } from './declaration-pdf';
import { SignatureProviders } from './signature-providers';
import { TestQesProvider } from './test-qes.provider';
import { WebhookEmitter } from '../webhooks/webhook-emitter';

const CALLBACK_TTL_S = 2 * 3600;

export type CompleteOutcome = 'abgeschlossen' | 'gestartet' | 'fehlgeschlagen' | 'abgebrochen';

/**
 * FES/QES-Ablauf (E-40): nach bestandenem Wissenscheck bestätigt der Teilnehmer den Text, wird zum Anbieter
 * weitergeleitet und kommt über die Rückleitung zurück. Erst dann entsteht die Unterschrift (typ fes|qes,
 * auth_method „provider“) und der Nachweis; das signierte Dokument des Anbieters wird dem Nachweis-PDF beigefügt.
 */
@Injectable()
export class QesService implements OnModuleInit {
  private readonly log = new Logger(QesService.name);

  constructor(
    private readonly db: DbService,
    private readonly participants: ParticipantService,
    private readonly providers: SignatureProviders,
    private readonly testProvider: TestQesProvider,
    private readonly audit: AuditService,
    private readonly evidence: EvidenceService,
    private readonly tokens: SignedTokens,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  onModuleInit() {
    // Simulierter Webhook des Test-Anbieters: Vorgang abschließen, auch wenn die Rückleitung ausbleibt
    this.testProvider.onSigned(async (tx) => {
      const r = await this.db.txAs({ roles: ['system'] }, (c) => c.query('SELECT * FROM app.signature_request_by_tx($1, $2)', ['test', tx]));
      if (r.rowCount) await this.complete(r.rows[0].id, r.rows[0].tenant_id);
    });
  }

  /** Vorgang beim Anbieter starten → Weiterleitungs-URL. */
  async start(invitationId: string, b: { confirmTextSha256: string }) {
    const p = await this.participants.resolve(invitationId);
    const pre = await this.participants.read(p, async (c) =>
      (await c.query(
        `SELECT i.status, coalesce(v.confirm_text, t.confirm_text) AS confirm_text, v.sha256 AS document_sha256, v.version_no,
                t.titel, t.settings, p.name AS person_name, p.email, p.sprache, te.name AS tenant_name
           FROM invitation i JOIN run r ON r.id = i.run_id JOIN training t ON t.id = r.training_id
           JOIN training_version v ON v.id = coalesce(i.training_version_id, r.training_version_id)
           JOIN person p ON p.id = i.person_id JOIN tenant te ON te.id = i.tenant_id WHERE i.id = $1`,
        [invitationId],
      )).rows[0],
    );
    if (!pre) throw new NotFoundException('Einladung nicht gefunden');
    const level = parseSettings(pre.settings).signatureLevel;
    if (level === 'ees') throw new ConflictException('Für diese Schulung genügt die einfache Unterschrift');
    if (pre.status === 'bestaetigt') throw new ConflictException('Bereits unterschrieben');
    if (pre.status !== 'bestanden') throw new ConflictException('Unterschrift erst nach allen Seiten und bestandenem Wissenscheck');
    if (sha256(pre.confirm_text) !== b.confirmTextSha256) throw new ConflictException('Der Bestätigungstext wurde geändert. Bitte Seite neu laden.');
    const provider = this.providers.forLevel(level);
    const lang = participantLanguage(pre.sprache);
    const requestId = (await this.db.txAs({ tenantId: p.tenantId, roles: ['system'] }, (c) => c.query('SELECT gen_random_uuid() AS id'))).rows[0].id as string;
    const doc = await buildDeclarationPdf({
      lang, tenantName: pre.tenant_name, trainingTitle: pre.titel, versionNo: pre.version_no, documentSha256: pre.document_sha256,
      personName: pre.person_name, personEmail: pre.email, confirmText: pre.confirm_text, confirmTextSha256: b.confirmTextSha256,
      invitationId, requestId, level, createdAt: formatDate(lang, this.clock.now()), test: provider.info.test,
    });
    const documentKey = `signature-requests/${p.tenantId}/${requestId}.pdf`;
    await this.storage.put('evidence', documentKey, doc, { contentType: 'application/pdf' });
    await this.participants.write(p, async (c) => {
      // ältere, nicht abgeschlossene Vorgänge gelten als abgebrochen
      await c.query(`UPDATE signature_request SET status = 'abgebrochen', completed_at = $2 WHERE invitation_id = $1 AND status = 'gestartet'`, [invitationId, this.clock.now()]);
      await c.query(
        `INSERT INTO signature_request (id, invitation_id, level, provider, document_key, document_sha256, confirm_text_sha256, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [requestId, invitationId, level, provider.info.name, documentKey, sha256(doc), b.confirmTextSha256, this.clock.now()],
      );
    });
    const token = this.tokens.sign('qes-callback', { r: requestId, t: p.tenantId }, CALLBACK_TTL_S);
    const returnPath = `/api/qes/callback/${requestId}?t=${encodeURIComponent(token)}`;
    const started = await provider.start({
      requestId, level, document: doc, documentName: `${pre.titel}.pdf`, signer: { name: pre.person_name, email: pre.email },
      returnUrl: provider.sameOrigin ? returnPath : `${this.config.PUBLIC_BASE_URL}${returnPath}`, lang,
    });
    await this.participants.write(p, async (c) => {
      await c.query('UPDATE signature_request SET transaction_id = $2 WHERE id = $1', [requestId, started.transactionId]);
      await this.audit.record(c, {
        entity: 'signature_request', entityId: requestId, action: 'started',
        payload: { invitationId, level, provider: provider.info.name, transactionId: started.transactionId, documentSha256: sha256(doc) },
      });
    });
    return { requestId, redirectUrl: started.redirectUrl, provider: provider.info.name, level, test: provider.info.test };
  }

  /** Rückleitung vom Anbieter (signiertes Token in der URL, ohne Sitzung gültig). */
  async callback(requestId: string, token: string | undefined): Promise<{ invitationId: string; outcome: CompleteOutcome }> {
    const data = token ? this.tokens.verify<{ r: string; t: string }>('qes-callback', token) : null;
    if (!data || data.r !== requestId) throw new NotFoundException('Rückleitung ungültig oder abgelaufen');
    return this.complete(requestId, data.t);
  }

  /** Teilnehmer fragt nach (falls die Rückleitung verloren ging). */
  async completeForInvitation(invitationId: string): Promise<{ outcome: CompleteOutcome | 'keiner' }> {
    const p = await this.participants.resolve(invitationId);
    const last = await this.participants.read(p, async (c) =>
      (await c.query('SELECT id FROM signature_request WHERE invitation_id = $1 ORDER BY created_at DESC LIMIT 1', [invitationId])).rows[0],
    );
    if (!last) return { outcome: 'keiner' };
    return { outcome: (await this.complete(last.id, p.tenantId)).outcome };
  }

  /** Ergebnis beim Anbieter abholen und – falls signiert – Unterschrift + Nachweis anlegen. Idempotent. */
  async complete(requestId: string, tenantId: string): Promise<{ invitationId: string; outcome: CompleteOutcome }> {
    const sys = { tenantId, roles: ['system'] };
    const req = (await this.db.txAs(sys, (c) => c.query('SELECT * FROM signature_request WHERE id = $1', [requestId]))).rows[0];
    if (!req) throw new NotFoundException('Signaturvorgang nicht gefunden');
    if (req.status !== 'gestartet' || !req.transaction_id) return { invitationId: req.invitation_id, outcome: req.status };
    const provider = this.providers.byName(req.provider);
    if (!provider) throw new NotFoundException('Signaturanbieter nicht verfügbar');
    const res = await provider.result(req.transaction_id);
    if (res.status === 'pending') return { invitationId: req.invitation_id, outcome: 'gestartet' };
    const now = this.clock.now();
    if (res.status !== 'signed' || !res.signedDocument) {
      const status = res.status === 'cancelled' ? 'abgebrochen' : 'fehlgeschlagen';
      await this.db.txAs(sys, async (c) => {
        const u = await c.query(`UPDATE signature_request SET status = $2, error = $3, completed_at = $4 WHERE id = $1 AND status = 'gestartet'`, [requestId, status, res.error ?? null, now]);
        if (u.rowCount) await this.audit.record(c, { entity: 'signature_request', entityId: requestId, action: status === 'abgebrochen' ? 'cancelled' : 'failed', payload: { error: res.error ?? null } });
      });
      return { invitationId: req.invitation_id, outcome: status };
    }
    const signedSha = sha256(res.signedDocument);
    const signedKey = `signatures/${tenantId}/${req.invitation_id}-${req.level}-${signedSha.slice(0, 12)}.${res.format === 'CAdES' ? 'p7m' : 'pdf'}`;
    await this.storage.put('evidence', signedKey, res.signedDocument, { contentType: res.format === 'CAdES' ? 'application/pkcs7-mime' : 'application/pdf' });
    const http = currentRequest();
    const created = await this.db.txAs(sys, async (c) => {
      const r = (await c.query('SELECT status FROM signature_request WHERE id = $1 FOR UPDATE', [requestId])).rows[0];
      if (r.status !== 'gestartet') return false;
      const inv = (
        await c.query(
          `SELECT i.status, coalesce(v.confirm_text, t.confirm_text) AS confirm_text, v.sha256 AS document_sha256
             FROM invitation i JOIN run rr ON rr.id = i.run_id JOIN training t ON t.id = rr.training_id
             JOIN training_version v ON v.id = coalesce(i.training_version_id, rr.training_version_id) WHERE i.id = $1 FOR UPDATE OF i`,
          [req.invitation_id],
        )
      ).rows[0];
      if (inv.status !== 'bestanden' || sha256(inv.confirm_text) !== req.confirm_text_sha256) {
        await c.query(`UPDATE signature_request SET status = 'fehlgeschlagen', error = $2, completed_at = $3 WHERE id = $1`, [requestId, 'Einladung nicht mehr unterschreibbar', now]);
        return false;
      }
      const attempt = (await c.query('SELECT id FROM quiz_attempt WHERE invitation_id = $1 AND passed ORDER BY attempt_no DESC LIMIT 1', [req.invitation_id])).rows[0];
      const s = await c.query(
        `INSERT INTO signature (invitation_id, typ, auth_method, confirm_text, confirm_text_sha256, document_sha256, quiz_attempt_id, user_agent, ip_hash,
                                signed_at, provider, provider_transaction_id, signed_document_key, signed_document_sha256, signed_document_format, signer_info)
         VALUES ($1, $2, 'provider', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
        [req.invitation_id, req.level, inv.confirm_text, req.confirm_text_sha256, inv.document_sha256, attempt?.id ?? null, http?.userAgent ?? null,
         http?.ipHash ?? null, res.signedAt ?? now, req.provider, req.transaction_id, signedKey, signedSha, res.format ?? 'PAdES', res.signer ?? null],
      );
      await c.query(`UPDATE invitation SET status = 'bestaetigt', completed_at = $2 WHERE id = $1`, [req.invitation_id, now]);
      await WebhookEmitter.emit(c, tenantId, 'invitation.completed', { invitationId: req.invitation_id }); // E-37
      await c.query(`UPDATE signature_request SET status = 'abgeschlossen', completed_at = $2 WHERE id = $1`, [requestId, now]);
      await this.audit.record(c, {
        entity: 'signature', entityId: s.rows[0].id, action: 'signed',
        payload: {
          invitationId: req.invitation_id, typ: req.level, authMethod: 'provider', provider: req.provider, transactionId: req.transaction_id,
          documentSha256: inv.document_sha256, confirmTextSha256: req.confirm_text_sha256, signedDocumentSha256: signedSha,
        },
      });
      return true;
    });
    if (!created) {
      const st = (await this.db.txAs(sys, (c) => c.query('SELECT status FROM signature_request WHERE id = $1', [requestId]))).rows[0].status;
      return { invitationId: req.invitation_id, outcome: st };
    }
    await this.evidence.createForInvitation(tenantId, req.invitation_id);
    this.log.log(`Signaturvorgang ${requestId} (${req.level}, ${req.provider}) abgeschlossen`);
    return { invitationId: req.invitation_id, outcome: 'abgeschlossen' };
  }
}
