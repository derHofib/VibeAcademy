-- 005 · Systemkontext (Jobs) darf Schulungen lesen (Seitenanalyse braucht die Einstellungen).
CREATE POLICY training_system ON training FOR SELECT USING (app.has_role('system'));
