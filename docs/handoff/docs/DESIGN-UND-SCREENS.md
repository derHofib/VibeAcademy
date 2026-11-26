# Design-System und Screens

Alle Screens liegen dreifach vor:

- `screens/*.jpg` – Standbilder in doppelter Auflösung, je wichtigem Zustand ein Bild
- `prototypen/*.html` – klickbare Prototypen, direkt im Browser öffnen (`index.html` im Hauptordner listet alles)
- `mockup-quellen/*.dc.html` – Quelltext der Mockups (HTML-Template + Logik-Klasse mit Beispieldaten und Zustandslogik)

**Verbindlicher Stil ist der „weiche“ Stil** der Screens 5a–5c, 6 und 9–13. Die Screens 1–3, 7 und 8 sind älter (kantiger, dunkle Seitenleiste): Für sie gelten Inhalt, Aufbau und Daten, der Stil ist beim Umsetzen an das Design-System unten anzugleichen.

---

## 1. Design-Tokens

### Farben

| Token | Wert | Verwendung |
| --- | --- | --- |
| `bg` | `#F4F6FB` | Seitenhintergrund |
| `surface` | `#FFFFFF` | Karten, Docks, Panels |
| `ink` | `#1D2433` | Haupttext |
| `ink-2` | `#3A4456` | Fließtext |
| `muted` | `#5F6B7D` | Sekundärtext (min. 4,5:1 auf Weiß) |
| `line` | `#E3E8F2` | Fortschritts-Tracks, Trennlinien |
| `accent` | `#3D63DD` | Primäraktionen, Fortschritt |
| `accent-soft` | `#EAF0FE` | Chips, aktive Zustände, Info-Boxen |
| `accent-text` | `#2E4FB8` / `#223C8F` | Text auf `accent-soft` |
| `success` | `#1E7A50` | erledigt, erfasst, bestanden |
| `success-soft` | `#E6F4EC` (Text `#1E6A45` / `#1E5A3C`) | |
| `warn` | `#F2B544` (Icon), Text `#6B4500` / `#5A3A00` | Warnhinweise, Vermerke, „teilweise“ |
| `warn-soft` | `#FFF4DF` | |
| `danger-soft` | `#FDECEA` (Text `#A1271B`) | abgelaufen |
| `disabled` | `#E4EAF8` (Text `#2E3F6E`) | gesperrte Primärbuttons |
| `scan-bg` | `#161B26` / `#2A3142` | Kamera-Sucher, Beleg-Vorschau |

### Typografie

- Überschriften: **Plus Jakarta Sans** 600–700, `letter-spacing: -0.01em`
- Text/UI: **Inter** 400–600
- Lesetext in Schulungen: mobil 15–15,5 px, Desktop 17 px, Zeilenhöhe 1,6–1,7; per Zoom 90–130 %
- Zahlen/Timer: `font-variant-numeric: tabular-nums`

### Formen und Tiefe

- Radius: Karten 22–30 px, Panels 26–28 px, Eingabefelder 14–18 px, Buttons und Chips `999px` (Pille), Icon-Buttons rund
- Keine harten Rahmen; Trennung über Flächen und weiche Schatten:
  - Karte: `0 1px 2px rgba(29,36,51,.04), 0 10px 30px rgba(29,36,51,.06)`
  - Schwebend (Dock, Dialog): `0 2px 6px rgba(29,36,51,.06), 0 14px 34px rgba(29,36,51,.14)`
  - Primärbutton: `0 8px 20px rgba(61,99,221,.28)`
- Eingabefelder: ohne Rahmen, Hintergrund `bg`
- Touch-Ziele ≥ 44 px, Primärbuttons mobil 52–56 px hoch

### Kernkomponenten

