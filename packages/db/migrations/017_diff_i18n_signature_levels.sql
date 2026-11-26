-- 017 · Phase 3, Paket C: Seiten-Diff (E-38), Mehrsprachigkeit (E-39), FES/QES (E-40)

-- ── 1. Seitentext je Version für den Seiten-Diff (E-38) ─────────────────────────────
-- Eigene Tabelle statt page_meta: hält page_meta klein (wird bei jedem Heartbeat gelesen) und ist nur für die
-- Verwaltung lesbar. Gespeichert wird der normalisierte Text (gekappt auf 20.000 Zeichen je Seite) plus Fingerabdruck.
CREATE TABLE page_text (
  tenant_id    uuid NOT NULL,
  version_id   uuid NOT NULL,
  page_no      int NOT NULL CHECK (page_no > 0),
  fingerprint  text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{16}$'),
  text_norm    text NOT NULL CHECK (length(text_norm) <= 20000),
  PRIMARY KEY (version_id, page_no),
  FOREIGN KEY (version_id, tenant_id) REFERENCES training_version(id, tenant_id) ON DELETE CASCADE
);
SELECT app.enable_tenant_rls('page_text');
CREATE POLICY pt_read ON page_text FOR SELECT
  USING (app.has_any_role(ARRAY['admin','verantwortlich','trainer','auditor','system']));
-- Schreiben auch für veröffentlichte Versionen (nachträgliches Befüllen alter Versionen beim ersten Diff);
-- der Text ist abgeleitet aus dem unveränderlichen Original-PDF.
CREATE POLICY pt_write ON page_text FOR ALL
  USING (app.has_any_role(ARRAY['admin','verantwortlich','system']))
  WITH CHECK (app.has_any_role(ARRAY['admin','verantwortlich','system']));

-- ── 2. Sprache je Schulungsversion (E-39) ──────────────────────────────────────────
-- Sprachfassungen teilen die Versionsnummer: Version 3 (de) und Version 3 (en) sind derselbe Stand.
ALTER TABLE training_version ADD COLUMN sprache text NOT NULL DEFAULT 'de' CHECK (sprache IN ('de','en'));
ALTER TABLE training_version DROP CONSTRAINT training_version_training_id_version_no_key;
ALTER TABLE training_version ADD CONSTRAINT training_version_no_lang_key UNIQUE (training_id, version_no, sprache);

-- Version je Einladung: NULL = Version der Durchführung (deutsch). Gesetzt, wenn die Person eine andere Sprache hat
-- und die Sprachfassung mit derselben Versionsnummer veröffentlicht ist.
ALTER TABLE invitation ADD COLUMN training_version_id uuid;
ALTER TABLE invitation ADD CONSTRAINT invitation_version_fk
  FOREIGN KEY (training_version_id, tenant_id) REFERENCES training_version(id, tenant_id);

CREATE OR REPLACE FUNCTION app.invitation_pick_language_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_lang text;
  v_base record;
  v_variant record;
BEGIN
  IF NEW.training_version_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT lower(left(coalesce(p.sprache, 'de'), 2)) INTO v_lang FROM person p WHERE p.id = NEW.person_id AND p.tenant_id = NEW.tenant_id;
  IF v_lang IS NULL OR v_lang = 'de' THEN RETURN NEW; END IF;
  SELECT v.id, v.training_id, v.version_no, v.sprache INTO v_base
    FROM run r JOIN training_version v ON v.id = r.training_version_id
   WHERE r.id = NEW.run_id AND r.tenant_id = NEW.tenant_id AND r.typ = 'kampagne';
  IF v_base.id IS NULL OR v_base.sprache = v_lang THEN RETURN NEW; END IF;
  SELECT x.id, x.changed_pages INTO v_variant FROM training_version x
   WHERE x.training_id = v_base.training_id AND x.version_no = v_base.version_no AND x.sprache = v_lang
     AND x.published_at IS NOT NULL AND x.tenant_id = NEW.tenant_id;
  IF v_variant.id IS NOT NULL THEN
    NEW.training_version_id := v_variant.id;
    -- Nur geänderte Seiten: Seitenzahlen der Sprachfassung (ohne eigene Angabe → alle Seiten)
    IF NEW.changed_pages IS NOT NULL THEN NEW.changed_pages := v_variant.changed_pages; END IF;
  END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION app.invitation_pick_language_version() OWNER TO app_definer;
CREATE TRIGGER invitation_language_version BEFORE INSERT ON invitation
  FOR EACH ROW EXECUTE FUNCTION app.invitation_pick_language_version();

-- Teilnehmer lesen die Version ihrer Einladung (Sprachfassung) und die der Durchführung.
CREATE OR REPLACE FUNCTION app.my_version_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.training_version_id FROM invitation i JOIN run r ON r.id = i.run_id
   WHERE i.tenant_id = app.tenant_id() AND i.person_id IN (SELECT app.my_person_ids()) AND r.training_version_id IS NOT NULL
  UNION
  SELECT i.training_version_id FROM invitation i
   WHERE i.tenant_id = app.tenant_id() AND i.person_id IN (SELECT app.my_person_ids()) AND i.training_version_id IS NOT NULL
