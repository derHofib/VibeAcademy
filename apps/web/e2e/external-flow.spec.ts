import { expect, test, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { API, ApiClient, latestOtp } from './participant-seed';

/**
 * Externe Nachweise + Pflichtmatrix (Phase 2, 2.9/2.10/2.13) gegen die echte API inkl. Tesseract-OCR:
 *  1. Verwaltung erfasst eine Gruppe mit einer Teilnahmeliste → versiegelte Nachweise (9a/9b)
 *  2. Mitarbeiterin (Konto mit Person verknüpft, E-34) fotografiert ihre Bescheinigung auf 390 px → OCR-Vorschläge → einreichen (10a/10b)
 *  3. Verwaltung prüft (Zertifikat 11a, Papierliste 11b) und gibt frei (11c)
 *  4. Mitarbeiterin sieht den Nachweis, Pflichtmatrix zeigt „gültig“, Dashboard-KPIs, Nachweismappe als ZIP
 * Screenshots (deviceScaleFactor 1) nach docs/screenshots/phase-2/external/.
 */

const SHOTS = fileURLToPath(new URL('../../../docs/screenshots/phase-2/external/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });

test.describe.configure({ mode: 'serial' });

const suffix = randomUUID().slice(0, 8);
const ADMIN = { name: 'Dennis Hofmann', organisation: 'Muster Elektrotechnik GmbH', email: `e2e-extern-${suffix}@example.org`, password: 'e2e-extern-passwort-1' };
const LEA = { name: 'Lea Wagner', email: `e2e-extern-lea-${suffix}@example.org`, password: 'e2e-extern-lea-pass-1' };
const MEHMET = { name: 'Mehmet Aydın', email: `e2e-extern-mehmet-${suffix}@example.org`, password: 'e2e-extern-mehmet-1' };
const HELD_ON = '2026-11-20';

interface Seed {
  persons: Record<string, string>;
  ersthelferReq: string;
  leaRecordId?: string;
}
let seed: Seed;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Testbelege (HTML → Bild/PDF) ─────────────────────────────
const paper = (body: string) => `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
  body{margin:0;background:#FFFDF8;font-family:Inter,Arial,sans-serif;color:#2a2a2a}
  .p{padding:64px 72px;width:656px;min-height:900px;box-sizing:border-box;display:flex;flex-direction:column;gap:14px;font-size:21px;line-height:1.5}
  .h{font-size:15px;letter-spacing:.08em;color:#555}.t{font-size:34px;font-weight:700;color:#111;margin:4px 0 12px}
  .b{font-weight:700;color:#111;font-size:24px}.f{margin-top:auto;display:flex;justify-content:space-between;align-items:flex-end}
  .sig{font-family:'Brush Script MT',cursive;font-size:30px;color:#34458A}.st{width:84px;height:84px;border-radius:50%;border:3px solid #C0504D;color:#C0504D;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;transform:rotate(-12deg)}
  table{border-collapse:collapse;width:100%;margin-top:8px}td{border-bottom:1px solid #d8d2c4;padding:12px 0;font-size:21px}td.s{font-family:'Brush Script MT',cursive;color:#34458A;font-size:26px}
</style></head><body><div class="p">${body}</div></body></html>`;

const CERT_LEA = paper(`<div class="h">ERSTE-HILFE-AUSBILDUNG MUSTER E. V.</div><div class="t">Teilnahmebescheinigung</div>
  <div>Hiermit wird bestätigt, dass</div><div class="b">Lea Wagner</div><div>am 20.11.2026 an der</div>
  <div class="b">Erste-Hilfe-Fortbildung (9 UE)</div><div>gemäß DGUV Grundsatz 304-001 teilgenommen hat.</div>
  <div class="f"><span class="sig">M. Muster</span><span class="st">STEMPEL</span></div>`);
const LIST_GROUP = paper(`<div class="h">ERSTE-HILFE-AUSBILDUNG MUSTER E. V.</div><div class="t">Teilnahmeliste</div>
  <div>Erste-Hilfe-Fortbildung am 20.11.2026, Schulungsraum Lager</div>
  <table><tr><td>Anna Schulz</td><td class="s">A. Schulz</td></tr><tr><td>Tobias Meier</td><td class="s">T. Meier</td></tr>
  <tr><td>Julia Becker</td><td class="s">J. Becker</td></tr><tr><td>Kai Neumann</td><td class="s">K. Neumann</td></tr></table>
  <div class="f"><span class="sig">M. Muster</span><span class="st">STEMPEL</span></div>`);
const LIST_TIEFBAU = paper(`<div class="h">MUSTER ELEKTROTECHNIK GMBH · BAUSTELLE LADEPARK NORD</div><div class="t">Unterweisung vor Arbeitsbeginn</div>
  <div>23.11.2026 · Thema: Arbeiten im Bereich der Ladeinfrastruktur</div>
  <table><tr><td>Kemal Arslan</td><td class="s">K. Arslan</td></tr><tr><td>Piotr Nowak</td><td class="s">~~</td></tr>
  <tr><td>Jan Fischer</td><td class="s">J. Fischer</td></tr><tr><td>Ali Demir</td><td class="s">^</td></tr><tr><td>Marco Russo</td><td class="s">M. Russo</td></tr></table>
  <div class="f"><span class="sig">D. Hofmann</span><span class="st">STEMPEL</span></div>`);
const PDF_MEHMET = paper(`<div class="h">LOGISTIKPARTNER BEISPIEL GMBH</div><div class="t">Bestätigung der Unterweisung</div>
  <div>Teilnehmer: Mehmet Aydın</div><div>Thema: Sicherer Umgang mit Gabelstaplern</div><div>Datum: ____________</div>
  <div>Unterweisender: K. Beispiel</div><div class="f"><span class="sig">K. Beispiel</span><span class="st">STEMPEL</span></div>`);

async function render(browser: Browser, html: string, kind: 'png' | 'jpeg' | 'pdf'): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: 656, height: 900 }, deviceScaleFactor: 2 });
  await page.setContent(html);
  const out = kind === 'pdf' ? await page.pdf({ width: '656px', height: '900px', printBackground: true }) : await page.screenshot({ type: kind, fullPage: true, ...(kind === 'jpeg' ? { quality: 85 } : {}) });
  await page.close();
  return out;
}
const files: Record<string, Buffer> = {};

