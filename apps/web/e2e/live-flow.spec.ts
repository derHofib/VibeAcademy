import { expect, test, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { API, berlinTime, E2E_ORGANIZER, inviteToken, seedLive, shareSession, type LiveSeed } from './live-seed';

/**
 * Präsenz- und Live-Ablauf gegen die echte API (Schritte 2.8, 2.11, 2.12):
 *  1. Externe Live-Schulung: Organisator legt an und startet, Teilnehmende checken per Start-QR ein (manuelle Eingabe
 *     und Deep-Link /q/:token), Kontrollfrage live per SSE, anonyme Frage + „Ich auch“, ohne QR ausloggen mit Vermerk,
 *     Vermerk akzeptieren, Ende-QR, Bestätigung + Nachweis, offizielles Ende.
 *  2. Interner Präsenztermin: Trainer-Check-in, Tablet-Kiosk mit Unterschrift, Termin beenden und gegenzeichnen.
 * Screenshots (deviceScaleFactor 1) → docs/screenshots/phase-2/live/.
 */

const SHOTS = fileURLToPath(new URL('../../../docs/screenshots/phase-2/live/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });

test.describe.configure({ mode: 'serial' });

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

let seed: LiveSeed;

test.beforeAll(async () => {
  const up = await fetch(`${API}/api/health`).then((r) => r.ok).catch(() => false);
  test.skip(!up, `API unter ${API} nicht erreichbar – Live-E2E übersprungen`);
  seed = await seedLive();
});

async function shot(page: Page, name: string, a11y = true) {
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${SHOTS}${name}.png` });
  if (a11y) await expectNoSeriousA11yViolations(page);
}

/** axe (WCAG 2.x A/AA): keine ernsten oder kritischen Verstöße */
async function expectNoSeriousA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const report = serious.map((v) => ({ id: v.id, help: v.help, targets: v.nodes.slice(0, 5).map((n) => `${n.target.join(' ')} — ${n.failureSummary ?? ''}`) }));
  expect(report, JSON.stringify(report, null, 2)).toEqual([]);
}

async function organizerPage(browser: Browser, baseURL: string) {
  const ctx = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1, locale: 'de-DE', timezoneId: 'Europe/Berlin', baseURL });
  await shareSession(seed.api, ctx, baseURL);
  return ctx.newPage();
}

async function participantPage(browser: Browser, baseURL: string, token: string) {
  const ctx = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    baseURL,
  });
  const page = await ctx.newPage();
  await page.goto(`/s/${token}`);
  await expect(page).toHaveURL(/\/teilnahme\/[0-9a-f-]{36}\/live$/);
  return page;
}

/** Aktuellen QR-Link (rotierend) von der Organisator-Seite lesen. */
async function qrUrl(org: Page, kind: 'start' | 'end'): Promise<string> {
  await org.getByRole('radio', { name: kind === 'start' ? 'Start-QR · Einchecken' : 'Ende-QR · Auschecken' }).click();
  const img = org.getByTestId(`qr-${kind}`);
  await expect(img).toBeVisible();
  const url = await img.getAttribute('data-qr-url');
  expect(url).toMatch(/\/q\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  return url!;
}

async function scanManually(p: Page, url: string) {
  const input = p.getByLabel('Code oder Link aus dem QR-Code');
  await expect(input).toBeVisible();
  await input.fill(url);
  await p.getByRole('button', { name: 'Übernehmen' }).click();
}

test('Externe Live-Schulung: anlegen, einchecken, Kontrollfrage, Fragen, Vermerk, Ende, Bestätigung', async ({ browser, baseURL }) => {
  const org = await organizerPage(browser, baseURL!);

  // ── Organisator legt an (Termine-Liste + Dialog) ──
  await org.goto('/verwaltung/termine');
  await expect(org.getByRole('heading', { name: 'Termine', level: 1 })).toBeVisible();
  await expect(org.getByRole('link', { name: 'Termine' }).first()).toHaveAttribute('aria-current', 'page');
  await org.getByRole('button', { name: 'Termin anlegen' }).first().click();
  const dlg = org.getByRole('dialog', { name: 'Termin anlegen' });
  await expect(dlg).toBeVisible();
  await dlg.getByLabel('Schulung aus dem Katalog').selectOption(seed.trainingId);
  await dlg.getByLabel('Titel', { exact: true }).fill('Erste-Hilfe-Fortbildung');
  await dlg.getByLabel('Anbieter', { exact: true }).fill('Erste-Hilfe-Ausbildung Muster e. V.');
  const from = berlinTime(-1);
  const until = berlinTime(119);
  await dlg.getByLabel('Datum', { exact: true }).fill(from.date);
  await dlg.getByLabel('Beginn', { exact: true }).fill(from.time);
  await dlg.getByLabel('Ende', { exact: true }).fill(until.time);
  await dlg.getByLabel('Ort', { exact: true }).fill('Schulungsraum Lager');
  // 2 % von 120 min = 144 s: so lässt sich „vollständig“ und „teilweise“ im Test zeigen
  await dlg.getByLabel(/Vollständig ab/).fill('2');
  await dlg.getByLabel('Personen suchen').fill(seed.suffix);
  for (const p of Object.values(seed.persons)) await dlg.getByRole('checkbox', { name: new RegExp(p.name) }).check();
  await dlg.getByRole('checkbox', { name: 'Einladung per E-Mail senden' }).uncheck();
  await expect(dlg.getByText('4 Personen ausgewählt')).toBeVisible();
  await shot(org, '12-termin-anlegen');
  await dlg.getByRole('button', { name: 'Termin anlegen' }).click();
  await expect(org).toHaveURL(/\/verwaltung\/termine\/[0-9a-f-]{36}$/);
  const runId = org.url().split('/').pop()!;

  // ── Start ──
  await expect(org.getByTestId('run-status')).toContainText('Geplant');
  await org.getByRole('button', { name: 'Schulung starten' }).click();
  await expect(org.getByTestId('run-status')).toContainText('Läuft');
  await expect(org.locator('[data-live-mode]').first()).toHaveAttribute('data-live-mode', 'sse');

  const att = await seed.api.call<{ rows: Array<{ personId: string; invitationId: string }> }>('GET', `/runs/${runId}/attendance`);
  const inv = (key: keyof LiveSeed['persons']) => att.rows.find((r) => r.personId === seed.persons[key].id)!.invitationId;

  // ── Anna: Start-QR per Sucher (manuelle Eingabe, da ohne Kamera) ──
  const a = await participantPage(browser, baseURL!, await inviteToken(seed.api, inv('anna')));
  await expect(a.getByText('Noch nicht eingecheckt')).toBeVisible();
  await a.getByRole('button', { name: 'Start-QR scannen' }).click();
  await expect(a.getByTestId('scan-start')).toBeVisible();
  await expect(a.getByLabel('Code oder Link aus dem QR-Code')).toBeVisible();
  await shot(a, '13a-start-qr-scannen');
  // Falscher Code (Ende-QR) wird sofort erkannt
  await scanManually(a, await qrUrl(org, 'end'));
  await expect(a.getByRole('alert')).toContainText('Start-QR');
  await scanManually(a, await qrUrl(org, 'start'));
  await expect(a.getByTestId('clock-card')).toBeVisible();
  const annaIn = Date.now();
  await expect(a.locator('[data-live-mode]')).toHaveAttribute('data-live-mode', 'sse');

  // ── Kai: Deep-Link /q/:token (Kamera-App des Handys) ──
  const c = await participantPage(browser, baseURL!, await inviteToken(seed.api, inv('kai')));
  const startToken = (await qrUrl(org, 'start')).split('/q/')[1]!;
  await c.goto(`/q/${startToken}`);
  await expect(c).toHaveURL(/\/teilnahme\/[0-9a-f-]{36}\/live$/);
  await expect(c.getByTestId('clock-card')).toBeVisible();

  // ── Organisator sieht beide live (SSE) ──
  await expect(org.getByText('2 anwesend')).toBeVisible();
  await expect(org.getByTestId('attendance-row').filter({ hasText: 'Jonas Krüger' })).toContainText('nicht eingecheckt');

  // ── Kontrollfrage aus dem Pool ──
  await org.getByRole('tab', { name: /^Kontrollfragen/ }).click();
  await org.getByTestId('pool-question').filter({ hasText: 'Stromunfall' }).getByRole('button', { name: 'Jetzt senden' }).click();
  await expect(org.getByTestId('active-poll')).toBeVisible();
  await expect(a.getByTestId('poll-card')).toContainText('Was tust du bei einem Stromunfall zuerst?');
  await shot(a, '13b-eingecheckt');
  await a.getByRole('button', { name: 'Den Stromkreis unterbrechen' }).click();
  await expect(a.getByText(/Richtig\. Eigenschutz zuerst/)).toBeVisible();
  await shot(a, '13h-kontrollfrage-beantwortet');
  await c.getByRole('button', { name: 'Sofort mit der Herzdruckmassage beginnen' }).click();
  await expect(c.getByText(/Nicht ganz\./)).toBeVisible();
  await expect(org.getByText('2 von 2 Eingecheckten haben geantwortet')).toBeVisible();
  await expect(org.getByTestId('active-poll')).toContainText('50 % richtig');
  await shot(org, '12f-organisator-kontrollfrage-live');

  // ── Fragen an den Trainer: Kai namentlich, Sven anonym, Anna „Ich auch“ ──
  await c.getByRole('button', { name: 'Frage an den Trainer stellen' }).click();
  const askC = c.getByRole('dialog', { name: 'Frage an den Trainer' });
  await askC.getByLabel('Deine Frage').fill('Wie oft muss der Defibrillator im Betrieb geprüft werden?');
  await askC.getByRole('button', { name: 'Frage senden' }).click();
  await expect(askC).toBeHidden();

  // Sven checkt spät ein (bleibt so unter der Mindestdauer → „teilweise“)
  const b = await participantPage(browser, baseURL!, await inviteToken(seed.api, inv('sven')));
  await b.getByRole('button', { name: 'Start-QR scannen' }).click();
  await scanManually(b, await qrUrl(org, 'start'));
  await expect(b.getByTestId('clock-card')).toBeVisible();
  await b.getByRole('button', { name: 'Frage an den Trainer stellen' }).click();
  const askB = b.getByRole('dialog', { name: 'Frage an den Trainer' });
  await askB.getByLabel('Deine Frage').fill('Darf ich als Ersthelfer Medikamente ausgeben?');
  await askB.getByRole('checkbox', { name: /Anonym stellen/ }).check();
  await shot(b, '13i-frage-stellen');
  await askB.getByRole('button', { name: 'Frage senden' }).click();
  await expect(askB).toBeHidden();

  const medA = a.getByRole('listitem').filter({ hasText: 'Medikamente' });
  await expect(medA).toContainText('anonym');
  await medA.getByRole('button', { name: /^Ich auch/ }).click();
  await expect(medA.getByRole('button', { name: /^Ich auch, 1 Stimme, unterstützt/ })).toBeVisible();
  await a.getByRole('listitem').filter({ hasText: 'Defibrillator' }).getByRole('button', { name: /^Ich auch/ }).click();
  await c.getByRole('listitem').filter({ hasText: 'Medikamente' }).getByRole('button', { name: /^Ich auch/ }).click();
  await expect(b.getByRole('listitem').filter({ hasText: 'Medikamente' })).toContainText('2');

  await org.getByRole('tab', { name: /^Fragen/ }).click();
  const orgQ = org.getByTestId('org-question');
  await expect(orgQ.first()).toContainText('Medikamente');
  await expect(orgQ.filter({ hasText: 'Medikamente' })).toContainText('anonym');
  await expect(orgQ.filter({ hasText: 'Defibrillator' })).toContainText('Kai Neumann');
  await shot(org, '12e-organisator-teilnehmerfragen');
  await orgQ.filter({ hasText: 'Defibrillator' }).getByRole('button', { name: 'Beantwortet' }).click();
  await expect(orgQ.filter({ hasText: 'Defibrillator' })).toContainText('beantwortet');
  await expect(c.getByRole('listitem').filter({ hasText: 'Defibrillator' })).toContainText('beantwortet');

  // ── Sven: ohne QR ausloggen (13d) → Zusammenfassung „teilweise“ (13f) ──
  await b.getByRole('button', { name: 'Ohne QR beenden' }).click();
  const man = b.getByRole('dialog', { name: 'Ohne QR-Code ausloggen' });
  await expect(man.getByRole('button', { name: 'Jetzt ausloggen' })).toBeDisabled();
  await man.getByRole('radio', { name: 'Vorzeitig gegangen' }).click();
  await man.getByLabel('Vermerk (Pflicht)').fill('Notdienst');
  await expect(man.getByText('Noch 1 Zeichen')).toBeVisible();
  await expect(man.getByRole('button', { name: 'Jetzt ausloggen' })).toBeDisabled();
  await man.getByLabel('Vermerk (Pflicht)').fill('Notdienst-Einsatz beim Kunden ab 13 Uhr');
  await shot(b, '13d-ohne-qr-ausloggen');
  await man.getByRole('button', { name: 'Jetzt ausloggen' }).click();
  await expect(b.getByRole('heading', { name: 'Teilnahme bestätigen' })).toBeVisible();
  await expect(b.getByTestId('summary-card')).toContainText('teilweise');
  await expect(b.getByTestId('summary-card')).toContainText('manuell');
  await expect(b.getByText('Wird vom Organisator geprüft.')).toBeVisible();
  await shot(b, '13f-bestaetigen-manuell');

  // ── Organisator: Anwesenheit mit Vermerk (12a Ende-QR, 12b Start-QR) → akzeptieren ──
  await org.getByRole('tab', { name: /^Anwesenheit/ }).click();
  const sven = org.getByTestId('attendance-row').filter({ hasText: 'Sven Albrecht' });
  await expect(sven).toContainText('Vermerk prüfen');
  await expect(sven).toContainText('Vorzeitig gegangen:');
  await qrUrl(org, 'start');
  await shot(org, '12b-organisator-start-qr');
  await qrUrl(org, 'end');
  await shot(org, '12a-organisator-ende-qr');
  await sven.getByRole('button', { name: 'Vermerk akzeptieren' }).click();
  await expect(sven).toContainText('Vermerk akzeptiert');
  await expect(b.getByText('Vom Organisator akzeptiert.')).toBeVisible();

  // ── Anna: Ende-QR (13c) nach mindestens 2 % der geplanten Dauer → „vollständig“ (13e) → bestätigt (13g) ──
  const wait = annaIn + 150_000 - Date.now();
  if (wait > 0) await a.waitForTimeout(wait);
  await a.getByRole('button', { name: 'Ende-QR scannen' }).click();
  await expect(a.getByTestId('scan-end')).toBeVisible();
  await expect(a.getByRole('button', { name: 'Abbrechen – weiter eingecheckt' })).toBeVisible();
  await shot(a, '13c-ende-qr-scannen');
  await scanManually(a, await qrUrl(org, 'end'));
  await expect(a.getByTestId('summary-card')).toContainText('vollständig');
  await expect(a.getByTestId('summary-card')).toContainText('Ende-QR');
  await a.getByRole('checkbox', { name: /Ich bestätige/ }).check();
  await shot(a, '13e-bestaetigen-ende-qr');
  await a.getByRole('button', { name: 'Teilnahme bestätigen' }).click();
  await expect(a.getByTestId('confirmed-card')).toBeVisible();
  const download = a.getByRole('link', { name: 'Nachweis herunterladen (PDF)' });
  await expect(download).toBeVisible({ timeout: 90_000 });
  await shot(a, '13g-bestaetigt');
  const [dl] = await Promise.all([a.waitForEvent('download'), download.click()]);
  expect(dl.suggestedFilename()).toMatch(/\.pdf$/);

  // ── Offiziell beenden (12c) → beendet (12d); Kai bekommt das offizielle Ende ──
  await org.getByRole('button', { name: 'Schulung offiziell beenden' }).click();
  const endDlg = org.getByRole('dialog', { name: 'Schulung jetzt offiziell beenden?' });
  await expect(endDlg).toContainText('1 Person ist');
  await shot(org, '12c-organisator-beenden-bestaetigen');
  await endDlg.getByRole('button', { name: 'Jetzt beenden' }).click();
  await expect(org.getByText('Codes deaktiviert')).toBeVisible();
  await expect(org.getByTestId('run-status')).toContainText('Beendet um');
  await expect(org.getByTestId('attendance-row').filter({ hasText: 'Kai Neumann' })).toContainText('offizielles Ende');
  await expect(org.getByTestId('attendance-row').filter({ hasText: 'Jonas Krüger' })).toContainText('nicht teilgenommen');
  await shot(org, '12d-organisator-beendet');
  await expect(c.getByRole('heading', { name: 'Teilnahme bestätigen' })).toBeVisible();
  await expect(c.getByTestId('summary-card')).toContainText('offizielles Ende');

  // ── Sven bestätigt (teilweise) → Organisator gibt die Teilzeit frei ──
  await b.getByRole('checkbox', { name: /Ich bestätige/ }).check();
  await b.getByRole('button', { name: 'Teilnahme bestätigen' }).click();
  await expect(b.getByTestId('confirmed-card')).toContainText('Wegen der Teilzeit');
  await sven.getByRole('button', { name: 'Teilzeit anrechnen' }).click();
  await expect(sven).toContainText('Anrechnung freigegeben');
  await expect(b.getByRole('link', { name: 'Nachweis herunterladen (PDF)' })).toBeVisible({ timeout: 90_000 });
});

test('Interner Präsenztermin: Trainer-Ansicht, Tablet-Kiosk mit Unterschrift, beenden und gegenzeichnen', async ({ browser, baseURL }) => {
  const now = Date.now();
  const { id: runId } = await seed.api.call<{ id: string }>('POST', '/runs/termin', {
    typ: 'termin',
    trainingId: seed.trainingId,
    titel: 'Erste Hilfe Auffrischung',
    startAt: new Date(now - 60_000).toISOString(),
    endAt: new Date(now + 90 * 60_000).toISOString(),
    ort: 'Schulungsraum Lager',
    personIds: Object.values(seed.persons).map((p) => p.id),
    sendMail: false,
  });
  // Anna checkt am Tablet ein (über die API, wie ein früherer Kiosk-Check-in)
  await seed.api.call('POST', `/runs/${runId}/attendance/checkin`, { personId: seed.persons.anna.id, method: 'kiosk' });

  const org = await organizerPage(browser, baseURL!);
  await org.goto('/verwaltung/termine');
  await expect(org.getByRole('link', { name: 'Erste Hilfe Auffrischung' }).first()).toBeVisible();
  await shot(org, '12-termine-liste');
  await org.goto(`/verwaltung/termine/${runId}`);
  await expect(org.getByText('Präsenztermin · Trainer-Ansicht')).toBeVisible();
  await org.getByRole('button', { name: 'Schulung starten' }).click();
  await expect(org.getByTestId('run-status')).toContainText('Läuft');
  await expect(org.getByText(/Code wechselt in/)).toBeVisible();
  // Trainer checkt Kai ein (ohne Smartphone)
  await org.getByRole('button', { name: 'Kai Neumann einchecken (ohne Smartphone)' }).click();
  await expect(org.getByTestId('presence-row').filter({ hasText: 'Kai Neumann' })).toContainText('eingecheckt · Trainer');
  await expect(org.getByTestId('presence-row').filter({ hasText: 'Anna Schulz' })).toContainText('eingecheckt · Tablet');
  await shot(org, '07-praesenz-trainer');

  // Tablet-Modus: Jonas checkt ohne Smartphone ein
  await org.getByRole('link', { name: 'Tablet-Modus' }).click();
  await expect(org).toHaveURL(new RegExp(`/verwaltung/termine/${runId}/kiosk$`));
  await expect(org.getByRole('heading', { name: 'Ohne Smartphone einchecken' })).toBeVisible();
  await org.getByLabel('Name suchen').fill('Jonas');
  await org.getByTestId('kiosk-person').filter({ hasText: 'Jonas Krüger' }).click();
  const inDlg = org.getByRole('dialog', { name: 'Jonas Krüger einchecken?' });
  await inDlg.getByRole('button', { name: 'Jetzt einchecken' }).click();
  await expect(org.getByText('Jonas Krüger ist eingecheckt.')).toBeVisible();
  await org.getByLabel('Name suchen').fill('');
  await shot(org, '07c-tablet-kiosk');

  // Termin beenden
  await org.getByRole('link', { name: 'Tablet-Modus verlassen' }).click();
  await org.getByRole('button', { name: 'Termin beenden' }).click();
  const endDlg = org.getByRole('dialog', { name: 'Termin jetzt beenden?' });
  await endDlg.getByRole('button', { name: 'Jetzt beenden' }).click();
  await expect(org.getByTestId('run-status')).toContainText('Beendet um');

  // Am Tablet unterschreiben
  await org.goto(`/verwaltung/termine/${runId}/kiosk`);
  await org.getByTestId('kiosk-person').filter({ hasText: 'Jonas Krüger' }).click();
  const sign = org.getByRole('dialog', { name: 'Teilnahme bestätigen – Jonas Krüger' });
  await expect(sign).toBeVisible();
  const box = (await sign.locator('canvas').boundingBox())!;
  await org.mouse.move(box.x + 30, box.y + box.height * 0.6);
  await org.mouse.down();
  for (let i = 1; i <= 24; i++) await org.mouse.move(box.x + 30 + i * 12, box.y + box.height * (0.6 - Math.sin(i / 3) * 0.25));
  await org.mouse.up();
  await expect(sign.getByRole('button', { name: 'Unterschreiben und bestätigen' })).toBeEnabled();
  await shot(org, '07d-kiosk-unterschrift');
  await sign.getByRole('button', { name: 'Unterschreiben und bestätigen' }).click();
  await expect(org.getByText('Danke, Jonas Krüger. Deine Teilnahme ist bestätigt.')).toBeVisible();

  // Gegenzeichnen mit Passwort (Step-up)
  await org.getByRole('link', { name: 'Tablet-Modus verlassen' }).click();
  await expect(org.getByTestId('presence-row').filter({ hasText: 'Jonas Krüger' })).toContainText('bestätigt · Tablet');
  await org.getByRole('button', { name: 'Termin abschließen & gegenzeichnen' }).click();
  const cs = org.getByRole('dialog', { name: 'Termin abschließen & gegenzeichnen' });
  await cs.getByLabel('Passwort zur Bestätigung').fill('falsch-falsch');
  await cs.getByRole('button', { name: 'Gegenzeichnen' }).click();
  await expect(cs.getByText(/Passwort|falsch|ungültig/i).last()).toBeVisible();
  await cs.getByLabel('Passwort zur Bestätigung').fill(E2E_ORGANIZER.password);
  await cs.getByRole('button', { name: 'Gegenzeichnen' }).click();
  await expect(org.getByTestId('countersigned')).toContainText('Gegengezeichnet von');
  await shot(org, '07b-praesenz-gegengezeichnet');

  // Jonas war nur kurz da („teilweise“) → Teilzeit anrechnen, dann entsteht der Nachweis
  await org.getByRole('button', { name: /^Teilzeit anrechnen: Jonas Krüger/ }).click();
  await expect(org.getByRole('button', { name: /^Teilzeit anrechnen: Jonas Krüger/ })).toBeHidden();
  await expect
    .poll(async () => {
      const r = await seed.api.call<{ rows: Array<{ personName: string; evidence: { status: string } | null; confirmedAt: string | null }> }>('GET', `/runs/${runId}/attendance`);
      const j = r.rows.find((x) => x.personName === 'Jonas Krüger');
      return !!j?.confirmedAt && !!j.evidence;
    }, { timeout: 30_000 })
    .toBe(true);
});

test('Aushang drucken und Check-in ohne Einladung (Deep-Link)', async ({ browser, baseURL }) => {
  const now = Date.now();
  const { id: runId } = await seed.api.call<{ id: string }>('POST', '/runs/termin', {
    typ: 'live_extern',
    titel: 'Erste-Hilfe-Fortbildung',
    provider: 'Erste-Hilfe-Ausbildung Muster e. V.',
    startAt: new Date(now + 10 * 60_000).toISOString(),
    endAt: new Date(now + 70 * 60_000).toISOString(),
    ort: 'Schulungsraum Lager',
    sendMail: false,
  });
  const org = await organizerPage(browser, baseURL!);
  await org.goto(`/verwaltung/termine/${runId}/aushang?art=start`);
  await expect(org.getByRole('heading', { name: 'Erste-Hilfe-Fortbildung' })).toBeVisible();
  await expect(org.getByRole('img', { name: 'Start-QR-Code zum Einchecken' })).toBeVisible();
  await expect(org.getByText(/Gültig .* bis /)).toBeVisible();
  await shot(org, '12g-aushang-drucken');

  // Check-in ohne Einladung: Kamera-App öffnet /q/:token ohne Sitzung → Name + E-Mail → eingecheckt
  await org.goto(`/verwaltung/termine/${runId}`);
  const token = (await qrUrl(org, 'start')).split('/q/')[1]!;
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: 'de-DE', timezoneId: 'Europe/Berlin', baseURL });
  const w = await ctx.newPage();
  await w.goto(`/q/${token}`);
  await expect(w.getByRole('heading', { name: 'Einchecken ohne Einladung' })).toBeVisible();
  await w.getByLabel('Vor- und Nachname').fill('Lea Wagner');
  await w.getByLabel('E-Mail-Adresse').fill(`live-lea-${seed.suffix}@example.org`);
  await shot(w, '13j-einchecken-ohne-einladung');
  await w.getByRole('button', { name: 'Einchecken' }).click();
  await expect(w).toHaveURL(/\/teilnahme\/[0-9a-f-]{36}\/live$/);
  await expect(w.getByTestId('clock-card')).toBeVisible();
  await expect(w.getByText('Die Zeit zählt ab dem geplanten Beginn', { exact: false })).toBeVisible();
  await expect(org.getByTestId('attendance-row').filter({ hasText: 'Lea Wagner' })).toContainText('anwesend');
});
