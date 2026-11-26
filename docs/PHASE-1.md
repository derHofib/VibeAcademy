# Phase 0 + 1 – Zusammenfassung

Stand: 26.11.2026 · Branch `claude/great-sagan-5a78lf` · Details je Schritt in `docs/PLAN.md`, Annahmen in `docs/ENTSCHEIDUNGEN.md`.

## Was fertig ist

**Fundament (Phase 0)**
- Monorepo (pnpm): `apps/api` (NestJS), `apps/web` (React/Vite/Tailwind, Design-System nach `DESIGN-UND-SCREENS.md`), `packages/db` (SQL-Migrationen, RLS), `packages/shared` (Regeln als reine Funktionen).
- PostgreSQL mit erzwungener Row Level Security je Mandant, Laufzeitrolle ohne `BYPASSRLS`; Audit-Trail als Hash-Kette (append-only).
- Konten: Dozenten registrieren sich mit eigener Organisation; Kollegen einladen; Teilnehmer ohne Konto über persönlichen Link; Step-up per Passwort oder Code.
- Benachrichtigungen über Outbox mit Vorlagen; Versand per Log (Standard) oder SMTP – Anbieter folgt (E-12).
- Docker Compose/Caddy/Dockerfiles, CI (Lint, Typecheck, Unit, Integration inkl. PDF/Siegel, E2E).

**Online-Unterweisung (Phase 1)**
- Schulung anlegen (Screen 2): PDF-Upload, SHA-256, Seitenanalyse (Wörter, `t_min`, Seiten ohne Text, Kapitel aus Lesezeichen, Vorschaubilder), Regeln, Fragenpool, Veröffentlichen (unveränderlich), Zielgruppe, Einladen, Links kopieren/drucken.
- Teilnehmer: Link → Start (5a) → Viewer mobil/Desktop (5b/5c) mit serverseitiger Lese-Erfassung → Wissenscheck → Unterschrift (6) → versiegeltes Nachweis-PDF (8) → Prüfseite `/verify/:code`.
- Verwaltung: Dashboard (1), Durchführung mit Status je Person, Lesenachweis je Person (3) mit Audit-Kettenprüfung, Personen/Org-Einheiten mit CSV-Import, Mitglieder.
- „Meine Nachweise“: Teilnehmerkonto sammelt Nachweise über Organisationen hinweg (E-25).

## Abnahmekriterien Phase 1

| Kriterium | Nachweis |
| --- | --- |
| Upload: SHA-256, Seitenzahl, Wörter, `t_min` nach Formel, Seiten ohne Text markiert | `apps/api/test/trainings.int.test.ts`, `apps/api/src/trainings/pdf-analysis.test.ts`, `packages/shared/src/rules/reading-time.test.ts` |
| Seite nur erfüllt bei Sichtbarkeit ≥ 60 %, aktivem Tab, Eingabe < 30 s und kumuliert ≥ `t_min`; manipulierte Heartbeats (Lücken, Zeitsprünge, parallele Sitzungen) | `packages/shared/src/rules/reading.test.ts` (inkl. Property-Tests), `apps/api/test/reading.int.test.ts` |
| Strenger Modus, gelesene Seiten frei, Pause bei verstecktem Tab und Inhaltsverzeichnis (mobil) | `reading.int.test.ts` (Server), `apps/web/src/features/participant/__tests__/useReadingTracker.test.tsx`, E2E |
| Quiz: Bestehensgrenze, max. Versuche, Feedback; Unterschrift erst nach Seiten + Quiz, Step-up Pflicht | `apps/api/test/completion.int.test.ts` |
| Nachweis-PDF mit Pflichtinhalten, versiegelt, über `/verify/:code` prüfbar | `completion.int.test.ts` (Textprüfung, pyHanko-Validierung, Manipulation erkannt), Bild: `docs/screenshots/phase-1/08-nachweis-pdf.png` |
| Audit-Trail erkennt nachträglich geänderte Zeile | `packages/db/test/audit.int.test.ts` |
| RLS: Mandanten getrennt; Vorgesetzte ohne Seitendetails | `packages/db/test/rls.int.test.ts`, `stammdaten.int.test.ts`, `reading.int.test.ts` |
| UI wie Screens 1, 3, 5a, 5b, 5c, 6, 8 (390/1440 px) | `docs/screenshots/phase-1/{admin,participant}/`, E2E `apps/web/e2e/*-flow.spec.ts` mit axe |

## Bewusste Abweichungen

- Seiteninhalt ist das PDF (Canvas), nicht HTML wie in den Prototypen (E-05); Kapitel-Kurzname = erstes Wort des Lesezeichens.
- Frage-Sheet im Viewer zeigt in Phase 1 die Kontaktdaten (E-28); gespeicherte Fragen kommen mit Phase 2.
- Dashboard: „Nachweismappe exportieren“ und Präsenztermine folgen in Phase 2.
- Siegel mit eigener Dev-CA und Test-Zeitstempeldienst, bis Zertifikat/TSA feststehen (E-10).

## Offen / Hinweise

- **Mailversand**: Anbieter fehlt (R3). Teilnehmer **ohne Konto** brauchen den Code per E-Mail für die Unterschrift – bis dahin nur mit Konto (Passwort) oder in der Entwicklung über den Dev-Postausgang.
- Docker-Stack ist geschrieben, aber hier nicht gestartet (kein Docker-Daemon im Container); bitte einmal `docker compose up` auf einem Rechner mit Docker prüfen.
- Offline gepufferte Heartbeats liegen im Speicher (nicht IndexedDB); sie werden ohnehin nie gutgeschrieben.
- `heartbeat_raw` ohne Partitionierung (Index + Löschjob) – bei großen Mandanten nachrüsten.
- Druckliste der Einladungslinks ohne QR-Codes.
- Fachliche Standardwerte (E-24) mit der Fachkraft für Arbeitssicherheit abstimmen; DSFA-/Betriebsvereinbarungs-Vorlagen (Gate Phase 1: DSB/BR) noch nicht erstellt.

## Lokal ausprobieren

```bash
scripts/dev.sh                 # Postgres/Redis, Migrationen, API :3000, Web :5173
node scripts/seed-demo.mjs     # Demo-Daten, druckt Einladungslinks
```
Anmeldung Verwaltung: `demo@example.org` / `demo-passwort-1`. Siehe auch `docs/BETRIEB.md`.
