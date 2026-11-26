# Umsetzungsplan – Schulungsnachweis

Status: **Rückfragen beantwortet (26.11.2026), Phase 0 in Arbeit.** Annahmen und Antworten: `docs/ENTSCHEIDUNGEN.md` (E-xx verweist dorthin).
Spezifikation: `docs/handoff/docs/SPEZIFIKATION.md` · Design: `docs/handoff/docs/DESIGN-UND-SCREENS.md`.

Legende: `[ ]` offen · `[x]` erledigt · **→** Abhängigkeit · **Test:** was den Schritt abnimmt.
Jeder Schritt endet mit grünen Tests und einem Commit; nach jedem Schritt wird hier abgehakt.

---

## Phase 0 – Fundament (Voraussetzung für alles)

- [x] **0.1 Monorepo-Gerüst** (E-02): pnpm Workspaces, TS-Basiskonfiguration, ESLint/Prettier, Vitest, `apps/web`, `apps/api`, `apps/worker`, `packages/shared`, `packages/db`.
  **Test:** `pnpm lint && pnpm typecheck && pnpm test` läuft leer grün.
- [x] **0.2 Infrastruktur** (E-22, E-23): `infra/docker-compose.yml` (postgres 16, redis, minio mit Object-Lock-Bucket, mailpit, gotenberg, caddy), `docker-compose.test.yml`, `.env.example`, Skripte für Dev-Zertifikate, VAPID-Schlüssel, Secrets.
  ✔ Compose/Dockerfiles/Caddy geschrieben; hier ohne Docker-Daemon nicht gestartet. Für Dev/Tests: `scripts/local-services.sh` (Postgres 16 + Redis lokal).
  **Test:** `pnpm dev:infra` startet alle Dienste; Health-Checks grün.
- [x] **0.3 CI** (E-21): GitHub Actions mit Services Postgres/Redis/MinIO; Jobs Lint, Typecheck, Unit, Integration; E2E ab Phase 1.
- [x] **0.4 Datenbank-Basis + RLS-Rahmen** (E-03, E-04) → 0.1, 0.2
  ✔ 19 DB-Integrationstests (RLS-Rahmen, Audit).
  Migration 001: Rollen `app_migrator`/`app_user`, `tenant`, `account` (mandantenunabhängig), `membership` (Konto ↔ Mandant + Rollen), Hilfsfunktionen `app.current_tenant()`, `app.has_role()`, Policy-Vorlage, `FORCE RLS`.
  NestJS: `DbModule` mit Request-Transaktion + `set_config`-Interceptor, `TenantContext` (AsyncLocalStorage), `Clock`-Service (E-14).
  **Test:** RLS-Rahmentest – zwei Mandanten, Abfrage ohne Kontext liefert 0 Zeilen, Kontext A sieht keine Zeilen von B, `app_user` kann RLS nicht umgehen.
- [x] **0.5 Audit-Hash-Kette** (E-11) → 0.4
  ✔ TSA-Tagesanker folgt mit 1.8 (Zeitstempel-Schnittstelle).
  Migration: `audit_event` + Trigger (append-only), `AuditService.record()`, `GET /audit`, `GET /audit/verify`.
  **Test:** Kette über 1.000 Ereignisse gültig; geänderte Zeile → `verify` meldet genau diese ID; UPDATE/DELETE als `app_user` scheitert; parallele Inserts bleiben eine Kette.
- [x] **0.6 Auth und RBAC** (E-07, E-08, E-25) → 0.4
  ✔ Dozenten-Registrierung, Teilnehmerkonto, Login, Mitglieder einladen, Step-up (Passwort). OTP-Step-up für Teilnehmer ohne Konto wird mit 1.4/1.7 angebunden.
  Dozenten-Registrierung (legt Konto + Mandant an), Login (argon2id), Redis-Sitzungen, CSRF, Rollen-Guard (`@Roles()`), Mitglieder einladen, Einladungslink-Sitzung für Teilnehmer ohne Konto, OTP, Step-up-Token; Rate-Limits auf Login/Registrierung/OTP.
  **Test:** Rollen-Matrix aus SPEZIFIKATION Kap. 2 als Tabellen-Test; Registrierung erzeugt isolierten Mandanten; Step-up-Token einmalig und an Einladung gebunden; abgelaufener OTP abgelehnt.
