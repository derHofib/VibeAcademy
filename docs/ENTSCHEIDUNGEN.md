# Entscheidungen und Annahmen – Schulungsnachweis

Stand: 26.11.2026 · Status: **Vorschlag, wartet auf Freigabe** (offene Rückfragen siehe Abschnitt 0).
Verbindliche Quellen: `docs/handoff/docs/SPEZIFIKATION.md` > `DESIGN-UND-SCREENS.md` > Prototypen > JPGs.
Jede Entscheidung hat eine ID (E-xx), damit Code-Kommentare und PRs darauf verweisen können.

---

## 0. Rückfragen – beantwortet am 26.11.2026

| # | Frage | Antwort | Folge |
| --- | --- | --- | --- |
| R1 | Eigenständig oder FieldVibe-Modul? | **Eigenständig** | E-01 bestätigt |
| R2 | Konten / Anmeldung | **Dozenten erstellen selbst ein Konto. Teilnehmer brauchen keins, können aber eins anlegen, um ihre Schulungen zu sammeln.** | E-07 neu gefasst, E-25 (Teilnehmerkonto „Meine Nachweise“) |
| R3 | Mail-/SMS-Anbieter | **Noch offen, nicht dringend – Versand soll weitgehend vorbereitet sein** | E-12 neu gefasst (Outbox + Adapter, Links zusätzlich kopier-/druckbar) |
| R4 | Siegelzertifikat / TSA | **Gibt es nicht** | E-10 ergänzt (Start mit eigenem Siegelzertifikat, Prüfung über `/verify`) |
| R5 | Viewer | **PDF-Seiten sind die Grundlage der Schulung** | E-05 bestätigt |

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
- Lücke in `seq` → keine Gutschrift für dieses Intervall, Basis wird neu gesetzt. Doppelte oder rückwärts laufende `seq`, zu frühe Heartbeats (< 1 s Serverzeit-Abstand, auch rückwärts laufende Serveruhr) und formal ungültige Werte werden verworfen, ohne die Basis zu ändern. Umgesetzt als reine Funktion `applyHeartbeat()` in `packages/shared/src/rules/reading.ts`; die Seitenzeit läuft nach Erfüllung weiter (echte Lesezeit für die Plausibilitätsprüfung).
- **Parallele Sitzungen**: Pro Einladung ist genau eine Sitzung aktiv (Lease in Redis/DB mit 15 s Ablauf). Eine neue Sitzung übernimmt die Lease; Heartbeats der alten Sitzung werden mit `409` abgelehnt, der Client zeigt „In einem anderen Fenster geöffnet“.
- Offline-Queue: Heartbeats, die offline gepuffert wurden, werden nachgesendet und gespeichert, aber **nicht** gutgeschrieben (Serverzeit-Abstand stimmt nicht). Das Lesen selbst braucht ohnehin Netz, weil die Seiten über signierte URLs kommen.
- Plausibilitätsflag: Gesamt-Ist < 50 % von Σ `t_min` → Flag im Lesenachweis, keine Sperre (bei korrekter Erfassung praktisch nur durch manuelle Korrekturen möglich; bleibt als Prüfregel).
- Rohdaten `heartbeat_raw` werden nach Abschluss in `page_progress` verdichtet und nach 90 Tagen gelöscht (täglicher Job).

## 3. Auth, Unterschrift, Nachweis

**E-07 Konten und Authentifizierung.**
- `account` ist **mandantenunabhängig** (E-Mail, argon2id-Passwort, verifiziert ja/nein). Rollen hängen nicht am Konto, sondern an `membership(account_id, tenant_id, roles[])`.
- **Selbstregistrierung für Dozenten**: „Konto erstellen“ legt Konto + neuen Mandanten (Organisation) an; der Dozent erhält die Rollen Mandanten-Admin, Schulungsverantwortlicher und Trainer. Weitere Kollegen lädt er später als Mitglieder ein. In der Oberfläche heißt die Rolle „Dozent“.
- **Teilnehmer ohne Konto**: Zugang über den persönlichen Einladungslink (Einmal-Token, nur SHA-256-Hash in `invitation.token_hash`) bzw. bei Live/Präsenz über Start-QR + Name/E-Mail (legt eine `person` im Mandanten an oder findet sie). Die Sitzung ist auf diese Einladung/diesen Termin beschränkt.
- **Teilnehmer mit Konto** (optional): siehe E-25.
- Sitzungen per httpOnly-Cookie (SameSite=Lax, Secure), Sitzungsdaten in Redis; CSRF per Double-Submit-Token; Rate-Limits auf Login, Registrierung, OTP. OIDC als Schnittstelle vorbereitet (Phase 3).