// ── Hilfen ───────────────────────────────────────────────────
async function shot(page: Page, name: string, opts: { fullPage?: boolean } = {}) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}${name}.png`, fullPage: opts.fullPage ?? false });
  await expectNoSeriousA11yViolations(page);
}

async function expectNoSeriousA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const report = serious.map((v) => ({ id: v.id, help: v.help, targets: v.nodes.slice(0, 5).map((n) => `${n.target.join(' ')} — ${n.failureSummary ?? ''}`) }));
  expect(report, JSON.stringify(report, null, 2)).toEqual([]);
}

async function login(page: Page, who: { email: string; password: string }, next: string) {
  await page.goto(`/anmelden?weiter=${encodeURIComponent(next)}`);
  await page.getByLabel('E-Mail').fill(who.email);
  await page.getByLabel('Passwort').fill(who.password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(new RegExp(next.replace(/[/?]/g, (c) => `\\${c}`)));
}

/** Teilnehmerkonto anlegen, E-Mail per Code bestätigen und mit der Person verknüpfen (E-25/E-34). */
async function linkedAccount(who: { name: string; email: string; password: string }, personId: string) {
  const c = new ApiClient();
  await c.call('GET', '/auth/csrf');
  await c.call('POST', '/auth/register-account', who);
  await c.call('POST', '/auth/email/verify-request');
  await c.call('POST', '/auth/email/verify', { code: await latestOtp(who.email) });
  await c.call('POST', '/me/link', { personIds: [personId] });
  return c;
}

test.beforeAll(async ({ browser }) => {
  const up = await fetch(`${API}/api/health`).then((r) => r.ok).catch(() => false);
  test.skip(!up, `API unter ${API} nicht erreichbar – Extern-E2E übersprungen`);
  test.setTimeout(240_000);

  files.lea = await render(browser, CERT_LEA, 'png');
  files.groupPdf = await render(browser, LIST_GROUP, 'pdf');
  files.groupJpg = await render(browser, LIST_GROUP, 'jpeg');
  files.tiefbau = await render(browser, LIST_TIEFBAU, 'png');
  files.mehmet = await render(browser, PDF_MEHMET, 'pdf');

  const a = new ApiClient();
  await a.call('GET', '/auth/csrf');
  await a.call('POST', '/auth/register', ADMIN);
  const unit = async (name: string) => (await a.call<{ id: string }>('POST', '/org-units', { name })).id;
  const lager = await unit('Lager');
  const service = await unit('Service');
  const tiefbau = await unit('Fremdfirma Tiefbau');
  const people: Array<[string, string, string | null, string | null, boolean]> = [
    ['Anna Schulz', '1031', lager, null, false],
    ['Tobias Meier', '1022', service, null, false],
    ['Julia Becker', '1058', service, null, false],
    ['Kai Neumann', '1019', lager, null, false],
    ['Lea Wagner', '1047', service, LEA.email, false],
    ['Mehmet Aydın', '1012', lager, MEHMET.email, false],
    ['Kemal Arslan', 'T-01', tiefbau, null, true],
    ['Piotr Nowak', 'T-02', tiefbau, null, true],
    ['Jan Fischer', 'T-03', tiefbau, null, true],
    ['Ali Demir', 'T-04', tiefbau, null, true],
    ['Marco Russo', 'T-05', tiefbau, null, true],
    ['Sven Albrecht', '1008', service, null, false],
    ['Jonas Krüger', '1033', lager, null, false],
    ['Sabine Roth', '1041', lager, null, false],
    ['Paul Weber', '1064', lager, null, false],
  ];
  const persons: Record<string, string> = {};
  for (const [name, personalnr, orgUnitId, email, extern] of people) {
    persons[name] = (await a.call<{ id: string }>('POST', '/persons', { name, personalnr, orgUnitId, email, extern })).id;
  }
  const training = async (titel: string) => (await a.call<{ id: string }>('POST', '/trainings', { titel, format: 'extern', confirmText: 'Externe Schulung – Nachweis per Beleg.' })).id;
  const tEH = await training('Erste-Hilfe-Fortbildung');
  const tFFZ = await training('Unterweisung Flurförderzeuge');
  const qEH = (await a.call<{ id: string }>('POST', '/qualifications', { name: 'Ersthelfer', description: 'Betriebliche Ersthelfer nach DGUV Vorschrift 1' })).id;
  const qFFZ = (await a.call<{ id: string }>('POST', '/qualifications', { name: 'Staplerfahrer' })).id;
  await a.call('POST', `/qualifications/${qEH}/persons`, {
    personIds: ['Anna Schulz', 'Tobias Meier', 'Kai Neumann', 'Lea Wagner', 'Sven Albrecht', 'Jonas Krüger'].map((n) => persons[n]),
  });
  await a.call('POST', `/qualifications/${qFFZ}/persons`, { personIds: ['Mehmet Aydın', 'Kai Neumann', 'Jonas Krüger', 'Sabine Roth', 'Paul Weber'].map((n) => persons[n]) });
  const rEH = (await a.call<{ id: string }>('POST', '/requirements', { qualificationId: qEH, trainingId: tEH, intervalMonths: 24 })).id;
  const rFFZ = (await a.call<{ id: string }>('POST', '/requirements', { qualificationId: qFFZ, trainingId: tFFZ, intervalMonths: 12 })).id;
  // Vorgeschichte (sofort angerechnet): abgelaufen, läuft bald ab, gültig
  const history: Array<[string, string, string]> = [
    ['Anna Schulz', rEH, '2024-10-01'],
    ['Tobias Meier', rEH, '2024-12-10'],
    ['Kai Neumann', rEH, '2024-12-22'],
    ['Lea Wagner', rEH, '2025-05-10'],
    ['Kai Neumann', rFFZ, '2026-02-03'],
    ['Sven Albrecht', rEH, '2024-09-02'],
    ['Jonas Krüger', rEH, '2024-12-14'],
    ['Jonas Krüger', rFFZ, '2025-12-18'],
  ];
  for (const [name, requirementId, heldOn] of history) {
    await a.call('POST', '/external-records', { mode: 'einzel', personIds: [persons[name]], requirementId, heldOn, provider: 'Erste-Hilfe-Ausbildung Muster e. V.' });
  }
  await a.call('POST', '/compliance/exemptions', { personId: persons['Sabine Roth'], requirementId: rFFZ, reason: 'Kein Staplereinsatz bis Ende der Elternzeit', validUntil: '2027-06-30' });
  // Papierliste der Fremdfirma (11b): von der Verwaltung erfasst, zwei Unterschriften unleserlich → „Zu prüfen“
  const form = new FormData();
  form.append('datei', new Blob([new Uint8Array(files.tiefbau!)], { type: 'image/png' }), 'Anwesenheitsliste_23-11.png');
  const up1 = await a.call<{ id: string }>('POST', '/external-uploads', form, true);
  const tb = ['Kemal Arslan', 'Piotr Nowak', 'Jan Fischer', 'Ali Demir', 'Marco Russo'].map((n) => persons[n]!);
  await a.call('POST', '/external-records', {
    mode: 'gruppe',
    personIds: tb,
    freeTitle: 'Baustellen-Unterweisung (Papierliste)',
    provider: 'Tiefbau Muster GmbH',
    location: 'Baustelle Ladepark Nord',
    heldOn: '2026-11-23',
    receipts: { mode: 'one', uploadIds: [up1.id], perPerson: [] },
    flags: [
      { personId: persons['Piotr Nowak'], code: 'unterschrift_unleserlich', note: 'Zeile 2' },
      { personId: persons['Ali Demir'], code: 'unterschrift_unleserlich', note: 'Zeile 4' },
    ],
    review: true,
  });
  // Mehmet reicht selbst ein PDF ohne Datum ein (11a: „Datum fehlt“)
  const m = await linkedAccount(MEHMET, persons['Mehmet Aydın']!);
  const mf = new FormData();
  mf.append('dateien', new Blob([new Uint8Array(files.mehmet!)], { type: 'application/pdf' }), 'Stapler_Unterweisung.pdf');
  mf.append('requirementId', rFFZ);
  mf.append('provider', 'Logistikpartner Beispiel GmbH');
  mf.append('submit', 'true');
  await m.call('POST', '/me/external-records', mf, true);
  // Lea: Konto mit Person verknüpft (reicht im Test selbst ein)
  await linkedAccount(LEA, persons['Lea Wagner']!);
  seed = { persons, ersthelferReq: rEH };
  // Gemeinsame OCR-Läufe abwarten, damit die Prüfansicht stabil ist
  for (let i = 0; i < 60; i++) {
    const r = await a.call<{ items: Array<{ ocrStatus: string }> }>('GET', '/external-records?status=eingereicht');
    if (r.items.every((x) => x.ocrStatus !== 'ausstehend')) break;
    await sleep(1000);
  }
});

test('9a/9b: Verwaltung erfasst eine Gruppe mit einer Teilnahmeliste', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, ADMIN, '/verwaltung/extern/neu');
  await expect(page.getByRole('heading', { name: 'Externe Schulung erfassen' })).toBeVisible();
  // Nav-Zähler „Externe Nachweise“ (2 Vorgänge zu prüfen)
  await expect(page.getByRole('link', { name: /Externe Nachweise\s*, 2 offen/ })).toBeVisible();

  await expect(page.getByRole('radio', { name: 'Gruppe' })).toHaveAttribute('data-state', 'on');
  await expect(page.getByLabel('Zuordnung zur Pflichtschulung')).toHaveValue(`req:${seed.ersthelferReq}`);
  await page.getByLabel('Anbieter', { exact: true }).fill('Erste-Hilfe-Ausbildung Muster e. V.');
  await page.getByLabel('Ort', { exact: true }).fill('Schulungsraum Lager');
  await page.getByLabel('Datum', { exact: true }).fill(HELD_ON);
  await page.getByLabel('Umfang', { exact: true }).fill('9 UE (1 Tag)');
  for (const name of ['Anna Schulz', 'Tobias Meier', 'Julia Becker', 'Kai Neumann']) {
    await page.getByLabel('Person hinzufügen').selectOption({ label: name.includes('Kai') ? 'Kai Neumann · 1019' : `${name} · ${{ 'Anna Schulz': '1031', 'Tobias Meier': '1022', 'Julia Becker': '1058' }[name]}` });
  }
  await expect(page.getByText('4 Personen')).toBeVisible();
  // Entfernen und wieder hinzufügen (Chip ×)
  await page.getByRole('button', { name: 'Julia Becker entfernen' }).click();
  await expect(page.getByText('3 Personen')).toBeVisible();
  await page.getByLabel('Person hinzufügen').selectOption({ label: 'Julia Becker · 1058' });
  // Kai wieder ans Ende (Reihenfolge wie im Mockup)
  await page.getByRole('button', { name: 'Kai Neumann entfernen' }).click();
  await page.getByLabel('Person hinzufügen').selectOption({ label: 'Kai Neumann · 1019' });

  await page.getByTestId('beleg-input').setInputFiles([
    { name: 'Teilnahmebescheinigungen_20-11.pdf', mimeType: 'application/pdf', buffer: files.groupPdf! },
    { name: 'Anwesenheitsliste_Scan.jpg', mimeType: 'image/jpeg', buffer: files.groupJpg! },
  ]);
  await expect(page.getByTestId('beleg-datei').filter({ hasText: 'hochgeladen' })).toHaveCount(2);

  const effect = page.getByTestId('was-sich-aendert');
  await expect(effect.getByText('Ersthelfer gültig bis')).toBeVisible();
  await expect(effect.getByText('20.11.2028')).toBeVisible();
  await expect(effect.getByTestId('wirkung-person')).toHaveCount(4);
  await expect(effect.getByTestId('wirkung-person').filter({ hasText: 'Anna Schulz' })).toContainText('abgelaufen');
  await expect(effect.getByTestId('wirkung-person').filter({ hasText: 'Tobias Meier' })).toContainText('läuft ab 12/26');
  await expect(effect.getByTestId('wirkung-person').filter({ hasText: 'Julia Becker' })).toContainText('neu');
  await expect(effect.getByTestId('wirkung-person').first()).toContainText('bis 11/28');
  await shot(page, '09a-extern-erfassen-gruppe', { fullPage: true });

  await page.getByRole('button', { name: 'Speichern und anrechnen' }).click();
  await expect(page.getByRole('button', { name: 'Gespeichert' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('4 Nachweise angelegt und versiegelt. Status im Dashboard aktualisiert.')).toBeVisible();
  await shot(page, '09b-extern-erfassen-gespeichert', { fullPage: true });
});

test('10a/10b: Mitarbeiterin reicht ein Foto mobil ein (OCR-Vorschläge)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, LEA, '/konto');
  await expect(page.getByTestId('extern-einstieg')).toBeVisible();
  await page.getByRole('link', { name: 'Nachweis einreichen' }).click();
  await expect(page).toHaveURL(/\/konto\/extern\/neu$/);
  await expect(page.getByRole('button', { name: 'Foto aufnehmen' })).toBeVisible();
  await expect(page.getByTestId('kamera-input')).toHaveAttribute('capture', 'environment');
  await page.getByTestId('kamera-input').setInputFiles({ name: 'Foto_Bescheinigung.png', mimeType: 'image/png', buffer: files.lea! });
  await expect(page).toHaveURL(/\/konto\/extern\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  seed.leaRecordId = page.url().split('/').pop();

  // OCR fertig: Name passt, Felder vorbelegt, Rahmen auf dem Foto
  await expect(page.getByText('Name passt')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('ocr-rahmen').first()).toBeAttached();
  expect(await page.getByTestId('ocr-rahmen').count()).toBeGreaterThanOrEqual(2);
  await expect(page.getByLabel('Datum', { exact: true })).toHaveValue(HELD_ON);
  await expect(page.getByLabel('Kurs', { exact: true })).toHaveValue('Erste-Hilfe-Fortbildung');
  await expect(page.getByLabel('Anbieter', { exact: true })).toHaveValue(/Erste-Hilfe-Ausbildung Muster e\. ?V\./);
  await expect(page.getByLabel('Umfang', { exact: true })).toHaveValue('9 UE');
  await expect(page.getByTestId('anrechnung')).toContainText('Wird angerechnet auf Ersthelfer – gültig bis 20.11.2028');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, '10a-extern-einreichen-mobil');

  await page.getByRole('button', { name: 'Zur Prüfung einreichen' }).click();
  await expect(page.getByRole('heading', { name: 'Eingereicht' })).toBeVisible();
  await expect(page.getByText(/liegt jetzt bei .* zur Prüfung/)).toBeVisible();
  const tl = page.getByTestId('zeitleiste');
  await expect(tl.locator('li[data-state="done"]')).toContainText('Eingereicht');
  await expect(tl.locator('li[data-state="current"]')).toContainText('In Prüfung');
  await expect(tl.locator('li[data-state="open"]')).toContainText('Wird auf „Ersthelfer“ angerechnet');
  await shot(page, '10b-extern-einreichen-mobil-eingereicht');
});

test('11a–11c: Verwaltung prüft Zertifikat und Papierliste, gibt frei', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, ADMIN, '/verwaltung/extern');
  await expect(page.getByRole('button', { name: 'Zu prüfen · 3' })).toHaveAttribute('aria-pressed', 'true');
  const cards = page.getByTestId('extern-fall');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText('Lea Wagner');
  await expect(cards.nth(0)).toContainText('selbst eingereicht · Foto');
  await expect(cards.filter({ hasText: 'Mehmet Aydın' })).toContainText('Datum fehlt');
  await expect(cards.filter({ hasText: 'Tiefbau Muster GmbH · 5 Personen' })).toContainText('2 Unterschriften prüfen');

  // 11a: Zertifikat
  await expect(cards.nth(0)).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('pruefung-person')).toContainText('Lea Wagner · Pers.-Nr. 1047');
  await expect(page.getByTestId('pruefung-person')).toContainText('Name stimmt mit Beleg überein');
  await expect(page.getByTestId('pruefung-datum')).toHaveAttribute('data-state', 'ok');
  await expect(page.getByTestId('pruefung-gueltigkeit')).toContainText('bis 20.11.2028');
  await expect(page.getByTestId('wirkung')).toContainText('Lea Wagner: Ersthelfer gültig bis 20.11.2028 (bisher bis 05/2027).');
  await expect(page.getByTestId('ocr-rahmen').first()).toBeAttached();
  await shot(page, '11a-extern-pruefen-zertifikat');

  // 11b: Papierliste mit markierten Unterschriften
  await cards.filter({ hasText: 'Tiefbau Muster GmbH' }).click();
  await expect(page.getByTestId('pruefung-unterschriften')).toContainText('2 unleserlich');
  await expect(page.getByTestId('pruefung-unterschriften')).toContainText('Zeile 2, Zeile 4 prüfen');
  await expect(page.getByTestId('listen-person')).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Unterschrift Piotr Nowak: prüfen' })).toBeVisible();
  await expect(page.getByTestId('wirkung')).toContainText('Alle 5 Personen erhalten den Nachweis „Baustellen-Unterweisung (Papierliste)“');
  await shot(page, '11b-extern-pruefen-papierliste');

  // Zurückgeben braucht eine Begründung (Mehmet, Datum fehlt)
  await cards.filter({ hasText: 'Mehmet Aydın' }).click();
  await expect(page.getByTestId('pruefung-datum')).toHaveAttribute('data-state', 'warn');
  await page.getByRole('button', { name: 'Zurückgeben', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nachweis zurückgeben' });
  await dialog.getByRole('button', { name: 'Zurückgeben senden' }).click();
  await expect(dialog.getByText('Bitte eine Begründung mit mindestens 5 Zeichen angeben.')).toBeVisible();
  await page.keyboard.press('Escape');

  // 11c: Lea freigeben
  await cards.filter({ hasText: 'Lea Wagner' }).click();
  await page.getByRole('button', { name: 'Freigeben', exact: true }).click();
  await expect(page.getByText('Nachweis versiegelt, Beleg angehängt, Pflichtmatrix aktualisiert.')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: /^Rückgängig \(\d+:\d\d\)$/ })).toBeVisible();
  await expect(cards.filter({ hasText: 'Lea Wagner' })).toContainText('freigegeben');
  await expect(page.getByRole('button', { name: 'Zu prüfen · 2' })).toBeVisible();
  await expect(page.getByTestId('nachweise')).toContainText('Lea Wagner', { timeout: 60_000 });
  await shot(page, '11c-extern-pruefen-freigegeben');
});

test('Mitarbeiterin sieht den versiegelten Nachweis', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, LEA, `/konto/extern/${seed.leaRecordId}`);
  await expect(page.getByRole('heading', { name: 'Freigegeben' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Nachweis herunterladen' })).toBeVisible({ timeout: 60_000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Nachweis herunterladen' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/\.pdf$/);
  await page.goto('/konto');
  await expect(page.getByTestId('extern-einstieg')).toBeVisible();
  await shot(page, '390-konto-extern', { fullPage: true });
  const card = page.getByTestId('nachweis-erledigt').filter({ hasText: 'Erste-Hilfe-Fortbildung' }).filter({ has: page.getByTestId('nachweis-art') }).first();
  await expect(card.getByTestId('nachweis-art')).toHaveText('Extern');
  await expect(card.getByRole('link', { name: /^Nachweis herunterladen/ })).toHaveAttribute('href', /\/api\/me\/external-records\/.+\/evidence\/pdf$/);
});

test('Pflichtmatrix, Dashboard und Nachweismappe', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, ADMIN, '/verwaltung/pflichtmatrix');
  await expect(page.getByRole('heading', { name: 'Pflichtmatrix' })).toBeVisible();
  const lea = page.getByTestId('matrix-person').filter({ hasText: 'Lea Wagner' });
  await expect(lea.getByTestId('matrix-zelle')).toHaveAttribute('data-state', 'gueltig');
  await expect(lea.getByTestId('matrix-zelle')).toContainText('bis 11/28');
  await expect(page.getByTestId('matrix-person').filter({ hasText: 'Anna Schulz' }).getByTestId('matrix-zelle').first()).toHaveAttribute('data-state', 'gueltig');
  await expect(page.getByTestId('matrix-person').filter({ hasText: 'Mehmet Aydın' }).getByTestId('matrix-zelle')).toHaveAttribute('data-state', 'fehlt');
  await shot(page, 'pflichtmatrix', { fullPage: true });

  // Filter „Fehlt“ über die Kachel, Zelle öffnen
  await page.getByTestId('kachel-fehlt').click();
  await expect(page.getByTestId('matrix-person')).toHaveCount(2);
  await page.getByTestId('matrix-person').filter({ hasText: 'Mehmet Aydın' }).getByTestId('matrix-zelle').click();
  await expect(page.getByRole('link', { name: 'Externen Nachweis erfassen' })).toHaveAttribute('href', /modus=einzel&person=/);
  await page.keyboard.press('Escape');
  await page.getByTestId('kachel-fehlt').click();

  // Anforderungen und Qualifikationen
  await page.getByRole('radio', { name: 'Anforderungen' }).click();
  await expect(page.getByTestId('anforderung')).toHaveCount(2);
  await page.getByRole('radio', { name: 'Qualifikationen' }).click();
  await expect(page.getByTestId('qualifikation').filter({ hasText: 'Ersthelfer' })).toContainText('6 Personen');

  // Fristen jetzt prüfen
  await page.getByRole('button', { name: 'Fristen jetzt prüfen' }).click();
  await expect(page.getByText(/Fristen geprüft/)).toBeVisible({ timeout: 60_000 });

  // Dashboard mit KPI aus der Pflichtmatrix
  await page.goto('/verwaltung');
  await expect(page.getByText('Erfüllungsquote Pflichtschulungen')).toBeVisible();
  await expect(page.getByText('Läuft in 30 Tagen ab')).toBeVisible();
  await shot(page, 'dashboard');

  // Nachweismappe exportieren → ZIP
  await page.getByRole('button', { name: 'Nachweismappe exportieren' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nachweismappe exportieren' });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), dialog.getByRole('button', { name: 'ZIP herunterladen' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^Nachweismappe_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.zip$/);
  await expect(dialog.getByTestId('export-ergebnis')).toContainText(/\d+ Nachweise exportiert · SHA-256/);
});

test('CSV-Import: Prüflauf zeigt Ergebnis je Zeile, fehlerhafte Datei importiert nichts', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, ADMIN, '/verwaltung/extern/neu');
  await page.getByRole('button', { name: 'CSV-Import' }).click();
  const sheet = page.getByRole('dialog', { name: 'Externe Nachweise importieren' });
  const csv = 'personalnr;qualifikation;anbieter;datum;umfang\n1008;Ersthelfer;DRK Kreisverband;18.11.2026;9 UE\nX-999;Ersthelfer;DRK;18.11.2026;9 UE\n';
  await sheet.getByLabel('CSV-Datei').setInputFiles({ name: 'extern.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await sheet.getByRole('button', { name: 'Prüfen' }).click();
  await expect(sheet.getByText('1 von 2 Zeilen fehlerhaft – nichts importiert.')).toBeVisible();
  await expect(sheet.getByTestId('import-zeilen')).toContainText('Person nicht gefunden: X-999');
  await expect(sheet.getByTestId('import-zeilen')).toContainText('Sven Albrecht');
  await expectNoSeriousA11yViolations(page);
  // Korrigierte Datei: Prüflauf ok, dann zur Prüfung importieren
  await sheet.getByLabel('CSV-Datei').setInputFiles({ name: 'extern.csv', mimeType: 'text/csv', buffer: Buffer.from(csv.split('\n').slice(0, 2).join('\n'), 'utf8') });
  await sheet.getByRole('button', { name: 'Prüfen' }).click();
  await expect(sheet.getByText('1 Zeile ist in Ordnung.')).toBeVisible();
  await sheet.getByRole('button', { name: 'Importieren' }).click();
  await expect(sheet.getByText('1 Nachweis importiert.')).toBeVisible();
});