- [x] **0.6b Benachrichtigungs-Outbox** (E-12) → 0.4
  ✔ Outbox, Log-/SMTP-Adapter, Sweeper; Web-Push-Adapter folgt mit 2.2.
  Tabelle `notification`, Job `notify`, Adapter `log`/`smtp`/`webpush`, `sms:log`; Vorschau-Route für Vorlagen (Dev).
  **Test:** Nachricht landet in Outbox; Adapter `smtp` gegen Mailpit; Wiederholung nach Fehler mit Backoff.
- [x] **0.7 Frontend-Basis + Design-System** (E-19, E-20) → 0.1
  ✔ Komponenten-Galerie `/dev/komponenten`, 28 Komponententests, axe ohne schwere Verstöße, Screenshots `docs/screenshots/phase-0/`.
  Tailwind-Theme aus den Design-Tokens, lokale Schriften, shadcn-Varianten: Button (Pille, primär/sekundär/dunkel/deaktiviert), Karte, Status-Chip, Status-Pille, Segment-Umschalter, Personen-Chip, Bottom-Sheet/Schwebe-Panel, Eingabefeld ohne Rahmen; App-Layout Verwaltung (helle Navigation statt dunkler Seitenleiste), Login-Seite, `de.ts`.
  **Test:** Storybook-freie Komponenten-Galerie-Route `/dev/komponenten` + Playwright-Screenshot; axe-Check ohne Verstöße (Kontrast, Labels, Fokus).

## Phase 1 – MVP Online-Unterweisung

### Backend

- [x] **1.1 Stammdaten** → 0.4, 0.6
  ✔ API: Personen, Org-Einheiten, CSV-Import; Vorgesetzten-Sicht per RLS getestet.
  Migration: `person` (+ `austritt_am`), `org_unit`; CRUD-API, CSV-Import Personen; `PersonDirectory`-Schnittstelle (E-01).
  **Test:** RLS je Tabelle; Vorgesetzter sieht nur Personen seiner Org-Einheit(en) inkl. Unterbäume.
- [x] **1.2 Schulungen + Versionen + Upload** → 1.1
  ✔ Speicher-Schnittstelle (fs/S3), Analyse-Job, Thumbnails, Veröffentlichen; Tests mit erzeugten Fixture-PDFs.
  Migration: `training`, `training_version` (unveränderlich nach `published_at`, Trigger), `page_meta`, `chapter` (E-05).
  `POST /trainings/:id/versions` (multipart): SHA-256 beim Streamen, Ablage in MinIO, Job `pdf-analysis`.
  Worker: pdfjs-dist Text je Seite → Wortzahl, `has_text`, `t_min` (E-06); Outline → Kapitel; pdf-lib → Einzelseiten-PDFs; pdftoppm → Thumbnails.
  `GET /trainings/:id/versions/:v/pages`, `PATCH /trainings/:id/settings` (Neuberechnung `t_min`), manueller `t_min` für Seiten ohne Text.
  **Test (Abnahme 1):** Fixture-PDFs (Text, leere Seite, Bildseite, mit/ohne Outline): SHA-256, Seitenzahl, Wörter, `t_min` nach Formel inkl. Clamping, Seiten ohne Text markiert; veröffentlichte Version nicht änderbar.
- [x] **1.3 Quiz-Fragenpool** → 1.2
  Migration: `quiz_question`; CRUD; Einstellungen (Anzahl, Bestehensgrenze, Versuche) in `training.settings`.
- [x] **1.4 Durchführung + Einladungen** → 1.2
  ✔ API inkl. Link-Sitzung, Link neu erzeugen, Erinnern, OTP-Step-up; Tests in `apps/api/test/runs.int.test.ts`.
  Migration: `run`, `invitation`; `POST /runs`, `POST /runs/:id/invite` (Personen/Org-Einheiten), Einladungs-Token (Hash), Benachrichtigung über die Outbox mit Vorlage nach Screen 4, Links zusätzlich kopierbar und als QR-Liste druckbar, `POST /invitations/:id/remind`, `GET /me/invitations`, Statusmaschine `offen → geoeffnet → gelesen → bestanden → bestaetigt` (+ `ueberfaellig`, `befreit`).
  **Test:** Statusübergänge nur in erlaubter Reihenfolge; Mail landet in Mailpit mit persönlichem Link.
