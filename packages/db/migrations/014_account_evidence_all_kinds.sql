-- 014 · Zusammenführung Phase 2:
--  - Online-Anrechnung nur aus Kampagnen (Termine/Live werden über attendance angerechnet, sonst doppelt)
--  - „Meine Nachweise“ (E-25) zeigt alle Arten: online, Präsenz/Live, extern

CREATE OR REPLACE VIEW app.completion_events_online WITH (security_invoker = true) AS
  SELECT i.tenant_id, i.person_id, r.training_id, NULL::uuid AS requirement_id,
         (i.completed_at AT TIME ZONE 'Europe/Berlin')::date AS completed_on, NULL::date AS valid_until,
         'online'::text AS source, i.id AS source_id
    FROM invitation i JOIN run r ON r.id = i.run_id
   WHERE i.status = 'bestaetigt' AND i.completed_at IS NOT NULL AND r.typ = 'kampagne';

DROP FUNCTION app.evidence_for_account(uuid);
CREATE FUNCTION app.evidence_for_account(p_account uuid)
RETURNS TABLE (invitation_id uuid, tenant_name text, training_titel text, version_no int, completed_at timestamptz,
               valid_until timestamptz, status text, nachweis_nr text, verify_code text, evidence_status text,
               kind text, record_id uuid, download_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  -- Online-Unterweisungen
  SELECT i.id, te.name, t.titel, v.version_no, i.completed_at,
         i.completed_at + make_interval(months => coalesce((t.settings->>'intervalMonths')::int, 12)),
         i.status, e.nachweis_nr, e.verify_code, e.status,
         'online'::text, i.id, '/api/me/invitations/' || i.id || '/evidence/pdf'
    FROM person p JOIN invitation i ON i.person_id = p.id JOIN run r ON r.id = i.run_id AND r.typ = 'kampagne'
    JOIN training t ON t.id = r.training_id JOIN training_version v ON v.id = r.training_version_id
    JOIN tenant te ON te.id = i.tenant_id LEFT JOIN evidence e ON e.invitation_id = i.id
   WHERE p.account_id = p_account
  UNION ALL
  -- Präsenz- und Live-Termine
  SELECT i.id, te.name, coalesce(r.titel, t.titel), NULL::int, a.confirmed_at,
         CASE WHEN t.id IS NULL OR a.confirmed_at IS NULL THEN NULL
              ELSE a.confirmed_at + make_interval(months => coalesce((t.settings->>'intervalMonths')::int, 12)) END,
         i.status, e.nachweis_nr, e.verify_code, e.status,
         CASE WHEN r.typ = 'termin' THEN 'praesenz' ELSE 'live' END, i.id,
         '/api/me/invitations/' || i.id || '/attendance/evidence/pdf'
    FROM person p JOIN invitation i ON i.person_id = p.id JOIN run r ON r.id = i.run_id AND r.typ IN ('termin','live_extern')
    LEFT JOIN training t ON t.id = r.training_id JOIN tenant te ON te.id = i.tenant_id
    LEFT JOIN attendance a ON a.invitation_id = i.id LEFT JOIN evidence e ON e.attendance_id = a.id
   WHERE p.account_id = p_account
  UNION ALL
  -- Externe Nachweise
  SELECT NULL::uuid, te.name, coalesce(t.titel, x.free_title), NULL::int, x.reviewed_at,
         x.valid_until::timestamptz,
         CASE WHEN x.status = 'freigegeben' THEN 'bestaetigt' ELSE x.status END,
         e.nachweis_nr, e.verify_code, e.status,
         'extern'::text, x.id, '/api/me/external-records/' || x.id || '/evidence/pdf'
    FROM person p JOIN external_record x ON x.person_id = p.id AND x.status IN ('freigegeben','abgelaufen')
    LEFT JOIN training t ON t.id = x.training_id JOIN tenant te ON te.id = x.tenant_id
    LEFT JOIN evidence e ON e.external_record_id = x.id AND e.revoked_at IS NULL
   WHERE p.account_id = p_account
  ORDER BY 5 DESC NULLS FIRST
$$;
ALTER FUNCTION app.evidence_for_account(uuid) OWNER TO app_definer;
GRANT SELECT ON attendance, external_record TO app_definer;
