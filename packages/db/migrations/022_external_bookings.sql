-- 022 · Phase 4.3: Externe Schulungen planen, buchen und nachverfolgen (E-55/E-56)
-- Buchung mit Terminen (Tage), Teilnehmern (Status je Person), Anhängen, Anreise/Hotel, Kosten (Cent, netto).
-- Abschluss über den vorhandenen externen Nachweis (external_record) – Freigabe aktualisiert die Pflichtmatrix.

CREATE TABLE external_booking (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  titel                text NOT NULL CHECK (length(trim(titel)) BETWEEN 2 AND 300),
  training_id          uuid,
  requirement_id       uuid,
  provider_name        text NOT NULL CHECK (length(trim(provider_name)) BETWEEN 2 AND 300),
  provider_contact     text,
  provider_phone       text,
  provider_email       text,
  provider_web         text,
  booking_no           text,
  format               text NOT NULL DEFAULT 'praesenz' CHECK (format IN ('praesenz','online')),
  address              text,
  room                 text,
  meeting_point        text,
  online_platform      text,
  online_url           text CHECK (online_url IS NULL OR online_url ~ '^https://'),
  travel_mode          text CHECK (travel_mode IN ('firmenwagen','bahn','flug','privat')),
  departure            text,
  carpool              text,
  hotel_name           text,
  hotel_address        text,
  hotel_check_in       date,
  hotel_check_out      date,
  hotel_booking_no     text,
  catering             text,
  bring_along          text,
  travel_notes         text,
  internal_contact     text,
  fee_cents            int NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  hotel_cents          int NOT NULL DEFAULT 0 CHECK (hotel_cents >= 0),
  travel_cents         int NOT NULL DEFAULT 0 CHECK (travel_cents >= 0),
  cost_center          text,
  approval_required    boolean NOT NULL DEFAULT false,
  approver_person_id   uuid,
  approved_at          timestamptz,
  approved_by          uuid,
  cancelled_at         timestamptz,
  cancel_reason        text,
  cancel_cost_cents    int CHECK (cancel_cost_cents >= 0),
  reminder_days_before int NOT NULL DEFAULT 7 CHECK (reminder_days_before BETWEEN 0 AND 60),
  escalate_after_days  int NOT NULL DEFAULT 7 CHECK (escalate_after_days BETWEEN 1 AND 90),
  created_by           uuid DEFAULT app.account_id(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  CHECK (hotel_check_out IS NULL OR hotel_check_in IS NULL OR hotel_check_out >= hotel_check_in),
  CHECK (NOT approval_required OR approver_person_id IS NOT NULL),
  FOREIGN KEY (training_id, tenant_id) REFERENCES training(id, tenant_id),
  FOREIGN KEY (requirement_id, tenant_id) REFERENCES requirement(id, tenant_id),
  FOREIGN KEY (approver_person_id, tenant_id) REFERENCES person(id, tenant_id)
);
CREATE TRIGGER external_booking_touch BEFORE UPDATE ON external_booking FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
SELECT app.enable_tenant_rls('external_booking');

CREATE TABLE external_booking_day (
  tenant_id   uuid NOT NULL,
  booking_id  uuid NOT NULL,
  day_no      int NOT NULL CHECK (day_no BETWEEN 1 AND 30),
  start_at    timestamptz NOT NULL,
  end_at      timestamptz NOT NULL,
  PRIMARY KEY (booking_id, day_no),
  CHECK (end_at > start_at),
  FOREIGN KEY (booking_id, tenant_id) REFERENCES external_booking(id, tenant_id) ON DELETE CASCADE
);
SELECT app.enable_tenant_rls('external_booking_day');

CREATE TABLE external_booking_participant (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  booking_id          uuid NOT NULL,
  person_id           uuid NOT NULL,
  status              text NOT NULL DEFAULT 'geplant' CHECK (status IN (
                        'geplant','zur_freigabe','gebucht','eingeladen','bestaetigt','teilgenommen','eingereicht','freigegeben',
                        'abgesagt','nicht_erschienen','verschoben')),
  status_at           timestamptz NOT NULL DEFAULT now(),
  status_reason       text,
  -- persönlicher Link (nur Hash gespeichert), Kalender-Folgenummer für aktualisierte Einladungen
  token_hash          text UNIQUE,
  ics_sequence        int NOT NULL DEFAULT 0,
  invited_at          timestamptz,
  confirmed_at        timestamptz,
  problem_note        text,
  problem_at          timestamptz,
  reminders_sent      text[] NOT NULL DEFAULT '{}',
  external_record_id  uuid,
  UNIQUE (id, tenant_id),
  UNIQUE (booking_id, person_id),
  FOREIGN KEY (booking_id, tenant_id) REFERENCES external_booking(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (person_id, tenant_id) REFERENCES person(id, tenant_id),
  FOREIGN KEY (external_record_id, tenant_id) REFERENCES external_record(id, tenant_id)
);
CREATE INDEX external_booking_participant_person_idx ON external_booking_participant(person_id);
CREATE INDEX external_booking_participant_record_idx ON external_booking_participant(external_record_id);
SELECT app.enable_tenant_rls('external_booking_participant');

CREATE TABLE external_booking_file (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  booking_id    uuid NOT NULL,
  file_key      text NOT NULL,
  file_name     text NOT NULL,
  content_type  text NOT NULL,
  size_bytes    int NOT NULL CHECK (size_bytes > 0),
  sha256        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (booking_id, tenant_id) REFERENCES external_booking(id, tenant_id) ON DELETE CASCADE
);
SELECT app.enable_tenant_rls('external_booking_file');

-- Verantwortliche verwalten, Auditor liest; Teilnehmer greifen über den persönlichen Link im Systemkontext zu (wie E-27)
CREATE POLICY ext_booking_staff ON external_booking FOR ALL
  USING (app.has_any_role(ARRAY['admin','verantwortlich','system','auditor']))
  WITH CHECK (app.has_any_role(ARRAY['admin','verantwortlich','system']));
CREATE POLICY ext_booking_day_staff ON external_booking_day FOR ALL
  USING (app.has_any_role(ARRAY['admin','verantwortlich','system','auditor']))
  WITH CHECK (app.has_any_role(ARRAY['admin','verantwortlich','system']));
CREATE POLICY ext_booking_part_staff ON external_booking_participant FOR ALL
  USING (app.has_any_role(ARRAY['admin','verantwortlich','system','auditor']))
  WITH CHECK (app.has_any_role(ARRAY['admin','verantwortlich','system']));
CREATE POLICY ext_booking_file_staff ON external_booking_file FOR ALL
  USING (app.has_any_role(ARRAY['admin','verantwortlich','system','auditor']))
  WITH CHECK (app.has_any_role(ARRAY['admin','verantwortlich','system']));

-- Persönlicher Link → Mandant (ohne Mandantenkontext)
CREATE OR REPLACE FUNCTION app.external_booking_by_token(p_hash text)
RETURNS TABLE (participant_id uuid, tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id, p.tenant_id FROM external_booking_participant p WHERE p.token_hash = p_hash
$$;
ALTER FUNCTION app.external_booking_by_token(text) OWNER TO app_definer;
GRANT SELECT ON external_booking_participant TO app_definer;

-- Mandanten mit offenen Buchungen (für die Erinnerungen der Fristen-Engine)
CREATE OR REPLACE FUNCTION app.external_booking_tenants() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT tenant_id FROM external_booking_participant WHERE status IN ('eingeladen','bestaetigt','verschoben','teilgenommen')
$$;
ALTER FUNCTION app.external_booking_tenants() OWNER TO app_definer;
