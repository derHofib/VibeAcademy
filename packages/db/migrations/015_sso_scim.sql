-- 015 · SSO (OIDC je Mandant) und SCIM 2.0 (E-36)
--  - tenant_sso_config: IdP-Konfiguration je Mandant; Client-Secret nur verschlüsselt (AES-256-GCM, Schlüssel in der API)
--  - sso_email_domain:  E-Mail-Domains je Mandant, global eindeutig (eine Domain gehört höchstens einem Mandanten)
--  - account_identity:  Konto ↔ (Issuer, Subject), mandantenunabhängig wie das Konto (E-07)
--  - scim_token:        Bearer-Token je Mandant, nur SHA-256-Hash gespeichert
--  - person/org_unit:   externe Kennungen für SCIM (externalId, userName)
--  - Rolle „scim“:      Kontext der SCIM-Schnittstelle (Mandant aus dem Token, nie aus dem Request)

-- ── IdP-Konfiguration je Mandant ─────────────────────────────
CREATE TABLE tenant_sso_config (
  tenant_id                   uuid PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
  enabled                     boolean NOT NULL DEFAULT false,
  -- Kurzname für Anmelde-Links (/api/auth/sso/start?tenant=<slug>)
  slug                        citext UNIQUE CHECK (slug IS NULL OR slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  issuer                      text NOT NULL DEFAULT '' CHECK (length(issuer) <= 500),
  client_id                   text NOT NULL DEFAULT '' CHECK (length(client_id) <= 500),
  -- „v1:<iv>:<tag>:<ciphertext>“ (base64url), AAD = tenant_id; NULL = öffentlicher Client (nur PKCE)
  client_secret_enc           text,
  scopes                      text NOT NULL DEFAULT 'openid email profile' CHECK (scopes ~ '(^| )openid( |$)'),
  sso_only                    boolean NOT NULL DEFAULT false,
  -- Notfallzugang: dieses Konto darf sich trotz „nur SSO“ mit Passwort anmelden
  emergency_admin_account_id  uuid REFERENCES account(id) ON DELETE SET NULL,
  jit_enabled                 boolean NOT NULL DEFAULT true,
  default_roles               text[] NOT NULL DEFAULT ARRAY['teilnehmer'] CHECK (
                                cardinality(default_roles) > 0 AND
                                default_roles <@ ARRAY['admin','verantwortlich','trainer','vorgesetzter','teilnehmer','auditor']),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT enabled OR (issuer <> '' AND client_id <> '')),
  CHECK (NOT sso_only OR enabled)
);
CREATE TRIGGER tenant_sso_config_touch BEFORE UPDATE ON tenant_sso_config
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
SELECT app.enable_tenant_rls('tenant_sso_config');
CREATE POLICY sso_config_admin ON tenant_sso_config FOR ALL
  USING (app.has_role('admin')) WITH CHECK (app.has_role('admin'));
-- Anmeldeablauf (Systemkontext im Mandanten des IdP)
CREATE POLICY sso_config_system ON tenant_sso_config FOR SELECT USING (app.has_role('system'));

