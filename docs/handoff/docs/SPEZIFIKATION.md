# Spezifikation: Schulungsnachweis

Fachliche und technische Spezifikation für die Umsetzung. Quelle: Konzept „Schulungsmanagement mit Lesenachweis & digitaler Teilnahmebestätigung“ (Stand 25.11.2026), Kapitel 1–15. Bei Widerspruch zwischen Mockup und dieser Datei gilt diese Datei.

---

## 1. Zielbild

Mandantenfähige Web-App (PWA) für Unterweisungen und Schulungen mit revisionssicherem Nachweis:

- PDF-Schulungen online durcharbeiten mit **seitengenauem Lesenachweis**, Wissenscheck und **digitaler Unterschrift**.
- **Präsenzschulungen** mit QR-Check-in, Tablet-Kiosk und Gegenzeichnung durch den Trainer.
- **Externe Schulungen** (Zertifikat, Papierliste, Import) erfassen, prüfen, freigeben.
- **Live-Erfassung externer Schulungen** per Start-QR und Ende-QR mit Zeiterfassung, manuellem Ausloggen mit Vermerk, offiziellem Ende, Live-Fragen und Kontrollfragen.
- Pflichtmatrix, Fristen-Engine, Dashboard und versiegelte Nachweis-PDFs mit Audit-Trail.

Rechtlicher Rahmen (fachliche Einordnung, keine Rechtsberatung): DGUV Vorschrift 1 § 4 (Unterweisung vor Tätigkeitsbeginn, danach mind. jährlich, dokumentieren), ArbSchG § 12, JArbSchG § 29 (Jugendliche halbjährlich), BetrVG § 87 Abs. 1 Nr. 6/7 (Mitbestimmung bei technischer Überwachung), DSGVO Art. 5, 6, 13, 25, 28, 35.

Nicht in v1: Video-Kurse/SCORM, Gehalts-/HR-Funktionen.

---

## 2. Rollen und Rechte (RBAC, je Mandant)

| Rolle | Darf | Sieht |
| --- | --- | --- |
| Mandanten-Admin | Nutzer, Rollen, Org-Einheiten, Vorlagen, Aufbewahrung, Signatur-Einstellungen | Alles im Mandanten |
| Schulungsverantwortlicher | Schulungen/Versionen, Quiz, Zielgruppen, Pflichtmatrix, Einladungen, externe Nachweise prüfen/freigeben, Live-Termine führen | Alle Schulungen und Nachweise seiner Bereiche inkl. Seitendetails |
| Trainer / Unterweisender | Termine durchführen, Anwesenheit bestätigen, gegenzeichnen, Live-Fragen beantworten, Kontrollfragen senden | Teilnehmer seiner Termine |
| Vorgesetzter | Nachnominieren, erinnern, Ausnahmen beantragen, selbst eingereichte externe Nachweise freigeben | **Nur Status** seines Teams, keine Seiten-Detaildaten |
| Teilnehmer | Lesen, Quiz, bestätigen, unterschreiben, externe Nachweise einreichen, ein-/auschecken, Live-Fragen | Nur eigene Daten |
| Externer Teilnehmer | Wie Teilnehmer über Magic Link + OTP, kein dauerhaftes Konto | Nur die eine Einladung |
| Auditor (read-only) | Nachweismappen exportieren | Nachweise im freigegebenen Zeitraum |

Pflichtschulungen ergeben sich aus Person → Qualifikation/Tätigkeit → Pflichtmatrix.

---

## 3. Datenmodell (PostgreSQL, alle Tabellen mit `tenant_id` + Row Level Security)

