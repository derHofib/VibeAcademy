-- 012 · Präsenz und Live: Termine, Anwesenheit als Intervalle, Live-Fragen, Kontrollfragen
-- (SPEZIFIKATION 3, 4.6, 4.8, 4.9, 7; E-15–E-17, E-27)
-- Teilnehmer-Schreibzugriffe laufen im Systemkontext, nachdem die API den Zugriff geprüft hat (E-27);
-- Trainer eines Termins schreiben ebenfalls über den Systemkontext nach expliziter Prüfung in der API.

-- ── Termine ohne PDF-Version (Präsenz) bzw. ohne Katalog-Schulung (externe Live-Schulung, freier Titel) ──
ALTER TABLE run ALTER COLUMN training_id DROP NOT NULL;
ALTER TABLE run ALTER COLUMN training_version_id DROP NOT NULL;
ALTER TABLE run ADD CONSTRAINT run_kampagne_complete
  CHECK (typ <> 'kampagne' OR (training_id IS NOT NULL AND training_version_id IS NOT NULL));
ALTER TABLE run ADD CONSTRAINT run_has_title CHECK (training_id IS NOT NULL OR length(trim(coalesce(titel, ''))) > 1);
ALTER TABLE run ADD CONSTRAINT run_termin_times
  CHECK (typ = 'kampagne' OR (start_at IS NOT NULL AND end_at IS NOT NULL AND end_at > start_at));
ALTER TABLE run
  ADD COLUMN started_at          timestamptz,
  ADD COLUMN completeness_pct    int NOT NULL DEFAULT 90 CHECK (completeness_pct BETWEEN 1 AND 100),
  ADD COLUMN allow_walk_in       boolean NOT NULL DEFAULT true,
  ADD COLUMN auto_ended          boolean NOT NULL DEFAULT false,
  ADD COLUMN countersigned_at    timestamptz,
  ADD COLUMN countersigned_by    uuid,
  ADD COLUMN countersign_name    text,
  ADD COLUMN countersign_method  text CHECK (countersign_method IN ('password','otp_mail','otp_sms','sso'));

-- Systemkontext legt Personen für den Check-in ohne Einladung an (Start-QR + Name/E-Mail, E-07)
CREATE POLICY person_system_insert ON person FOR INSERT WITH CHECK (app.has_role('system'));

-- Termine, die ich als Trainer führe / zu denen ich eingeladen bin
CREATE OR REPLACE FUNCTION app.my_trainer_run_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.id FROM run r
   WHERE r.tenant_id = app.tenant_id() AND app.has_any_role(ARRAY['trainer','admin','verantwortlich'])
     AND r.trainer_person_id IN (SELECT app.my_person_ids())
$$;
CREATE OR REPLACE FUNCTION app.my_run_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.run_id FROM invitation i WHERE i.tenant_id = app.tenant_id() AND i.person_id IN (SELECT app.my_person_ids())
$$;
ALTER FUNCTION app.my_trainer_run_ids() OWNER TO app_definer;
ALTER FUNCTION app.my_run_ids() OWNER TO app_definer;

