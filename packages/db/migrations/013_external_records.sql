-- 013 · Externe Nachweise (SPEZIFIKATION 3, 4.7; PLAN 2.6/2.7; E-18) und Widerruf von Nachweisen
-- Drei Wege: Verwaltung erfasst (einzeln/Gruppe, gilt sofort), Mitarbeiter reicht mobil ein (OCR-Vorschlag), Import (CSV + ZIP).

CREATE TABLE external_record (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  person_id            uuid NOT NULL,
  -- gemeinsame Erfassung (Gruppe, Papierliste, Import-Lauf): wird in der Prüfansicht als ein Vorgang gezeigt
  group_id             uuid,
  -- Zuordnung zur Pflichtschulung (Anforderung) bzw. Katalog-Schulung/Qualifikation; ohne Zuordnung = nur Dokumentation
  requirement_id       uuid,
  qualification_id     uuid,
  training_id          uuid,
  free_title           text CHECK (free_title IS NULL OR length(free_title) <= 300),
  provider             text CHECK (provider IS NULL OR length(provider) <= 300),
  held_on              date,
  duration_hours       numeric(6,2) CHECK (duration_hours IS NULL OR duration_hours > 0),
  duration_label       text CHECK (duration_label IS NULL OR length(duration_label) <= 100),
  location             text CHECK (location IS NULL OR length(location) <= 300),
  valid_until          date,
  -- arbeitsmedizinische Vorsorge: nur Teilnahme und Datum, keine Befunde (keine OCR, kein Freitext)
  is_medical           boolean NOT NULL DEFAULT false,
  -- Belege (Objektspeicher „uploads“) – Schlüssel, SHA-256 und Metadaten [{name, mime, size, pages}]
  evidence_keys        text[] NOT NULL DEFAULT '{}',
  evidence_sha256      text[] NOT NULL DEFAULT '{}',
  evidence_files       jsonb NOT NULL DEFAULT '[]'::jsonb,
  source               text NOT NULL CHECK (source IN ('verwaltung','selbst','import')),
  status               text NOT NULL DEFAULT 'entwurf'
                       CHECK (status IN ('entwurf','eingereicht','freigegeben','zurueckgegeben','abgelaufen','widerrufen')),
  ocr_status           text NOT NULL DEFAULT 'keine' CHECK (ocr_status IN ('keine','ausstehend','fertig','fehler')),
  -- Vorschläge der Texterkennung (nur Vorschlag, E-18): {fields:{course,name,date,provider,duration}, nameMatches, pages:[…]}
  ocr_fields           jsonb,
  -- manuelle Prüfhinweise, z. B. [{"code":"unterschrift_unleserlich","note":"Zeile 2"}]
  flags                jsonb NOT NULL DEFAULT '[]'::jsonb,
  submitted_by         uuid DEFAULT app.account_id(),
  submitted_by_person  uuid,
  submitted_at         timestamptz,
  reviewed_by          uuid,
  reviewed_at          timestamptz,
  review_note          text,
  -- nach „Rückgängig“: neuer Datensatz verweist auf den widerrufenen
  supersedes           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  CHECK (cardinality(evidence_keys) = cardinality(evidence_sha256)),
  CHECK (status IN ('entwurf','zurueckgegeben') OR training_id IS NOT NULL OR length(trim(coalesce(free_title, ''))) > 0),
  CHECK (status NOT IN ('freigegeben','abgelaufen') OR held_on IS NOT NULL),
  FOREIGN KEY (person_id, tenant_id) REFERENCES person(id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (requirement_id, tenant_id) REFERENCES requirement(id, tenant_id) ON DELETE SET NULL (requirement_id),
  FOREIGN KEY (qualification_id, tenant_id) REFERENCES qualification(id, tenant_id) ON DELETE SET NULL (qualification_id),
  FOREIGN KEY (training_id, tenant_id) REFERENCES training(id, tenant_id) ON DELETE SET NULL (training_id),
  FOREIGN KEY (supersedes, tenant_id) REFERENCES external_record(id, tenant_id)
);
CREATE INDEX external_record_person_idx ON external_record(person_id);
CREATE INDEX external_record_status_idx ON external_record(tenant_id, status);
CREATE INDEX external_record_group_idx ON external_record(group_id) WHERE group_id IS NOT NULL;
CREATE TRIGGER external_record_touch BEFORE UPDATE ON external_record FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
SELECT app.enable_tenant_rls('external_record');

CREATE POLICY ext_staff ON external_record FOR ALL
  USING (app.has_any_role(ARRAY['admin','verantwortlich','system'])) WITH CHECK (app.has_any_role(ARRAY['admin','verantwortlich','system']));
CREATE POLICY ext_read ON external_record FOR SELECT USING (
  app.has_role('auditor')
  OR person_id IN (SELECT app.my_person_ids())
  OR (app.has_role('vorgesetzter') AND person_id IN (SELECT p.id FROM person p WHERE p.org_unit_id IN (SELECT app.led_org_units())))
);
-- Vorgesetzte dürfen selbst eingereichte Nachweise ihres Teams freigeben/zurückgeben (SPEZIFIKATION 2) – nie eigene.
CREATE POLICY ext_supervisor_review ON external_record FOR UPDATE
  USING (app.has_role('vorgesetzter') AND source = 'selbst'
         AND person_id IN (SELECT p.id FROM person p WHERE p.org_unit_id IN (SELECT app.led_org_units()))
         AND person_id NOT IN (SELECT app.my_person_ids()))
  WITH CHECK (app.has_role('vorgesetzter') AND source = 'selbst'
         AND person_id IN (SELECT p.id FROM person p WHERE p.org_unit_id IN (SELECT app.led_org_units()))
         AND person_id NOT IN (SELECT app.my_person_ids()));

-- Hochgeladene Belege der Verwaltung, bevor sie einem Nachweis zugeordnet werden (Screen 9: „✓ hochgeladen“)
CREATE TABLE external_upload (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  key         text NOT NULL,
  sha256      text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  name        text NOT NULL,
  mime        text NOT NULL CHECK (mime IN ('application/pdf','image/jpeg','image/png')),
  size        bigint NOT NULL,
  pages       int NOT NULL DEFAULT 1,
  created_by  uuid DEFAULT app.account_id(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id)
);
SELECT app.enable_tenant_rls('external_upload');
CREATE POLICY eu_staff ON external_upload FOR ALL
  USING (app.has_any_role(ARRAY['admin','verantwortlich','system'])) WITH CHECK (app.has_any_role(ARRAY['admin','verantwortlich','system']));

-- Nachweis-FK für externe Nachweise und Sicht des Mitarbeiters auf eigene externe Nachweise
ALTER TABLE evidence ADD CONSTRAINT evidence_external_record_fk
  FOREIGN KEY (external_record_id, tenant_id) REFERENCES external_record(id, tenant_id) ON DELETE RESTRICT;
CREATE POLICY ev_read_external ON evidence FOR SELECT USING (
  external_record_id IN (SELECT x.id FROM external_record x WHERE x.person_id IN (SELECT app.my_person_ids())));

-- ── Widerruf (Rückgängig nach Freigabe): Nachweis bleibt erhalten, gilt aber nicht mehr ──
ALTER TABLE evidence ADD COLUMN revoked_at timestamptz;
ALTER TABLE evidence ADD COLUMN revoked_reason text;
CREATE OR REPLACE FUNCTION app.evidence_revoke_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoked_reason IS DISTINCT FROM OLD.revoked_reason) THEN
    RAISE EXCEPTION 'Widerruf ist unveränderlich';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER evidence_revoke_once BEFORE UPDATE ON evidence FOR EACH ROW EXECUTE FUNCTION app.evidence_revoke_once();