```sql
-- Stammdaten
person(id, tenant_id, name, personalnr, email, mobil, org_unit_id, extern bool, birthdate_under18 bool, sprache)
org_unit(id, tenant_id, name, parent_id, leiter_person_id)
qualification(id, tenant_id, name)                       -- z. B. EFK, EuP, Ersthelfer, Stapler
person_qualification(person_id, qualification_id)
requirement(id, tenant_id, qualification_id, training_id, interval_months, grace_days)   -- Pflichtmatrix

-- Schulungen
training(id, tenant_id, titel, kategorie, rechtsgrundlage, format /*online|praesenz|hybrid|extern*/,
         quiz_required bool, confirm_text, settings jsonb /*t_floor,t_cap,f,v,strict_mode,pass_pct,max_attempts,completeness_pct*/)
training_version(id, training_id, version_no, file_key, sha256, page_count, change_note,
                 change_kind /*redaktionell|inhaltlich*/, changed_pages int[], published_at)  -- nach Veröffentlichung unveränderlich
page_meta(version_id, page_no, word_count, t_min_seconds, has_text bool)
quiz_question(id, training_id, text, options jsonb, correct int, explanation, active bool)

-- Durchführung
run(id, tenant_id, training_version_id, typ /*kampagne|termin|live_extern*/, deadline, ort, start_at, end_at,
    trainer_id, status /*geplant|laeuft|beendet*/, ended_at, ended_by, qr_mode /*rotierend|statisch*/, provider)
invitation(id, run_id, person_id, status /*offen|geoeffnet|gelesen|bestanden|bestaetigt|ueberfaellig|befreit*/,
           token_hash, sent_at, opened_at, completed_at, due_at)

-- Lesenachweis
read_session(id, invitation_id, started_at, ended_at, user_agent, ip_hash)
heartbeat_raw(session_id, seq, page_no, visible_ratio, focused bool, last_input_age_ms, client_ts, server_ts)  -- 90 Tage
page_progress(invitation_id, page_no, first_seen_at, dwell_ms, fulfilled_at)                                 -- aggregiert
quiz_attempt(id, invitation_id, attempt_no, score, passed bool, answers jsonb, at)

-- Unterschrift / Nachweis
signature(id, invitation_id, typ, image_key, stroke_data jsonb, auth_method, confirm_text_sha256, signed_at)
evidence(id, invitation_id|external_record_id|attendance_id, pdf_key, pdf_sha256, seal_ts, verify_code, retain_until)

-- Präsenz und Live
attendance(id, run_id, person_id, intervals jsonb /*[{in,out,in_method,out_method}]*/, check_in_method /*qr_start|kiosk|trainer*/,
           check_out_method /*qr_end|manual|official_end|kiosk|trainer*/, check_out_reason, check_out_note,
           note_review /*offen|akzeptiert|rueckfrage*/, duration_min, completeness numeric, confirmed_at)
live_question(id, run_id, person_id NULL /*anonym*/, text, votes int, status /*offen|beantwortet|per_mail*/, created_at)
live_question_vote(question_id, person_id)
live_poll(id, run_id, question, options jsonb, correct int, mode /*stimmungsbild|wissenscheck*/, opened_at, closed_at)
live_poll_answer(poll_id, person_id NULL, option int, answered_at)

-- Externe Nachweise
external_record(id, tenant_id, person_id, training_id NULL, free_title, provider, held_on, duration_hours, location,
                valid_until, evidence_keys text[], evidence_sha256 text[], source /*verwaltung|selbst|import*/,
                status /*entwurf|eingereicht|freigegeben|zurueckgegeben|abgelaufen*/, submitted_by, reviewed_by, reviewed_at, review_note,
                ocr_fields jsonb)

-- Auswertung / Revision
compliance_status  -- Materialized View: person_id, training_id/qualification_id, last_completed_at, valid_until, state
audit_event(id, tenant_id, ts, actor_id, entity, entity_id, action, payload jsonb, prev_hash, hash)  -- append-only, Hash-Kette
```

---

## 4. Kernregeln

### 4.1 Lesenachweis (Online-PDF)

Eine Seite gilt als **erfüllt**, wenn kumuliert über alle Sitzungen die Mindestverweildauer erreicht ist und dabei jeweils gilt:

1. Seite ≥ 60 % im Viewport (IntersectionObserver),
2. Tab sichtbar (Page Visibility API) und Fenster fokussiert,
3. Interaktion in den letzten 30 s (sonst Uhr pausieren, Hinweis „Noch da?“).

Mindestverweildauer je Seite:

