-- 020 · Phase 4.2: Live-Online und nachträgliche Erfassung (E-52 bis E-54)
--  - Live-Online als Variante des internen Termins (typ 'termin', delivery 'live_online') mit Plattform und Link
--  - Nachträglich erfasste Durchführung: Begründung, wer/wann; Zeiten aus Import (Teams-Bericht, CSV/XLSX)
--  - Bestätigung der Anwesenheitsliste durch den Dozenten statt je Person
--  - „Kombiniert“: Folge-Kampagne zur eigenen Bestätigung
--  - Belege/Importdateien je Durchführung

ALTER TABLE run
  ADD COLUMN delivery text CHECK (delivery IN ('praesenz','live_online')),
  ADD COLUMN platform text CHECK (platform IN ('teams','zoom','meet','sonstige')),
  ADD COLUMN meeting_url text CHECK (meeting_url IS NULL OR meeting_url ~ '^https://'),
  ADD COLUMN followup_required boolean NOT NULL DEFAULT false,
  ADD COLUMN followup_run_id uuid,
  ADD COLUMN backdated_at timestamptz,
  ADD COLUMN backdated_by uuid,
  ADD COLUMN backdated_by_name text,
  ADD COLUMN backdated_reason text;
ALTER TABLE run ADD CONSTRAINT run_backdated_reason
  CHECK (backdated_at IS NULL OR length(trim(coalesce(backdated_reason, ''))) >= 10);
ALTER TABLE run ADD CONSTRAINT run_delivery_termin CHECK (delivery IS NULL OR typ = 'termin');
ALTER TABLE run ADD CONSTRAINT run_followup_fk FOREIGN KEY (followup_run_id, tenant_id) REFERENCES run(id, tenant_id);
UPDATE run SET delivery = 'praesenz' WHERE typ = 'termin';

-- Import als Quelle von Anwesenheitszeiten; Bestätigung der Liste durch den Dozenten
ALTER TABLE attendance DROP CONSTRAINT attendance_check_in_method_check;
ALTER TABLE attendance ADD CONSTRAINT attendance_check_in_method_check CHECK (check_in_method IN ('qr_start','kiosk','trainer','import'));
ALTER TABLE attendance DROP CONSTRAINT attendance_check_out_method_check;
ALTER TABLE attendance ADD CONSTRAINT attendance_check_out_method_check
  CHECK (check_out_method IN ('qr_end','manual','official_end','kiosk','trainer','import'));
ALTER TABLE attendance DROP CONSTRAINT attendance_confirmed_via_check;
ALTER TABLE attendance ADD CONSTRAINT attendance_confirmed_via_check CHECK (confirmed_via IN ('selbst','kiosk','trainer'));
ALTER TABLE attendance_interval DROP CONSTRAINT attendance_interval_in_method_check;
ALTER TABLE attendance_interval ADD CONSTRAINT attendance_interval_in_method_check CHECK (in_method IN ('qr_start','kiosk','trainer','import'));
ALTER TABLE attendance_interval DROP CONSTRAINT attendance_interval_out_method_check;
ALTER TABLE attendance_interval ADD CONSTRAINT attendance_interval_out_method_check
  CHECK (out_method IN ('qr_end','manual','official_end','kiosk','trainer','import'));

-- Importdateien und Belege je Durchführung (Ablage wie bei externen Nachweisen)
CREATE TABLE run_document (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL DEFAULT app.tenant_id(),
  run_id        uuid NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('import','beleg')),
  file_key      text NOT NULL,
  file_name     text NOT NULL,
  content_type  text NOT NULL,
  size_bytes    int NOT NULL CHECK (size_bytes > 0),
  sha256        text NOT NULL,
  -- Import: erkanntes Format und Zeilen samt Zuordnungsvorschlag (für die Nachvollziehbarkeit)
  format        text,
  parsed        jsonb,
  applied_at    timestamptz,
  created_by    uuid DEFAULT app.account_id(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (run_id, tenant_id) REFERENCES run(id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX run_document_run_idx ON run_document(run_id);
SELECT app.enable_tenant_rls('run_document');
CREATE POLICY run_document_staff ON run_document FOR ALL
  USING (app.has_any_role(ARRAY['admin','verantwortlich','system','auditor']))
  WITH CHECK (app.has_any_role(ARRAY['admin','verantwortlich','system']));
