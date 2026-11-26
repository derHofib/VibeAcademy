# Entscheidungen und Annahmen – Schulungsnachweis

Stand: 26.11.2026 · Status: **Vorschlag, wartet auf Freigabe** (offene Rückfragen siehe Abschnitt 0).
Verbindliche Quellen: `docs/handoff/docs/SPEZIFIKATION.md` > `DESIGN-UND-SCREENS.md` > Prototypen > JPGs.
Jede Entscheidung hat eine ID (E-xx), damit Code-Kommentare und PRs darauf verweisen können.

---

## 0. Offene Rückfragen (Annahme gilt, bis beantwortet)

| # | Frage | Annahme bis zur Antwort |
| --- | --- | --- |
| R1 | Eigenständige App in `VibeAcademy` oder Modul im FieldVibe-Repo? | **Eigenständiges Monorepo** in `VibeAcademy` mit FieldVibe-Stack (siehe E-01). |
| R2 | Anmeldung: eigene Konten (Passwort) oder gemeinsame Identität mit FieldVibe / OIDC-IdP? | Eigene Konten (Passwort + Magic Link/OTP), OIDC-Schnittstelle vorbereitet (E-07). |
| R3 | Mail- und SMS-Anbieter? | SMTP (dev: Mailpit); OTP für Externe per **E-Mail**, SMS-Adapter nur als Schnittstelle (E-12). |
| R4 | Zertifikat und TSA für das PDF-Siegel? | Dev-Zertifikat (selbstsigniert) + lokaler Test-TSA hinter austauschbarer Schnittstelle (E-10). |
| R5 | Viewer: PDF als Seitenbild (Spezifikation) vs. umfließender Text mit Schriftgröße (Prototyp)? | PDF.js-Canvas, „Schriftgröße“ = Zoom 90–130 %, Kapitel aus PDF-Lesezeichen (E-05). |

---

## 1. Projekt und Stack

**E-01 Eigenständiges Monorepo.** Das Repository `VibeAcademy` war leer; es gibt hier keine bestehende App, auf die ein Modul aufsetzen könnte. Gebaut wird ein neues Monorepo mit genau dem FieldVibe-Stack (React/Vite, NestJS, PostgreSQL mit RLS, Redis/BullMQ, MinIO, Caddy, Docker Compose). Personen, Org-Einheiten und Auth werden als eigene Module angelegt, aber hinter klaren Schnittstellen (`PersonDirectory`, `AuthProvider`), damit die FieldVibe-Anbindung aus Phase 3 ein Adapter wird und kein Umbau.

**E-02 Monorepo-Layout (pnpm Workspaces).**
```
apps/web        React + Vite + TS (PWA)
apps/api        NestJS (HTTP-API + SSE)
apps/worker     NestJS-Standalone für BullMQ-Jobs (PDF-Analyse, Nachweis-PDF, Mails, OCR, Fristen)
packages/shared Zod-Schemas, DTO-Typen, Konstanten (Lese-Regeln, Statuswerte), reine Rechenlogik
packages/db     Drizzle-Schema, SQL-Migrationen inkl. RLS-Policies, Seed
infra/          docker-compose.yml, Caddyfile, Dockerfiles, Dev-Zertifikate-Skript
docs/           Spezifikation (handoff), PLAN, ENTSCHEIDUNGEN, Screenshots
```
Die zeitkritische Logik (Seitenerfüllung, Anwesenheitsintervalle, QR-Fenster, Fristen) liegt als **reine Funktionen** in `packages/shared/src/rules/`, damit sie ohne Datenbank testbar ist und das Frontend dieselben Konstanten anzeigt – entscheidend ist aber immer die Berechnung im Backend.

**E-03 Datenzugriff: Drizzle ORM + handgeschriebene SQL-Migrationen.** Drizzle für typisierte Abfragen; RLS-Policies, Trigger (Audit, Unveränderlichkeit) und Materialized Views als explizite SQL-Migrationen. Prisma wurde verworfen, weil es mit transaktionsgebundenem `SET LOCAL` für RLS umständlich ist.

