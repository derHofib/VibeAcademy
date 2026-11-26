# Prompt für die Coding-KI: „Schulungsnachweis“ umsetzen

> Kopiere alles ab der nächsten Linie in Claude Code (oder eine andere Coding-KI). Lege vorher den Ordner `Schulungsnachweis-Handoff/` ins Repository (z. B. unter `docs/handoff/`).

---

Du bist Lead-Engineer für eine neue Web-Anwendung **„Schulungsnachweis“**: Unterweisungen und Schulungen digital durchführen und revisionssicher nachweisen – mit seitengenauem Lesenachweis für PDFs, Wissenscheck, digitaler Unterschrift, Präsenz-Check-in, externen Schulungsnachweisen und Live-Erfassung externer Schulungen per Start-/Ende-QR-Code inklusive Live-Fragen.

## 1. Lies zuerst diese Unterlagen (Reihenfolge einhalten)

1. `docs/handoff/docs/SPEZIFIKATION.md` – fachliche und technische Spezifikation, **verbindlich**
2. `docs/handoff/docs/DESIGN-UND-SCREENS.md` – Design-Tokens, Komponenten, Screen-Liste mit Zuständen
3. `docs/handoff/index.html` bzw. `docs/handoff/screens/*.jpg` – alle Screens als Bild (je Zustand ein Bild)
4. `docs/handoff/prototypen/*.html` – klickbare Prototypen; öffne sie im Browser (z. B. mit Playwright), um Verhalten, Übergänge und Zustände genau zu verstehen
5. `docs/handoff/mockup-quellen/*.dc.html` – Quelltext der Prototypen: Template + Klasse `Component` mit Beispieldaten und Zustandslogik (`state`, `renderVals()`); nützlich für exakte Texte, Abstände, Farben, Zustandsübergänge

Bei Widerspruch gilt: SPEZIFIKATION > DESIGN-UND-SCREENS > Prototyp > JPG.

## 2. Bevor du Code schreibst

1. Prüfe das vorhandene Repository: Gibt es bereits eine Anwendung (z. B. FieldVibe mit React/Vite, NestJS, PostgreSQL mit RLS, MinIO, Caddy, Docker Compose)? Wenn ja, baue „Schulungsnachweis“ als **Modul in diesem Stack** und nutze bestehende Auth, Mandanten, Personen/Mitarbeiter, UI-Komponenten und Konventionen. Wenn nein, setze ein neues Monorepo mit genau diesem Stack auf.
2. Stelle mir **höchstens 5 Rückfragen** zu Punkten, die du aus Repo und Unterlagen nicht klären kannst (z. B. Modul vs. eigenständig, Mail-/SMS-Anbieter, Zertifikat für PDF-Siegel). Triff für alles andere sinnvolle Annahmen und dokumentiere sie in `docs/ENTSCHEIDUNGEN.md`.
3. Erstelle einen **Umsetzungsplan** (`docs/PLAN.md`) entlang der Phasen unten: Datenbank-Migrationen, Backend-Module, API, Frontend-Routen/Komponenten, Jobs, Tests – mit Reihenfolge und Abhängigkeiten. Warte auf mein OK zum Plan.

## 3. Technische Leitplanken

- **Frontend**: React + TypeScript + Vite, TanStack Query/Table, shadcn/ui, Tailwind; PWA (Web-Push, Offline-Queue für Heartbeats und Scans). PDF.js (`pdfjs-dist`) für den Viewer, `signature_pad` für Unterschriften, QR-Scan per Kamera (z. B. `qr-scanner`).
- **Backend**: NestJS, PostgreSQL mit **Row Level Security je Mandant** (jede Tabelle `tenant_id`), Redis + BullMQ für Jobs, MinIO/S3 mit Object Lock für Nachweise und Belege, SSE oder WebSocket für Live-Funktionen.
- **Nachweis-PDF**: HTML-Template → PDF (Gotenberg oder Playwright) → PAdES-Siegel + RFC-3161-Zeitstempel. Bis Zertifikat/TSA feststehen: austauschbare Signatur-Schnittstelle mit Dev-Zertifikat.
- **Sicherheit**: Zeit-, Lese- und Scan-Logik **serverseitig** berechnen (Client ist nicht vertrauenswürdig); signierte, kurzlebige Tokens für Seiten-URLs und QR-Codes; Audit-Trail als Hash-Kette; IP nur gehasht; Step-up-Auth vor Unterschrift.
- **Datenschutz**: keine Kamera-, Standort- oder Tastatur-Überwachung; Vorgesetzte sehen nur Status; Rohdaten nach 90 Tagen löschen; anonyme Live-Fragen ohne Personenbezug speichern.
- **UI**: Design-Tokens und Komponenten aus `DESIGN-UND-SCREENS.md` als Tailwind-Theme bzw. shadcn-Varianten anlegen (weiche Radien, keine harten Rahmen, Pillen-Buttons, Lese-Dock mit Ring-Button). Alle Texte auf Deutsch. Barrierefrei: echte Buttons/Labels, Fokus sichtbar, Kontrast ≥ 4,5:1, Touch-Ziele ≥ 44 px.

## 4. Phasen und Abnahmekriterien

