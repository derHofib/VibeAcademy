-- 004 · Stammdaten (Personen, Org-Einheiten) und Schulungen mit Versionen, Seitenanalyse, Kapiteln, Fragenpool
-- Muster: jede Tabelle hat tenant_id + erzwungene RLS; Kindtabellen referenzieren (id, tenant_id) des Elternobjekts,
-- damit keine mandantenübergreifenden Verweise entstehen können (E-04).

-- ── Org-Einheiten ────────────────────────────────────────────
CREATE TABLE org_unit (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name              text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  parent_id         uuid,
  leiter_person_id  uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (parent_id, tenant_id) REFERENCES org_unit(id, tenant_id) ON DELETE SET NULL (parent_id)
);
SELECT app.enable_tenant_rls('org_unit');

-- ── Personen ─────────────────────────────────────────────────
CREATE TABLE person (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name                 text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  personalnr           text,
  email                citext CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  mobil                text,
  org_unit_id          uuid,
  extern               boolean NOT NULL DEFAULT false,
  birthdate_under18    boolean NOT NULL DEFAULT false,
  sprache              text NOT NULL DEFAULT 'de',
  austritt_am          date,
  -- Verlängerung der Mindestlesezeit (Barrierefreiheit), ≥ 1
  reading_time_factor  numeric(3,2) NOT NULL DEFAULT 1 CHECK (reading_time_factor BETWEEN 1 AND 5),
  -- Verknüpfung mit einem (mandantenunabhängigen) Konto, E-25
  account_id           uuid REFERENCES account(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (org_unit_id, tenant_id) REFERENCES org_unit(id, tenant_id) ON DELETE SET NULL (org_unit_id)
);
CREATE UNIQUE INDEX person_email_uq ON person(tenant_id, email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX person_personalnr_uq ON person(tenant_id, personalnr) WHERE personalnr IS NOT NULL;
CREATE INDEX person_account_idx ON person(account_id) WHERE account_id IS NOT NULL;
CREATE TRIGGER person_touch BEFORE UPDATE ON person FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
SELECT app.enable_tenant_rls('person');

ALTER TABLE org_unit ADD FOREIGN KEY (leiter_person_id, tenant_id) REFERENCES person(id, tenant_id)
  ON DELETE SET NULL (leiter_person_id);

-- Personen-IDs des angemeldeten Kontos bzw. der Link-Sitzung im aktiven Mandanten
CREATE OR REPLACE FUNCTION app.my_person_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id FROM person p
   WHERE p.tenant_id = app.tenant_id()
     AND ((app.account_id() IS NOT NULL AND p.account_id = app.account_id()) OR p.id = app.person_id())
$$;
-- Org-Einheiten (inkl. Unterbäume), die eine meiner Personen leitet → Sicht des Vorgesetzten
CREATE OR REPLACE FUNCTION app.led_org_units() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH RECURSIVE t AS (
    SELECT o.id FROM org_unit o
     WHERE o.tenant_id = app.tenant_id() AND o.leiter_person_id IN (SELECT app.my_person_ids())
    UNION
    SELECT c.id FROM org_unit c JOIN t ON c.parent_id = t.id WHERE c.tenant_id = app.tenant_id()
  ) SELECT id FROM t
$$;
ALTER FUNCTION app.my_person_ids() OWNER TO app_definer;
ALTER FUNCTION app.led_org_units() OWNER TO app_definer;
GRANT SELECT ON person, org_unit TO app_definer;

CREATE POLICY org_unit_read ON org_unit FOR SELECT USING (app.tenant_id() IS NOT NULL);
CREATE POLICY org_unit_write ON org_unit FOR ALL
  USING (app.has_any_role(ARRAY['admin','verantwortlich'])) WITH CHECK (app.has_any_role(ARRAY['admin','verantwortlich']));

CREATE POLICY person_staff ON person FOR ALL
  USING (app.has_any_role(ARRAY['admin','verantwortlich'])) WITH CHECK (app.has_any_role(ARRAY['admin','verantwortlich']));
CREATE POLICY person_read ON person FOR SELECT USING (
  app.has_role('auditor')
  OR id IN (SELECT app.my_person_ids())
  OR (app.has_role('vorgesetzter') AND org_unit_id IN (SELECT app.led_org_units()))
);

-- ── Schulungen ───────────────────────────────────────────────
CREATE TABLE training (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  titel            text NOT NULL CHECK (length(trim(titel)) BETWEEN 2 AND 300),
  kategorie        text,
  rechtsgrundlage  text,
  format           text NOT NULL DEFAULT 'online' CHECK (format IN ('online','praesenz','hybrid','extern')),
  quiz_required    boolean NOT NULL DEFAULT true,
  confirm_text     text NOT NULL DEFAULT '',
  -- t_floor, t_cap, f, v, strict_mode, pass_pct, max_attempts, quiz_count, completeness_pct, … (Zod-Schema in @sn/shared)
  settings         jsonb NOT NULL DEFAULT '{}'::jsonb,
  ansprechpartner  text,
  created_by       uuid DEFAULT app.account_id(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz,
  UNIQUE (id, tenant_id)
);
CREATE TRIGGER training_touch BEFORE UPDATE ON training FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
SELECT app.enable_tenant_rls('training');
CREATE POLICY training_read ON training FOR SELECT
  USING (app.has_any_role(ARRAY['admin','verantwortlich','trainer','vorgesetzter','auditor']));
CREATE POLICY training_write ON training FOR ALL
  USING (app.has_any_role(ARRAY['admin','verantwortlich'])) WITH CHECK (app.has_any_role(ARRAY['admin','verantwortlich']));

CREATE TABLE training_version (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  training_id     uuid NOT NULL,
  version_no      int NOT NULL CHECK (version_no > 0),
  status          text NOT NULL DEFAULT 'hochgeladen'
                  CHECK (status IN ('hochgeladen','analyse','bereit','fehler','veroeffentlicht')),
  file_key        text NOT NULL,
  file_name       text NOT NULL,
  file_size       bigint NOT NULL,
  sha256          text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  page_count      int,
  word_count      int,
  analysis_error  text,
  change_note     text,
  change_kind     text CHECK (change_kind IN ('redaktionell','inhaltlich')),
  changed_pages   int[],
  confirm_text    text,
  published_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  UNIQUE (training_id, version_no),
  FOREIGN KEY (training_id, tenant_id) REFERENCES training(id, tenant_id) ON DELETE CASCADE
);
SELECT app.enable_tenant_rls('training_version');

CREATE TABLE page_meta (
  tenant_id      uuid NOT NULL,
  version_id     uuid NOT NULL,
  page_no        int NOT NULL CHECK (page_no > 0),
  word_count     int NOT NULL CHECK (word_count >= 0),
  has_text       boolean NOT NULL,
  t_min_seconds  int NOT NULL CHECK (t_min_seconds > 0),
  t_min_manual   int CHECK (t_min_manual IS NULL OR t_min_manual > 0),
  title          text,
  page_key       text,
  thumb_key      text,
  PRIMARY KEY (version_id, page_no),
  FOREIGN KEY (version_id, tenant_id) REFERENCES training_version(id, tenant_id) ON DELETE CASCADE
);
SELECT app.enable_tenant_rls('page_meta');

CREATE TABLE chapter (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  version_id  uuid NOT NULL,
  idx         int NOT NULL,
  title       text NOT NULL,
  short_name  text NOT NULL CHECK (length(short_name) <= 24),
  from_page   int NOT NULL,
  to_page     int NOT NULL,
  source      text NOT NULL DEFAULT 'outline' CHECK (source IN ('outline','manuell')),
  CHECK (from_page <= to_page),
  UNIQUE (version_id, idx),
  FOREIGN KEY (version_id, tenant_id) REFERENCES training_version(id, tenant_id) ON DELETE CASCADE
);
SELECT app.enable_tenant_rls('chapter');

-- Versionen, Seiten, Kapitel: lesen wie training, schreiben admin/verantwortlich
CREATE POLICY tv_read ON training_version FOR SELECT
  USING (app.has_any_role(ARRAY['admin','verantwortlich','trainer','vorgesetzter','auditor']));
CREATE POLICY tv_write ON training_version FOR ALL
  USING (app.has_any_role(ARRAY['admin','verantwortlich','system'])) WITH CHECK (app.has_any_role(ARRAY['admin','verantwortlich','system']));
CREATE POLICY pm_read ON page_meta FOR SELECT
  USING (app.has_any_role(ARRAY['admin','verantwortlich','trainer','auditor']));
CREATE POLICY pm_write ON page_meta FOR ALL
  USING (app.has_any_role(ARRAY['admin','verantwortlich','system'])) WITH CHECK (app.has_any_role(ARRAY['admin','verantwortlich','system']));
CREATE POLICY ch_read ON chapter FOR SELECT
  USING (app.has_any_role(ARRAY['admin','verantwortlich','trainer','auditor']));
CREATE POLICY ch_write ON chapter FOR ALL
  USING (app.has_any_role(ARRAY['admin','verantwortlich','system'])) WITH CHECK (app.has_any_role(ARRAY['admin','verantwortlich','system']));

-- Veröffentlichte Versionen sind unveränderlich (inkl. Seiten und Kapitel).
CREATE OR REPLACE FUNCTION app.version_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_published timestamptz;
BEGIN
  IF TG_TABLE_NAME = 'training_version' THEN
    IF OLD.published_at IS NOT NULL THEN
      RAISE EXCEPTION 'Veröffentlichte Version ist unveränderlich';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.sha256 <> OLD.sha256 OR NEW.file_key <> OLD.file_key) THEN
      RAISE EXCEPTION 'Datei einer Version kann nicht ersetzt werden – neue Version anlegen';
    END IF;
  ELSE
    SELECT published_at INTO v_published FROM training_version WHERE id = coalesce(NEW.version_id, OLD.version_id);
    IF v_published IS NOT NULL THEN
      RAISE EXCEPTION 'Veröffentlichte Version ist unveränderlich';
    END IF;
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER tv_immutable BEFORE UPDATE OR DELETE ON training_version FOR EACH ROW EXECUTE FUNCTION app.version_immutable();
CREATE TRIGGER pm_immutable BEFORE INSERT OR UPDATE OR DELETE ON page_meta FOR EACH ROW EXECUTE FUNCTION app.version_immutable();
CREATE TRIGGER ch_immutable BEFORE INSERT OR UPDATE OR DELETE ON chapter FOR EACH ROW EXECUTE FUNCTION app.version_immutable();

-- ── Fragenpool ───────────────────────────────────────────────
CREATE TABLE quiz_question (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  training_id  uuid NOT NULL,
  text         text NOT NULL CHECK (length(trim(text)) BETWEEN 3 AND 1000),
  options      jsonb NOT NULL CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) BETWEEN 2 AND 6),
  correct      int NOT NULL CHECK (correct >= 0),
  explanation  text,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (correct < jsonb_array_length(options)),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (training_id, tenant_id) REFERENCES training(id, tenant_id) ON DELETE CASCADE
);
SELECT app.enable_tenant_rls('quiz_question');
-- Lösungen sehen nur Verantwortliche; Teilnehmer erhalten Fragen ausschließlich über die API (ohne „correct“).
CREATE POLICY qq_staff ON quiz_question FOR ALL
  USING (app.has_any_role(ARRAY['admin','verantwortlich'])) WITH CHECK (app.has_any_role(ARRAY['admin','verantwortlich']));
CREATE POLICY qq_auditor ON quiz_question FOR SELECT USING (app.has_role('auditor'));