**E-04 Mandantentrennung per RLS.**
- Zwei DB-Rollen: `app_migrator` (Owner, nur Migrationen) und `app_user` (Laufzeit, **ohne** `BYPASSRLS`, nicht Owner der Tabellen). Zusätzlich `FORCE ROW LEVEL SECURITY` auf allen Tabellen.
- Jeder Request läuft in einer Transaktion; ein NestJS-Interceptor setzt `set_config('app.tenant_id', …, true)`, `app.person_id` und `app.roles` (aus der Sitzung, nie aus dem Client).
- Policy-Grundmuster: `tenant_id = current_setting('app.tenant_id')::uuid`. Fehlt die Einstellung, liefert `current_setting(..., true)` NULL → keine Zeilen (fail closed).
- **Vorgesetzte ohne Seitendetails** wird doppelt abgesichert: RLS-Policies auf `page_progress`, `heartbeat_raw`, `read_session`, `quiz_attempt.answers` erlauben nur eigene Daten oder Rollen `admin`/`verantwortlich`/`auditor`; zusätzlich liefert die API für Vorgesetzte nur Status-DTOs.
- Tabellen ohne eigene `tenant_id` in der Spezifikation (z. B. `training_version`, `page_meta`, `invitation`, `heartbeat_raw`) bekommen trotzdem `tenant_id` (Prompt-Vorgabe „jede Tabelle `tenant_id`“), befüllt per Trigger/Insert aus dem Elternobjekt; ein Constraint-Trigger prüft Gleichheit mit dem Elternobjekt.
- Jobs im Worker setzen den Mandantenkontext pro Job explizit; mandantenübergreifende Jobs (nächtlicher Fristen-Scan) iterieren über Mandanten und setzen den Kontext je Mandant.

## 2. Lesenachweis und Viewer

**E-05 Darstellung: PDF.js-Canvas, Seite für Seite.** Die Spezifikation verlangt PDF.js mit signierter, kurzlebiger URL; der Prototyp zeigt dagegen umfließenden HTML-Text. Es gilt die Spezifikation:
- Beim Upload wird das PDF in **Einzelseiten-PDFs** zerlegt (pdf-lib) und in MinIO abgelegt. `GET /invitations/:id/page/:n` liefert eine signierte URL (TTL 60 s) nur auf diese eine Seite. So gibt es kein Gesamt-PDF im Browser, und der strenge Modus wird serverseitig erzwungen (Seite n+1 erst nach Erfüllung von n).
- „Schriftgröße 100/115/130 %“ bzw. A−/A+ = Render-Skalierung der Seite (90–130 %), mobil auf Kartenbreite eingepasst.
- **Kapitel** (Kapitel-Leiste, Inhaltsverzeichnis, „Kapitel 2 von 4“) kommen aus den PDF-Lesezeichen (Outline); fehlen sie, legt der Verantwortliche beim Anlegen Kapitel als Seitenbereiche mit Kurznamen fest. Ohne Kapitel zeigt das Inhaltsverzeichnis nur Seiten.
- Abschnittsnummern („2.4“) und Seitentitel stammen aus der Outline bzw. der ersten Textzeile der Seite.

**E-06 Berechnung der Lesezeit (serverseitig).**
- `t_min = max(t_floor, min(t_cap, W / v · 60 · f))` in Sekunden, gerundet auf ganze Sekunden; `v = 200`, `f = 0,6`, `t_floor = 4`, `t_cap = 90`, je Schulung überschreibbar, Verlängerungsfaktor je Person (Barrierefreiheit).
  Hinweis: Die Spezifikation schreibt `W / v * f` mit `v` in Wörtern/Minute; die Einheit ist Minuten, daher der Faktor 60. Plausibilisiert am Screen 2 (2.090 Wörter → 6 min 22 s Summe, mit Clamping je Seite).
- Wörter je Seite: Text-Layer per `pdfjs-dist` (Node, Legacy-Build), Tokens mit mindestens einem Buchstaben/Ziffer. Seiten mit < 5 Wörtern gelten als „ohne Text“ (`has_text = false`, `t_floor` oder manueller Wert, im Upload-Screen gelb markiert).
- Heartbeat alle 5 s: `{session_id, seq, page, visible_ratio, focused, last_input_age_ms, client_ts}`.
- Gutschrift für das Intervall zwischen Heartbeat k−1 und k **nur wenn**: `seq_k = seq_{k−1} + 1`; beide Heartbeats gültig (sichtbar ≥ 0,6, fokussiert, letzte Eingabe < 30 s); gleiche Seite; Sitzung ist die aktive Sitzung der Einladung. Gutgeschrieben wird `min(server_ts_k − server_ts_{k−1}, 5 s)`. `client_ts` zählt nie, er dient nur der Plausibilitätsprüfung.
- Lücke in `seq`, Rücksprung, doppelte `seq` → keine Gutschrift für dieses Intervall, Basis wird neu gesetzt. Zu frühe Heartbeats (< 1 s) werden verworfen (Rate-Limit).
- **Parallele Sitzungen**: Pro Einladung ist genau eine Sitzung aktiv (Lease in Redis/DB mit 15 s Ablauf). Eine neue Sitzung übernimmt die Lease; Heartbeats der alten Sitzung werden mit `409` abgelehnt, der Client zeigt „In einem anderen Fenster geöffnet“.
- Offline-Queue: Heartbeats, die offline gepuffert wurden, werden nachgesendet und gespeichert, aber **nicht** gutgeschrieben (Serverzeit-Abstand stimmt nicht). Das Lesen selbst braucht ohnehin Netz, weil die Seiten über signierte URLs kommen.
- Plausibilitätsflag: Gesamt-Ist < 50 % von Σ `t_min` → Flag im Lesenachweis, keine Sperre (bei korrekter Erfassung praktisch nur durch manuelle Korrekturen möglich; bleibt als Prüfregel).
- Rohdaten `heartbeat_raw` werden nach Abschluss in `page_progress` verdichtet und nach 90 Tagen gelöscht (täglicher Job).