-- ── Anwesenheit (E-17) ───────────────────────────────────────
CREATE TABLE attendance (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  run_id               uuid NOT NULL,
  person_id            uuid NOT NULL,
  invitation_id        uuid,
  check_in_method      text CHECK (check_in_method IN ('qr_start','kiosk','trainer')),
  check_out_method     text CHECK (check_out_method IN ('qr_end','manual','official_end','kiosk','trainer')),
  check_out_reason     text CHECK (check_out_reason IN ('vorzeitig','ende_qr_fehlt','technik','sonstiges')),
  check_out_note       text CHECK (check_out_note IS NULL OR length(trim(check_out_note)) BETWEEN 10 AND 1000),
  note_review          text CHECK (note_review IN ('offen','akzeptiert','rueckfrage')),
  note_review_message  text,
  note_reviewed_at     timestamptz,
  note_reviewed_by     uuid,
  -- offenes Intervall ohne offizielles Ende beim Ablauf des Zeitfensters geschlossen → prüfen (E-17)
  auto_closed          boolean NOT NULL DEFAULT false,
  -- serverseitig berechnet (Stand: letzte Änderung bzw. offizielles Ende)
  duration_seconds     int NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  completeness         numeric(5,4) NOT NULL DEFAULT 0 CHECK (completeness BETWEEN 0 AND 1),
  completeness_state   text NOT NULL DEFAULT 'teilweise' CHECK (completeness_state IN ('vollstaendig','teilweise')),
  -- „teilweise“ → Anrechnung nur mit Freigabe
  release              text CHECK (release IN ('freigegeben','abgelehnt')),
  release_note         text,
  released_at          timestamptz,
  released_by          uuid,
  confirmed_at         timestamptz,
  confirmed_via        text CHECK (confirmed_via IN ('selbst','kiosk')),
  kiosk_signature_key  text,
  confirm_reminded_at  timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK ((check_out_reason IS NULL) = (check_out_note IS NULL)),
  CHECK (confirmed_at IS NULL OR confirmed_via IS NOT NULL),
  UNIQUE (id, tenant_id),
  UNIQUE (run_id, person_id),
  FOREIGN KEY (run_id, tenant_id) REFERENCES run(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (person_id, tenant_id) REFERENCES person(id, tenant_id),
  FOREIGN KEY (invitation_id, tenant_id) REFERENCES invitation(id, tenant_id)
);
CREATE INDEX attendance_person_idx ON attendance(person_id);
CREATE TRIGGER attendance_touch BEFORE UPDATE ON attendance FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
SELECT app.enable_tenant_rls('attendance');

CREATE TABLE attendance_interval (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  attendance_id  uuid NOT NULL,
  in_at          timestamptz NOT NULL,
  out_at         timestamptz,
  in_method      text NOT NULL CHECK (in_method IN ('qr_start','kiosk','trainer')),
  out_method     text CHECK (out_method IN ('qr_end','manual','official_end','kiosk','trainer')),
  in_offline     boolean NOT NULL DEFAULT false,
  out_offline    boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (out_at IS NULL OR out_at >= in_at),
  CHECK ((out_at IS NULL) = (out_method IS NULL)),
  FOREIGN KEY (attendance_id, tenant_id) REFERENCES attendance(id, tenant_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX attendance_interval_one_open ON attendance_interval(attendance_id) WHERE out_at IS NULL;
CREATE INDEX attendance_interval_att_idx ON attendance_interval(attendance_id, in_at);
SELECT app.enable_tenant_rls('attendance_interval');

-- Bestätigte Anwesenheit ist unveränderlich (Grundlage des Nachweises).
CREATE OR REPLACE FUNCTION app.attendance_interval_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM attendance a WHERE a.id = coalesce(NEW.attendance_id, OLD.attendance_id) AND a.confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Bestätigte Anwesenheit ist unveränderlich';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER attendance_interval_guard BEFORE INSERT OR UPDATE OR DELETE ON attendance_interval
  FOR EACH ROW EXECUTE FUNCTION app.attendance_interval_guard();

-- Sichtbarkeit: Verantwortliche/Auditor alles, Trainer seine Termine, Teilnehmer nur sich selbst, Vorgesetzte nichts
-- (sie sehen nur den Status über invitation, SPEZIFIKATION 2).
CREATE POLICY att_staff ON attendance FOR ALL
  USING (app.has_any_role(ARRAY['admin','verantwortlich','system']))
  WITH CHECK (app.has_any_role(ARRAY['admin','verantwortlich','system']));
CREATE POLICY att_read ON attendance FOR SELECT USING (
  app.has_role('auditor')
  OR person_id IN (SELECT app.my_person_ids())
  OR run_id IN (SELECT app.my_trainer_run_ids())
);
CREATE POLICY ati_staff ON attendance_interval FOR ALL
  USING (app.has_any_role(ARRAY['admin','verantwortlich','system']))
  WITH CHECK (app.has_any_role(ARRAY['admin','verantwortlich','system']));
-- erbt die Sichtbarkeit der Anwesenheit (RLS greift in der Unterabfrage)
CREATE POLICY ati_read ON attendance_interval FOR SELECT USING (attendance_id IN (SELECT a.id FROM attendance a));

-- Nachweise zu Anwesenheiten: Bezug + Sichtbarkeit für die Person selbst
ALTER TABLE evidence ADD CONSTRAINT evidence_attendance_fk FOREIGN KEY (attendance_id, tenant_id) REFERENCES attendance(id, tenant_id) ON DELETE RESTRICT;
CREATE POLICY ev_read_attendance ON evidence FOR SELECT USING (
  attendance_id IS NOT NULL AND attendance_id IN (SELECT a.id FROM attendance a WHERE a.person_id IN (SELECT app.my_person_ids())));

-- ── Live-Fragen (4.9) ────────────────────────────────────────
CREATE TABLE live_question (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  run_id      uuid NOT NULL,
  -- NULL = anonym (kein Personenbezug, SPEZIFIKATION 7)
  person_id   uuid,
  text        text NOT NULL CHECK (length(trim(text)) BETWEEN 3 AND 1000),
  status      text NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','beantwortet','per_mail')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  status_at   timestamptz,
  UNIQUE (id, tenant_id),
  FOREIGN KEY (run_id, tenant_id) REFERENCES run(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (person_id, tenant_id) REFERENCES person(id, tenant_id)
);
CREATE INDEX live_question_run_idx ON live_question(run_id);
SELECT app.enable_tenant_rls('live_question');

-- „Ich auch“: eine Stimme je Person (Primärschlüssel)
CREATE TABLE live_question_vote (
  tenant_id    uuid NOT NULL,
  question_id  uuid NOT NULL,
  person_id    uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (question_id, person_id),
  FOREIGN KEY (question_id, tenant_id) REFERENCES live_question(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (person_id, tenant_id) REFERENCES person(id, tenant_id)
);
SELECT app.enable_tenant_rls('live_question_vote');

-- ── Kontrollfragen (4.9) ─────────────────────────────────────
CREATE TABLE live_poll (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  run_id              uuid NOT NULL,
  question            text NOT NULL CHECK (length(trim(question)) BETWEEN 3 AND 1000),
  options             jsonb NOT NULL CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) BETWEEN 2 AND 6),
  correct             int CHECK (correct >= 0),
  explanation         text,
  mode                text NOT NULL CHECK (mode IN ('stimmungsbild','wissenscheck')),
  source_question_id  uuid,
  opened_at           timestamptz NOT NULL,
  closed_at           timestamptz,
  created_by          uuid DEFAULT app.account_id(),
  CHECK (correct IS NULL OR correct < jsonb_array_length(options)),
  CHECK (mode <> 'wissenscheck' OR correct IS NOT NULL),
  CHECK (closed_at IS NULL OR closed_at >= opened_at),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (run_id, tenant_id) REFERENCES run(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (source_question_id, tenant_id) REFERENCES quiz_question(id, tenant_id) ON DELETE SET NULL (source_question_id)
);
-- höchstens eine offene Kontrollfrage je Termin
CREATE UNIQUE INDEX live_poll_one_open ON live_poll(run_id) WHERE closed_at IS NULL;
SELECT app.enable_tenant_rls('live_poll');

-- Antworten: Wissenscheck personenbezogen, Stimmungsbild OHNE person_id und ohne Zeitstempel (kein Rückschluss)
CREATE TABLE live_poll_answer (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  poll_id      uuid NOT NULL,
  person_id    uuid,
  option       int NOT NULL CHECK (option >= 0),
  correct      boolean,
  -- nach dem Ende nachgeholt (nicht eingecheckt, während die Frage lief)
  late         boolean NOT NULL DEFAULT false,
  answered_at  timestamptz,
  UNIQUE (poll_id, person_id),
  FOREIGN KEY (poll_id, tenant_id) REFERENCES live_poll(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (person_id, tenant_id) REFERENCES person(id, tenant_id)
);
SELECT app.enable_tenant_rls('live_poll_answer');

-- Wer hat geantwortet (ohne Antwort) – verhindert doppelte Antworten auch beim anonymen Stimmungsbild
CREATE TABLE live_poll_participant (
  tenant_id  uuid NOT NULL,
  poll_id    uuid NOT NULL,
  person_id  uuid NOT NULL,
  PRIMARY KEY (poll_id, person_id),
  FOREIGN KEY (poll_id, tenant_id) REFERENCES live_poll(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (person_id, tenant_id) REFERENCES person(id, tenant_id)
);
SELECT app.enable_tenant_rls('live_poll_participant');

CREATE OR REPLACE FUNCTION app.live_poll_answer_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_mode text; v_options int;
BEGIN
  SELECT mode, jsonb_array_length(options) INTO v_mode, v_options FROM live_poll WHERE id = NEW.poll_id;
  IF NEW.option >= v_options THEN RAISE EXCEPTION 'Antwort außerhalb der Optionen'; END IF;
  IF v_mode = 'stimmungsbild' AND (NEW.person_id IS NOT NULL OR NEW.answered_at IS NOT NULL OR NEW.correct IS NOT NULL) THEN
    RAISE EXCEPTION 'Stimmungsbild wird ohne Personenbezug gespeichert';
  END IF;
  IF v_mode = 'wissenscheck' AND NEW.person_id IS NULL THEN
    RAISE EXCEPTION 'Wissenscheck braucht den Personenbezug';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER live_poll_answer_guard BEFORE INSERT OR UPDATE ON live_poll_answer
  FOR EACH ROW EXECUTE FUNCTION app.live_poll_answer_guard();

-- Policies Live: Verantwortliche/System schreiben; Trainer und Auditor lesen; Teilnehmer lesen Fragen/Kontrollfragen
-- ihres Termins und nur ihre eigenen Stimmen/Antworten. Vorgesetzte: kein Zugriff.
CREATE POLICY lq_staff ON live_question FOR ALL
  USING (app.has_any_role(ARRAY['admin','verantwortlich','system'])) WITH CHECK (app.has_any_role(ARRAY['admin','verantwortlich','system']));
CREATE POLICY lq_read ON live_question FOR SELECT USING (
  app.has_role('auditor') OR run_id IN (SELECT app.my_trainer_run_ids()) OR run_id IN (SELECT app.my_run_ids()));
CREATE POLICY lqv_staff ON live_question_vote FOR ALL
  USING (app.has_any_role(ARRAY['admin','verantwortlich','system'])) WITH CHECK (app.has_any_role(ARRAY['admin','verantwortlich','system']));
CREATE POLICY lqv_read ON live_question_vote FOR SELECT USING (app.has_role('auditor') OR person_id IN (SELECT app.my_person_ids()));
CREATE POLICY lp_staff ON live_poll FOR ALL
  USING (app.has_any_role(ARRAY['admin','verantwortlich','system'])) WITH CHECK (app.has_any_role(ARRAY['admin','verantwortlich','system']));
CREATE POLICY lp_read ON live_poll FOR SELECT USING (
  app.has_role('auditor') OR run_id IN (SELECT app.my_trainer_run_ids()) OR run_id IN (SELECT app.my_run_ids()));
CREATE POLICY lpa_staff ON live_poll_answer FOR ALL
  USING (app.has_any_role(ARRAY['admin','verantwortlich','system'])) WITH CHECK (app.has_any_role(ARRAY['admin','verantwortlich','system']));
CREATE POLICY lpa_read ON live_poll_answer FOR SELECT USING (
  app.has_role('auditor') OR person_id IN (SELECT app.my_person_ids())
  OR poll_id IN (SELECT p.id FROM live_poll p WHERE p.run_id IN (SELECT app.my_trainer_run_ids())));
CREATE POLICY lpp_staff ON live_poll_participant FOR ALL
  USING (app.has_any_role(ARRAY['admin','verantwortlich','system'])) WITH CHECK (app.has_any_role(ARRAY['admin','verantwortlich','system']));
CREATE POLICY lpp_read ON live_poll_participant FOR SELECT USING (person_id IN (SELECT app.my_person_ids()));

-- ── SECURITY DEFINER: Zugänge ohne Mandantenkontext ──────────
-- QR-Scan: Termin zum Token finden (Mandant für den Schlüssel, Zeitfenster, Status). Nur über die run_id.
CREATE OR REPLACE FUNCTION app.run_for_qr(p_run uuid)
RETURNS TABLE (tenant_id uuid, typ text, status text, start_at timestamptz, end_at timestamptz, ended_at timestamptz, allow_walk_in boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.tenant_id, r.typ, r.status, r.start_at, r.end_at, r.ended_at, r.allow_walk_in
    FROM run r WHERE r.id = p_run AND r.typ IN ('termin','live_extern')
$$;
-- Einladung eines Kontos (verknüpfte Person, E-25) zu einem Termin
CREATE OR REPLACE FUNCTION app.invitation_for_account_run(p_run uuid, p_account uuid)
RETURNS TABLE (invitation_id uuid, tenant_id uuid, person_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.id, i.tenant_id, i.person_id FROM invitation i JOIN person p ON p.id = i.person_id
   WHERE i.run_id = p_run AND p.account_id = p_account
   LIMIT 1
$$;
-- Erinnerungs-Job: offene Bestätigungen aller Mandanten, deren offizielles Ende vor p_cutoff liegt (nur IDs)
CREATE OR REPLACE FUNCTION app.attendance_confirm_due(p_cutoff timestamptz, p_limit int)
RETURNS TABLE (attendance_id uuid, tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.id, a.tenant_id FROM attendance a JOIN run r ON r.id = a.run_id
   WHERE a.confirmed_at IS NULL AND a.confirm_reminded_at IS NULL AND r.status = 'beendet' AND r.ended_at <= p_cutoff
     AND EXISTS (SELECT 1 FROM attendance_interval i WHERE i.attendance_id = a.id)
   ORDER BY r.ended_at LIMIT p_limit
$$;
-- Fristen-Job: Termine ohne offizielles Ende, deren Zeitfenster (geplantes Ende + 60 min) abgelaufen ist
CREATE OR REPLACE FUNCTION app.runs_window_expired(p_now timestamptz, p_limit int)
RETURNS TABLE (run_id uuid, tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.id, r.tenant_id FROM run r
   WHERE r.typ IN ('termin','live_extern') AND r.status <> 'beendet' AND r.end_at + interval '60 minutes' < p_now
   ORDER BY r.end_at LIMIT p_limit
$$;
-- Termin + Mandant zu einer Frage/Kontrollfrage/Anwesenheit (Zugriff prüft die API danach selbst)
CREATE OR REPLACE FUNCTION app.live_ref(p_question uuid, p_poll uuid, p_attendance uuid)
RETURNS TABLE (run_id uuid, tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT q.run_id, q.tenant_id FROM live_question q WHERE q.id = p_question
  UNION ALL SELECT p.run_id, p.tenant_id FROM live_poll p WHERE p.id = p_poll
  UNION ALL SELECT a.run_id, a.tenant_id FROM attendance a WHERE a.id = p_attendance
$$;
ALTER FUNCTION app.live_ref(uuid, uuid, uuid) OWNER TO app_definer;
GRANT SELECT ON live_question, live_poll TO app_definer;
ALTER FUNCTION app.run_for_qr(uuid) OWNER TO app_definer;
ALTER FUNCTION app.invitation_for_account_run(uuid, uuid) OWNER TO app_definer;
ALTER FUNCTION app.attendance_confirm_due(timestamptz, int) OWNER TO app_definer;
ALTER FUNCTION app.runs_window_expired(timestamptz, int) OWNER TO app_definer;
GRANT SELECT ON attendance, attendance_interval TO app_definer;

-- ── Anschluss an Pflichtmatrix und Nachweismappe (Erweiterungspunkte aus 011) ──
-- Angerechnet wird eine Anwesenheit, wenn bestätigt, Vermerk (falls nötig) akzeptiert, vollständig oder freigegeben,
-- bei interner Präsenz gegengezeichnet. Abschlussdatum = Tag des Termins.
CREATE OR REPLACE VIEW app.completion_events_attendance WITH (security_invoker = true) AS
  SELECT a.tenant_id, a.person_id, r.training_id, NULL::uuid AS requirement_id,
         (r.start_at AT TIME ZONE 'Europe/Berlin')::date AS completed_on, NULL::date AS valid_until,
         (CASE WHEN r.typ = 'termin' THEN 'praesenz' ELSE 'live' END)::text AS source, a.id AS source_id
    FROM attendance a JOIN run r ON r.id = a.run_id
   WHERE a.confirmed_at IS NOT NULL AND r.training_id IS NOT NULL
     AND (a.completeness_state = 'vollstaendig' OR a.release = 'freigegeben')
     AND (a.note_review IS NULL OR a.note_review = 'akzeptiert')
     AND (r.typ <> 'termin' OR r.countersigned_at IS NOT NULL);

CREATE OR REPLACE VIEW app.evidence_index_attendance WITH (security_invoker = true) AS
  SELECT e.id AS evidence_id, e.tenant_id, a.person_id, r.training_id, coalesce(r.titel, t.titel) AS titel, e.kind,
         (r.start_at AT TIME ZONE 'Europe/Berlin')::date AS completed_on
    FROM evidence e JOIN attendance a ON a.id = e.attendance_id JOIN run r ON r.id = a.run_id LEFT JOIN training t ON t.id = r.training_id;

-- „Meine Einladungen“ (E-25) um Art und Termin ergänzen, damit die Oberfläche Live-/Präsenztermine erkennt
DROP FUNCTION app.invitations_for_account(uuid);
CREATE FUNCTION app.invitations_for_account(p_account uuid)
RETURNS TABLE (invitation_id uuid, tenant_id uuid, tenant_name text, training_titel text, status text, due_at timestamptz,
               completed_at timestamptz, typ text, run_id uuid, start_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.id, i.tenant_id, te.name, CASE WHEN r.typ = 'kampagne' THEN t.titel ELSE coalesce(r.titel, t.titel) END, i.status, i.due_at, i.completed_at, r.typ, r.id, r.start_at
    FROM invitation i JOIN person p ON p.id = i.person_id JOIN run r ON r.id = i.run_id
    LEFT JOIN training t ON t.id = r.training_id JOIN tenant te ON te.id = i.tenant_id
   WHERE p.account_id = p_account ORDER BY i.completed_at NULLS FIRST, i.due_at
$$;
ALTER FUNCTION app.invitations_for_account(uuid) OWNER TO app_definer;
