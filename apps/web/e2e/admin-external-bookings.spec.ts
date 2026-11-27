import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ApiClient, apiUp, registerDozent, uniqueEmail } from './admin-seed';

/**
 * Phase 4.3 (E-55/E-56), Abnahme gegen die echte API: „Elektrofachkraft Hochvolt (HV2), Anbieter X, 2 Tage, mit Hotel“
 * bei der Buchung anlegen, buchen, einladen (Mail + .ics), Mitarbeiter bestätigt auf seiner Seite; zweite Buchung in der
 * Vergangenheit: Bescheinigung hochladen, Verwaltung gibt frei, Pflichtmatrix aktualisiert.
 * Screenshots nach docs/screenshots/phase-4/extern/.
 */
test.skip(({ baseURL }) => !baseURL?.includes(':5176'), 'nur mit playwright.admin.config.ts (Proxy auf die API)');

const SHOTS = fileURLToPath(new URL('../../../docs/screenshots/phase-4/extern/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const isoDay = (offsetDays: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offsetDays * 86_400_000));

async function noSeriousA11y(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
}

test('Externe Schulung: planen, buchen, einladen, bestätigen, Bescheinigung, Freigabe, Pflichtmatrix', async ({ page, browser }) => {
  test.setTimeout(240_000);
  expect(await apiUp(), 'API auf Port 3000 erreichbar').toBe(true);
  const email = uniqueEmail('extern');
  const password = 'sicheres-passwort-42';
  const api = new ApiClient();
  await registerDozent(api, { name: 'Dennis Hofmann', organisation: 'Muster Elektrotechnik GmbH', email, password });
  const sfx = email.split('@')[0]!.split('-').at(-1);
  const ids: Record<string, string> = {};
  for (const [n, m] of [['Lea Wagner', `lea-${sfx}@example.org`], ['Tobias Meier', `tobias-${sfx}@example.org`]] as const) {
    ids[n] = (await api.call<{ id: string }>('POST', '/persons', { name: n, email: m })).id;
  }
  const training = (await api.call<{ id: string }>('POST', '/trainings', { titel: 'Elektrofachkraft Hochvolt (HV2)', format: 'extern', quizRequired: false })).id;
  const qual = (await api.call<{ id: string }>('POST', '/qualifications', { name: 'HV-Qualifikation' })).id;
  const requirementId = (await api.call<{ id: string }>('POST', '/requirements', { qualificationId: qual, trainingId: training, intervalMonths: 36 })).id;
  await api.call('POST', `/qualifications/${qual}/persons`, { personIds: [ids['Lea Wagner'], ids['Tobias Meier']] });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/anmelden');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/verwaltung$/);

  // ── Planen über die Oberfläche ──
  await page.getByRole('link', { name: 'Externe Schulungen' }).first().click();
  await page.getByRole('link', { name: 'Externe Schulung planen' }).first().click();
  await page.getByLabel('Schulung / Qualifikation').fill('Elektrofachkraft Hochvolt (HV2)');
  await page.getByLabel('Verknüpfte Anforderung (Pflichtmatrix)').selectOption(requirementId);
  await page.getByLabel('Anbieter', { exact: true }).fill('Hochvolt Akademie Süd GmbH');
  await page.getByLabel('Buchungs-/Auftragsnummer').fill('HVA-2026-4471');
  await page.getByLabel('Kontakt beim Anbieter').fill('Frau Richter');
  await page.getByLabel('Tag 1 Datum').fill(isoDay(45));
  await page.getByRole('button', { name: 'Tag hinzufügen' }).click();
  await page.getByLabel('Tag 2 Datum').fill(isoDay(46));
  await page.getByLabel('Tag 2 Beginn').fill('08:00');
  await page.getByLabel('Tag 2 Ende').fill('15:00');
  await page.getByLabel('Adresse', { exact: true }).fill('Industriestr. 14, 70565 Stuttgart');
  await page.getByLabel('Raum').fill('Schulungszentrum, Raum 2');
  await page.getByLabel('Anreise', { exact: true }).selectOption('firmenwagen');
  await page.getByLabel('Abfahrt / Treffpunkt').fill('Vortag 15:00 · Betriebshof');
  await page.getByLabel('Hotel', { exact: true }).fill('Hotel am Park');
  await page.getByLabel('Mitbringen (Unterlagen, PSA)').fill('Sicherheitsschuhe, Lichtbogenschutz-Visier, Personalausweis');
  await page.getByRole('checkbox', { name: 'Lea Wagner' }).check();
  await page.getByRole('checkbox', { name: 'Tobias Meier' }).check();
  await page.getByLabel('Schulungsgebühr je Person').fill('1.290,00');
  await page.getByLabel('Hotel je Person').fill('236');
  await page.getByLabel('Kostenstelle').fill('4100 Service');
  await expect(page.getByTestId('kosten-summe')).toHaveText('3.052,00 €');
  await page.screenshot({ path: `${SHOTS}1440-planen.png`, fullPage: true });
  await page.getByRole('button', { name: 'Als Entwurf speichern' }).click();
  await expect(page).toHaveURL(/\/verwaltung\/externe-schulungen\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Gespeichert.')).toBeVisible();

  // ── Buchen und einladen ──
  await page.getByRole('button', { name: 'Als gebucht markieren' }).click();
  await expect(page.getByText('2 Teilnehmer als gebucht markiert.')).toBeVisible();
  await page.getByRole('button', { name: 'Einladung versenden' }).click();
  await expect(page.getByText('2 eingeladen, 2 Mails mit Kalendereintrag.')).toBeVisible();
  await expect(page.getByTestId('teilnehmer-Lea Wagner')).toContainText('Einladung versendet');
  const leaLink = (await page.getByTestId('persoenlicher-link').first().textContent())!.trim();
  await noSeriousA11y(page);
  await page.screenshot({ path: `${SHOTS}1440-detail-eingeladen.png`, fullPage: true });

  // ── Mitarbeiter am Handy ──
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await phoneCtx.newPage();
  await phone.goto(new URL(leaLink).pathname);
  await expect(phone.getByRole('heading', { name: 'Elektrofachkraft Hochvolt (HV2)' })).toBeVisible();
  await expect(phone.getByText('Hotel am Park')).toBeVisible();
  await expect(phone.getByRole('link', { name: 'In Kalender übernehmen (.ics)' })).toBeVisible();
  await phone.screenshot({ path: `${SHOTS}390-einladung.png`, fullPage: true });
  await phone.getByRole('button', { name: 'Teilnahme bestätigen' }).click();
  await expect(phone.getByText('Teilnahme bestätigt – danke!')).toBeVisible();
  await noSeriousA11y(phone);

  // ── Übersicht ──
  await page.goto('/verwaltung/externe-schulungen');
  await expect(page.getByRole('link', { name: 'Elektrofachkraft Hochvolt (HV2)' })).toBeVisible();
  await expect(page.getByTestId('kosten-kostenstelle')).toContainText('4100 Service');
  await page.screenshot({ path: `${SHOTS}1440-uebersicht.png`, fullPage: true });

  // ── Vergangener Termin: Bescheinigung hochladen, freigeben, Pflichtmatrix ──
  const past = await api.call<{ id: string }>('POST', '/external-bookings', {
    titel: 'Elektrofachkraft Hochvolt (HV2)', requirementId, providerName: 'Hochvolt Akademie Süd GmbH',
    days: [{ startAt: `${isoDay(-3)}T08:30:00+01:00`, endAt: `${isoDay(-3)}T16:30:00+01:00` }], personIds: [ids['Lea Wagner']],
  });
  await api.call('POST', `/external-bookings/${past.id}/booked`, {});
  const inv = await api.call<{ links: Array<{ link: string }> }>('POST', `/external-bookings/${past.id}/invite`, { sendMail: false });
  await phone.goto(new URL(inv.links[0]!.link).pathname);
  await phone.getByTestId('bescheinigung-datei').setInputFiles({ name: 'zertifikat.png', mimeType: 'image/png', buffer: PNG });
  await expect(phone.getByText('Bescheinigung eingereicht – die Verwaltung prüft sie.')).toBeVisible();
  const detail = await api.call<{ participants: Array<{ externalRecordId: string }> }>('GET', `/external-bookings/${past.id}`);
  await api.call('POST', `/external-records/${detail.participants[0]!.externalRecordId}/approve`, { scope: 'record' });
  await page.goto(`/verwaltung/externe-schulungen/${past.id}`);
  await expect(page.getByTestId('teilnehmer-Lea Wagner')).toContainText('geprüft/freigegeben');
  const comp = await api.call<{ rows: Array<{ requirementId: string; personId: string; state: string }> }>('GET', `/compliance?person=${ids['Lea Wagner']}`);
  expect(comp.rows.find((r) => r.requirementId === requirementId)?.state).toBe('gueltig');
  await phoneCtx.close();
});