```
t_min = max(t_floor, min(t_cap, W_Seite / v * f))
W = Wörter der Seite (Text-Layer beim Upload), v = 200 Wörter/min, f = 0,6, t_floor = 4 s, t_cap = 90 s
```

Seiten ohne Text: `t_floor` oder manueller Wert. Alle Parameter je Schulung überschreibbar, Verlängerung je Person (Barrierefreiheit).

Technik:
- PDF.js rendert Canvas aus kurzlebiger, signierter URL; kein Download (optional nach Abschluss mit Wasserzeichen).
- Client sendet alle 5 s Heartbeat `{session_id, page, visible_ratio, focused, last_input_age, client_ts, seq}`.
- **Server rechnet**: nur lückenlose `seq`, max. 5 s pro Heartbeat, Zeit aus Serverzeit. Parallele Sitzungen derselben Person: nur eine zählt.
- Strenger Modus: nächste Seite erst nach Erfüllung der aktuellen; gelesene Seiten frei wieder aufrufbar.
- Plausibilitätsflag: Gesamtdauer < 50 % der Summe aller `t_min` → markieren, nicht blockieren.
- Bewusst **nicht**: Kamera, Eye-Tracking, Screenshot-Erkennung, Keylogging.

### 4.2 Wissenscheck

Fragenpool je Schulung, zufällige Auswahl, Bestehensgrenze (Standard 80 %), max. 3 Versuche, danach Info an den Verantwortlichen. Sofortiges Feedback mit Erklärung je Frage.

### 4.3 Bestätigung und Unterschrift (EES+)

Freigeschaltet erst nach allen Seiten + bestandenem Quiz. Schritte: Bestätigungstext (Pflicht-Checkbox) → Re-Auth (Passwort/SSO-Step-up, bei Magic Link OTP) → Signaturfeld (Strichdaten + PNG). Serverseitig gebunden an Person, Einladung, Dokument-Hash, Quiz-Ergebnis, Bestätigungstext-Hash, Zeitstempel; danach unveränderlich. QES/FES nur optional per Schnittstelle.

### 4.4 Nachweis-PDF und Audit

Je Person automatisch: Kopf mit Nachweis-Nr. und Prüf-QR, Schulung inkl. Version und SHA-256, Teilnehmer, Ablauf, Seitenprotokoll (Seite · erstmals gesehen · Ist · Soll · erfüllt), Quiz-Versuche, Bestätigungstext im Wortlaut, Signaturbild, Auth-Methode; bei Präsenz/Live: Ein-/Auscheckzeiten, Methode, Vermerk, Gegenzeichnung; bei externen Nachweisen der Original-Beleg als Anlage. Versiegelt (PAdES, Firmenzertifikat) + RFC-3161-Zeitstempel, gespeichert mit Object Lock (WORM). `audit_event` als Hash-Kette, täglicher Hash-Anker per TSA.

### 4.5 Einladungen und Fristen

E-Mail + Web-Push (+ optional SMS), persönlicher Link, ICS bei Terminen. Erinnerungen T−7, T−2, T+1, danach Eskalation an Vorgesetzten. Nächtlicher Fristen-Scan: Ablauf je Person/Schulung, automatische Wiedereinladung; bei externen Kursen Hinweis „neuen Termin buchen“. Neue Version „inhaltlich“: Betroffene neu einladen, optional nur geänderte Seiten lesen.

### 4.6 Präsenz (intern)

Rotierender QR (neu alle 30 s, signiertes Token) oder Tablet-Kiosk; Check-out optional; Trainer zeichnet gegen → Einzel- und Sammelnachweis.

### 4.7 Externe Nachweise

Drei Wege: **Verwaltung erfasst** (einzeln oder Gruppe; gilt sofort), **Mitarbeiter reicht mobil ein** (Foto → Texterkennung füllt Kurs, Name, Datum, Anbieter vor → Status „eingereicht“), **Import** (CSV + ZIP mit Belegen). Prüfansicht: Beleg neben erfassten Daten, Abweichungen markiert (z. B. Name ≠ Person, Datum fehlt, Unterschriften unleserlich). Freigeben → versiegelter Nachweis mit Beleg als Anlage; Zurückgeben nur mit Begründung. Zuordnung zu Katalog-Schulung/Qualifikation; `valid_until` aus Intervall vorgeschlagen (z. B. Ersthelfer 2 Jahre), überschreibbar. Arbeitsmedizinische Vorsorge: nur Teilnahme und Datum, keine Befunde.