- [x] **1.5 Tracking-Ingest** (Kern, E-06) → 1.4
  ✔ Lease in Redis, Heartbeat-Ingest mit `applyHeartbeat()`, signierte Seiten-URLs (60 s), strenger Modus serverseitig; Abnahmefälle in `apps/api/test/reading.int.test.ts` mit steuerbarer Uhr. `heartbeat_raw` vorerst ohne Partitionierung (Index auf `server_ts`, Löschjob).
  `packages/shared/rules/reading.ts` (reine Funktion: Heartbeat-Folge → Gutschrift je Seite); Migration `read_session`, `heartbeat_raw` (partitioniert nach Monat), `page_progress`; `POST /invitations/:id/sessions` (Lease), `POST /sessions/:id/heartbeat`, `GET /invitations/:id/progress`, `GET /invitations/:id/page/:n` (signierte URL, strenger Modus).
  **Test (Abnahme 2+3):** Erfüllung nur bei sichtbar ≥ 60 %, Tab aktiv/fokussiert, Eingabe < 30 s, kumuliert ≥ `t_min` über mehrere Sitzungen; manipulierte Heartbeats: Lücke in `seq`, doppelte/rückwärts `seq`, Serverzeit-Sprung > 5 s (gekappt), Client-Zeitstempel in der Zukunft (ignoriert), Heartbeat-Flut (verworfen), zwei parallele Sitzungen (nur aktive zählt, alte erhält 409), Seitenwechsel zwischen Heartbeats (keine Gutschrift); strenger Modus: Seite n+2 → 403, gelesene Seiten bleiben abrufbar; Plausibilitätsflag. Property-Test (fast-check): Gutschrift ≤ reale Serverzeit.
- [ ] **1.6 Quiz-Durchführung** → 1.3, 1.5
  `GET /invitations/:id/quiz` (zufällige Auswahl, ohne Lösungen), `POST /invitations/:id/quiz/attempts` (Bewertung serverseitig, Feedback + Erklärung), Sperre nach max. Versuchen + Info-Mail an Verantwortlichen; Quiz erst nach allen Seiten.
  **Test (Abnahme 4):** Bestehensgrenze, Versuchslimit, Quiz vor Lese-Erfüllung → 409.
- [ ] **1.7 Unterschrift** → 1.6, 0.6
  Migration `signature` (unveränderlich); `POST /invitations/:id/signature` mit Step-up-Token, Strichdaten + PNG in MinIO, Bindung an Dokument-Hash, Quiz-Ergebnis, Bestätigungstext-Hash.
  **Test (Abnahme 4):** ohne Step-up → 401; vor Erfüllung → 409; zweite Unterschrift → 409; geänderter Bestätigungstext → Hash-Abweichung erkannt.
- [ ] **1.8 Nachweis-PDF + Siegel + Verify** (E-09, E-10) → 1.7
  Migration `evidence`; Job `evidence-pdf`: HTML-Template (Screen 8, weicher Stil) mit allen Pflichtinhalten aus SPEZIFIKATION 4.4 → Gotenberg → pyHanko (PAdES-B-T, Dev-Zertifikat + Test-TSA) → MinIO (Object Lock). `GET /evidence/:id/pdf`, öffentliches `GET /verify/:code` + Seite `/verify/:code`.
  **Test (Abnahme 5):** PDF enthält Nachweis-Nr., Prüf-QR, Schulung/Version/SHA-256, Teilnehmer, Ablauf, Seitenprotokoll, Quiz-Versuche, Bestätigungstext im Wortlaut, Signaturbild, Auth-Methode (Textextraktion); Signatur gültig (pyHanko validate), Zeitstempel vorhanden; veränderte PDF-Bytes → Verify meldet „ungültig“.