### Phase 1 – MVP Online-Unterweisung
Umfang: Personen/Org-Einheiten (oder Anbindung an vorhandenen Stamm), Schulung + Version mit PDF-Upload und Seitenanalyse (Wörter je Seite → `t_min`), Einladung per Mail mit persönlichem Link, Startbildschirm (5a), Viewer mobil + Desktop mit Lese-Dock (5b/5c), Tracking-Ingest, Quiz, Unterschrift (6), Nachweis-PDF (8), Dashboard (1) und Lesenachweis je Person (3).

Abnahme:
- [ ] Upload berechnet SHA-256, Seitenzahl, Wörter und `t_min` je Seite nach der Formel in SPEZIFIKATION 4.1; Seiten ohne Text werden markiert.
- [ ] Eine Seite wird nur erfüllt, wenn sichtbar (≥ 60 %), Tab aktiv, Interaktion < 30 s und `t_min` kumuliert erreicht – **nachgewiesen durch Backend-Tests** inkl. manipulierter Heartbeats (Lücken in `seq`, zu große Zeitsprünge, parallele Sitzungen).
- [ ] Strenger Modus sperrt Folgeseiten; gelesene Seiten bleiben frei aufrufbar; Erfassung pausiert bei verstecktem Tab und geöffnetem Inhaltsverzeichnis (mobil).
- [ ] Quiz mit Bestehensgrenze, max. Versuchen und Feedback; Unterschrift erst nach allen Seiten + bestandenem Quiz; Step-up-Auth erforderlich.
- [ ] Nachweis-PDF enthält alle Pflichtinhalte aus SPEZIFIKATION 4.4, ist versiegelt und über `/verify/:code` prüfbar.
- [ ] Audit-Trail-Verifikation erkennt eine nachträglich geänderte Zeile.
- [ ] RLS-Tests: Daten eines Mandanten sind für einen anderen Mandanten nicht lesbar; Vorgesetzte sehen keine Seitendetails.
- [ ] UI entspricht den Screens 1, 3, 5a, 5b, 5c, 6, 8 (Playwright-Screenshots mobil 390 px und Desktop 1440 px zum Vergleich ablegen).

### Phase 2 – Präsenz, Pflichtmatrix, Externe Schulungen, Live
Umfang: Präsenz-QR intern (7), Pflichtmatrix + Fristen-Engine + Erinnerungen/Eskalation, externe Nachweise erfassen (9), mobil einreichen mit OCR (10), prüfen/freigeben (11), Live-Termin Organisator (12) und Teilnehmer (13) mit Start-/Ende-QR, manuellem Ausloggen mit Vermerk, offiziellem Ende, Live-Fragen und Kontrollfragen, Nachweismappe-Export.

Abnahme:
- [ ] QR-Tokens rotieren alle 30 s, sind signiert und an Termin + Art (Start/Ende) gebunden; gedruckte Codes nur im Zeitfenster gültig; Scans nutzen Serverzeit.
- [ ] Ein-/Auschecken als Intervalle, Dauer und Vollständigkeit (Standard ≥ 90 %) korrekt berechnet – mit Tests für Wiedereintritt, vergessenes Auschecken und manuelles Ausloggen.
- [ ] Manuelles Ausloggen nur mit Grund + Vermerk (≥ 10 Zeichen); erscheint beim Organisator als „Vermerk prüfen“ (akzeptieren/nachfragen).
- [ ] „Offiziell beenden“ setzt offizielles Ende für alle noch Eingecheckten, deaktiviert QR-Codes und fordert per Push zur Bestätigung auf.
- [ ] Live-Fragen: anonym möglich (ohne `person_id`), „Ich auch“ einmal je Person, Sortierung nach Stimmen, Status beantwortet/per Mail; Kontrollfragen erscheinen in Echtzeit bei allen Eingecheckten, Live-Auswertung beim Organisator, Modus Stimmungsbild vs. Wissenscheck korrekt im Nachweis.
- [ ] Externe Nachweise: drei Erfassungswege, OCR nur als Vorschlag, Prüfansicht mit Abweichungs-Hinweisen, Freigabe erzeugt versiegelten Nachweis mit Beleg als Anlage, Anrechnung auf Pflichtmatrix mit `valid_until`.
- [ ] Fristen-Engine: Ablauf, Erinnerungen T−7/T−2/T+1, Eskalation, automatische Wiedereinladung – mit Zeitreise-Tests.
- [ ] UI entspricht den Screens 7, 9–13 in allen abgebildeten Zuständen.

### Phase 3 – Ausbau (erst nach Rücksprache)
SSO/SCIM, REST-API + Webhooks, Seiten-Diff bei neuen Versionen, Mehrsprachigkeit, optional FES/QES-Anbieter.

## 5. Arbeitsweise

- Arbeite in kleinen, prüfbaren Schritten; nach jedem Teilschritt Tests ausführen und `docs/PLAN.md` abhaken.
- Wenn du Sub-Agenten nutzen kannst: plane und koordiniere selbst, lass klar abgegrenzte Pakete (z. B. „Tracking-Ingest + Tests“, „Viewer-Komponenten“, „Nachweis-PDF“) parallel umsetzen und prüfe deren Ergebnis gegen Spezifikation und Screens.
- Vergleiche UI-Ergebnisse visuell mit den JPGs/Prototypen (Playwright-Screenshots), bevor du eine Phase als fertig meldest.
- Keine Geheimnisse ins Repo; `.env.example` pflegen.
- Am Ende jeder Phase: kurze Zusammenfassung, was fertig ist, was offen ist, welche Annahmen du getroffen hast.
