-- 021 · Phase 4.2: Prüfseite zeigt Durchführungsart, tatsächliches Datum und „nachträglich erfasst“ (E-53)
DROP FUNCTION app.verify_evidence(text);
CREATE FUNCTION app.verify_evidence(p_code text)
RETURNS TABLE (status text, nachweis_nr text, pdf_sha256 text, seal_ts timestamptz, training_titel text, version_no int,
               person_initialen text, tenant_name text, kind text, details jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN e.revoked_at IS NOT NULL THEN 'widerrufen' ELSE e.status END,
         e.nachweis_nr, e.pdf_sha256, e.seal_ts, e.subject->>'titel', (e.subject->>'version')::int,
         e.subject->>'initialen', te.name, e.kind,
         jsonb_strip_nulls(jsonb_build_object('art', e.subject->'art', 'datum', e.subject->'datum', 'erfassung', e.subject->'erfassung'))
    FROM evidence e JOIN tenant te ON te.id = e.tenant_id
   WHERE e.verify_code = upper(p_code)
$$;
ALTER FUNCTION app.verify_evidence(text) OWNER TO app_definer;
