-- 007 · Lesenachweis: Sitzungen, Roh-Heartbeats (90 Tage), aggregierter Seitenfortschritt (SPEZIFIKATION 3, 4.1; E-06)
-- Seitendetails sehen nur admin/verantwortlich/auditor und die Person selbst – Vorgesetzte NICHT.

CREATE TABLE read_session (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  invitation_id  uuid NOT NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz,
  ended_at       timestamptz,
  end_reason     text CHECK (end_reason IN ('abgeloest','beendet','zeitablauf')),
  user_agent     text,
  ip_hash        text,
  -- SessionTrackState aus @sn/shared (lastSeq, lastServerTs, lastPage, lastValid)
  state          jsonb NOT NULL DEFAULT '{"lastSeq":null,"lastServerTs":null,"lastPage":null,"lastValid":false}'::jsonb,
  UNIQUE (id, tenant_id),
  FOREIGN KEY (invitation_id, tenant_id) REFERENCES invitation(id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX read_session_inv_idx ON read_session(invitation_id);
SELECT app.enable_tenant_rls('read_session');

CREATE TABLE heartbeat_raw (
  id                 bigserial PRIMARY KEY,
  tenant_id          uuid NOT NULL,
  session_id         uuid NOT NULL,
  seq                bigint NOT NULL,
  page_no            int NOT NULL,
  visible_ratio      real NOT NULL,
  focused            boolean NOT NULL,
  last_input_age_ms  int NOT NULL,
  client_ts          bigint,
  server_ts          timestamptz NOT NULL,
  offline            boolean NOT NULL DEFAULT false,
  reason             text NOT NULL,
  credited_ms        int NOT NULL DEFAULT 0,
  FOREIGN KEY (session_id, tenant_id) REFERENCES read_session(id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX heartbeat_raw_session_idx ON heartbeat_raw(session_id, seq);
CREATE INDEX heartbeat_raw_ts_idx ON heartbeat_raw(server_ts);
SELECT app.enable_tenant_rls('heartbeat_raw');

CREATE TABLE page_progress (
  tenant_id      uuid NOT NULL,
  invitation_id  uuid NOT NULL,
  page_no        int NOT NULL,
  first_seen_at  timestamptz NOT NULL,
  dwell_ms       bigint NOT NULL DEFAULT 0 CHECK (dwell_ms >= 0),
  fulfilled_at   timestamptz,
  PRIMARY KEY (invitation_id, page_no),
  FOREIGN KEY (invitation_id, tenant_id) REFERENCES invitation(id, tenant_id) ON DELETE CASCADE
);
SELECT app.enable_tenant_rls('page_progress');

-- Eigene Einladungen (Teilnehmer-Sicht)
CREATE OR REPLACE FUNCTION app.my_invitation_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.id FROM invitation i WHERE i.tenant_id = app.tenant_id() AND i.person_id IN (SELECT app.my_person_ids())
$$;
ALTER FUNCTION app.my_invitation_ids() OWNER TO app_definer;

-- Detailrollen + System + eigene
CREATE POLICY rs_detail ON read_session FOR SELECT USING (
  app.has_any_role(ARRAY['admin','verantwortlich','auditor']) OR invitation_id IN (SELECT app.my_invitation_ids()));
CREATE POLICY rs_system ON read_session FOR ALL USING (app.has_role('system')) WITH CHECK (app.has_role('system'));
CREATE POLICY hb_detail ON heartbeat_raw FOR SELECT USING (app.has_any_role(ARRAY['admin','verantwortlich','auditor']));
CREATE POLICY hb_system ON heartbeat_raw FOR ALL USING (app.has_role('system')) WITH CHECK (app.has_role('system'));
CREATE POLICY pp_detail ON page_progress FOR SELECT USING (
  app.has_any_role(ARRAY['admin','verantwortlich','auditor']) OR invitation_id IN (SELECT app.my_invitation_ids()));
CREATE POLICY pp_system ON page_progress FOR ALL USING (app.has_role('system')) WITH CHECK (app.has_role('system'));

-- Datenschutz: Roh-Heartbeats nach 90 Tagen löschen (mandantenübergreifender Job, E-06/SPEZ. 7)
CREATE OR REPLACE FUNCTION app.purge_heartbeats(p_older_than interval) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n bigint;
BEGIN
  DELETE FROM heartbeat_raw WHERE server_ts < now() - p_older_than;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
ALTER FUNCTION app.purge_heartbeats(interval) OWNER TO app_definer;
GRANT SELECT, DELETE ON heartbeat_raw TO app_definer;

-- Lesesitzung eines Kontos auflösen (Konto-Sitzungen haben ggf. einen anderen aktiven Mandanten, E-25)
CREATE OR REPLACE FUNCTION app.read_session_for_account(p_session uuid, p_account uuid)
RETURNS TABLE (invitation_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.invitation_id FROM read_session s JOIN invitation i ON i.id = s.invitation_id JOIN person p ON p.id = i.person_id
   WHERE s.id = p_session AND p.account_id = p_account
$$;
ALTER FUNCTION app.read_session_for_account(uuid, uuid) OWNER TO app_definer;
GRANT SELECT ON read_session TO app_definer;
