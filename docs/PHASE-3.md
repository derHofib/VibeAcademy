# Phase 3 – Zusammenfassung

Stand: 26.11.2026 · Branch `claude/great-sagan-5a78lf` · Plan 3.1–3.4 in `docs/PLAN.md`, Entscheidungen E-36 bis E-44 in `docs/ENTSCHEIDUNGEN.md`.

## Was fertig ist

**3.1 Firmenanmeldung (SSO) und Benutzerabgleich (SCIM)**
- OIDC je Organisation (Authorization Code + PKCE), Erkennung über die E-Mail-Domain auf der Anmeldeseite, automatische Kontoanlage (JIT) mit Standardrollen, Verknüpfung über die bestätigte E-Mail.
- **Domain-Nachweis per DNS-TXT** (E-41): erst bestätigte Domains wirken; niemand kann fremde Domains blockieren oder übernehmen.
- „Nur SSO“ mit Notfall-Admin; Bestätigung vor der Unterschrift per erneuter Firmenanmeldung („Single Sign-on (Step-up)“ im Nachweis).
- SCIM 2.0 (Users ↔ Personen, Groups ↔ Org-Einheiten, Vorgesetzte), Löschen = deaktivieren (Aufbewahrung), Token je Organisation.

**3.2 REST-API und Webhooks**
- `/api/v1` mit API-Schlüsseln und Scopes (Personen, Schulungen, Durchführungen/Einladungen, Nachweise inkl. PDF und Prüfcode, externe Nachweise inkl. Beleg-Upload, Pflichtmatrix), OpenAPI unter `/api/v1/openapi.json`, Rate-Limit, Audit.
- Webhooks: `invitation.completed`, `evidence.created`, `external_record.approved`, `attendance.confirmed`, `compliance.state_changed`, `test.ping` – signiert, mit Wiederholung, ohne Namen/E-Mails, Zustellprotokoll, Seite „Schnittstellen“.

**3.3 Seiten-Diff, Mehrsprachigkeit, FES/QES**
- Bei einer neuen Version schlägt das System geänderte Seiten und die Art der Änderung vor; Nachschulung liest nur geänderte Seiten (Quiz einstellbar), der Nachweis vermerkt das.
- Teilnehmer-Oberfläche, Teilnehmer-Mails und Nachweis-PDF auf Deutsch und Englisch; Sprache je Person, Sprachumschalter; englische Schulungsversionen.
- Signaturniveau je Schulung (EES/FES/QES) über eine Anbieter-Schnittstelle; Test-Anbieter für Entwicklung und Abnahme.

## Abnahme (Tests)

| Bereich | Nachweis |
| --- | --- |
| SSO-Anmeldung, Ablehnung fremder Issuer/Audience/Nonce/Signatur, JIT, „nur SSO“, Step-up | `apps/api/test/sso.int.test.ts`, `sso-oidc-provider.int.test.ts` (echter OIDC-Server), E2E `sso-flow.spec.ts` |
| Domain-Nachweis | `apps/api/test/sso-domain.int.test.ts` |
| SCIM-Konformität, Mandantentrennung | `apps/api/test/scim.int.test.ts` |
| API-Schlüssel, Scopes (auch auf DB-Ebene), Mandantentrennung, OpenAPI vollständig | `apps/api/test/public-api.int.test.ts` |
| Webhook-Signatur, Wiederholung, Abschaltung, Ereignisse aus echten Abläufen, keine Personendaten | `apps/api/test/webhooks.int.test.ts` |
| Seiten-Diff, nur geänderte Seiten, Englisch, FES-Ablauf | `packages/shared/src/rules/page-diff.test.ts`, `apps/api/test/diff-i18n-qes.int.test.ts`, E2E `i18n-flow.spec.ts` |

Screenshots Englisch/FES: `docs/screenshots/phase-3/i18n/`. Die Phase-1-Teilnehmer-Screenshots zeigen jetzt zusätzlich den Sprachumschalter DE | EN.

## Offen / Hinweise

- **FES/QES**: nur Test-Anbieter. Für den Echtbetrieb Vertrag mit einem Vertrauensdiensteanbieter (z. B. D-Trust, Bundesdruckerei, Swisscom) und eine eingehende Webhook-Route ohne CSRF ergänzen.
- **SSO**: Gegenzeichnung des Trainers per Passwort auch bei „nur SSO“; kein Single Logout; SCIM `preferredLanguage` → Sprache der Person noch nicht übernommen; SSO-Texte nur Deutsch.
- **Webhooks**: kleines DNS-Rebinding-Fenster zwischen Prüfung und Verbindungsaufbau.
- **Mehrsprachigkeit**: Verwaltung, Anmeldung und API-Fehlermeldungen bleiben Deutsch.
- Weiterhin offen aus Phase 1/2: Mailanbieter, Siegelzertifikat/TSA, Docker-Stack auf echtem Host, Standardwerte mit der Fachkraft für Arbeitssicherheit, DSFA/Betriebsvereinbarung, Sammelnachweis je Termin.