| Komponente | Beschreibung | Zu sehen in |
| --- | --- | --- |
| **Lese-Dock** | Schwebende weiße Pille unten (mobil links/rechts je 16 px, 72 px hoch; Desktop zentriert unter der Seite, sticky). Aktionen: Inhalt, Zurück, **Ring-Button**, Frage, Schriftgröße | 5b, 5c |
| **Ring-Button** | Runder Weiter-Button (mobil 72 px, Desktop 84 px), ragt aus dem Dock. Ring füllt sich mit der Erfassung der Seite, innen Sekunden-Countdown. Bei Erfüllung: blau mit Pfeil. Quiz: „?“ bis Antwort gewählt. Nach bestandenem Quiz: grün mit Unterschrifts-Icon | 5b, 5c |
| **Segment-Fortschritt** | Ein Balkensegment je Seite, füllt sich live; aktuelle Seite mit hellem Ring | 5b, 5c |
| **Kapitel-Leiste** (Desktop) | Vertikale Pille links, ein Fortschrittsring je Kapitel mit Kurzname, darunter Quiz und Abschluss (gesperrt bis freigeschaltet) | 5c |
| **Bottom-Sheet** (mobil) / **schwebendes Panel** (Desktop) | Inhaltsverzeichnis, Frage stellen, Ohne QR ausloggen | 5b, 5c, 13 |
| **Status-Pille** | Kleine Pille mit Punkt: „Seite wird erfasst“, „Pausiert – Fenster nicht aktiv“, „Bestanden“ | 5b, 5c |
| **Quiz-Option** | Großer Antwort-Button; nach Auswahl: richtig grün + ✓, falsch gelb + ✕, Rest gedimmt; Erklärungsbox darunter | 5b, 5c, 13 |
| **Segment-Umschalter** | Pillen-Gruppe auf `bg`, aktive Pille weiß mit Schatten | 9, 11, 12 |
| **Personen-Chip** | Initialen-Kreis + Name + × | 9 |
| **Status-Chip** | Farbcodiert: grün erledigt, blau läuft/offen, gelb prüfen/teilweise, rot abgelaufen, grau neutral | überall |
| **QR-Karte** | QR-Code in farbigem Rahmen (blau = Start, orange = Ende), Hinweis „neuer Code alle 30 s“ | 12 |
| **Sucher** | Dunkle Fläche mit runden Eckwinkeln, Farbe je Start/Ende | 13 |

Icons: einfache Linien-Icons (z. B. Lucide). Keine Emojis, keine Verläufe.

---

## 2. Screens

Legende Dateien: JPG in `screens/`, Prototyp in `prototypen/`, Quelle in `mockup-quellen/`.

### Verwaltung

| # | Screen | Bilder | Prototyp | Inhalt / Interaktion |
| --- | --- | --- | --- | --- |
| 1 | Admin-Dashboard | `01_Dashboard.jpg` | `Main.html` | KPIs (Erfüllungsquote, überfällig, läuft ab, offene Einladungen), Tabelle laufender Schulungen mit Fortschritt und Status, Liste Überfällige mit „Alle erinnern“, nächste Präsenztermine; Menüpunkt „Externe Nachweise“ mit Zähler |
| 2 | Schulung anlegen | `02_Schulung-anlegen.jpg` | `Schulung-anlegen.html` | Stepper; PDF-Karte mit Hash; Kennzahlen (Wörter, Mindest-Lesezeit, Seiten ohne Text); Seiten-Thumbnails mit `t_min`; Art der Änderung; Regeln (v, f, t_floor, t_cap, strenger Modus, Quiz, Re-Auth, Download), Frist, Intervall, Bestätigungstext |
| 3 | Lesenachweis je Teilnehmer | `03_Lesenachweis-Teilnehmer.jpg` | `Teilnehmer-Nachweis.html` | Zusammenfassung (eingeladen, geöffnet, Sitzungen, Lesezeit Ist/Soll, Quiz, Unterschrift); Seitenprotokoll mit Balken Ist vs. Soll-Marke; Audit-Trail |
| 4 | Einladungs-E-Mail | `04_Einladungs-Mail.jpg` | `Einladung-Mail.html` | Umfang, Frist, Ansprechpartner, Button → Startbildschirm, Hinweise |
| 7 | Präsenz QR-Check-in (intern) | `07_Praesenz-QR-Checkin.jpg` | `Praesenz-QR.html` | Rotierender QR, Anwesenheitsliste, Agenda, „Termin abschließen & gegenzeichnen“ |
| 8 | Nachweis-PDF | `08_Nachweis-PDF.jpg` | `Nachweis-PDF.html` | Layout des versiegelten PDFs (A4): Prüf-QR, Schulung, Teilnehmer, Seitenprotokoll, Quiz, Bestätigung + Signatur, Siegel-Fußzeile |