- [ ] **1.9 Auswertung** → 1.4–1.8
  `GET /dashboard` (KPIs, laufende Schulungen, Überfällige, nächste Termine), „Alle erinnern“; `GET /invitations/:id/report` (Lesenachweis je Person inkl. Seitenprotokoll + Audit-Auszug, nur berechtigte Rollen).
  **Test (Abnahme 7):** Vorgesetzter bekommt Status, aber 403/keine Felder für Seitendetails – sowohl API als auch direkt per SQL unter RLS.
- [x] **1.10 Datenschutz-Jobs** → 1.5
  ✔ Täglicher Job 03:15 Europe/Berlin, Test mit gealterten Zeilen.
  `retention`: Heartbeats > 90 Tage löschen, verdichten nach Abschluss; IP nur als HMAC-Hash.
  **Test:** Zeitreise-Test 91 Tage.

### Frontend

- [ ] **1.11 Verwaltung: Schulung anlegen (Screen 2)** → 0.7, 1.2, 1.3
  Stepper (Grunddaten · Dokument & Regeln · Zielgruppe · Prüfen & einladen), PDF-Karte mit Hash, Kennzahlen, Seiten-Thumbnails mit `t_min`, Regeln, Kapitel bearbeiten, Fragenpool, Bestätigungstext.
- [ ] **1.12 Dashboard (Screen 1)** und **Lesenachweis je Person (Screen 3)** → 1.9
  TanStack Table; Seitenprotokoll mit Balken Ist vs. Soll-Marke; Audit-Trail-Liste.
- [ ] **1.13 Teilnehmer-Start (5a)** → 1.4 — Kennzahlen, Ablauf in 3 Schritten, „Was erfasst wird“, „Los geht’s“.
- [ ] **1.14 Viewer mobil + Desktop (5b/5c)** → 1.5
  `usePageTracking` (IntersectionObserver ≥ 60 %, Visibility, Fokus, Eingabe-Alter, Heartbeat alle 5 s, Offline-Queue), PDF.js-Seite aus signierter URL, Lese-Dock mit Ring-Button (Countdown aus Serverfortschritt), Segment-Fortschritt, Status-Pille (erfasst/pausiert), Inhaltsverzeichnis als Bottom-Sheet (pausiert Erfassung mobil) bzw. Schwebe-Panel, Kapitel-Leiste mit Ringen (Desktop), Zoom 90–130 %, „Noch da?“-Hinweis, Frage-Sheet (Frage an Verantwortlichen per Mail – Phase 1 ohne Live).
  **Test:** Komponententests für den Tracking-Hook mit Fake-Timern; E2E: Seite wird erst nach `t_min` erfüllt, Pause bei verstecktem Tab und offenem Inhaltsverzeichnis.
- [ ] **1.15 Quiz (5f/5g/5j)** → 1.6 — Quiz-Optionen mit Feedback, Ergebnis, erneuter Versuch.
- [ ] **1.16 Unterschrift (Screen 6)** → 1.7 — Checkbox, `signature_pad` (Pointer-Events, Löschen), Passwort/OTP, Button erst aktiv wenn alles erfüllt, Hinweis was fehlt.
- [ ] **1.17 E2E + Screenshots** → alle
  Playwright: vollständiger Durchlauf Einladung → Lesen → Quiz → Unterschrift → Nachweis → Verify. Screenshots 390 px + 1440 px für Screens 1, 3, 5a, 5b, 5c, 6, 8 nach `docs/screenshots/phase-1/`, nebeneinander mit den JPGs in `docs/screenshots/phase-1/VERGLEICH.md`.
  **Test (Abnahme 8).**
- [ ] **1.18 Meine Nachweise – optionales Teilnehmerkonto** (E-25) → 0.6, 1.8
  Nach dem Abschluss Angebot „Nachweis in einem Konto sammeln“; Konto anlegen/anmelden, E-Mail per OTP bestätigen, Verknüpfung der Personen mit dieser E-Mail über alle Mandanten (je Verknüpfung bestätigen); Übersicht eigener Nachweise mit Gültigkeit und PDF-Download; neue Einladungen. Kein Mockup → Gestaltung im weichen Stil nach Screen 10b/5a.
  **Test:** Konto sieht Nachweise aus zwei Mandanten, aber keine fremden Personen; Löschen trennt nur die Verknüpfung.
- [ ] **1.19 Phasenabschluss:** Zusammenfassung (fertig / offen / Annahmen) in `docs/PHASE-1.md`.

