-- 011 · Pflichtmatrix, Erfüllungsstand, Fristen-Engine, Web-Push-Abos (SPEZIFIKATION 3, 4.5; PLAN 2.1/2.2; E-13, E-14, E-24)
--
-- Erweiterungspunkte für andere Pakete (Präsenz/Live, Paket E):
--   app.completion_events_attendance  – Abschlüsse aus Anwesenheiten (hier: leerer Platzhalter)
--   app.evidence_index_attendance     – Nachweise aus Anwesenheiten für die Nachweismappe (hier: leerer Platzhalter)
-- Beide mit CREATE OR REPLACE VIEW ersetzen; Spalten (Name, Typ, Reihenfolge) müssen exakt gleich bleiben.
-- Die externen Gegenstücke (…_external) ersetzt Migration 013.

-- ── Qualifikationen / Tätigkeiten ───────────────────────────
CREATE TABLE qualification (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  description  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id)
);
CREATE UNIQUE INDEX qualification_name_uq ON qualification(tenant_id, lower(name));
SELECT app.enable_tenant_rls('qualification');

CREATE TABLE person_qualification (
  tenant_id         uuid NOT NULL,
  person_id         uuid NOT NULL,
  qualification_id  uuid NOT NULL,
  since             date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, qualification_id),
  FOREIGN KEY (person_id, tenant_id) REFERENCES person(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (qualification_id, tenant_id) REFERENCES qualification(id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX person_qualification_q_idx ON person_qualification(qualification_id);
SELECT app.enable_tenant_rls('person_qualification');

-- Pflichtmatrix: Qualifikation → Schulung (Katalog; format „extern“ = externer Kurstyp), Intervall, Kulanz.
CREATE TABLE requirement (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  qualification_id  uuid NOT NULL,
  training_id       uuid NOT NULL,
  interval_months   int NOT NULL CHECK (interval_months BETWEEN 1 AND 240),
  grace_days        int NOT NULL DEFAULT 0 CHECK (grace_days BETWEEN 0 AND 365),
  -- automatische Wiedereinladung bzw. Hinweis „neuen Termin buchen“ so viele Tage vor Ablauf
  reinvite_days     int NOT NULL DEFAULT 30 CHECK (reinvite_days BETWEEN 0 AND 365),
  -- auch Personen ohne bisherigen Nachweis automatisch einladen
  auto_invite       boolean NOT NULL DEFAULT true,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  UNIQUE (qualification_id, training_id),
  FOREIGN KEY (qualification_id, tenant_id) REFERENCES qualification(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (training_id, tenant_id) REFERENCES training(id, tenant_id) ON DELETE CASCADE
);
SELECT app.enable_tenant_rls('requirement');

-- Ausnahmen („befreit“) je Person und Anforderung, optional befristet
CREATE TABLE compliance_exemption (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  person_id       uuid NOT NULL,
  requirement_id  uuid NOT NULL,
  reason          text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  valid_until     date,
  created_by      uuid DEFAULT app.account_id(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, requirement_id),
  FOREIGN KEY (person_id, tenant_id) REFERENCES person(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (requirement_id, tenant_id) REFERENCES requirement(id, tenant_id) ON DELETE CASCADE
);
SELECT app.enable_tenant_rls('compliance_exemption');

-- Sichtbarkeit: Stammdaten der Matrix lesen alle Rollen mit Verwaltungsbezug; schreiben admin/verantwortlich.
CREATE POLICY qual_read ON qualification FOR SELECT
  USING (app.has_any_role(ARRAY['admin','verantwortlich','trainer','vorgesetzter','auditor','system']));
CREATE POLICY qual_write ON qualification FOR ALL
  USING (app.has_any_role(ARRAY['admin','verantwortlich'])) WITH CHECK (app.has_any_role(ARRAY['admin','verantwortlich']));
CREATE POLICY req_read ON requirement FOR SELECT
  USING (app.has_any_role(ARRAY['admin','verantwortlich','trainer','vorgesetzter','auditor','system']));
CREATE POLICY req_write ON requirement FOR ALL
  USING (app.has_any_role(ARRAY['admin','verantwortlich'])) WITH CHECK (app.has_any_role(ARRAY['admin','verantwortlich']));
-- Person ↔ Qualifikation: Verwaltung alles, Auditor/System lesen, Vorgesetzte ihr Team, Teilnehmer sich selbst
CREATE POLICY pq_staff ON person_qualification FOR ALL
  USING (app.has_any_role(ARRAY['admin','verantwortlich'])) WITH CHECK (app.has_any_role(ARRAY['admin','verantwortlich']));
CREATE POLICY pq_read ON person_qualification FOR SELECT USING (
  app.has_any_role(ARRAY['auditor','system'])
  OR person_id IN (SELECT app.my_person_ids())
  OR (app.has_role('vorgesetzter') AND person_id IN (SELECT p.id FROM person p WHERE p.org_unit_id IN (SELECT app.led_org_units())))
);
CREATE POLICY ex_staff ON compliance_exemption FOR ALL
  USING (app.has_any_role(ARRAY['admin','verantwortlich'])) WITH CHECK (app.has_any_role(ARRAY['admin','verantwortlich']));
CREATE POLICY ex_read ON compliance_exemption FOR SELECT USING (
  app.has_any_role(ARRAY['auditor','system'])
  OR person_id IN (SELECT app.my_person_ids())
  OR (app.has_role('vorgesetzter') AND person_id IN (SELECT p.id FROM person p WHERE p.org_unit_id IN (SELECT app.led_org_units())))
);
-- Teilnehmer (Konto) dürfen die Namen ihrer Qualifikationen/Anforderungen lesen
CREATE POLICY qual_own ON qualification FOR SELECT USING (
  id IN (SELECT pq.qualification_id FROM person_qualification pq WHERE pq.person_id IN (SELECT app.my_person_ids())));
CREATE POLICY req_own ON requirement FOR SELECT USING (
  qualification_id IN (SELECT pq.qualification_id FROM person_qualification pq WHERE pq.person_id IN (SELECT app.my_person_ids())));

-- ── Durchführungen/Einladungen: Kennzeichen für die Fristen-Engine ──
-- auto_key: eine automatische Wiederholungs-Kampagne je Schulungsversion und Monat (eindeutig je Mandant)
ALTER TABLE run ADD COLUMN auto_key text;
CREATE UNIQUE INDEX run_auto_key_uq ON run(tenant_id, auto_key) WHERE auto_key IS NOT NULL;
-- Grund einer automatischen Einladung und (bei neuer inhaltlicher Version) die geänderten Seiten
ALTER TABLE invitation ADD COLUMN auto_reason text CHECK (auto_reason IN ('fehlt','ablauf','neue_version'));
ALTER TABLE invitation ADD COLUMN changed_pages int[];

-- ── Abschlussereignisse (Quelle der Pflichtmatrix) ───────────
-- Spalten: tenant_id, person_id, training_id, requirement_id (falls ausdrücklich zugeordnet), completed_on (Kalendertag),
--          valid_until (NULL = aus Intervall berechnen), source, source_id. Views mit security_invoker → RLS des Aufrufers gilt.
CREATE VIEW app.completion_events_online WITH (security_invoker = true) AS
  SELECT i.tenant_id, i.person_id, r.training_id, NULL::uuid AS requirement_id,
         (i.completed_at AT TIME ZONE 'Europe/Berlin')::date AS completed_on, NULL::date AS valid_until,
         'online'::text AS source, i.id AS source_id
    FROM invitation i JOIN run r ON r.id = i.run_id
   WHERE i.status = 'bestaetigt' AND i.completed_at IS NOT NULL;

CREATE VIEW app.completion_events_external WITH (security_invoker = true) AS
  SELECT NULL::uuid AS tenant_id, NULL::uuid AS person_id, NULL::uuid AS training_id, NULL::uuid AS requirement_id,
         NULL::date AS completed_on, NULL::date AS valid_until, NULL::text AS source, NULL::uuid AS source_id
   WHERE false;

DO $$ BEGIN
  IF to_regclass('app.completion_events_attendance') IS NULL THEN
    EXECUTE $v$CREATE VIEW app.completion_events_attendance WITH (security_invoker = true) AS
      SELECT NULL::uuid AS tenant_id, NULL::uuid AS person_id, NULL::uuid AS training_id, NULL::uuid AS requirement_id,
             NULL::date AS completed_on, NULL::date AS valid_until, NULL::text AS source, NULL::uuid AS source_id
       WHERE false$v$;
  END IF;
END $$;

CREATE VIEW app.completion_events WITH (security_invoker = true) AS
  SELECT * FROM app.completion_events_online
  UNION ALL SELECT * FROM app.completion_events_external
  UNION ALL SELECT * FROM app.completion_events_attendance;

-- ── Nachweis-Index (Nachweismappe) ───────────────────────────
-- Spalten: evidence_id, tenant_id, person_id, training_id, titel, kind, completed_on
CREATE VIEW app.evidence_index_online WITH (security_invoker = true) AS
  SELECT e.id AS evidence_id, e.tenant_id, i.person_id, r.training_id, coalesce(r.titel, t.titel) AS titel, e.kind,
         (i.completed_at AT TIME ZONE 'Europe/Berlin')::date AS completed_on
    FROM evidence e JOIN invitation i ON i.id = e.invitation_id JOIN run r ON r.id = i.run_id JOIN training t ON t.id = r.training_id;

CREATE VIEW app.evidence_index_external WITH (security_invoker = true) AS
  SELECT NULL::uuid AS evidence_id, NULL::uuid AS tenant_id, NULL::uuid AS person_id, NULL::uuid AS training_id,
         NULL::text AS titel, NULL::text AS kind, NULL::date AS completed_on
   WHERE false;

DO $$ BEGIN
  IF to_regclass('app.evidence_index_attendance') IS NULL THEN
    EXECUTE $v$CREATE VIEW app.evidence_index_attendance WITH (security_invoker = true) AS
      SELECT NULL::uuid AS evidence_id, NULL::uuid AS tenant_id, NULL::uuid AS person_id, NULL::uuid AS training_id,
             NULL::text AS titel, NULL::text AS kind, NULL::date AS completed_on
       WHERE false$v$;
  END IF;
END $$;

CREATE VIEW app.evidence_index WITH (security_invoker = true) AS
  SELECT * FROM app.evidence_index_online
  UNION ALL SELECT * FROM app.evidence_index_external
  UNION ALL SELECT * FROM app.evidence_index_attendance;

GRANT SELECT ON app.completion_events_online, app.completion_events_external, app.completion_events_attendance, app.completion_events,
  app.evidence_index_online, app.evidence_index_external, app.evidence_index_attendance, app.evidence_index TO app_user, app_definer;

-- ── Erfüllungsstand je Person × Anforderung (compliance_status) ──
-- Live berechnet statt Materialized View: RLS des Aufrufers gilt (Vorgesetzte sehen nur ihr Team),
-- und der Stichtag ist ein Parameter (steuerbare Uhr, E-14). Gleiche Regel wie complianceState() in @sn/shared.
CREATE OR REPLACE FUNCTION app.compliance(p_at timestamptz, p_soon_days int DEFAULT 30)
RETURNS TABLE (
  tenant_id uuid, person_id uuid, requirement_id uuid, qualification_id uuid, training_id uuid,
  interval_months int, grace_days int, reinvite_days int, auto_invite boolean,
  last_completed_on date, valid_until date, expires_on date, source text, source_id uuid,
  exempt boolean, state text
) LANGUAGE sql STABLE AS $$
  WITH today AS (SELECT (p_at AT TIME ZONE 'Europe/Berlin')::date AS d),
  req AS (
    SELECT DISTINCT pq.tenant_id, pq.person_id, r.id AS requirement_id, r.qualification_id, r.training_id,
           r.interval_months, r.grace_days, r.reinvite_days, r.auto_invite
      FROM person_qualification pq
      JOIN requirement r ON r.qualification_id = pq.qualification_id AND r.active
      JOIN person p ON p.id = pq.person_id
     WHERE p.austritt_am IS NULL OR p.austritt_am > (SELECT d FROM today)
  ),
  ev AS (
    SELECT DISTINCT ON (req.person_id, req.requirement_id)
           req.person_id, req.requirement_id, e.completed_on,
           coalesce(e.valid_until, (e.completed_on + make_interval(months => req.interval_months))::date) AS valid_until,
           e.source, e.source_id
      FROM req JOIN app.completion_events e
        ON e.person_id = req.person_id AND (e.requirement_id = req.requirement_id OR (e.requirement_id IS NULL AND e.training_id = req.training_id))
     WHERE e.completed_on IS NOT NULL AND e.completed_on <= (SELECT d FROM today)
     ORDER BY req.person_id, req.requirement_id,
              coalesce(e.valid_until, (e.completed_on + make_interval(months => req.interval_months))::date) DESC, e.completed_on DESC
  )
  SELECT req.tenant_id, req.person_id, req.requirement_id, req.qualification_id, req.training_id,
         req.interval_months, req.grace_days, req.reinvite_days, req.auto_invite,
         ev.completed_on, ev.valid_until, (ev.valid_until + req.grace_days) AS expires_on, ev.source, ev.source_id,
         (x.id IS NOT NULL) AS exempt,
         CASE
           WHEN x.id IS NOT NULL THEN 'befreit'
           WHEN ev.valid_until IS NULL THEN 'fehlt'
           WHEN (ev.valid_until + req.grace_days) < (SELECT d FROM today) THEN 'abgelaufen'
           WHEN (ev.valid_until + req.grace_days) - (SELECT d FROM today) <= p_soon_days THEN 'laeuft_ab'
           ELSE 'gueltig'
         END
    FROM req
    LEFT JOIN ev ON ev.person_id = req.person_id AND ev.requirement_id = req.requirement_id
    LEFT JOIN compliance_exemption x ON x.person_id = req.person_id AND x.requirement_id = req.requirement_id
          AND (x.valid_until IS NULL OR x.valid_until >= (SELECT d FROM today))
$$;

-- ── Fristen-Protokoll: jede Stufe genau einmal (eindeutiger Schlüssel aus @sn/shared noticeKey) ──
CREATE TABLE deadline_notice (
  tenant_id         uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  key               text NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('erinnerung','eskalation','ueberfaellig','wiedereinladung','termin_buchen','neue_version')),
  stage             text,
  invitation_id     uuid,
  person_id         uuid,
  requirement_id    uuid,
  notification_ids  uuid[] NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, key)
);
CREATE INDEX deadline_notice_inv_idx ON deadline_notice(invitation_id) WHERE invitation_id IS NOT NULL;
ALTER TABLE deadline_notice ENABLE ROW LEVEL SECURITY;
ALTER TABLE deadline_notice FORCE ROW LEVEL SECURITY;
ALTER TABLE deadline_notice ALTER COLUMN tenant_id SET DEFAULT app.tenant_id();
CREATE POLICY tenant_isolation ON deadline_notice AS RESTRICTIVE USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id());
CREATE POLICY dn_system ON deadline_notice FOR ALL USING (app.has_role('system')) WITH CHECK (app.has_role('system'));
CREATE POLICY dn_read ON deadline_notice FOR SELECT USING (app.has_any_role(ARRAY['admin','verantwortlich','auditor']));
-- Protokoll ist unveränderlich (nur INSERT)
CREATE TRIGGER deadline_notice_immutable BEFORE UPDATE OR DELETE ON deadline_notice FOR EACH ROW EXECUTE FUNCTION app.forbid_change();

-- Mandanten für den nächtlichen Scan (nur IDs)
CREATE OR REPLACE FUNCTION app.deadline_tenants() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.id FROM tenant t
   WHERE EXISTS (SELECT 1 FROM run r WHERE r.tenant_id = t.id)
      OR EXISTS (SELECT 1 FROM requirement q WHERE q.tenant_id = t.id)
   ORDER BY t.id
$$;
ALTER FUNCTION app.deadline_tenants() OWNER TO app_definer;
GRANT SELECT ON requirement TO app_definer;

-- Systemkontext (Fristen-Job) liest Org-Einheiten, Personen, Mitgliedschaften
CREATE POLICY org_unit_fg_system ON org_unit FOR SELECT USING (app.has_role('system'));

-- ── Web-Push-Abos (E-12) ─────────────────────────────────────
-- Konto-Abos sind mandantenunabhängig (tenant_id NULL); Abos aus einer Einladungslink-Sitzung gehören zu Person + Mandant.
CREATE TABLE push_subscription (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid REFERENCES tenant(id) ON DELETE CASCADE,
  account_id       uuid REFERENCES account(id) ON DELETE CASCADE,
  person_id        uuid,
  endpoint         text NOT NULL UNIQUE CHECK (endpoint ~ '^https://'),
  p256dh           text NOT NULL,
  auth             text NOT NULL,
  user_agent       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_success_at  timestamptz,
  CHECK (num_nonnulls(account_id, person_id) = 1),
  CHECK (person_id IS NULL OR tenant_id IS NOT NULL),
  FOREIGN KEY (person_id, tenant_id) REFERENCES person(id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX push_subscription_account_idx ON push_subscription(account_id) WHERE account_id IS NOT NULL;
CREATE INDEX push_subscription_person_idx ON push_subscription(person_id) WHERE person_id IS NOT NULL;
ALTER TABLE push_subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscription FORCE ROW LEVEL SECURITY;
-- Nur eigene Abos sichtbar; Schreiben ausschließlich über die Funktionen unten.
CREATE POLICY push_own ON push_subscription FOR SELECT USING (
  (account_id IS NOT NULL AND account_id = app.account_id())
  OR (person_id IS NOT NULL AND tenant_id = app.tenant_id() AND person_id = app.person_id()));
REVOKE INSERT, UPDATE, DELETE ON push_subscription FROM app_user;

CREATE OR REPLACE FUNCTION app.push_subscribe(p_account uuid, p_tenant uuid, p_person uuid, p_endpoint text, p_p256dh text, p_auth text, p_ua text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  -- Ein Endpunkt gehört immer genau einem Empfänger (Gerätewechsel des Nutzers ersetzt das alte Abo).
  INSERT INTO push_subscription (tenant_id, account_id, person_id, endpoint, p256dh, auth, user_agent)
  VALUES (CASE WHEN p_person IS NULL THEN NULL ELSE p_tenant END, CASE WHEN p_person IS NULL THEN p_account END, p_person,
          p_endpoint, p_p256dh, p_auth, p_ua)
  ON CONFLICT (endpoint) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, account_id = EXCLUDED.account_id, person_id = EXCLUDED.person_id,
     p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent, created_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION app.push_unsubscribe(p_account uuid, p_tenant uuid, p_person uuid, p_endpoint text)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n int;
BEGIN
  DELETE FROM push_subscription s WHERE s.endpoint = p_endpoint
     AND ((p_account IS NOT NULL AND s.account_id = p_account) OR (p_person IS NOT NULL AND s.person_id = p_person AND s.tenant_id = p_tenant));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Empfänger auflösen: „person:<id>“ → Abos der Person und ihres verknüpften Kontos; „account:<id>“ → Abos des Kontos.
CREATE OR REPLACE FUNCTION app.push_targets(p_kind text, p_id uuid)
RETURNS TABLE (endpoint text, p256dh text, auth text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.endpoint, s.p256dh, s.auth FROM push_subscription s
   WHERE (p_kind = 'account' AND s.account_id = p_id)
      OR (p_kind = 'person' AND (s.person_id = p_id OR s.account_id = (SELECT p.account_id FROM person p WHERE p.id = p_id)))
$$;

CREATE OR REPLACE FUNCTION app.push_result(p_endpoint text, p_ok boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_ok THEN UPDATE push_subscription SET last_success_at = now() WHERE endpoint = p_endpoint;
  ELSE DELETE FROM push_subscription WHERE endpoint = p_endpoint; -- 404/410: Abo existiert nicht mehr
  END IF;
END $$;

-- Hat eine Person (oder ihr Konto) überhaupt ein Abo? (Push nur dann in die Outbox)
CREATE OR REPLACE FUNCTION app.push_has_target(p_person uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM app.push_targets('person', p_person))
$$;

ALTER FUNCTION app.push_subscribe(uuid, uuid, uuid, text, text, text, text) OWNER TO app_definer;
ALTER FUNCTION app.push_unsubscribe(uuid, uuid, uuid, text) OWNER TO app_definer;
ALTER FUNCTION app.push_targets(text, uuid) OWNER TO app_definer;
ALTER FUNCTION app.push_result(text, boolean) OWNER TO app_definer;
ALTER FUNCTION app.push_has_target(uuid) OWNER TO app_definer;
GRANT SELECT, INSERT, UPDATE, DELETE ON push_subscription TO app_definer;
