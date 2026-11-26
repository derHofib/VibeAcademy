-- 003 · Mitglieder einladen (E-07) und Benachrichtigungs-Outbox (E-12)

-- Admin fügt Kollegen hinzu. Legt bei Bedarf ein Konto ohne Passwort an (Passwort setzt der Kollege per Link).
-- SECURITY DEFINER (BYPASSRLS) → Berechtigung wird hier explizit geprüft.
CREATE OR REPLACE FUNCTION app.admin_add_member(p_email citext, p_display_name text, p_roles text[])
RETURNS TABLE (account_id uuid, created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid := app.tenant_id(); v_account uuid; v_created boolean := false;
BEGIN
  IF v_tenant IS NULL OR NOT app.has_role('admin') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT a.id INTO v_account FROM account a WHERE a.email = p_email;
  IF v_account IS NULL THEN
    INSERT INTO account (email, display_name) VALUES (p_email, p_display_name) RETURNING id INTO v_account;
    v_created := true;
  END IF;
  IF EXISTS (SELECT 1 FROM membership m WHERE m.tenant_id = v_tenant AND m.account_id = v_account) THEN
    RAISE EXCEPTION 'ALREADY_MEMBER' USING ERRCODE = 'unique_violation';
  END IF;
  INSERT INTO membership (tenant_id, account_id, roles) VALUES (v_tenant, v_account, p_roles);
  RETURN QUERY SELECT v_account, v_created;
END $$;
ALTER FUNCTION app.admin_add_member(citext, text, text[]) OWNER TO app_definer;

-- Outbox: jede Nachricht wird hier protokolliert und von einem Job versendet.
-- Geheime Inhalte (OTP-Codes, Links mit Token) stehen NICHT hier, sondern kurzlebig in Redis (secret_ref).
CREATE TABLE notification (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid REFERENCES tenant(id) ON DELETE CASCADE,
  account_id           uuid REFERENCES account(id) ON DELETE SET NULL,
  channel              text NOT NULL CHECK (channel IN ('mail', 'sms', 'push')),
  recipient            text NOT NULL,
  template             text NOT NULL,
  data                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  has_secret           boolean NOT NULL DEFAULT false,
  status               text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed')),
  attempts             int NOT NULL DEFAULT 0,
  last_error           text,
  provider             text,
  provider_message_id  text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  sent_at              timestamptz
);
CREATE INDEX notification_status_idx ON notification(status, created_at);
ALTER TABLE notification ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification FORCE ROW LEVEL SECURITY;
-- Mandantennachrichten im Mandantenkontext; mandantenlose (z. B. Teilnehmerkonto) nur für den Systemkontext.
CREATE POLICY notification_access ON notification
  USING ((tenant_id IS NOT NULL AND tenant_id = app.tenant_id()) OR (tenant_id IS NULL AND app.has_role('system')))
  WITH CHECK ((tenant_id IS NOT NULL AND tenant_id = app.tenant_id()) OR (tenant_id IS NULL AND app.has_role('system')));

-- Für den Sweeper-Job: noch nicht versendete Nachrichten aller Mandanten (nur IDs).
CREATE OR REPLACE FUNCTION app.notification_pending(p_older_than interval, p_limit int)
RETURNS TABLE (id uuid, tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT n.id, n.tenant_id FROM notification n
   WHERE n.status IN ('queued', 'failed') AND n.attempts < 5 AND n.created_at < now() - p_older_than
   ORDER BY n.created_at LIMIT p_limit
$$;
ALTER FUNCTION app.notification_pending(interval, int) OWNER TO app_definer;
GRANT SELECT ON notification TO app_definer;