**Parallelisierbar** (nach 0.x): Paket A „Tracking-Ingest + Tests“ (1.5) · Paket B „Viewer-Komponenten“ (1.14, gegen Mock-API aus `packages/shared`-Schemas) · Paket C „Nachweis-PDF + Siegel“ (1.8 mit Fixture-Daten) · Paket D „Verwaltungs-Screens“ (1.11, 1.12).

## Phase 2 – Präsenz, Pflichtmatrix, Externe Schulungen, Live

### Backend

- [ ] **2.1 Pflichtmatrix** → 1.1
  Migration `qualification`, `person_qualification`, `requirement`, Materialized View `compliance_status` (Refresh nach Nachweis/Freigabe + nächtlich); CRUD-API, `GET /compliance`.
- [ ] **2.2 Fristen-Engine** (E-13, E-14) → 2.1, 1.4
  Job `deadlines`: Ablauf je Person/Requirement, Erinnerungen T−7/T−2/T+1, Eskalation an Vorgesetzten, automatische Wiedereinladung, Hinweis „neuen Termin buchen“ bei externen Kursen, neue Version „inhaltlich“ → Neueinladung (optional nur geänderte Seiten). Web-Push-Abos.
  **Test:** Zeitreise-Tests über 14 Monate: genau eine Erinnerung je Stufe, Eskalation, Wiedereinladung, keine Duplikate bei Job-Wiederholung.
- [ ] **2.3 QR-Token-Dienst** (E-16) → 0.4
  `packages/shared/rules/qr.ts` + `GET /runs/:id/qr?kind=start|end`.
  **Test (Abnahme 1):** Rotation 30 s, Signatur, Bindung an Termin + Art, vorheriger Slot ok / vorletzter nicht, gedruckter Code nur im Fenster, nach Beenden ungültig, Scanzeit = Serverzeit, Offline-Scan nutzt signierten Slot.
- [ ] **2.4 Anwesenheit** (E-17) → 2.3
  Migration `attendance`; `POST /checkin`, `POST /checkout`, `POST /checkout/manual` (Grund + Vermerk ≥ 10 Zeichen), `POST /attendance/:id/review`, `POST /runs/:id/start|end` (offizielles Ende für alle Eingecheckten, Tokens ungültig, Push), `POST /attendance/:id/confirm` (48 h, sonst Erinnerung), Trainer-Gegenzeichnung, Tablet-Kiosk-Modus.
  **Test (Abnahme 2–4):** Wiedereintritt (zwei Intervalle addiert), vergessenes Auschecken, manuelles Ausloggen → „Vermerk prüfen“, Vollständigkeit ≥ 90 % vs. „teilweise“, Kappung auf offizielles Ende.
- [ ] **2.5 Live-Kanal + Fragen + Kontrollfragen** (E-15) → 2.4
  SSE `GET /runs/:id/live`; Migration `live_question`, `live_question_vote`, `live_poll`, `live_poll_answer`; Fragen (anonym ohne `person_id`), „Ich auch“ einmal je Person (PK), Sortierung, Status; Polls senden/beantworten/schließen, Modi Stimmungsbild (anonym gespeichert) vs. Wissenscheck (personenbezogen, optional Bedingung für „vollständig“), Nachholen nach Ende; nur eingecheckt.
  **Test (Abnahme 5):** anonyme Frage hat in der DB keinen Personenbezug; doppelte Stimme abgelehnt; Poll erreicht alle Eingecheckten per SSE; Stimmungsbild-Antworten ohne `person_id`; Nachweis enthält nur Wissenscheck.
- [ ] **2.6 Externe Nachweise** (E-18) → 2.1, 1.8
  Migration `external_record`; `POST /external-records` (einzeln/Gruppe, gilt sofort), `POST /me/external-records` (Foto → OCR-Job → Vorschlag), `POST /imports/external` (CSV + ZIP), Abweichungs-Checks (Name ≠ Person, Datum fehlt, …), approve/return (Begründung Pflicht), Rückgängig, `valid_until` aus Intervall, versiegelter Nachweis mit Beleg als Anlage, Anrechnung in `compliance_status`. Arbeitsmedizinische Vorsorge: nur Teilnahme + Datum.
  **Test (Abnahme 6).**
