-- 001 · Kern: Kontext-Funktionen, Mandanten, Konten, Mitgliedschaften (E-04, E-07)
-- Läuft als app_migrator. Alle Tabellen: RLS aktiviert UND erzwungen (auch für den Owner).

-- ── Request-Kontext ──────────────────────────────────────────
-- Gesetzt per set_config(..., true) je Transaktion durch die API. Fehlt er → NULL → keine Zeilen (fail closed).
CREATE OR REPLACE FUNCTION app.tenant_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION app.account_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.account_id', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION app.person_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.person_id', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION app.roles() RETURNS text[] LANGUAGE sql STABLE AS
$$ SELECT coalesce(string_to_array(nullif(current_setting('app.roles', true), ''), ','), '{}'::text[]) $$;
CREATE OR REPLACE FUNCTION app.has_role(r text) RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT r = ANY (app.roles()) $$;
CREATE OR REPLACE FUNCTION app.has_any_role(rs text[]) RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT app.roles() && rs $$;

-- Hilfsfunktion für spätere Migrationen: Standard-Mandantentrennung auf einer Tabelle mit Spalte tenant_id.
CREATE OR REPLACE FUNCTION app.enable_tenant_rls(tbl regclass) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s ALTER COLUMN tenant_id SET DEFAULT app.tenant_id()', tbl);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s AS RESTRICTIVE USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id())',
    tbl);
END $$;

-- updated_at pflegen
CREATE OR REPLACE FUNCTION app.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- ── Mandant ──────────────────────────────────────────────────
CREATE TABLE tenant (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 200),
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER tenant_touch BEFORE UPDATE ON tenant FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- ── Konto (mandantenunabhängig, E-07/E-25) ───────────────────
CREATE TABLE account (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              citext NOT NULL UNIQUE CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  display_name       text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 200),
  password_hash      text,
  email_verified_at  timestamptz,
  disabled_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER account_touch BEFORE UPDATE ON account FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- ── Mitgliedschaft: Konto ↔ Mandant mit Rollen ──────────────
CREATE TABLE membership (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  account_id  uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  roles       text[] NOT NULL CHECK (
                cardinality(roles) > 0 AND
                roles <@ ARRAY['admin','verantwortlich','trainer','vorgesetzter','teilnehmer','auditor']),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, account_id)
);
CREATE INDEX membership_account_idx ON membership(account_id);

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant FORCE ROW LEVEL SECURITY;
ALTER TABLE account ENABLE ROW LEVEL SECURITY;
ALTER TABLE account FORCE ROW LEVEL SECURITY;
ALTER TABLE membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership FORCE ROW LEVEL SECURITY;

-- Mitgliedschaften: eigene (für den Mandanten-Wechsel) und die des aktiven Mandanten
CREATE POLICY membership_select ON membership FOR SELECT
  USING (account_id = app.account_id() OR tenant_id = app.tenant_id());
CREATE POLICY membership_write ON membership FOR ALL
  USING (tenant_id = app.tenant_id() AND app.has_role('admin'))
  WITH CHECK (tenant_id = app.tenant_id() AND app.has_role('admin'));

-- Mandant: der aktive sowie alle, in denen das Konto Mitglied ist (Name für die Auswahl)
CREATE POLICY tenant_select ON tenant FOR SELECT
  USING (id = app.tenant_id()
         OR EXISTS (SELECT 1 FROM membership m WHERE m.tenant_id = tenant.id AND m.account_id = app.account_id()));
CREATE POLICY tenant_update ON tenant FOR UPDATE
  USING (id = app.tenant_id() AND app.has_role('admin'))
  WITH CHECK (id = app.tenant_id() AND app.has_role('admin'));
-- INSERT/DELETE auf tenant nur über SECURITY-DEFINER-Funktion (Registrierung).

