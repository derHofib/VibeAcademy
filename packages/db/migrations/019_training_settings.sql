-- 019 · Phase 4.1: Einstellungen je Schulung (E-51)
--  - Anlass (Erst-/Wiederholungs-/anlassbezogene Unterweisung, Sonstige) mit Freitext
--  - Standard-Durchführungsart, Plattform/Link für Live-Online, Standard-Zielgruppe (Org-Einheiten)
--  - Schnappschuss der Schulungsdaten je Durchführung: spätere Änderungen verändern laufende Einladungen
--    und daraus erzeugte Nachweise nicht.

ALTER TABLE training
  ADD COLUMN anlass_typ text NOT NULL DEFAULT 'erst' CHECK (anlass_typ IN ('erst','wiederholung','anlass','sonstige')),
  ADD COLUMN anlass_text text CHECK (anlass_text IS NULL OR length(anlass_text) <= 2000),
  ADD COLUMN default_delivery text NOT NULL DEFAULT 'online'
    CHECK (default_delivery IN ('online','praesenz','live_online','extern','kombiniert')),
  ADD COLUMN default_platform text CHECK (default_platform IN ('teams','zoom','meet','sonstige')),
  ADD COLUMN default_meeting_url text CHECK (default_meeting_url IS NULL OR default_meeting_url ~ '^https://'),
  ADD COLUMN default_org_units uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE training ADD CONSTRAINT training_anlass_text_required
  CHECK (anlass_typ <> 'anlass' OR length(trim(coalesce(anlass_text, ''))) >= 3);

-- Bestand: Durchführungsart aus dem bisherigen Format ableiten
UPDATE training SET default_delivery = CASE format WHEN 'praesenz' THEN 'praesenz' WHEN 'hybrid' THEN 'kombiniert' WHEN 'extern' THEN 'extern' ELSE 'online' END;

-- Schnappschuss je Durchführung (Titel, Rechtsgrundlage, Ansprechpartner, Anlass, Einstellungen)
ALTER TABLE run
  ADD COLUMN training_snapshot jsonb,
  ADD COLUMN settings_snapshot jsonb;

CREATE OR REPLACE FUNCTION app.run_snapshot_training() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t record;
BEGIN
  IF NEW.training_snapshot IS NULL OR NEW.settings_snapshot IS NULL THEN
    SELECT tr.titel, tr.kategorie, tr.rechtsgrundlage, tr.ansprechpartner, tr.format, tr.quiz_required,
           tr.anlass_typ, tr.anlass_text, tr.default_delivery, tr.settings
      INTO t FROM training tr WHERE tr.id = NEW.training_id AND tr.tenant_id = NEW.tenant_id;
    IF FOUND THEN
      NEW.training_snapshot := coalesce(NEW.training_snapshot, jsonb_build_object(
        'titel', t.titel, 'kategorie', t.kategorie, 'rechtsgrundlage', t.rechtsgrundlage,
        'ansprechpartner', t.ansprechpartner, 'format', t.format, 'quiz_required', t.quiz_required,
        'anlass_typ', t.anlass_typ, 'anlass_text', t.anlass_text, 'delivery', t.default_delivery));
      NEW.settings_snapshot := coalesce(NEW.settings_snapshot, t.settings);
    END IF;
  END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION app.run_snapshot_training() OWNER TO app_definer;
GRANT SELECT ON training TO app_definer;
CREATE TRIGGER run_snapshot BEFORE INSERT ON run FOR EACH ROW EXECUTE FUNCTION app.run_snapshot_training();

-- Bestand: laufende Durchführungen frieren den heutigen Stand ein
UPDATE run r SET training_snapshot = jsonb_build_object(
    'titel', t.titel, 'kategorie', t.kategorie, 'rechtsgrundlage', t.rechtsgrundlage, 'ansprechpartner', t.ansprechpartner,
    'format', t.format, 'quiz_required', t.quiz_required, 'anlass_typ', t.anlass_typ, 'anlass_text', t.anlass_text,
    'delivery', t.default_delivery),
  settings_snapshot = t.settings
  FROM training t WHERE t.id = r.training_id AND r.training_snapshot IS NULL;