DROP FUNCTION app.verify_evidence(text);
CREATE FUNCTION app.verify_evidence(p_code text)
RETURNS TABLE (status text, nachweis_nr text, pdf_sha256 text, seal_ts timestamptz, training_titel text, version_no int,
               person_initialen text, tenant_name text, kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN e.revoked_at IS NOT NULL THEN 'widerrufen' ELSE e.status END,
         e.nachweis_nr, e.pdf_sha256, e.seal_ts, e.subject->>'titel', (e.subject->>'version')::int,
         e.subject->>'initialen', te.name, e.kind
    FROM evidence e JOIN tenant te ON te.id = e.tenant_id
   WHERE e.verify_code = upper(p_code)
$$;
ALTER FUNCTION app.verify_evidence(text) OWNER TO app_definer;

-- ── Erweiterungspunkte aus 011 mit externen Nachweisen füllen ──
CREATE OR REPLACE VIEW app.completion_events_external WITH (security_invoker = true) AS
  SELECT x.tenant_id, x.person_id, x.training_id, x.requirement_id, x.held_on AS completed_on, x.valid_until,
         'extern'::text AS source, x.id AS source_id
    FROM external_record x
   WHERE x.status IN ('freigegeben','abgelaufen') AND x.held_on IS NOT NULL;

CREATE OR REPLACE VIEW app.evidence_index_external WITH (security_invoker = true) AS
  SELECT e.id AS evidence_id, e.tenant_id, x.person_id, x.training_id,
         coalesce(t.titel, x.free_title) AS titel, e.kind, x.held_on AS completed_on
    FROM evidence e JOIN external_record x ON x.id = e.external_record_id LEFT JOIN training t ON t.id = x.training_id;

-- ── Mitarbeiter reicht mit seinem Konto ein (E-25): verknüpfte Personen über alle Mandanten ──
CREATE OR REPLACE FUNCTION app.external_targets(p_account uuid)
RETURNS TABLE (person_id uuid, person_name text, tenant_id uuid, tenant_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id, p.name, p.tenant_id, t.name FROM person p JOIN tenant t ON t.id = p.tenant_id
   WHERE p.account_id = p_account AND (p.austritt_am IS NULL OR p.austritt_am > current_date)
   ORDER BY t.name, p.name
$$;
ALTER FUNCTION app.external_targets(uuid) OWNER TO app_definer;

-- Teilnehmer sehen Titel der Schulungen, die ihren eigenen externen Nachweisen zugeordnet sind
CREATE POLICY training_external_own ON training FOR SELECT USING (
  id IN (SELECT x.training_id FROM external_record x WHERE x.person_id IN (SELECT app.my_person_ids())));

-- Systemkontext (Nachweis, OCR) liest Qualifikationen/Anforderungen (bereits in 011) und Konten-Namen der Prüfer
GRANT SELECT ON external_record TO app_definer;