### 4.8 Live-Erfassung externer Schulungen (Start-/Ende-QR)

- Teilnehmer scannt **Start-QR** → eingecheckt, laufende Uhr. **Ende-QR** → ausgecheckt.
- **Ohne QR beenden**: Grund (vorzeitig gegangen, Ende-QR nicht verfügbar, technisches Problem, Sonstiges) + Vermerk (Pflicht, ≥ 10 Zeichen) → Status „Vermerk prüfen“ beim Organisator (akzeptieren / nachfragen).
- **Offiziell beenden** (Organisator): alle noch Eingecheckten bekommen das offizielle Ende als Auscheckzeit (`official_end`), Push zur Bestätigung, beide QR-Codes ungültig.
- Zeitquelle Serverzeit; Offline-Scans mit signiertem Zeitstempel nachsynchronisieren. Gedruckter QR nur im Zeitfenster gültig (30 min vor Beginn bis 60 min nach Ende).
- Mehrfaches Ein-/Auschecken = Intervalle, werden addiert.
- Vollständigkeit: Anwesenheit ≥ 90 % der geplanten Dauer (je Schulung einstellbar), sonst „teilweise“ → Anrechnung nur mit Freigabe.
- Teilnehmer bestätigt die Zusammenfassung innerhalb von 48 h, sonst Erinnerung.
- Keine Standortdaten; ohne Smartphone über Tablet des Organisators.

### 4.9 Fragen während der Live-Schulung

- **Teilnehmer → Trainer**: Frage stellen (optional anonym = ohne `person_id`), andere unterstützen mit „Ich auch“ (eine Stimme pro Person), Liste sortiert nach Stimmen; Trainer markiert „beantwortet“ oder „per Mail“. Nicht anonyme Fragen → Vermerk „Rückfrage gestellt“ im Nachweis.
- **Organisator → Teilnehmer**: Kontrollfrage aus Pool oder spontan senden; erscheint sofort bei allen Eingecheckten (WebSocket/SSE); Live-Auswertung (geantwortet / Verteilung / % richtig); Frage schließen. Modus **Stimmungsbild** (anonym, zählt nicht) oder **Wissenscheck** (personenbezogen, im Nachweis, optional Bedingung für „vollständig“). Nicht Eingecheckte holen Wissenscheck-Fragen nach dem Ende nach.
- Nur möglich, solange man eingecheckt ist.

---

## 5. API (REST, NestJS; Auszug)

```
Auth        POST /auth/login | /auth/oidc/callback | /auth/magic-link | /auth/otp/verify | /auth/step-up
Schulungen  GET/POST /trainings · POST /trainings/:id/versions (multipart PDF → Hash, Seitenanalyse-Job)
            GET /trainings/:id/versions/:v/pages · PATCH /trainings/:id/settings · CRUD /trainings/:id/questions
Matrix      CRUD /qualifications · CRUD /requirements · GET /compliance?org_unit=&state=
Einladungen POST /runs · POST /runs/:id/invite · POST /invitations/:id/remind · GET /me/invitations
Lesen       POST /invitations/:id/sessions · POST /sessions/:id/heartbeat · GET /invitations/:id/progress
            GET /invitations/:id/page/:n (signierte, kurzlebige Render-URL)
Quiz        GET /invitations/:id/quiz · POST /invitations/:id/quiz/attempts
Signatur    POST /invitations/:id/signature (nach Step-up)
Nachweise   GET /evidence/:id/pdf · GET /verify/:code (öffentlich, nur Status + Hash) · POST /exports/nachweismappe
Extern      POST /external-records (Verwaltung) · POST /me/external-records (Foto, OCR) · POST /external-records/:id/approve|return
            POST /imports/external (CSV + ZIP)
Live        POST /runs/:id/start · GET /runs/:id/qr?kind=start|end (rotierendes Token) · POST /checkin {token} · POST /checkout {token}
            POST /checkout/manual {reason, note} · POST /runs/:id/end · POST /attendance/:id/review {akzeptiert|rueckfrage}
            POST /attendance/:id/confirm · GET /runs/:id/live (SSE/WebSocket: Anwesenheit, Fragen, Polls)
            POST /runs/:id/questions · POST /questions/:id/vote · PATCH /questions/:id {status}
            POST /runs/:id/polls · POST /polls/:id/answers · POST /polls/:id/close
Audit       GET /audit?entity=&id= · GET /audit/verify (Hash-Kette prüfen)
```

