-- 008 · Wissenscheck, Unterschrift, Nachweise (SPEZIFIKATION 3, 4.2–4.4; E-08–E-10)

CREATE TABLE quiz_attempt (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  invitation_id uuid NOT NULL,
  attempt_no    int NOT NULL CHECK (attempt_no > 0),
  question_ids  uuid[] NOT NULL,
  -- {"<questionId>": {"option": n, "correct": bool, "at": ts}}
  answers       jsonb NOT NULL DEFAULT '{}'::jsonb,
  score_pct     int,
  passed        boolean,
  started_at    timestamptz NOT NULL DEFAULT now(),
  submitted_at  timestamptz,
  UNIQUE (id, tenant_id),
  UNIQUE (invitation_id, attempt_no),
  FOREIGN KEY (invitation_id, tenant_id) REFERENCES invitation(id, tenant_id) ON DELETE CASCADE
);
SELECT app.enable_tenant_rls('quiz_attempt');
CREATE POLICY qa_detail ON quiz_attempt FOR SELECT USING (
  app.has_any_role(ARRAY['admin','verantwortlich','auditor']) OR invitation_id IN (SELECT app.my_invitation_ids()));
CREATE POLICY qa_system ON quiz_attempt FOR ALL USING (app.has_role('system')) WITH CHECK (app.has_role('system'));

CREATE TABLE signature (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  invitation_id        uuid NOT NULL UNIQUE,
  typ                  text NOT NULL DEFAULT 'ees' CHECK (typ IN ('ees','fes','qes')),
  image_key            text NOT NULL,
  image_sha256         text NOT NULL,
  stroke_data          jsonb NOT NULL,
  auth_method          text NOT NULL CHECK (auth_method IN ('password','otp_mail','otp_sms','sso')),
  confirm_text         text NOT NULL,
  confirm_text_sha256  text NOT NULL,
  document_sha256      text NOT NULL,
  quiz_attempt_id      uuid,
  user_agent           text,
  ip_hash              text,
  signed_at            timestamptz NOT NULL,
  FOREIGN KEY (invitation_id, tenant_id) REFERENCES invitation(id, tenant_id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('signature');
CREATE POLICY sig_read ON signature FOR SELECT USING (
  app.has_any_role(ARRAY['admin','verantwortlich','auditor']) OR invitation_id IN (SELECT app.my_invitation_ids()));
CREATE POLICY sig_insert ON signature FOR INSERT WITH CHECK (app.has_role('system'));
CREATE POLICY sig_system_read ON signature FOR SELECT USING (app.has_role('system'));

CREATE OR REPLACE FUNCTION app.forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% ist unveränderlich', TG_TABLE_NAME; END $$;
CREATE TRIGGER signature_immutable BEFORE UPDATE OR DELETE ON signature FOR EACH ROW EXECUTE FUNCTION app.forbid_change();

CREATE TABLE evidence (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  invitation_id  uuid UNIQUE,
  kind           text NOT NULL DEFAULT 'online' CHECK (kind IN ('online','praesenz','live','extern')),
  verify_code    text NOT NULL UNIQUE CHECK (verify_code ~ '^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  nachweis_nr    text NOT NULL,
  status         text NOT NULL DEFAULT 'ausstehend' CHECK (status IN ('ausstehend','erzeugt','fehler')),
  pdf_key        text,
  pdf_sha256     text,
  seal_ts        timestamptz,
  seal_info      jsonb,
  error          text,
  retain_until   date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  UNIQUE (tenant_id, nachweis_nr),
  FOREIGN KEY (invitation_id, tenant_id) REFERENCES invitation(id, tenant_id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('evidence');
CREATE POLICY ev_read ON evidence FOR SELECT USING (
  app.has_any_role(ARRAY['admin','verantwortlich','auditor']) OR invitation_id IN (SELECT app.my_invitation_ids()));
CREATE POLICY ev_system ON evidence FOR ALL USING (app.has_role('system')) WITH CHECK (app.has_role('system'));
-- Nach Erzeugung ist der Nachweis unveränderlich (nur retain_until darf verlängert werden).
CREATE OR REPLACE FUNCTION app.evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'evidence ist unveränderlich'; END IF;
  IF OLD.status = 'erzeugt' AND (NEW.pdf_key IS DISTINCT FROM OLD.pdf_key OR NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256
     OR NEW.status IS DISTINCT FROM OLD.status OR NEW.verify_code IS DISTINCT FROM OLD.verify_code
     OR (NEW.retain_until IS DISTINCT FROM OLD.retain_until AND NEW.retain_until < OLD.retain_until)) THEN
    RAISE EXCEPTION 'evidence ist unveränderlich';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER evidence_guard BEFORE UPDATE OR DELETE ON evidence FOR EACH ROW EXECUTE FUNCTION app.evidence_guard();

-- Öffentliche Prüfung /verify/:code – nur Status, Hash, Datum, Schulung, Initialen (E-10)
CREATE OR REPLACE FUNCTION app.verify_evidence(p_code text)
RETURNS TABLE (status text, nachweis_nr text, pdf_sha256 text, seal_ts timestamptz, training_titel text, version_no int,
               person_initialen text, tenant_name text, kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e.status, e.nachweis_nr, e.pdf_sha256, e.seal_ts, t.titel, v.version_no,
         (SELECT string_agg(left(w, 1), '') || '.' FROM unnest(string_to_array(p.name, ' ')) w),
         te.name, e.kind
    FROM evidence e JOIN tenant te ON te.id = e.tenant_id
    LEFT JOIN invitation i ON i.id = e.invitation_id LEFT JOIN person p ON p.id = i.person_id
    LEFT JOIN run r ON r.id = i.run_id LEFT JOIN training t ON t.id = r.training_id
    LEFT JOIN training_version v ON v.id = r.training_version_id
   WHERE e.verify_code = upper(p_code)
$$;
ALTER FUNCTION app.verify_evidence(text) OWNER TO app_definer;
GRANT SELECT ON evidence, training_version TO app_definer;
