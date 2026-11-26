-- 018 · SSO: Nachweis der Domain-Inhaberschaft per DNS-TXT (Sicherheitskorrektur zu E-36)
-- Ohne Nachweis könnte eine Organisation eine fremde E-Mail-Domain beanspruchen und über JIT/E-Mail-Verknüpfung
-- fremde Konten übernehmen oder Nutzer auf ihren IdP umleiten. Ab jetzt:
--  - mehrere Organisationen dürfen eine Domain beanspruchen (niemand kann eine Domain blockieren),
--  - bestätigt werden kann sie nur von einer (eindeutiger Teilindex),
--  - Weiterleitung, JIT und E-Mail-Verknüpfung nutzen nur bestätigte Domains.

ALTER TABLE sso_email_domain ADD COLUMN verification_token text NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex');
ALTER TABLE sso_email_domain ADD COLUMN verified_at timestamptz;
ALTER TABLE sso_email_domain DROP CONSTRAINT sso_email_domain_pkey;
ALTER TABLE sso_email_domain ADD PRIMARY KEY (domain, tenant_id);
CREATE UNIQUE INDEX sso_email_domain_verified_uq ON sso_email_domain(domain) WHERE verified_at IS NOT NULL;

CREATE OR REPLACE FUNCTION app.sso_tenant_by_domain(p_domain citext)
RETURNS TABLE (tenant_id uuid, tenant_name text, sso_only boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.tenant_id, t.name, c.sso_only
    FROM sso_email_domain d JOIN tenant_sso_config c ON c.tenant_id = d.tenant_id JOIN tenant t ON t.id = c.tenant_id
   WHERE d.domain = p_domain AND c.enabled AND d.verified_at IS NOT NULL
$$;