## 3. Auth, Unterschrift, Nachweis

**E-07 Authentifizierung.** Server-Sitzungen per httpOnly-Cookie (SameSite=Lax, Secure), Sitzungsdaten in Redis; Passwörter mit argon2id. Persönlicher Einladungslink = Einmal-Token (nur SHA-256-Hash in `invitation.token_hash`), öffnet eine auf die Einladung beschränkte Sitzung. Externe Teilnehmer: Magic Link + 6-stelliger OTP. OIDC-Login als Schnittstelle vorbereitet, Umsetzung Phase 3 (SSO).
CSRF: Double-Submit-Token für alle schreibenden Requests.

**E-08 Step-up vor der Unterschrift.** `POST /auth/step-up` (Passwort, bei Magic-Link-Nutzern OTP) erzeugt ein Step-up-Token, gebunden an Person + Einladung, gültig 5 min, einmal verwendbar. `POST /invitations/:id/signature` verlangt dieses Token und prüft serverseitig: alle Seiten erfüllt, Quiz bestanden (falls verlangt), Bestätigungstext-Hash passt zur Version.

**E-09 Nachweis-PDF: HTML-Template → Gotenberg (Chromium) → Siegel.** Gotenberg als Compose-Dienst; Template als serverseitig gerendertes HTML mit den Design-Tokens (Screen 8). Für externe Nachweise wird der Beleg als PDF-Anlage angehängt (Bilder werden vorher in PDF-Seiten umgewandelt).

