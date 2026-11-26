-- 009 · „Meine Nachweise“: Teilnehmerkonto mit Personen verknüpfen, mandantenübergreifend nur eigene Daten (E-25)
-- Alle Funktionen prüfen selbst: E-Mail des Kontos bestätigt und identisch mit der E-Mail der Person.

CREATE OR REPLACE FUNCTION app.link_candidates(p_account uuid)
RETURNS TABLE (person_id uuid, person_name text, tenant_id uuid, tenant_name text, linked boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id, p.name, p.tenant_id, t.name, p.account_id IS NOT NULL
    FROM account a JOIN person p ON p.email = a.email JOIN tenant t ON t.id = p.tenant_id
   WHERE a.id = p_account AND a.email_verified_at IS NOT NULL AND (p.account_id IS NULL OR p.account_id = p_account)
   ORDER BY t.name
$$;

CREATE OR REPLACE FUNCTION app.link_persons(p_account uuid, p_person_ids uuid[])
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n int;
BEGIN
  UPDATE person p SET account_id = p_account
    FROM account a
   WHERE a.id = p_account AND a.email_verified_at IS NOT NULL AND p.email = a.email
     AND p.id = ANY (p_person_ids) AND p.account_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION app.unlink_account(p_account uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n int;
BEGIN
  UPDATE person SET account_id = NULL WHERE account_id = p_account;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Konto löschen: nur ohne Mitgliedschaften; Nachweise bleiben beim Mandanten (Aufbewahrung).
CREATE OR REPLACE FUNCTION app.auth_delete_account(p_account uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM membership WHERE account_id = p_account) THEN
    RAISE EXCEPTION 'HAS_MEMBERSHIPS' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE person SET account_id = NULL WHERE account_id = p_account;
  DELETE FROM account WHERE id = p_account;
END $$;

-- Nachweise aller verknüpften Personen
CREATE OR REPLACE FUNCTION app.evidence_for_account(p_account uuid)
RETURNS TABLE (invitation_id uuid, tenant_name text, training_titel text, version_no int, completed_at timestamptz,
               valid_until timestamptz, status text, nachweis_nr text, verify_code text, evidence_status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.id, te.name, t.titel, v.version_no, i.completed_at,
         i.completed_at + make_interval(months => coalesce((t.settings->>'intervalMonths')::int, 12)),
         i.status, e.nachweis_nr, e.verify_code, e.status
    FROM person p JOIN invitation i ON i.person_id = p.id JOIN run r ON r.id = i.run_id
    JOIN training t ON t.id = r.training_id JOIN training_version v ON v.id = r.training_version_id
    JOIN tenant te ON te.id = i.tenant_id LEFT JOIN evidence e ON e.invitation_id = i.id
   WHERE p.account_id = p_account
   ORDER BY i.completed_at DESC NULLS FIRST, i.due_at
$$;

ALTER FUNCTION app.link_candidates(uuid) OWNER TO app_definer;
ALTER FUNCTION app.link_persons(uuid, uuid[]) OWNER TO app_definer;
ALTER FUNCTION app.unlink_account(uuid) OWNER TO app_definer;
ALTER FUNCTION app.auth_delete_account(uuid) OWNER TO app_definer;
ALTER FUNCTION app.evidence_for_account(uuid) OWNER TO app_definer;
GRANT UPDATE (account_id) ON person TO app_definer;
GRANT DELETE ON account TO app_definer;