- [ ] **2.7 Präsenz-/Live-Nachweis-PDF + Nachweismappe** → 2.4–2.6, 1.8
  Nachweis mit Ein-/Auscheckzeiten, Methode, Vermerk, Gegenzeichnung, Rückfrage-Vermerk, Wissenscheck; Sammelnachweis je Termin; `POST /exports/nachweismappe` (ZIP mit Index-PDF, Zeitraum, Auditor-Rolle).

### Frontend

- [ ] **2.8 Präsenz-QR intern (Screen 7)** – rotierender QR, Anwesenheitsliste, Agenda, „Termin abschließen & gegenzeichnen“, Kiosk-Ansicht.
- [ ] **2.9 Pflichtmatrix-Verwaltung** (kein Mockup; im Stil von Screen 9/11 gestaltet, vor Umsetzung Skizze zur Freigabe).
- [ ] **2.10 Extern erfassen (9a/9b)**, **mobil einreichen (10a/10b)** mit Kamera/Datei + OCR-Markierungen, **prüfen/freigeben (11a–11c)**.
- [ ] **2.11 Live-Organisator (12a–12f)** – Start-/Ende-QR, Vollbild für Beamer, Aushang drucken, Reiter Anwesenheit/Fragen/Kontrollfragen, Bestätigungsdialog „offiziell beenden“, beendeter Zustand.
- [ ] **2.12 Live-Teilnehmer (13a–13i)** – Sucher mit `qr-scanner`, Uhr, Kontrollfrage-Overlay, Fragen mit „Ich auch“/anonym, ohne QR ausloggen, Zusammenfassung, bestätigen; Offline-Queue für Scans.
- [ ] **2.13 E2E + Screenshots** Screens 7, 9–13 in allen abgebildeten Zuständen (Abnahme 7) nach `docs/screenshots/phase-2/`.
- [ ] **2.14 Phasenabschluss** `docs/PHASE-2.md`.

**Parallelisierbar:** Paket E „QR + Anwesenheit + Tests“ (2.3, 2.4) · Paket F „Fristen-Engine“ (2.1, 2.2) · Paket G „Extern + OCR“ (2.6, 2.10) · Paket H „Live-UI“ (2.11, 2.12 gegen SSE-Mock).

## Phase 3 – Ausbau (erst nach Rücksprache)

SSO/SCIM, REST-API + Webhooks, FieldVibe-Anbindung (`PersonDirectory`-Adapter), Seiten-Diff bei neuen Versionen, Mehrsprachigkeit, optional FES/QES-Anbieter. Wird nach Phase 2 separat geplant.

---

## Reihenfolge auf einen Blick

```
0.1 → 0.2 → 0.3
      0.4 → 0.5
      0.4 → 0.6
0.1 → 0.7
0.4/0.6 → 1.1 → 1.2 → 1.3
                1.2 → 1.4 → 1.5 → 1.6 → 1.7 → 1.8 → 1.9
                                1.5 → 1.10
Frontend 1.11–1.16 jeweils nach dem zugehörigen Backend-Schritt, 1.17 zum Schluss
Phase 2: 2.1 → 2.2 · 2.3 → 2.4 → 2.5 · 2.1+1.8 → 2.6 · 2.4–2.6 → 2.7 · Frontend 2.8–2.12 · 2.13
```

## Risiken

| Risiko | Gegenmaßnahme |
| --- | --- |
| Prototyp zeigt umfließenden Text, Spezifikation verlangt PDF-Canvas (R5) | Entscheidung E-05; Kapitel aus Outline oder manuell |
| PAdES + TSA in Node unausgereift | pyHanko im Worker hinter Schnittstelle (E-10) |
| Mobile Browser drosseln Timer im Hintergrund | Unkritisch: Hintergrund = keine Gutschrift; Serverzeit entscheidet |
| Kamera-Zugriff auf iOS nur über HTTPS | Caddy mit lokalem TLS auch in Dev |
| Betriebsrat/DSB-Abnahme (Gate Phase 1) | Info-Text „Was erfasst wird“, DSFA-Vorlage und BV-Entwurf als Anlage in `docs/datenschutz/` |