**E-10 Siegel und Zeitstempel hinter Schnittstellen.**
- `SealProvider.seal(pdf) → pdf` (PAdES-B-T) und `TimestampProvider.timestamp(sha256) → RFC-3161-Token`.
- Umsetzung: **pyHanko** im Worker-Container (ausgereifte PAdES-Implementierung inkl. Zeitstempel). Dev: selbstsigniertes Zertifikat aus `infra/dev-certs/generate.sh` (nicht im Repo) und lokaler Test-TSA auf Basis von `openssl ts` hinter einem kleinen HTTP-Endpunkt.
- Produktiv austauschbar per Konfiguration (Firmen-Siegelzertifikat als PKCS#12, TSA-URL); optional später FES/QES-Anbieter (Phase 3).
- `/verify/:code` zeigt öffentlich nur Status, Nachweis-Nr., Datum und SHA-256 – keine Personendaten außer Initialen.

**E-11 Audit-Trail als Hash-Kette.** `audit_event` nur per INSERT (Trigger verweigert UPDATE/DELETE, auch für `app_user`). `hash = SHA-256(prev_hash ‖ kanonisches JSON der Zeile)`, Kette je Mandant, serialisiert über `pg_advisory_xact_lock(tenant)`. `GET /audit/verify` rechnet die Kette nach und meldet die erste abweichende Zeile. Täglicher Anker: letzter Hash je Mandant wird per TSA gestempelt und gespeichert. Der Test „nachträglich geänderte Zeile“ ändert die Zeile als `app_migrator` (der Trigger wird dafür im Test kurz deaktiviert) und erwartet, dass `verify` sie findet.

## 4. Benachrichtigungen, Jobs, Echtzeit

**E-12 Mail, Push, SMS.** Mail per SMTP (nodemailer; dev: Mailpit). Web-Push per VAPID (`web-push`). SMS nur als `SmsProvider`-Schnittstelle mit Log-Implementierung; OTP für Externe zunächst per E-Mail (Screen 2 nennt „OTP per SMS“ – folgt, sobald ein Anbieter feststeht).

**E-13 Jobs mit BullMQ.** Queues: `pdf-analysis`, `evidence-pdf`, `mail`, `push`, `ocr`, `deadlines` (nächtlich 02:00 Europe/Berlin), `retention` (täglich), `audit-anchor` (täglich). Jobs sind idempotent (Job-ID aus fachlichem Schlüssel).

**E-14 Zeit ist injizierbar.** Ein `Clock`-Service (Default: DB-Zeit `now()` bzw. Systemzeit) wird überall verwendet; Tests nutzen eine steuerbare Uhr („Zeitreise-Tests“ für Fristen, QR-Fenster, 48-h-Bestätigung).

**E-15 Echtzeit per SSE.** `GET /runs/:id/live` als Server-Sent Events (läuft problemlos durch Caddy, automatische Wiederverbindung mit `Last-Event-ID`). Aktionen laufen über normale POSTs. Verteilung zwischen API-Instanzen über Redis Pub/Sub.

## 5. Präsenz und Live (Phase 2)

**E-16 QR-Tokens.** Kompaktes Token `base64url(run_id · kind · slot · exp) + HMAC-SHA256` (Schlüssel je Mandant, aus Master-Secret abgeleitet). `slot = floor(server_time / 30 s)`; akzeptiert werden aktueller und vorheriger Slot (Scan-Latenz). Gedruckter Aushang: statisches Token mit Gültigkeit „30 min vor Beginn bis 60 min nach geplantem Ende“. Nach „Offiziell beenden“ sind alle Tokens des Termins ungültig (Statusprüfung, nicht nur Ablauf).
Offline-Scan: Der Client speichert Token + Geräteuhrzeit; beim Nachsynchronisieren gilt als Scanzeit der **im Token signierte Slot-Beginn** (Serverzeit), nicht die Geräteuhr.

**E-17 Anwesenheit als Intervalle.** `attendance.intervals` = Liste `{in, out, in_method, out_method}`; Dauer = Summe der Intervalle, gekappt auf `[start_at, offizielles Ende]`. Vollständigkeit = Dauer / geplante Dauer, Schwelle je Schulung (Standard 90 %). „Vergessenes Auschecken“: offenes Intervall wird beim offiziellen Ende mit `official_end` geschlossen; ohne offizielles Ende schließt der Fristen-Job es beim Ablauf des Zeitfensters mit Status „prüfen“.

**E-18 OCR.** Tesseract (`deu`) im Worker-Container, nur als Vorschlag in `ocr_fields`; alle Felder bleiben editierbar. Kein Cloud-OCR.

## 6. Frontend

**E-19 Frontend-Bibliotheken.** React Router (Data-Router), TanStack Query/Table, shadcn/ui (eigene Varianten nach Design-Tokens), Tailwind, `pdfjs-dist`, `signature_pad`, `qr-scanner`, `vite-plugin-pwa` (Workbox; Offline-Queue für Heartbeats und Scans in IndexedDB), Lucide-Icons. Schriften lokal eingebunden (Plus Jakarta Sans, Inter) – keine Google-Fonts-Abrufe.

**E-20 Stil.** Verbindlich ist der weiche Stil (Screens 5a–5c, 6, 9–13). Screens 1–3, 7, 8 übernehmen Inhalt und Aufbau, werden aber im weichen Stil umgesetzt (keine dunkle Seitenleiste, keine harten Rahmen). Alle Texte auf Deutsch, zentral in `apps/web/src/i18n/de.ts` (erleichtert Mehrsprachigkeit in Phase 3).

## 7. Tests und Betrieb

**E-21 Tests.** Vitest für Unit- und Integrationstests (API mit echtem PostgreSQL 16, Redis, MinIO – lokal per Docker Compose `infra/docker-compose.test.yml`, in CI als Services). Playwright für E2E und Screenshots (390 px und 1440 px) unter `docs/screenshots/<phase>/`. GitHub Actions: Lint, Typecheck, Unit, Integration, E2E.

**E-22 Konfiguration.** Alle Geheimnisse über Umgebungsvariablen; `.env.example` mit Platzhaltern. Dev-Zertifikate, VAPID-Schlüssel und QR-Master-Secret werden per Skript lokal erzeugt, nie eingecheckt.

**E-23 Hosting.** Docker Compose mit Caddy (TLS, Rate-Limit), Betrieb in Deutschland; Backups sind Betriebsaufgabe und werden in `docs/BETRIEB.md` beschrieben, nicht im Code umgesetzt.

**E-24 Fachliche Standardwerte** (bis zur Abstimmung mit der Fachkraft für Arbeitssicherheit): Bestehensgrenze 80 %, max. 3 Versuche, Vollständigkeit 90 %, Erinnerungen T−7/T−2/T+1, Eskalation T+1 an Vorgesetzten, Teilnahmebestätigung Live binnen 48 h, Aufbewahrung Beschäftigungsdauer + 3 Jahre (`person.austritt_am` ergänzt; `retain_until` bleibt leer, bis ein Austrittsdatum gepflegt ist, dann Austritt + 3 Jahre; Object Lock im Compliance-Modus zunächst 3 Jahre ab Ablage, Verlängerung per Job – verkürzen ist bei WORM nicht möglich), Heartbeat-Rohdaten 90 Tage.
