-- 010 · Nachweise für alle Arten (online, Präsenz/Live, extern) – Vorbereitung Phase 2
-- Genau ein Bezug je Nachweis; „subject“ hält die für die öffentliche Prüfung nötigen Angaben (ohne Klarnamen).

ALTER TABLE evidence ADD COLUMN attendance_id uuid UNIQUE;
ALTER TABLE evidence ADD COLUMN external_record_id uuid UNIQUE;
ALTER TABLE evidence ADD COLUMN subject jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE evidence ADD CONSTRAINT evidence_one_subject CHECK (num_nonnulls(invitation_id, attendance_id, external_record_id) = 1);

-- Bestehende Online-Nachweise nachtragen
UPDATE evidence e SET subject = jsonb_build_object(
    'titel', t.titel, 'version', v.version_no,
    'initialen', (SELECT string_agg(left(w, 1), '') || '.' FROM unnest(string_to_array(p.name, ' ')) w))
  FROM invitation i JOIN person p ON p.id = i.person_id JOIN run r ON r.id = i.run_id
  JOIN training t ON t.id = r.training_id JOIN training_version v ON v.id = r.training_version_id
 WHERE i.id = e.invitation_id AND e.subject = '{}'::jsonb;

-- Initialen ohne Klarnamen (für subject)
CREATE OR REPLACE FUNCTION app.initials(p_name text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT string_agg(left(w, 1), '') || '.' FROM unnest(string_to_array(trim(p_name), ' ')) w WHERE w <> ''
$$;

DROP FUNCTION app.verify_evidence(text);
CREATE FUNCTION app.verify_evidence(p_code text)
RETURNS TABLE (status text, nachweis_nr text, pdf_sha256 text, seal_ts timestamptz, training_titel text, version_no int,
               person_initialen text, tenant_name text, kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e.status, e.nachweis_nr, e.pdf_sha256, e.seal_ts, e.subject->>'titel', (e.subject->>'version')::int,
         e.subject->>'initialen', te.name, e.kind
    FROM evidence e JOIN tenant te ON te.id = e.tenant_id
   WHERE e.verify_code = upper(p_code)
$$;
ALTER FUNCTION app.verify_evidence(text) OWNER TO app_definer;