### Teilnehmer – Online-Schulung

| # | Screen | Bilder | Prototyp | Inhalt / Interaktion |
| --- | --- | --- | --- | --- |
| 5a | Start | `05a_Start-mobil.jpg` | `Viewer-Start.html` | Kennzahlen (Seiten, Lesezeit, Fragen), Ablauf in 3 Schritten, „Was erfasst wird“, „Los geht’s“ |
| 5b | Lesen mobil | `05b`–`05g` | `Viewer-Mobil.html` | 14 Seiten mit echtem Inhalt, Live-Erfassung (Demo-Zeiten 5–8 s), Pause bei verstecktem Tab oder offenem Inhaltsverzeichnis, Bottom-Sheets Inhalt/Frage, Schriftgröße 100/115/130 %, Quiz mit Feedback, Ergebnis, erneuter Versuch |
| 5c | Lesen Desktop | `05h`–`05j` | `Viewer-Desktop.html` | Wie 5b, Kapitel-Leiste mit Ringen, schwebende Panels, A−/A+ |
| 6 | Unterschrift | `06_Unterschrift-mobil.jpg` | `Abschluss-Signatur.html` | Bestätigungstext-Checkbox, Zeichenfeld (Pointer-Events, Löschen), Passwort; Button erst aktiv wenn alles erfüllt, Hinweis zeigt was fehlt |

### Externe Schulungen

| # | Screen | Bilder | Prototyp | Inhalt / Interaktion |
| --- | --- | --- | --- | --- |
| 9 | Externe Schulung erfassen | `09a`, `09b` | `Extern-erfassen.html` | Einzelperson/Gruppe, Zuordnung zur Pflichtschulung (ändert Gültigkeit), Anbieter/Ort/Datum/Umfang, Teilnehmer-Chips hinzufügen/entfernen, Belege (eine Liste vs. je Person), rechts „Was sich ändert“ je Person, Speichern |
| 10 | Nachweis mobil einreichen | `10a`, `10b` | `Extern-einreichen-mobil.html` | Foto mit markierten OCR-Feldern, erkannte Felder editierbar, Anrechnungs-Hinweis, Einreichen → Status-Zeitleiste |
| 11 | Prüfen und freigeben | `11a`–`11c` | `Extern-pruefen.html` | Warteschlange mit Hinweis-Chips, Beleg-Vorschau (Zertifikat/Papierliste), Abgleich-Checks, Zurückgeben (mit Begründung) / Freigeben / Rückgängig |
| 12 | Live-Termin Organisator | `12a`–`12f` | `Extern-Live-Organisator.html` | Start-/Ende-QR umschalten; Reiter Anwesenheit (Ein/Aus/Dauer/Status, Vermerk akzeptieren/nachfragen) · Fragen (nach Stimmen, beantwortet/per Mail) · Kontrollfragen (senden, Live-Balken, % richtig, schließen); „Schulung offiziell beenden“ mit Bestätigungsdialog; beendeter Zustand |
| 13 | Live-Teilnehmer | `13a`–`13i` | `Extern-Live-Teilnehmer.html` | Start-QR scannen → eingecheckt mit laufender Uhr; eingehende Kontrollfrage mit Feedback; Fragen an Trainer mit „Ich auch“ und anonym; Ende-QR scannen oder ohne QR beenden (Grund + Vermerk Pflicht); Zusammenfassung mit vollständig/teilweise; Teilnahme bestätigen |

Hinweis zu den Prototypen: Beispieldaten sind fiktiv. Zeiten sind für die Demo verkürzt (Seiten 5–8 s, Quiz 3 statt 10 Fragen). „QR-Code erkannt (Demo)“ simuliert den Scan; beim Ende-QR wird für die Demo 15:31 als Uhrzeit gesetzt, in echt zählt die Scanzeit.
