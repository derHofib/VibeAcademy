# Phase 4 – Zusammenfassung

Stand: 27.11.2026 · Branch `claude/great-sagan-5a78lf` · Plan 4.1–4.4 in `docs/PLAN.md`, Entscheidungen E-50 bis E-56 in `docs/ENTSCHEIDUNGEN.md`. Grundlage: Konzept „Schulungseinstellungen, nachträgliche Erfassung und externe Schulungen“, freigegeben mit den Empfehlungen.

## Was fertig ist

**4.1 Einstellungsseite je Schulung** (`/verwaltung/schulungen/:id/einstellungen`)
- Sieben Karten: Allgemein (inkl. Standard-Zielgruppe, Sprachen), Anlass (Erst-/Wiederholungs-/anlassbezogen mit Pflichttext, Sonstige), Durchführungsart (Online-Selbstlernen, Präsenz, Live-Online mit Plattform/Link, Extern, Kombiniert), Inhalt & Lesen, Wissenscheck, Bestätigung & Signatur (Gegenzeichnung schaltbar), Fristen & Gültigkeit (Pflichtmatrix-Status, Erinnerungsstufen).
- Anlass erscheint im Nachweis-PDF (online und Termin).
- Schnappschuss der Schulung je Durchführung: spätere Änderungen verändern laufende Einladungen und Nachweise nicht.
- Protokoll mit Vorher/Nachher; Erinnerungsstufen je Schulung in der Fristen-Engine.
- Behobener Fehler: `PATCH /trainings/:id` setzte nicht genannte Felder zurück (Zod-4-Standardwerte in `partial()`).

**4.2 Nachträgliche Erfassung, Live-Online, Teams-Import** (`/verwaltung/termine/nachtraeglich`)
- Vier Schritte: Termin (Vergangenheit, Pflichtbegründung, nur Admin/Verantwortliche) → Anwesenheit (Checkliste oder Import CSV/XLSX/Teams-Bericht, Zuordnung per E-Mail/Name, Unbekannte anlegen, Mindestanwesenheit aus der Dauer) → Beleg → Gegenzeichnung.
- Nachweis-PDF und Prüfseite: Durchführungsart mit Plattform, echtes Datum, „nachträglich erfasst am … von … (Begründung)“, Zeitquelle Import, Belege mit SHA-256.
- „Kombiniert“: nach der Gegenzeichnung Online-Bestätigung (Lesen/Wissenscheck) für alle Teilnehmenden.
- Live-Online ist technisch eine Variante des internen Termins (E-52).

**4.3 Externe Schulungen** (`/verwaltung/externe-schulungen`, Teilnehmerseite `/extern/b/:token`)
- Buchung mit Anbieter, Kontakt, Buchungsnummer, ein- oder mehrtägigen Terminen, Präsenz/Online, Anreise, Hotel, Verpflegung, Mitbringen, Kosten (netto, Kostenstelle), Anhängen, optionaler Vorgesetzten-Freigabe.
- Status je Person mit Nebenzweigen; jeder Wechsel im Protokoll.
- Einladung per Mail mit `.ics` je Tag, Aktualisierung bei Verschiebung, Kalender-Absage; ohne Mailversand Link/PDF.
- Teilnehmerseite: Details, Kalender, bestätigen, Problem melden, Bescheinigung hochladen (→ externer Nachweis, Texterkennung).
- Fristen-Engine: automatisch „teilgenommen“, Erinnerung vorher/Vortag, Upload-Aufforderung, Eskalation.
- Freigabe des Nachweises schließt die Buchung ab und aktualisiert die Pflichtmatrix; Sammelbescheinigung; Auswertung nach Kostenstelle und Person.

## Migrationen

| Nr. | Inhalt |
| --- | --- |
| 019 | Anlass, Standard-Durchführungsart, Plattform/Link, Standard-Zielgruppe; Schnappschuss je Durchführung (Trigger) |
| 020 | Live-Online-Variante, nachträglich erfasst, Import als Zeitquelle, Bestätigung durch den Dozenten, Folge-Kampagne, `run_document` |
| 021 | Prüfseite mit Durchführungsart, Datum, Vermerk |
| 022 | `external_booking`, `external_booking_day`, `external_booking_participant`, `external_booking_file` |

## Abnahme (Tests)

| Kriterium | Nachweis |
| --- | --- |
| Einstellungen, Validierung, Protokoll, Schnappschuss bis ins PDF, Erinnerungsstufen | `apps/api/test/training-settings.int.test.ts`, Web-Unit `settings-draft.test.ts`, E2E `admin-settings.spec.ts` |
| „Die fünf Sicherheitsregeln“ als Live-Online (Teams) für ein vergangenes Datum, Teams-Liste importiert, gegengezeichnet → Nachweise mit Anlass, Plattform, echtem Datum | `apps/api/test/backdated.int.test.ts`, Parser `attendance-import.test.ts`, XLSX `xlsx-rows.test.ts`, E2E `admin-backdated.spec.ts` |
| „Elektrofachkraft Hochvolt, 2 Tage, Hotel“: Buchung, Einladung mit Anreise/Hotel/.ics, Bestätigung, Upload, Freigabe, Pflichtmatrix | `apps/api/test/external-bookings.int.test.ts`, Regeln `external-booking.test.ts`, E2E `admin-external-bookings.spec.ts` |
| Bestehende Durchführungsarten unverändert | alle bisherigen Integrations- und E2E-Tests grün |

Gesamt: 123 Regel-Tests, 26 API-Unit-Tests, 224 Web-Unit-Tests, 221 API- und 40 DB-Integrationstests, sieben Playwright-Suiten grün. Screenshots: `docs/screenshots/phase-4/{einstellungen,nachtraeglich,extern}/`.

## Offen / Hinweise

- „Meine Nachweise“ (`/konto`) listet externe Buchungen noch nicht; Zugang über den persönlichen Link aus der Einladung.
- Web-Push für Einladungen externer Schulungen nicht angebunden (nur Mail); Erinnerungen per Mail.
- Freigabe durch Vorgesetzte erfolgt in der Verwaltung (Rolle „vorgesetzter“ sieht nur eigene Freigaben); ein eigener Freigabe-Eingang fehlt.
- Kosten netto ohne MwSt.-Feld; Auswertung ohne Export.
- Teams-Bericht: getestet mit deutschem/englischem Format (neu und alt); weitere Plattformen (Zoom/Meet) über die generische Tabelle (Name, E-Mail, Beitritt, Verlassen, Dauer).
- Anwesenheit unter der Mindestanwesenheit wird standardmäßig nicht angerechnet („teilweise“), außer „trotzdem anrechnen“.
