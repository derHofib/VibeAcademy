-- 016 · Öffentliche REST-API (/api/v1) mit API-Schlüsseln und Webhooks (PLAN 3.2, E-37)
--
-- API-Schlüssel: je Mandant, nur SHA-256 des Geheimnisses gespeichert, Scopes. Ein Request mit Schlüssel läuft im
-- Mandantenkontext mit den Rollen „api“ + je Scope einer eigenen Rolle (z. B. api_persons_read). Die Policies unten
-- geben diesen Rollen genau die Lesezugriffe, die der Scope erlaubt (least privilege). Schreibende Abläufe und die
-- Pflichtmatrix laufen nach der Scope-Prüfung in der API im Systemkontext (wie Teilnehmer-Schreibzugriffe, E-27).
--
-- Webhooks: Outbox-Muster (E-12) – Ereignisse werden in der fachlichen Transaktion über app.webhook_emit()
-- eingetragen (SECURITY DEFINER, prüft den Mandantenkontext), ein Poller in der API reiht fällige Zustellungen in
-- BullMQ ein. Nutzlast enthält nur IDs und Status, keine Personendaten (E-37).

-- ── Externe Kennung der Person (Filter externalId). Normalerweise bereits durch 015 (SCIM) angelegt. ──
ALTER TABLE person ADD COLUMN IF NOT EXISTS external_id text CHECK (external_id IS NULL OR length(external_id) BETWEEN 1 AND 255);
CREATE UNIQUE INDEX IF NOT EXISTS person_external_id_uq ON person(tenant_id, external_id) WHERE external_id IS NOT NULL;

-- ── Änderungszeitpunkt der Einladung (Filter updatedSince) ──
ALTER TABLE invitation ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE TRIGGER invitation_touch BEFORE UPDATE ON invitation FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE INDEX invitation_updated_idx ON invitation(tenant_id, updated_at, id);
CREATE INDEX person_updated_idx ON person(tenant_id, updated_at, id);
CREATE INDEX external_record_updated_idx ON external_record(tenant_id, updated_at, id);