**E-08 Step-up vor der Unterschrift.** `POST /auth/step-up` (Konto: Passwort; Teilnehmer ohne Konto: 6-stelliger OTP an die E-Mail-Adresse der Einladung) erzeugt ein Step-up-Token, gebunden an Person + Einladung, gültig 5 min, einmal verwendbar. `POST /invitations/:id/signature` verlangt dieses Token und prüft serverseitig: alle Seiten erfüllt, Quiz bestanden (falls verlangt), Bestätigungstext-Hash passt zur Version.

**E-09 Nachweis-PDF: HTML-Template → Chromium → Siegel.** Renderer austauschbar (`PDF_RENDERER`): Gotenberg als Compose-Dienst im Betrieb, lokales Chromium über playwright-core in Entwicklung und Tests; Template als serverseitig gerendertes HTML mit den Design-Tokens (Screen 8). Für externe Nachweise wird der Beleg als PDF-Anlage angehängt (Bilder werden vorher in PDF-Seiten umgewandelt).

**E-10 Siegel und Zeitstempel hinter Schnittstellen.**
- `SealProvider.seal(pdf) → pdf` (PAdES-B-T) und `TimestampProvider.timestamp(sha256) → RFC-3161-Token`.
- Umsetzung: **pyHanko** (`infra/seal/seal.py`, Unterprozess). Dev: `scripts/setup-seal.sh` erzeugt Dev-CA, Siegelzertifikat und Test-TSA-Zertifikat unter `.local/certs` (nicht im Repo); ohne `TSA_URL` stempelt pyHankos eingebauter Test-TSA (`DummyTimeStamper`) – im Nachweis als „nicht qualifiziert“ gekennzeichnet. `infra/seal/verify.py` prüft Siegel und Zeitstempel.
- Produktiv austauschbar per Konfiguration (Firmen-Siegelzertifikat als PKCS#12, TSA-URL); optional später FES/QES-Anbieter (Phase 3).
- **Da kein Zertifikat vorhanden ist (R4)**: Jede Installation erzeugt beim ersten Start eine eigene Siegel-CA und ein Siegelzertifikat (Schlüssel nur im Secret-Speicher, nie im Repo). PDF-Reader zeigen die Signatur dann als „Identität unbekannt“, die Unveränderbarkeit ist aber prüfbar. Maßgeblich für die Echtheit ist `/verify/:code` (Abgleich SHA-256 mit der Datenbank) plus Audit-Kette. Zeitstempel: konfigurierbare TSA-URL (z. B. ein öffentlicher kostenloser RFC-3161-Dienst), ohne Konfiguration der interne Test-TSA mit Hinweis „Zeitstempel nicht qualifiziert“ im Nachweis. Wechsel auf ein vertrauenswürdiges Siegel ist reine Konfiguration.
- `/verify/:code` zeigt öffentlich nur Status, Nachweis-Nr., Datum und SHA-256 – keine Personendaten außer Initialen.

**E-11 Audit-Trail als Hash-Kette.** `audit_event` nur per INSERT (Trigger verweigert UPDATE/DELETE, auch für `app_user`). `hash = SHA-256(prev_hash ‖ kanonisches JSON der Zeile)`, Kette je Mandant, serialisiert über `pg_advisory_xact_lock(tenant)`. `GET /audit/verify` rechnet die Kette nach und meldet die erste abweichende Zeile. Täglicher Anker: letzter Hash je Mandant wird per TSA gestempelt und gespeichert. Der Test „nachträglich geänderte Zeile“ ändert die Zeile als `app_migrator` (der Trigger wird dafür im Test kurz deaktiviert) und erwartet, dass `verify` sie findet.

## 4. Benachrichtigungen, Jobs, Echtzeit

**E-12 Benachrichtigungen vorbereitet, Versand später (R3).**
- Alle Nachrichten (Einladung, Erinnerung, Eskalation, OTP, Bestätigung) laufen über eine **Outbox-Tabelle** `notification` (Empfänger, Kanal, Vorlage, Daten, Status, Versuche) und einen BullMQ-Job.
- Kanäle als Adapter: `MailProvider` (`log` = Standard, schreibt nur ins Log/Outbox · `smtp` per nodemailer · dev: Mailpit), `SmsProvider` (`log`), `PushProvider` (Web-Push/VAPID). Welcher Adapter aktiv ist, steuert `.env`; ein Anbieterwechsel ist Konfiguration.
- Mail-Vorlagen (Einladung nach Screen 4, Erinnerung, OTP, …) werden vollständig gebaut und in einer Vorschau-Route angezeigt.
- Damit es ohne Mailversand nutzbar ist: Einladungslinks lassen sich in der Verwaltung **kopieren und als QR/Liste drucken**; Teilnehmer mit Konto sehen neue Einladungen in „Meine Nachweise“.
- Einschränkung: Teilnehmer **ohne** Konto brauchen für den Step-up vor der Unterschrift den OTP per E-Mail. Solange kein Mailversand eingerichtet ist, funktioniert die Unterschrift nur mit Konto (Passwort) oder in der Entwicklung über Mailpit.

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

## 8. Teilnehmerkonten

**E-25 „Meine Nachweise“ – mandantenübergreifend, nur eigene Daten (R2).**
- Ein Teilnehmer kann jederzeit (typisch nach dem Abschluss: „Nachweis in einem Konto sammeln?“) ein Konto anlegen oder sich anmelden. Nach E-Mail-Bestätigung per OTP werden alle `person`-Datensätze mit dieser verifizierten E-Mail in allen Mandanten mit dem Konto verknüpft (`person.account_id`); der Teilnehmer bestätigt jede Verknüpfung.
- Das Konto sieht **nur eigene** Einladungen, Nachweise (PDF-Download, Gültigkeit) und Live-Teilnahmen – über eine eigene RLS-Policy `person.account_id = app.account_id` bzw. SECURITY-DEFINER-Funktionen, die ausschließlich eigene Zeilen liefern. Keine Einsicht in andere Personen oder Mandanteneinstellungen.
- Ein Konto kann gleichzeitig Dozent (Mitglied eines Mandanten) und Teilnehmer anderer Schulungen sein.
- Eigene externe Nachweise mobil einreichen (Screen 10) geht an den jeweiligen Mandanten, in dem die Person geführt wird.
- Löschen des Kontos trennt nur die Verknüpfung; Nachweise bleiben beim Mandanten (Aufbewahrungspflicht).

## 9. Ergänzungen während der Umsetzung

**E-26 Objektspeicher-Treiber.** `STORAGE_DRIVER=fs` (Verzeichnis, Entwicklung/Tests; Nachweise schreibgeschützt und nicht überschreibbar) oder `s3` (MinIO/S3 mit Object Lock im Betrieb).

**E-27 Teilnehmer-Schreibzugriffe.** Statuswechsel aus Teilnehmersicht (geöffnet, gelesen, Quiz, Unterschrift) schreibt die API im Systemkontext des Mandanten, nachdem `ParticipantService.resolve()` den Zugriff geprüft hat. Teilnehmer haben per RLS nur Leserechte auf eigene Daten; Mandantentrennung bleibt erzwungen.

**E-28 Fragen während der Online-Schulung (Phase 1).** Das Frage-Sheet im Viewer zeigt in Phase 1 die Kontaktdaten der Ansprechperson; die Frage-Funktion mit Speicherung folgt mit den Live-Fragen in Phase 2.

## 10. Phase 2

**E-29 Präsenz/Live-Termine** sind `run.typ` `termin` (intern, mit Gegenzeichnung des Trainers per Passwort-Step-up) bzw. `live_extern` (Katalog-Schulung oder freier Titel + Anbieter). Teilnehmer kommen wie in Phase 1 über persönliche Einladungen (Link-Sitzung) oder ihr Konto; spontane Teilnahme („Walk-in“) mit Name + E-Mail ist je Termin abschaltbar (`allowWalkIn`, Standard an – Risiko wie ein weitergeleiteter Link). Ohne Smartphone: Tablet-Kiosk des Organisators mit Unterschrift.

**E-30 Anwesenheit** liegt in `attendance` + Kindtabelle `attendance_interval` (statt jsonb); nach Bestätigung unveränderlich. Nachweis entsteht erst, wenn bestätigt, kein offenes Intervall, Vermerk akzeptiert, bei „teilweise“ Freigabe entschieden und bei `termin` gegengezeichnet. Ohne offizielles Ende schließt ein Job (alle 15 min) nach Ablauf des Zeitfensters mit Status „prüfen“; Erinnerung zur Bestätigung nach 48 h genau einmal.

**E-31 Live-Fragen/Kontrollfragen:** anonyme Fragen ohne `person_id` und ohne Person im Audit; Stimmungsbild-Antworten ohne Person (Trigger), Doppelantworten über separate Teilnahme-Tabelle ohne Option verhindert. Echtzeit per SSE mit Redis-Pub/Sub (nur Themen-Signale, keine Personendaten im Bus); nach Wiederverbindung wird ein vollständiger Snapshot gesendet.

**E-32 Pflichtmatrix** wird live per `app.compliance(at)` mit der RLS des Aufrufers berechnet (keine Materialized View): Vorgesetzten-Sicht bleibt korrekt, Zeitreise-Tests übergeben die Uhrzeit. Quellen sind die Views `app.completion_events_{online,external,attendance}`. Externe Kurstypen sind Schulungen mit `format='extern'`; eine Anforderung verweist immer auf eine Schulung.

**E-33 Fristen-Engine:** nächtlich 02:00 Europe/Berlin je Mandant mit Advisory-Lock; jede Stufe genau einmal über das Protokoll `deadline_notice` (Schlüssel je Mandant). `ueberfaellig` nur für `offen`/`geoeffnet`. Wiedereinladung `reinvite_days` (Standard 30) vor Ablauf in eine automatische Kampagne je Version und Monat; externe/Präsenz-Kurse erhalten „neuen Termin buchen“. Inhaltliche neue Version → Neueinladung mit `changed_pages`.

**E-34 Externe Nachweise:** mobil einreichen nur über das mit der Person verknüpfte Konto (E-25), kein eigener Einreiche-Link. OCR (Tesseract deu, PDF über pdftoppm) füllt nur leere Felder von Entwürfen, sonst nur Vorschläge. Vier-Augen-Prinzip: niemand gibt eigene Nachweise frei; Vorgesetzte nur selbst eingereichte ihres Teams. Gruppen werden als ein Fall geprüft. Rückgängig nach Freigabe (10 min) = Widerruf: Nachweis wird „widerrufen“ (auch auf `/verify`), eine Kopie geht zurück in die Prüfung. Arbeitsmedizinische Vorsorge: nur Teilnahme + Datum, keine OCR.

**E-35 Web-Push** über VAPID (`web-push`), Abos je Konto oder Person (Link-Sitzung), nur über SECURITY-DEFINER-Funktionen schreibbar; ohne Schlüssel Log-Platzhalter. Nachweismappe-Export synchron (bis 5.000 Nachweise) als ZIP mit versiegeltem Verzeichnis-PDF und CSV.

## 11. Phase 3 (Annahmen bei Start, werden von den Paketen präzisiert)

**E-36 SSO/SCIM.** OIDC (Authorization Code + PKCE) je Mandant; Client-Secret verschlüsselt (AES-256-GCM, Schlüssel aus `HMAC_MASTER_SECRET` abgeleitet). Konten werden über (Issuer, Subject) verknüpft, bei erster Anmeldung über die bestätigte E-Mail. Step-up vor der Unterschrift per erneuter IdP-Anmeldung (`prompt=login`, `max_age=0`, `auth_time` geprüft) → Auth-Methode „sso“ im Nachweis. SCIM 2.0 je Mandant mit eigenem Bearer-Token (nur Hash gespeichert); SCIM-Löschen = deaktivieren (Aufbewahrung).

**E-37 REST-API und Webhooks.** `/api/v1` mit API-Schlüsseln (Präfix + Geheimnis, nur Hash gespeichert, Scopes wie `persons:read`, `evidence:read`, `trainings:write`), eigene Rate-Limits, OpenAPI 3.1 unter `/api/v1/openapi.json`. Webhooks über die Outbox-Mechanik: HMAC-SHA256-Signatur mit Zeitstempel im Header, Wiederholung mit Backoff, Zustellprotokoll, keine Personendaten außer IDs in den Ereignissen (Abruf über die API).

**E-38 Seiten-Diff.** Textvergleich je Seite (normalisierter Text, Ähnlichkeitsmaß) zwischen veröffentlichter und neuer Version; Vorschlag für `changed_pages`, der Verantwortliche bestätigt. Neueinladungen mit `changed_pages` verlangen die Lese-Erfüllung nur für diese Seiten.

**E-39 Mehrsprachigkeit.** Phase 3 übersetzt die Teilnehmer-Oberfläche, Mails und das Nachweis-PDF (de/en); die Verwaltung bleibt Deutsch. Sprache je Person (`person.sprache`), Schulungsversionen können je Sprache hochgeladen werden; Einladungen wählen die Version in der Sprache der Person, sonst Deutsch.

**E-40 FES/QES.** Signaturniveau je Schulung (EES Standard, FES/QES optional) über eine Anbieter-Schnittstelle (`SignatureProvider`: Vorgang starten → Weiterleitung → Rückruf mit signiertem Dokument). Ohne Vertrag mit einem Vertrauensdiensteanbieter nur Test-Anbieter.

**E-41 Domain-Nachweis für SSO (Sicherheitskorrektur zu E-36).** Eine E-Mail-Domain wirkt für Weiterleitung zur Firmenanmeldung, JIT-Konten und E-Mail-Verknüpfung erst, wenn der Mandant sie per DNS-TXT-Eintrag `_schulungsnachweis.<domain>` = `schulungsnachweis-verify=<token>` bestätigt hat (`POST /api/tenant/sso/domains/:domain/verify`). Mehrere Mandanten dürfen eine Domain eintragen (niemand kann blockieren), bestätigt sein kann sie nur bei einem. `SSO_DOMAIN_VERIFICATION=trust` bestätigt sofort – nur Entwicklung/Tests, in Produktion verweigert der Konfigurationscheck den Start.