$$;
ALTER FUNCTION app.my_version_ids() OWNER TO app_definer;

-- ── 3. FES/QES über einen Signaturanbieter (E-40) ──────────────────────────────────
ALTER TABLE signature DROP CONSTRAINT IF EXISTS signature_auth_method_check;
ALTER TABLE signature ADD CONSTRAINT signature_auth_method_check
  CHECK (auth_method IN ('password','otp_mail','otp_sms','sso','provider'));
ALTER TABLE signature ALTER COLUMN image_key DROP NOT NULL;
ALTER TABLE signature ALTER COLUMN image_sha256 DROP NOT NULL;
ALTER TABLE signature ALTER COLUMN stroke_data DROP NOT NULL;
ALTER TABLE signature ADD COLUMN provider text;
ALTER TABLE signature ADD COLUMN provider_transaction_id text;
ALTER TABLE signature ADD COLUMN signed_document_key text;
ALTER TABLE signature ADD COLUMN signed_document_sha256 text CHECK (signed_document_sha256 IS NULL OR signed_document_sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE signature ADD COLUMN signed_document_format text CHECK (signed_document_format IS NULL OR signed_document_format IN ('PAdES','CAdES'));
ALTER TABLE signature ADD COLUMN signer_info jsonb;
ALTER TABLE signature ADD CONSTRAINT signature_level_shape CHECK (
  (typ = 'ees' AND image_key IS NOT NULL AND image_sha256 IS NOT NULL AND stroke_data IS NOT NULL)
  OR (typ IN ('fes','qes') AND auth_method = 'provider' AND provider IS NOT NULL AND provider_transaction_id IS NOT NULL
      AND signed_document_key IS NOT NULL AND signed_document_sha256 IS NOT NULL)
);

-- Laufender Signaturvorgang beim Anbieter (Weiterleitung → Rückruf). Abgeschlossene Vorgänge bleiben als Protokoll.
CREATE TABLE signature_request (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  invitation_id        uuid NOT NULL,
  level                text NOT NULL CHECK (level IN ('fes','qes')),
  provider             text NOT NULL,
  transaction_id       text,
  status               text NOT NULL DEFAULT 'gestartet'
                       CHECK (status IN ('gestartet','abgeschlossen','fehlgeschlagen','abgebrochen')),
  document_key         text NOT NULL,
  document_sha256      text NOT NULL CHECK (document_sha256 ~ '^[0-9a-f]{64}$'),
  confirm_text_sha256  text NOT NULL CHECK (confirm_text_sha256 ~ '^[0-9a-f]{64}$'),
  error                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  completed_at         timestamptz,
  UNIQUE (id, tenant_id),
  FOREIGN KEY (invitation_id, tenant_id) REFERENCES invitation(id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX signature_request_invitation_idx ON signature_request(invitation_id);
CREATE UNIQUE INDEX signature_request_tx_uq ON signature_request(provider, transaction_id) WHERE transaction_id IS NOT NULL;
SELECT app.enable_tenant_rls('signature_request');
CREATE POLICY sr_read ON signature_request FOR SELECT USING (
  app.has_any_role(ARRAY['admin','verantwortlich','auditor']) OR invitation_id IN (SELECT app.my_invitation_ids()));
CREATE POLICY sr_system ON signature_request FOR ALL USING (app.has_role('system')) WITH CHECK (app.has_role('system'));

-- ── 4. Sprache der Person aus der Teilnehmersicht setzen (E-39) ─────────────────────
-- Teilnehmer schreiben nicht direkt (E-27); die Funktion ändert nur die Sprache einer Person des aktuellen Mandanten.
CREATE OR REPLACE FUNCTION app.set_person_language(p_person uuid, p_sprache text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH u AS (
    UPDATE person SET sprache = p_sprache
     WHERE id = p_person AND tenant_id = app.tenant_id() AND p_sprache IN ('de','en') AND sprache IS DISTINCT FROM p_sprache
     RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM u)
$$;
ALTER FUNCTION app.set_person_language(uuid, text) OWNER TO app_definer;
GRANT UPDATE (sprache) ON person TO app_definer;

-- Webhook/Rückmeldung eines Anbieters kennt nur dessen Transaktions-ID → Vorgang mandantenübergreifend finden.
CREATE OR REPLACE FUNCTION app.signature_request_by_tx(p_provider text, p_tx text)
RETURNS TABLE (id uuid, tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.id, r.tenant_id FROM signature_request r WHERE r.provider = p_provider AND r.transaction_id = p_tx
$$;
ALTER FUNCTION app.signature_request_by_tx(text, text) OWNER TO app_definer;
GRANT SELECT ON signature_request TO app_definer;