-- ── API-Schlüssel ────────────────────────────────────────────
CREATE TABLE api_key (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  -- öffentlicher Teil des Schlüssels sn_live_<prefix>_<secret>; mandantenübergreifend eindeutig (Suche beim Login)
  prefix        text NOT NULL UNIQUE CHECK (prefix ~ '^[a-z0-9]{12}$'),
  -- SHA-256 (hex) des Geheimnisses (32 Zufallsbytes) – das Geheimnis selbst wird nur einmal angezeigt
  secret_hash   text NOT NULL CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  scopes        text[] NOT NULL CHECK (
                  cardinality(scopes) > 0 AND scopes <@ ARRAY['persons:read','persons:write','trainings:read','runs:read','runs:write',
                    'evidence:read','external:read','external:write','compliance:read','webhooks:manage']),
  created_by    uuid DEFAULT app.account_id(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  expires_at    timestamptz,
  revoked_at    timestamptz,
  revoked_by    uuid
);
CREATE INDEX api_key_tenant_idx ON api_key(tenant_id, created_at);
SELECT app.enable_tenant_rls('api_key');
CREATE POLICY api_key_admin ON api_key FOR ALL USING (app.has_role('admin')) WITH CHECK (app.has_role('admin'));
-- Der Hash ist für die Laufzeitrolle nicht lesbar (nur schreibbar beim Anlegen).
REVOKE ALL ON api_key FROM app_user;
GRANT SELECT (id, tenant_id, name, prefix, scopes, created_by, created_at, last_used_at, expires_at, revoked_at, revoked_by) ON api_key TO app_user;
GRANT INSERT (tenant_id, name, prefix, secret_hash, scopes, created_by, expires_at) ON api_key TO app_user;
GRANT UPDATE (name, revoked_at, revoked_by) ON api_key TO app_user;

-- Anmeldung mit Schlüssel (ohne Mandantenkontext): Präfix + Hash rein, Kontext raus. Aktualisiert last_used_at (gedrosselt).
CREATE OR REPLACE FUNCTION app.api_key_authenticate(p_prefix text, p_hash text)
RETURNS TABLE (id uuid, tenant_id uuid, name text, scopes text[], revoked boolean, expired boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE k api_key%ROWTYPE;
BEGIN
  SELECT * INTO k FROM api_key a WHERE a.prefix = p_prefix AND a.secret_hash = p_hash;
  IF NOT FOUND THEN RETURN; END IF;
  IF k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > now())
     AND (k.last_used_at IS NULL OR k.last_used_at < now() - interval '1 minute') THEN
    UPDATE api_key a SET last_used_at = now() WHERE a.id = k.id;
  END IF;
  RETURN QUERY SELECT k.id, k.tenant_id, k.name, k.scopes, k.revoked_at IS NOT NULL, (k.expires_at IS NOT NULL AND k.expires_at <= now());
END $$;
ALTER FUNCTION app.api_key_authenticate(text, text) OWNER TO app_definer;
GRANT SELECT, UPDATE ON api_key TO app_definer;

-- ── Lesezugriffe je Scope (permissiv; die Mandantentrennung bleibt als RESTRICTIVE-Policy bestehen) ──
CREATE POLICY person_api_read ON person FOR SELECT USING (app.has_any_role(ARRAY['api_persons_read','api_persons_write']));
CREATE POLICY person_api_insert ON person FOR INSERT WITH CHECK (app.has_role('api_persons_write'));
CREATE POLICY person_api_update ON person FOR UPDATE USING (app.has_role('api_persons_write')) WITH CHECK (app.has_role('api_persons_write'));
CREATE POLICY training_api_read ON training FOR SELECT USING (app.has_role('api_trainings_read'));
CREATE POLICY tv_api_read ON training_version FOR SELECT USING (app.has_role('api_trainings_read'));
CREATE POLICY run_api_read ON run FOR SELECT USING (app.has_role('api_runs_read'));
CREATE POLICY inv_api_read ON invitation FOR SELECT USING (app.has_role('api_runs_read'));
CREATE POLICY ev_api_read ON evidence FOR SELECT USING (app.has_role('api_evidence_read'));
CREATE POLICY ext_api_read ON external_record FOR SELECT USING (app.has_role('api_external_read'));
CREATE POLICY qual_api_read ON qualification FOR SELECT USING (app.has_role('api_compliance_read'));
CREATE POLICY req_api_read ON requirement FOR SELECT USING (app.has_role('api_compliance_read'));

-- Person eines Nachweises (über Einladung, Anwesenheit oder externen Nachweis) – nur die ID, nur im aktiven Mandanten.
-- Damit braucht „evidence:read“ keinen Lesezugriff auf Einladungen/Anwesenheiten.
CREATE OR REPLACE FUNCTION app.evidence_person_id(p_evidence uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(i.person_id, a.person_id, x.person_id)
    FROM evidence e
    LEFT JOIN invitation i ON i.id = e.invitation_id
    LEFT JOIN attendance a ON a.id = e.attendance_id
    LEFT JOIN external_record x ON x.id = e.external_record_id
   WHERE e.id = p_evidence AND e.tenant_id = app.tenant_id()
$$;
ALTER FUNCTION app.evidence_person_id(uuid) OWNER TO app_definer;
GRANT SELECT ON evidence, invitation, attendance, external_record TO app_definer;

-- ── Webhooks ─────────────────────────────────────────────────
CREATE TABLE webhook_endpoint (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  url              text NOT NULL CHECK (url ~ '^https?://' AND length(url) <= 2000),
  description      text CHECK (description IS NULL OR length(description) <= 200),
  -- AES-256-GCM, Schlüssel aus HMAC_MASTER_SECRET abgeleitet (v1:<iv>:<tag>:<ciphertext>)
  secret_enc       text NOT NULL,
  events           text[] NOT NULL CHECK (cardinality(events) > 0 AND events <@ ARRAY['invitation.completed','evidence.created',
                     'external_record.approved','attendance.confirmed','compliance.state_changed']),
  active           boolean NOT NULL DEFAULT true,
  -- Fehlversuche in Folge; bei Erreichen der Grenze wird der Endpunkt deaktiviert
  failure_count    int NOT NULL DEFAULT 0,
  disabled_at      timestamptz,
  disabled_reason  text,
  last_success_at  timestamptz,
  last_failure_at  timestamptz,
  created_by       uuid DEFAULT app.account_id(),
  created_by_key   uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id)
);
CREATE TRIGGER webhook_endpoint_touch BEFORE UPDATE ON webhook_endpoint FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
SELECT app.enable_tenant_rls('webhook_endpoint');
CREATE POLICY whe_manage ON webhook_endpoint FOR ALL
  USING (app.has_any_role(ARRAY['admin','api_webhooks_manage','system']))
  WITH CHECK (app.has_any_role(ARRAY['admin','api_webhooks_manage','system']));

-- Ereignis (einmal je fachlichem Vorgang, dedup_key verhindert Doppelte). data: nur IDs und Status.
CREATE TABLE webhook_event (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  type        text NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedup_key   text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  UNIQUE (tenant_id, dedup_key)
);
SELECT app.enable_tenant_rls('webhook_event');
CREATE POLICY whv_read ON webhook_event FOR SELECT USING (app.has_any_role(ARRAY['admin','api_webhooks_manage','system']));

-- Zustellung je Ereignis × Endpunkt (Zustellprotokoll). Die ID ist der Idempotenzschlüssel (Header Schulungsnachweis-Delivery).
CREATE TABLE webhook_delivery (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  endpoint_id      uuid NOT NULL,
  event_id         uuid NOT NULL,
  event_type       text NOT NULL,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','succeeded','failed')),
  attempts         int NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  last_attempt_at  timestamptz,
  response_code    int,
  last_error       text,
  duration_ms      int,
  delivered_at     timestamptz,
  redelivery_of    uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (endpoint_id, tenant_id) REFERENCES webhook_endpoint(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (event_id, tenant_id) REFERENCES webhook_event(id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX webhook_delivery_due_idx ON webhook_delivery(next_attempt_at) WHERE status IN ('pending','sending');
CREATE INDEX webhook_delivery_endpoint_idx ON webhook_delivery(endpoint_id, created_at DESC);
SELECT app.enable_tenant_rls('webhook_delivery');
CREATE POLICY whd_manage ON webhook_delivery FOR ALL
  USING (app.has_any_role(ARRAY['admin','api_webhooks_manage','system']))
  WITH CHECK (app.has_any_role(ARRAY['admin','api_webhooks_manage','system']));

-- Hat der aktive Mandant einen aktiven Endpunkt für diesen Ereignistyp? (vor dem Zusammenstellen der Nutzlast)
CREATE OR REPLACE FUNCTION app.webhook_subscribed(p_type text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM webhook_endpoint e WHERE e.tenant_id = app.tenant_id() AND e.active AND p_type = ANY (e.events))
$$;

-- Ereignis eintragen und Zustellungen für alle passenden Endpunkte anlegen (in der fachlichen Transaktion).
-- p_endpoint: nur an diesen Endpunkt (test.ping, auch wenn inaktiv). Liefert die Ereignis-ID oder NULL (kein Empfänger/Duplikat).
CREATE OR REPLACE FUNCTION app.webhook_emit(p_tenant uuid, p_type text, p_data jsonb, p_dedup text, p_endpoint uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_event uuid;
BEGIN
  IF p_tenant IS NULL OR p_tenant IS DISTINCT FROM app.tenant_id() THEN
    RAISE EXCEPTION 'webhook_emit: Mandant muss dem aktiven Mandanten entsprechen';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM webhook_endpoint e WHERE e.tenant_id = p_tenant
                   AND ((p_endpoint IS NULL AND e.active AND p_type = ANY (e.events)) OR e.id = p_endpoint)) THEN
    RETURN NULL;
  END IF;
  INSERT INTO webhook_event (tenant_id, type, data, dedup_key) VALUES (p_tenant, p_type, p_data, p_dedup)
    ON CONFLICT (tenant_id, dedup_key) DO NOTHING RETURNING id INTO v_event;
  IF v_event IS NULL THEN RETURN NULL; END IF;
  INSERT INTO webhook_delivery (tenant_id, endpoint_id, event_id, event_type)
    SELECT p_tenant, e.id, v_event, p_type FROM webhook_endpoint e
     WHERE e.tenant_id = p_tenant AND ((p_endpoint IS NULL AND e.active AND p_type = ANY (e.events)) OR e.id = p_endpoint);
  RETURN v_event;
END $$;

-- Poller: fällige Zustellungen aller Mandanten beanspruchen (nur IDs). Hängengebliebene „sending“ nach 5 min erneut.
CREATE OR REPLACE FUNCTION app.webhook_claim_due(p_limit int)
RETURNS TABLE (id uuid, tenant_id uuid, attempts int)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE webhook_delivery d SET status = 'sending', attempts = d.attempts + 1, last_attempt_at = now()
   WHERE d.id IN (
     SELECT x.id FROM webhook_delivery x JOIN webhook_endpoint e ON e.id = x.endpoint_id
      WHERE ((x.status = 'pending' AND x.next_attempt_at <= now())
             OR (x.status = 'sending' AND x.last_attempt_at < now() - interval '5 minutes'))
        AND (e.active OR x.event_type = 'test.ping')
      ORDER BY x.next_attempt_at LIMIT p_limit
      FOR UPDATE OF x SKIP LOCKED)
  RETURNING d.id, d.tenant_id, d.attempts
$$;

-- Aufräumen: Zustellprotokoll und Ereignisse nach p_keep löschen.
CREATE OR REPLACE FUNCTION app.webhook_cleanup(p_keep interval) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n int;
BEGIN
  DELETE FROM webhook_event v WHERE v.created_at < now() - p_keep
     AND NOT EXISTS (SELECT 1 FROM webhook_delivery d WHERE d.event_id = v.id AND d.status IN ('pending','sending'));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

ALTER FUNCTION app.webhook_subscribed(text) OWNER TO app_definer;
ALTER FUNCTION app.webhook_emit(uuid, text, jsonb, text, uuid) OWNER TO app_definer;
ALTER FUNCTION app.webhook_claim_due(int) OWNER TO app_definer;
ALTER FUNCTION app.webhook_cleanup(interval) OWNER TO app_definer;
GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_endpoint, webhook_event, webhook_delivery TO app_definer;

-- ── Letzter Stand der Pflichtmatrix je Person × Anforderung (für compliance.state_changed aus dem Fristen-Job) ──
CREATE TABLE compliance_snapshot (
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  person_id       uuid NOT NULL,
  requirement_id  uuid NOT NULL,
  state           text NOT NULL,
  valid_until     date,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, requirement_id),
  FOREIGN KEY (person_id, tenant_id) REFERENCES person(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (requirement_id, tenant_id) REFERENCES requirement(id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX compliance_snapshot_tenant_idx ON compliance_snapshot(tenant_id);
SELECT app.enable_tenant_rls('compliance_snapshot');
CREATE POLICY cs_system ON compliance_snapshot FOR ALL USING (app.has_role('system')) WITH CHECK (app.has_role('system'));
