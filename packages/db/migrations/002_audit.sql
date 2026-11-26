-- 002 · Audit-Trail als Hash-Kette je Mandant (E-11). Append-only.

CREATE TABLE audit_event (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenant(id),
  seq               bigint NOT NULL,
  ts                timestamptz NOT NULL,
  actor_account_id  uuid DEFAULT app.account_id(),
  actor_person_id   uuid DEFAULT app.person_id(),
  entity            text NOT NULL,
  entity_id         text,
  action            text NOT NULL,
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash         text NOT NULL,
  hash              text NOT NULL,
  UNIQUE (tenant_id, seq)
);
CREATE INDEX audit_event_entity_idx ON audit_event(tenant_id, entity, entity_id);

-- Kanonische Darstellung einer Zeile (ohne hash). jsonb::text ist normalisiert (Schlüsselreihenfolge stabil).
CREATE OR REPLACE FUNCTION app.audit_canonical(
  p_tenant uuid, p_seq bigint, p_ts timestamptz, p_actor_account uuid, p_actor_person uuid,
  p_entity text, p_entity_id text, p_action text, p_payload jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws('|',
    p_tenant::text, p_seq::text,
    to_char(p_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    coalesce(p_actor_account::text, ''), coalesce(p_actor_person::text, ''),
    p_entity, coalesce(p_entity_id, ''), p_action, p_payload::text)
$$;

CREATE OR REPLACE FUNCTION app.audit_hash(p_prev text, p_canonical text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT encode(digest(p_prev || '|' || p_canonical, 'sha256'), 'hex')
$$;

-- Vor dem Einfügen: Kette fortschreiben. Serialisiert je Mandant über Advisory-Lock.
-- SECURITY DEFINER, damit auch Rollen ohne Leserecht auf audit_event (z. B. Teilnehmer) die Kette fortsetzen.
CREATE OR REPLACE FUNCTION app.audit_chain() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_seq bigint; v_hash text;
BEGIN
  IF NEW.tenant_id IS NULL THEN NEW.tenant_id := app.tenant_id(); END IF;
  IF NEW.tenant_id IS NULL OR NEW.tenant_id IS DISTINCT FROM app.tenant_id() THEN
    RAISE EXCEPTION 'audit_event: tenant_id muss dem aktiven Mandanten entsprechen';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('audit:' || NEW.tenant_id::text, 0));
  SELECT a.seq, a.hash INTO v_seq, v_hash FROM audit_event a
    WHERE a.tenant_id = NEW.tenant_id ORDER BY a.seq DESC LIMIT 1;
  NEW.seq := coalesce(v_seq, 0) + 1;
  NEW.prev_hash := coalesce(v_hash, repeat('0', 64));
  NEW.ts := clock_timestamp();
  NEW.hash := app.audit_hash(NEW.prev_hash, app.audit_canonical(
    NEW.tenant_id, NEW.seq, NEW.ts, NEW.actor_account_id, NEW.actor_person_id,
    NEW.entity, NEW.entity_id, NEW.action, NEW.payload));
  RETURN NEW;
END $$;
ALTER FUNCTION app.audit_chain() OWNER TO app_definer;
GRANT SELECT ON audit_event TO app_definer;

CREATE TRIGGER audit_event_chain BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION app.audit_chain();

CREATE OR REPLACE FUNCTION app.audit_forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_event ist unveränderlich (append-only)'; END $$;
CREATE TRIGGER audit_event_no_update BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION app.audit_forbid_change();
CREATE TRIGGER audit_event_no_truncate BEFORE TRUNCATE ON audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION app.audit_forbid_change();

ALTER TABLE audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_event FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_insert ON audit_event FOR INSERT WITH CHECK (tenant_id = app.tenant_id());
CREATE POLICY audit_select ON audit_event FOR SELECT
  USING (tenant_id = app.tenant_id() AND app.has_any_role(ARRAY['admin','verantwortlich','auditor']));
REVOKE UPDATE, DELETE, TRUNCATE ON audit_event FROM app_user;

-- Kette prüfen (läuft mit den Rechten des Aufrufers → nur admin/verantwortlich/auditor sehen Zeilen).
-- Liefert die erste fehlerhafte Zeile oder ok = true.
CREATE OR REPLACE FUNCTION app.audit_verify()
RETURNS TABLE (ok boolean, checked bigint, first_bad_id uuid, first_bad_seq bigint, reason text)
LANGUAGE plpgsql STABLE AS $$
DECLARE r record; v_prev text := repeat('0', 64); v_expected_seq bigint := 1; v_n bigint := 0; v_calc text;
BEGIN
  FOR r IN SELECT * FROM audit_event a WHERE a.tenant_id = app.tenant_id() ORDER BY a.seq LOOP
    v_n := v_n + 1;
    IF r.seq <> v_expected_seq THEN
      RETURN QUERY SELECT false, v_n, r.id, r.seq, 'Lücke in der Folge (erwartet ' || v_expected_seq || ')'; RETURN;
    END IF;
    IF r.prev_hash <> v_prev THEN
      RETURN QUERY SELECT false, v_n, r.id, r.seq, 'prev_hash passt nicht zum Vorgänger'; RETURN;
    END IF;
    v_calc := app.audit_hash(r.prev_hash, app.audit_canonical(
      r.tenant_id, r.seq, r.ts, r.actor_account_id, r.actor_person_id, r.entity, r.entity_id, r.action, r.payload));
    IF v_calc <> r.hash THEN
      RETURN QUERY SELECT false, v_n, r.id, r.seq, 'Inhalt verändert (Hash stimmt nicht)'; RETURN;
    END IF;
    v_prev := r.hash; v_expected_seq := v_expected_seq + 1;
  END LOOP;
  RETURN QUERY SELECT true, v_n, NULL::uuid, NULL::bigint, NULL::text;
END $$;