CREATE TABLE sso_email_domain (
  domain      citext PRIMARY KEY CHECK (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sso_email_domain_tenant_idx ON sso_email_domain(tenant_id);
SELECT app.enable_tenant_rls('sso_email_domain');
CREATE POLICY sso_domain_admin ON sso_email_domain FOR ALL
  USING (app.has_role('admin')) WITH CHECK (app.has_role('admin'));
CREATE POLICY sso_domain_system ON sso_email_domain FOR SELECT USING (app.has_role('system'));

-- ── Konto ↔ IdP-Subjekt ──────────────────────────────────────
CREATE TABLE account_identity (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  issuer         text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 500),
  subject        text NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
  -- Mandant, über dessen IdP die Verknüpfung entstand (Information)
  tenant_id      uuid REFERENCES tenant(id) ON DELETE SET NULL,
  linked_via     text NOT NULL CHECK (linked_via IN ('jit', 'email', 'existing')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz,
  UNIQUE (issuer, subject)
);
CREATE INDEX account_identity_account_idx ON account_identity(account_id);
ALTER TABLE account_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_identity FORCE ROW LEVEL SECURITY;
-- Lesen: das eigene Konto; schreiben nur über die SECURITY-DEFINER-Funktionen unten.
CREATE POLICY account_identity_own ON account_identity FOR SELECT USING (account_id = app.account_id());
REVOKE INSERT, UPDATE, DELETE ON account_identity FROM app_user;

-- ── SCIM-Token ───────────────────────────────────────────────
CREATE TABLE scim_token (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  -- erste Zeichen des Tokens zur Wiedererkennung in der Oberfläche
  prefix       text NOT NULL CHECK (length(prefix) BETWEEN 4 AND 16),
  label        text NOT NULL DEFAULT '' CHECK (length(label) <= 100),
  created_by   uuid REFERENCES account(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX scim_token_tenant_idx ON scim_token(tenant_id);
SELECT app.enable_tenant_rls('scim_token');
CREATE POLICY scim_token_admin ON scim_token FOR ALL
  USING (app.has_role('admin')) WITH CHECK (app.has_role('admin'));

-- ── SCIM-Kennungen an Personen und Org-Einheiten ─────────────
ALTER TABLE person ADD COLUMN external_id text CHECK (external_id IS NULL OR length(external_id) BETWEEN 1 AND 255);
ALTER TABLE person ADD COLUMN scim_user_name citext CHECK (scim_user_name IS NULL OR length(scim_user_name) BETWEEN 1 AND 255);
CREATE UNIQUE INDEX person_external_id_uq ON person(tenant_id, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX person_scim_user_name_uq ON person(tenant_id, scim_user_name) WHERE scim_user_name IS NOT NULL;
ALTER TABLE org_unit ADD COLUMN external_id text CHECK (external_id IS NULL OR length(external_id) BETWEEN 1 AND 255);
CREATE UNIQUE INDEX org_unit_external_id_uq ON org_unit(tenant_id, external_id) WHERE external_id IS NOT NULL;

-- SCIM-Kontext: Personen und Org-Einheiten des Token-Mandanten pflegen, Mitgliedschaften beim Deaktivieren lösen.
-- (Mandantentrennung erzwingt zusätzlich die restriktive Policy tenant_isolation bzw. membership_select/-scim.)
CREATE POLICY person_scim ON person FOR ALL USING (app.has_role('scim')) WITH CHECK (app.has_role('scim'));
CREATE POLICY org_unit_scim ON org_unit FOR ALL USING (app.has_role('scim')) WITH CHECK (app.has_role('scim'));
CREATE POLICY membership_scim_delete ON membership FOR DELETE
  USING (tenant_id = app.tenant_id() AND app.has_role('scim'));

-- ── SECURITY DEFINER: Anmeldeablauf ──────────────────────────
-- Mandant per Kurzname oder ID (nur mit aktivem SSO)
CREATE OR REPLACE FUNCTION app.sso_resolve_tenant(p_key text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.tenant_id FROM tenant_sso_config c
   WHERE c.enabled AND (c.slug = p_key::citext
         OR c.tenant_id = CASE WHEN p_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                               THEN p_key::uuid END)
$$;

-- Mandant per E-Mail-Domain (Anmeldeseite: „Mit Firmenkonto anmelden“)
CREATE OR REPLACE FUNCTION app.sso_tenant_by_domain(p_domain citext)
RETURNS TABLE (tenant_id uuid, tenant_name text, sso_only boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.tenant_id, t.name, c.sso_only
    FROM sso_email_domain d JOIN tenant_sso_config c ON c.tenant_id = d.tenant_id JOIN tenant t ON t.id = c.tenant_id
   WHERE d.domain = p_domain AND c.enabled
$$;

CREATE OR REPLACE FUNCTION app.sso_find_identity(p_issuer text, p_subject text)
RETURNS TABLE (account_id uuid, email citext, disabled boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.id, a.email, a.disabled_at IS NOT NULL
    FROM account_identity i JOIN account a ON a.id = i.account_id
   WHERE i.issuer = p_issuer AND i.subject = p_subject
$$;

-- Identität des Kontos beim Issuer (Step-up per SSO)
CREATE OR REPLACE FUNCTION app.sso_identity_of(p_account uuid, p_issuer text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.subject FROM account_identity i WHERE i.account_id = p_account AND i.issuer = p_issuer
   ORDER BY i.created_at LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app.sso_link_identity(p_account uuid, p_issuer text, p_subject text, p_tenant uuid, p_via text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO account_identity (account_id, issuer, subject, tenant_id, linked_via, last_login_at)
  VALUES (p_account, p_issuer, p_subject, p_tenant, p_via, now())
  ON CONFLICT (issuer, subject) DO UPDATE SET last_login_at = now()
    WHERE account_identity.account_id = EXCLUDED.account_id
$$;

-- Neues Konto aus dem IdP (Just-in-time): ohne Passwort, E-Mail vom IdP bestätigt.
CREATE OR REPLACE FUNCTION app.sso_create_account(p_email citext, p_display_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_account uuid;
BEGIN
  INSERT INTO account (email, display_name, email_verified_at) VALUES (p_email, p_display_name, now())
    RETURNING id INTO v_account;
  RETURN v_account;
END $$;

-- Mitgliedschaft sicherstellen (JIT). Liefert 'existing', 'created' oder 'missing' (JIT aus / nicht erlaubt).
CREATE OR REPLACE FUNCTION app.sso_ensure_membership(p_tenant uuid, p_account uuid, p_roles text[], p_create boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM membership m WHERE m.tenant_id = p_tenant AND m.account_id = p_account) THEN
    RETURN 'existing';
  END IF;
  IF NOT p_create THEN RETURN 'missing'; END IF;
  INSERT INTO membership (tenant_id, account_id, roles) VALUES (p_tenant, p_account, p_roles);
  RETURN 'created';
END $$;

-- Personen des Mandanten mit dieser (bestätigten) E-Mail mit dem Konto verknüpfen (E-25, nur unverknüpfte).
CREATE OR REPLACE FUNCTION app.sso_link_tenant_persons(p_tenant uuid, p_account uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n int;
BEGIN
  UPDATE person p SET account_id = p_account FROM account a
   WHERE a.id = p_account AND a.email_verified_at IS NOT NULL AND p.tenant_id = p_tenant
     AND p.email = a.email AND p.account_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Per SCIM ausgetretene Person (austritt_am erreicht) → keine Anmeldung/JIT mehr in diesem Mandanten.
CREATE OR REPLACE FUNCTION app.sso_person_left(p_tenant uuid, p_account uuid, p_email citext)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM person p
     WHERE p.tenant_id = p_tenant AND (p.account_id = p_account OR p.email = p_email)
       AND p.austritt_am IS NOT NULL AND p.austritt_am <= current_date
       AND NOT EXISTS (SELECT 1 FROM person q WHERE q.tenant_id = p_tenant
                        AND (q.account_id = p_account OR q.email = p_email)
                        AND (q.austritt_am IS NULL OR q.austritt_am > current_date)))
$$;

-- „Nur SSO“: Passwort-Anmeldung gesperrt, wenn das Konto Mitglied eines solchen Mandanten ist
-- (außer als dort benannter Notfall-Admin). Liefert die betroffenen Mandanten.
CREATE OR REPLACE FUNCTION app.sso_password_blocked(p_account uuid)
RETURNS TABLE (tenant_id uuid, tenant_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.tenant_id, t.name FROM membership m
    JOIN tenant_sso_config c ON c.tenant_id = m.tenant_id JOIN tenant t ON t.id = c.tenant_id
   WHERE m.account_id = p_account AND c.enabled AND c.sso_only
     AND c.emergency_admin_account_id IS DISTINCT FROM p_account
$$;

-- SCIM: Token → Mandant (nur nicht widerrufene); vermerkt die letzte Nutzung (höchstens minütlich).
CREATE OR REPLACE FUNCTION app.scim_token_lookup(p_hash text)
RETURNS TABLE (token_id uuid, tenant_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE scim_token s SET last_used_at = now()
   WHERE s.token_hash = p_hash AND s.revoked_at IS NULL
     AND (s.last_used_at IS NULL OR s.last_used_at < now() - interval '1 minute');
  RETURN QUERY SELECT s.id, s.tenant_id FROM scim_token s WHERE s.token_hash = p_hash AND s.revoked_at IS NULL;
END $$;

ALTER FUNCTION app.sso_resolve_tenant(text) OWNER TO app_definer;
ALTER FUNCTION app.sso_tenant_by_domain(citext) OWNER TO app_definer;
ALTER FUNCTION app.sso_find_identity(text, text) OWNER TO app_definer;
ALTER FUNCTION app.sso_identity_of(uuid, text) OWNER TO app_definer;
ALTER FUNCTION app.sso_link_identity(uuid, text, text, uuid, text) OWNER TO app_definer;
ALTER FUNCTION app.sso_create_account(citext, text) OWNER TO app_definer;
ALTER FUNCTION app.sso_ensure_membership(uuid, uuid, text[], boolean) OWNER TO app_definer;
ALTER FUNCTION app.sso_link_tenant_persons(uuid, uuid) OWNER TO app_definer;
ALTER FUNCTION app.sso_person_left(uuid, uuid, citext) OWNER TO app_definer;
ALTER FUNCTION app.sso_password_blocked(uuid) OWNER TO app_definer;
ALTER FUNCTION app.scim_token_lookup(text) OWNER TO app_definer;
GRANT SELECT ON tenant_sso_config, sso_email_domain TO app_definer;
GRANT SELECT, INSERT, UPDATE ON account_identity TO app_definer;
GRANT SELECT, UPDATE ON scim_token TO app_definer;
