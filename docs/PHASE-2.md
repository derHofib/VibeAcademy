# Phase 2 – Zusammenfassung

Stand: 26.11.2026 · Branch `claude/great-sagan-5a78lf` · Details je Schritt in `docs/PLAN.md`, Entscheidungen E-29 bis E-35 in `docs/ENTSCHEIDUNGEN.md`.

## Was fertig ist

- **Präsenz intern (Screen 7)**: Termin anlegen, rotierender QR mit Countdown, Anwesenheitsliste, Tablet-Kiosk für Personen ohne Smartphone (mit Unterschrift), Ende, Gegenzeichnung des Trainers per Passwort → Einzelnachweise.
- **Live-Erfassung externer Schulungen (Screens 12/13)**: Start-/Ende-QR (30 s, signiert, an Termin + Art gebunden), Beamer-Vollbild, Aushang mit Zeitfenster, Ein-/Auschecken als Intervalle, Ausloggen ohne QR mit Grund + Vermerk („Vermerk prüfen“ beim Organisator), offizielles Ende mit Push zur Bestätigung, Zusammenfassung vollständig/teilweise, Teilnahmebestätigung, versiegelter Nachweis.
- **Fragen und Kontrollfragen live (SSE)**: anonyme Fragen ohne Personenbezug, „Ich auch“ einmal je Person, Sortierung nach Stimmen, beantwortet/per Mail; Kontrollfragen aus Pool oder spontan, Stimmungsbild (anonym) vs. Wissenscheck (personenbezogen, im Nachweis), Live-Auswertung, Nachholen nach dem Ende.
- **Pflichtmatrix**: Qualifikationen, Anforderungen (Intervall, Kulanz, Wiedereinladung), Ausnahmen; Status je Person × Anforderung (gültig, läuft ab, abgelaufen, fehlt, befreit); Vorgesetzte sehen nur den Status ihres Teams.
- **Fristen-Engine**: nächtlich, Erinnerungen T−7/T−2/T+1, überfällig, Eskalation an Vorgesetzte, automatische Wiedereinladung, „neuen Termin buchen“ bei externen Kursen, Neueinladung bei inhaltlich neuer Version; jede Stufe genau einmal.
- **Externe Nachweise (Screens 9–11)**: Verwaltung erfasst (einzeln/Gruppe, eine Liste oder je Person, „Was sich ändert“), Mitarbeiter reicht mobil ein (Foto → Texterkennung als Vorschlag mit Markierungen → Zeitleiste), Import CSV + ZIP (Probelauf, alles oder nichts); Prüfansicht mit Abweichungs-Hinweisen, Zurückgeben mit Begründung, Freigeben (Vier-Augen-Prinzip), Rückgängig als Widerruf, versiegelter Nachweis mit Beleg als Anlage, Anrechnung mit `valid_until`.
- **Nachweismappe**: Export als ZIP mit versiegeltem Verzeichnis-PDF, CSV und allen Nachweisen; Dashboard mit Erfüllungsquote und „läuft in 30 Tagen ab“.
- **Web-Push**: Abos je Gerät, Opt-in auf „Meine Nachweise“; aktiv, sobald VAPID-Schlüssel gesetzt sind.
- **Meine Nachweise** zeigt jetzt alle Arten (online, Präsenz, Live, extern).

## Abnahmekriterien Phase 2

| Kriterium | Nachweis |
| --- | --- |
| QR-Tokens rotieren alle 30 s, signiert, an Termin + Art gebunden; gedruckte Codes nur im Zeitfenster; Serverzeit | `packages/shared/src/rules/qr.test.ts`, `apps/api/test/presence.int.test.ts` |
| Intervalle, Dauer, Vollständigkeit (≥ 90 %) inkl. Wiedereintritt, vergessenes Auschecken, manuelles Ausloggen | `packages/shared/src/rules/attendance.test.ts`, `presence.int.test.ts` |
| Manuelles Ausloggen nur mit Grund + Vermerk ≥ 10 Zeichen, „Vermerk prüfen“ (akzeptieren/nachfragen) | `presence.int.test.ts`, E2E `apps/web/e2e/live-flow.spec.ts` |
| „Offiziell beenden“ setzt Ende für alle Eingecheckten, deaktiviert QR, fordert per Push zur Bestätigung auf | `presence.int.test.ts`, E2E |
| Live-Fragen anonym, „Ich auch“ einmal, Sortierung, Status; Kontrollfragen in Echtzeit, Auswertung, Modus korrekt im Nachweis | `presence.int.test.ts` (SSE-Client), `packages/db/test/presence.int.test.ts`, E2E |
| Externe Nachweise: drei Wege, OCR nur Vorschlag, Abweichungs-Hinweise, versiegelter Nachweis mit Beleg, Anrechnung mit `valid_until` | `apps/api/test/external.int.test.ts`, E2E `external-flow.spec.ts` |
| Fristen-Engine mit Zeitreise-Tests | `packages/shared/src/rules/deadlines.test.ts`, `apps/api/test/deadlines.int.test.ts` (14 Monate) |
| UI wie Screens 7, 9–13 in allen Zuständen | `docs/screenshots/phase-2/{live,external}/`, axe ohne schwere Verstöße |

Testumfang gesamt: 96 API-Integrationstests, 40 DB-Integrationstests, 84 Regel-Tests, 159 Web-Unit-Tests, sechs Playwright-Abläufe gegen die echte API (Phase 1 + 2) in der CI.

## Bewusste Abweichungen

- Pflichtmatrix hatte kein Mockup; Gestaltung im Stil der Screens 9/11 (bitte prüfen).
- Kamera-Scan statt Demo-Knopf „QR-Code erkannt“; ohne Kamera manuelle Eingabe.
- Papierlisten: Texterkennung markiert nur das Datum; Unterschriften werden je Person per Schalter geprüft.
- Live-Organisator-Ansicht ohne Seitenleiste (wie 12a); Verwaltungsseiten mit Seitenleiste.
- Rückgängig nach Freigabe = Widerruf (der versiegelte Nachweis bleibt, `/verify` zeigt „widerrufen“).

## Offen

- Sammelnachweis je Termin (ein PDF für alle), Agenda-Abhaken (Screen 7), ICS-Anhang für Termine.
- „Ausnahme beantragen“ durch Vorgesetzte (bisher nur Verantwortliche).
- Web-Push nur mit VAPID-Schlüsseln aktiv; echter Abo-Ablauf mangels Schlüssel nur per Unit-Test geprüft.
- Nachweismappe synchron bis 5.000 Nachweise; OCR läuft im API-Prozess (später eigener Worker).
- Unverändert aus Phase 1: Mailanbieter, Siegelzertifikat/TSA, Docker-Stack auf echtem Host prüfen, Standardwerte mit der Fachkraft für Arbeitssicherheit abstimmen, DSFA/Betriebsvereinbarung.

## Phase 3

Laut Prompt erst nach Rücksprache: SSO/SCIM, REST-API + Webhooks, Seiten-Diff bei neuen Versionen, Mehrsprachigkeit, optional FES/QES.