---

## 6. Architektur

- **Frontend**: React + TypeScript + Vite, TanStack Query/Table, shadcn/ui, Tailwind, PWA (Web-Push, Offline-Queue für Heartbeats/Scans), PDF.js (pdfjs-dist), signature_pad, QR-Scanner (z. B. `@zxing/browser` oder `qr-scanner`).
- **Backend**: NestJS, Module: Schulungen & Versionen · Einladungen & Fristen · Tracking-Ingest · Quiz & Signatur · Nachweis-Generator · Auth & Mandanten · Extern & Live.
- **Daten**: PostgreSQL (RLS je Mandant, Audit-Hash-Kette) · Redis + BullMQ (Mails, Fristen-Scan, PDF-Jobs, OCR-Jobs) · MinIO/S3 (PDFs, Belege, Signaturen; Object Lock) · SMTP/SMS/IdP · RFC-3161-TSA.
- **Nachweis-PDF**: HTML-Template → PDF (Gotenberg oder Playwright) → PAdES-Siegel (z. B. node-signpdf) + TSA.
- **OCR** für eingereichte Zertifikate: Tesseract (lokal, DSGVO-freundlich) als Job; Felder nur als Vorschlag.
- **Echtzeit**: SSE oder WebSocket (NestJS Gateway) für Live-Liste, Fragen, Polls.
- **Hosting**: Deutschland, Docker Compose, Caddy (TLS, Rate Limit), tägliches verschlüsseltes Backup.

---

## 7. Datenschutz und Mitbestimmung

- Zweck „Nachweis Unterweisung“, keine Leistungsbewertung. Vorgesetzte nur Status.
- Info-Text vor dem ersten Öffnen („Was erfasst wird“), DSFA-Vorlage, Betriebsvereinbarung vorsehen.
- IP nur gehasht; Rohdaten (Heartbeats) nach Abschluss verdichten, nach 90 Tagen löschen.
- Aufbewahrung je Kategorie konfigurierbar; Vorschlag Beschäftigungsdauer + 3 Jahre.
- Anonyme Live-Fragen und Stimmungsbilder ohne Personenbezug speichern.

---

## 8. Roadmap

| Phase | Umfang | Gate |
| --- | --- | --- |
| 1 · MVP | PDF-Upload + Seitenanalyse, Einladungen, Viewer mit Tracking, Quiz, Signatur, Nachweis-PDF, Status-Dashboard | Pilot mit einem Team, Nachweis von DSB/BR abgenommen |
| 2 · Präsenz & Extern | Präsenz-QR, Tablet-Kiosk, Pflichtmatrix, Fristen-Engine, Externe Nachweise (erfassen, einreichen, prüfen), Live-QR Start/Ende, Live-Fragen, Kontrollfragen, Nachweismappe | Erste Präsenz- und externe Schulung vollständig digital nachgewiesen |
| 3 · Ausbau | SSO/SCIM, REST-API + Webhooks, fieldvibe-Anbindung, Seiten-Diff bei Updates, Mehrsprachigkeit, optional FES/QES | – |

Offene Entscheidungen: eigenständig oder fieldvibe-Modul · Eigenbetrieb oder SaaS · Zertifikat/TSA-Anbieter · Standardwerte mit Fachkraft für Arbeitssicherheit · Betriebsvereinbarung.
