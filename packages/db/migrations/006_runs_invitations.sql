-- 006 · Durchführungen (Kampagne/Termin/Live) und Einladungen mit persönlichem Link (SPEZIFIKATION 3, 4.5; E-07)
-- Statuswechsel aus Teilnehmersicht schreibt die API im Systemkontext, nachdem sie die Berechtigung geprüft hat.

CREATE TABLE run (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  training_id          uuid NOT NULL,
  training_version_id  uuid NOT NULL,
  typ                  text NOT NULL DEFAULT 'kampagne' CHECK (typ IN ('kampagne','termin','live_extern')),
  titel                text,
  deadline             timestamptz,
  ort                  text,
  start_at             timestamptz,
  end_at               timestamptz,
  trainer_person_id    uuid,
  status               text NOT NULL DEFAULT 'laeuft' CHECK (status IN ('geplant','laeuft','beendet')),
  ended_at             timestamptz,
  ended_by             uuid,
  qr_mode              text CHECK (qr_mode IN ('rotierend','statisch')),
  provider             text,
  created_by           uuid DEFAULT app.account_id(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (training_id, tenant_id) REFERENCES training(id, tenant_id),
  FOREIGN KEY (training_version_id, tenant_id) REFERENCES training_version(id, tenant_id),
  FOREIGN KEY (trainer_person_id, tenant_id) REFERENCES person(id, tenant_id)
);
SELECT app.enable_tenant_rls('run');

CREATE TABLE invitation (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  run_id               uuid NOT NULL,
  person_id            uuid NOT NULL,
  status               text NOT NULL DEFAULT 'offen'
                       CHECK (status IN ('offen','geoeffnet','gelesen','bestanden','bestaetigt','ueberfaellig','befreit')),
  token_hash           text UNIQUE,
  token_expires_at     timestamptz,
  reading_time_factor  numeric(3,2) NOT NULL DEFAULT 1,
  sent_at              timestamptz,
  opened_at            timestamptz,
  read_completed_at    timestamptz,
  completed_at         timestamptz,
  due_at               timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  UNIQUE (run_id, person_id),
  FOREIGN KEY (run_id, tenant_id) REFERENCES run(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (person_id, tenant_id) REFERENCES person(id, tenant_id)
);
CREATE INDEX invitation_person_idx ON invitation(person_id);
SELECT app.enable_tenant_rls('invitation');

-- Sichtbarkeit
CREATE POLICY run_staff ON run FOR ALL
  USING (app.has_any_role(ARRAY['admin','verantwortlich','system']))
  WITH CHECK (app.has_any_role(ARRAY['admin','verantwortlich','system']));
CREATE POLICY run_read ON run FOR SELECT USING (
  app.has_any_role(ARRAY['auditor','vorgesetzter'])
  OR trainer_person_id IN (SELECT app.my_person_ids())
  OR EXISTS (SELECT 1 FROM invitation i WHERE i.run_id = run.id AND i.person_id IN (SELECT app.my_person_ids()))
);
CREATE POLICY inv_staff ON invitation FOR ALL
  USING (app.has_any_role(ARRAY['admin','verantwortlich','system']))
  WITH CHECK (app.has_any_role(ARRAY['admin','verantwortlich','system']));
CREATE POLICY inv_read ON invitation FOR SELECT USING (
  app.has_role('auditor')
  OR person_id IN (SELECT app.my_person_ids())
  OR (app.has_role('vorgesetzter') AND person_id IN (SELECT p.id FROM person p WHERE p.org_unit_id IN (SELECT app.led_org_units())))
);

-- Teilnehmer dürfen die veröffentlichte Version ihrer Einladung, deren Seiten/Kapitel und die Schulung lesen.
CREATE OR REPLACE FUNCTION app.my_version_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.training_version_id FROM invitation i JOIN run r ON r.id = i.run_id
   WHERE i.tenant_id = app.tenant_id() AND i.person_id IN (SELECT app.my_person_ids())
$$;
ALTER FUNCTION app.my_version_ids() OWNER TO app_definer;
GRANT SELECT ON run, invitation TO app_definer;
CREATE POLICY tv_participant ON training_version FOR SELECT USING (id IN (SELECT app.my_version_ids()));
CREATE POLICY pm_participant ON page_meta FOR SELECT USING (version_id IN (SELECT app.my_version_ids()));
CREATE POLICY ch_participant ON chapter FOR SELECT USING (version_id IN (SELECT app.my_version_ids()));
CREATE POLICY training_participant ON training FOR SELECT USING (
  id IN (SELECT v.training_id FROM training_version v WHERE v.id IN (SELECT app.my_version_ids())));
-- Systemkontext (Jobs, Statuswechsel) liest Stammdaten und Fragen
CREATE POLICY person_system ON person FOR SELECT USING (app.has_role('system'));
CREATE POLICY qq_system ON quiz_question FOR SELECT USING (app.has_role('system'));
CREATE POLICY pm_system_read ON page_meta FOR SELECT USING (app.has_role('system'));
CREATE POLICY ch_system_read ON chapter FOR SELECT USING (app.has_role('system'));
CREATE POLICY tv_system_read ON training_version FOR SELECT USING (app.has_role('system'));

-- Einladungslink auflösen (ohne Mandantenkontext): nur Hash rein, Kontext raus.
CREATE OR REPLACE FUNCTION app.invitation_by_token(p_token_hash text)
RETURNS TABLE (invitation_id uuid, tenant_id uuid, person_id uuid, expired boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.id, i.tenant_id, i.person_id, (i.token_expires_at IS NOT NULL AND i.token_expires_at < now())
    FROM invitation i WHERE i.token_hash = p_token_hash
$$;
-- Darf ein Konto (über verknüpfte Personen, E-25) auf eine Einladung zugreifen? Liefert den Kontext.
CREATE OR REPLACE FUNCTION app.invitation_for_account(p_invitation uuid, p_account uuid)
RETURNS TABLE (tenant_id uuid, person_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.tenant_id, i.person_id FROM invitation i JOIN person p ON p.id = i.person_id
   WHERE i.id = p_invitation AND p.account_id = p_account
$$;
-- Alle Einladungen eines Kontos über alle Mandanten („Meine Nachweise“, E-25)
CREATE OR REPLACE FUNCTION app.invitations_for_account(p_account uuid)
RETURNS TABLE (invitation_id uuid, tenant_id uuid, tenant_name text, training_titel text, status text, due_at timestamptz, completed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.id, i.tenant_id, te.name, t.titel, i.status, i.due_at, i.completed_at
    FROM invitation i JOIN person p ON p.id = i.person_id JOIN run r ON r.id = i.run_id
    JOIN training t ON t.id = r.training_id JOIN tenant te ON te.id = i.tenant_id
   WHERE p.account_id = p_account ORDER BY i.completed_at NULLS FIRST, i.due_at
$$;
ALTER FUNCTION app.invitation_by_token(text) OWNER TO app_definer;
ALTER FUNCTION app.invitation_for_account(uuid, uuid) OWNER TO app_definer;
ALTER FUNCTION app.invitations_for_account(uuid) OWNER TO app_definer;
GRANT SELECT ON training, tenant TO app_definer;