-- Konto: das eigene und die Mitglieder des aktiven Mandanten
CREATE POLICY account_select ON account FOR SELECT
  USING (id = app.account_id()
         OR EXISTS (SELECT 1 FROM membership m WHERE m.account_id = account.id AND m.tenant_id = app.tenant_id()));
CREATE POLICY account_update_self ON account FOR UPDATE
  USING (id = app.account_id()) WITH CHECK (id = app.account_id());

-- Passwort-Hash ist für die Laufzeitrolle nie lesbar oder schreibbar (Spaltenrechte).
REVOKE ALL ON account FROM app_user;
GRANT SELECT (id, email, display_name, email_verified_at, disabled_at, created_at, updated_at) ON account TO app_user;
GRANT UPDATE (display_name) ON account TO app_user;
REVOKE INSERT, DELETE ON tenant FROM app_user;

-- ── SECURITY DEFINER: Login und Registrierung (Owner app_definer = BYPASSRLS) ──
CREATE OR REPLACE FUNCTION app.auth_find_account(p_email citext)
RETURNS TABLE (id uuid, email citext, display_name text, password_hash text, disabled boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.id, a.email, a.display_name, a.password_hash, a.disabled_at IS NOT NULL
  FROM account a WHERE a.email = p_email
$$;

CREATE OR REPLACE FUNCTION app.auth_get_password_hash(p_account uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.password_hash FROM account a WHERE a.id = p_account AND a.disabled_at IS NULL
$$;

-- Dozent registriert sich: legt Konto + neuen Mandanten + Mitgliedschaft (admin, verantwortlich, trainer) an.
CREATE OR REPLACE FUNCTION app.auth_register_tenant(
  p_email citext, p_display_name text, p_password_hash text, p_tenant_name text)
RETURNS TABLE (account_id uuid, tenant_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_account uuid; v_tenant uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM account a WHERE a.email = p_email) THEN
    RAISE EXCEPTION 'EMAIL_TAKEN' USING ERRCODE = 'unique_violation';
  END IF;
  INSERT INTO account (email, display_name, password_hash) VALUES (p_email, p_display_name, p_password_hash)
    RETURNING id INTO v_account;
  INSERT INTO tenant (name) VALUES (p_tenant_name) RETURNING id INTO v_tenant;
  INSERT INTO membership (tenant_id, account_id, roles)
    VALUES (v_tenant, v_account, ARRAY['admin','verantwortlich','trainer']);
  RETURN QUERY SELECT v_account, v_tenant;
END $$;

-- Teilnehmer legt ein Konto ohne Mandant an (E-25).
CREATE OR REPLACE FUNCTION app.auth_register_account(p_email citext, p_display_name text, p_password_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_account uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM account a WHERE a.email = p_email) THEN
    RAISE EXCEPTION 'EMAIL_TAKEN' USING ERRCODE = 'unique_violation';
  END IF;
  INSERT INTO account (email, display_name, password_hash) VALUES (p_email, p_display_name, p_password_hash)
    RETURNING id INTO v_account;
  RETURN v_account;
END $$;

CREATE OR REPLACE FUNCTION app.auth_set_password(p_account uuid, p_password_hash text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE account SET password_hash = p_password_hash WHERE id = p_account
$$;

CREATE OR REPLACE FUNCTION app.auth_mark_email_verified(p_account uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE account SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = p_account
$$;

ALTER FUNCTION app.auth_find_account(citext) OWNER TO app_definer;
ALTER FUNCTION app.auth_get_password_hash(uuid) OWNER TO app_definer;
ALTER FUNCTION app.auth_register_tenant(citext, text, text, text) OWNER TO app_definer;
ALTER FUNCTION app.auth_register_account(citext, text, text) OWNER TO app_definer;
ALTER FUNCTION app.auth_set_password(uuid, text) OWNER TO app_definer;
ALTER FUNCTION app.auth_mark_email_verified(uuid) OWNER TO app_definer;
GRANT SELECT, INSERT, UPDATE ON tenant, account, membership TO app_definer;
