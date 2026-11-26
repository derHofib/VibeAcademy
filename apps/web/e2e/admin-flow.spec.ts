import { test, expect } from '@playwright/test';
import { API, ApiClient, apiUp, makePdf, participantFor, readPages, uniqueEmail } from './admin-seed';

/**
 * Verwaltungs-Ablauf gegen die echte API:
 * Registrieren → leeres Dashboard → Personen importieren → Schulung anlegen → PDF hochladen → Analyse
 * → Regeln/Kapitel/Fragen → veröffentlichen und einladen → Links → Durchführung → Lesenachweis → Abmelden.
 * Start: pnpm --filter @sn/web exec playwright test -c playwright.admin.config.ts --trace off
 */
test.skip(
  ({ baseURL }) => !baseURL?.includes(':5176'),
  'nur mit playwright.admin.config.ts (Proxy auf die API)',
);

test.beforeAll(async () => {
  expect(await apiUp(), 'API auf Port 3000 erreichbar').toBe(true);
});

test('Dozent: registrieren, Schulung anlegen, einladen, Lesenachweis ansehen', async ({ page, context }) => {
  test.setTimeout(240_000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const email = uniqueEmail();
  const password = 'sicheres-passwort-42';

  // ── Anmeldung erforderlich ──────────────────────────────────
  await page.goto('/verwaltung/personen');
  await expect(page).toHaveURL(/\/anmelden\?weiter=%2Fverwaltung%2Fpersonen/);
  await page.getByRole('link', { name: 'Konto für Dozenten erstellen' }).click();

  // ── Registrieren mit Feldfehlern ────────────────────────────
  await expect(page.getByRole('heading', { name: 'Konto für Dozenten erstellen' })).toBeVisible();
  await page.getByRole('button', { name: 'Konto erstellen' }).click();
  await expect(page.getByText('Das Passwort muss mindestens 10 Zeichen haben')).toBeVisible();
  await page.getByLabel('Name').fill('Dana Dozentin');
  await page.getByLabel('Organisation').fill('E2E Elektro GmbH');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort').fill(password);
  await page.getByRole('button', { name: 'Konto erstellen' }).click();

  // ── Leeres Dashboard ───────────────────────────────────────
  await expect(page).toHaveURL(/\/verwaltung$/);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Erste Schulung anlegen' })).toBeVisible();
  await expect(page.getByText('E2E Elektro GmbH').first()).toBeVisible();

  // ── Personen: CSV-Import mit Ergebnis je Zeile ─────────────
  await page.getByRole('link', { name: 'Personen anlegen' }).click();
  await expect(page.getByRole('heading', { name: 'Personen', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'CSV importieren' }).click();
  const csv = [
    'name;personalnr;email;mobil;org_einheit',
    `Anna Schulz;2001;anna-${email};;Service Nord`,
    `Tobias Meier;2002;tobias-${email};;Service Nord`,
    'Kai Neumann;2003;;;Service Nord',
    'Fehlerhaft;2004;keine-mail;;Service Nord',
  ].join('\n');
  await page.getByLabel('oder Inhalt einfügen').fill(csv);
  await page.getByRole('button', { name: 'Importieren' }).click();
  await expect(page.getByTestId('import-ergebnis')).toHaveText('3 neu, 0 aktualisiert, 1 Zeile mit Fehler');
  await expect(page.getByText(/Zeile 5: /)).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Schließen' }).click();

  // Person einzeln hinzufügen
  await page.getByRole('button', { name: 'Person hinzufügen' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Person hinzufügen' });
  await sheet.getByLabel('Name').fill('Lea Wagner');
  await sheet.getByLabel('E-Mail').fill(`lea-${email}`);
  await sheet.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Person gespeichert.')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Personen' }).getByText('Lea Wagner')).toBeVisible();
  // Suche
  await page.getByLabel('Personen suchen').fill('Kai');
  await expect(page.getByRole('table', { name: 'Personen' }).getByText('Anna Schulz')).toBeHidden();
  await expect(page.getByRole('table', { name: 'Personen' }).getByText('Kai Neumann')).toBeVisible();

  // ── Schulung anlegen: Grunddaten ───────────────────────────
  await page.getByRole('link', { name: 'Schulungen' }).first().click();
  await page.getByRole('link', { name: 'Neue Schulung' }).click();
  await expect(page.getByRole('navigation', { name: 'Schritte' })).toBeVisible();
  await page.getByLabel('Titel').fill('E2E Sicherheitsunterweisung');
  await page.getByLabel('Kategorie').fill('Arbeitsschutz');
  await page.getByLabel('Ansprechpartner für Rückfragen').fill('Dana Dozentin, 0761 123');
  await page.getByRole('button', { name: 'Vorschlag einsetzen' }).click();
  await expect(page.getByLabel('Bestätigungstext')).toHaveValue(
    /E2E Sicherheitsunterweisung, Version 1.*Dana Dozentin/,
  );
  await page.getByRole('button', { name: 'Weiter: Dokument & Regeln' }).click();

  // ── Dokument & Regeln: Upload + Analyse ────────────────────
  await expect(page).toHaveURL(/schritt=2/);
  const pdf = await makePdf({ wordsPerPage: [60, 110, 0, 90], heading: (n) => `Abschnitt ${n}` });
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({ name: 'Unterweisung_E2E.pdf', mimeType: 'application/pdf', buffer: pdf });
  await expect(page.getByText('Wörter gesamt')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Unterweisung_E2E.pdf')).toBeVisible();
  await expect(page.getByText(/4 Seiten · .* · SHA-256 [0-9a-f]{4}…[0-9a-f]{4}/)).toBeVisible();
  await expect(page.getByText('manuell prüfen')).toBeVisible();
  // t_min = max(4, min(90, W/200·60·0,6)) → S. 1: 60 Wörter → 11 s, S. 3 ohne Text → 4 s
  await expect(page.getByText('S. 1 · 11 s')).toBeVisible();
  await expect(page.getByText('S. 3 · 4 s')).toBeVisible();
  // manuelle Zeit für die Seite ohne Text
  const manual = page.getByLabel('Mindestzeit Seite 3 in Sekunden');
  await manual.fill('12');
  await manual.press('Enter');
  await expect(page.getByText('S. 3 · 12 s')).toBeVisible();

  // Regeln: Lesegeschwindigkeit ändern → Mindestzeiten neu berechnet
  await page.getByLabel('Lesegeschwindigkeit').fill('300');
  await page.getByRole('button', { name: 'Regeln übernehmen' }).click();
  await expect(page.getByText('Regeln gespeichert, Mindestzeiten neu berechnet.')).toBeVisible();
  await expect(page.getByText('S. 1 · 7 s')).toBeVisible();

  // Kapitel manuell (PDF ohne Lesezeichen)
  await expect(page.getByText(/keine Lesezeichen/)).toBeVisible();
  await page.getByRole('button', { name: 'Kapitel bearbeiten' }).click();
  const chapters = page.getByRole('group', { name: 'Kapitel 1' });
  await chapters.getByLabel('Titel').fill('Grundlagen');
  await chapters.getByLabel('Kurzname').fill('Grundl.');
  await chapters.getByLabel('bis Seite').fill('2');
  await page.getByRole('button', { name: 'Kapitel hinzufügen' }).click();
  const ch2 = page.getByRole('group', { name: 'Kapitel 2' });
  await ch2.getByLabel('Titel').fill('Notfall');
  await ch2.getByLabel('Kurzname').fill('Notfall');
  await page.getByRole('button', { name: 'Kapitel speichern' }).click();
  await expect(page.getByText('Kapitel gespeichert.')).toBeVisible();
  await expect(page.getByText('S. 3–4')).toBeVisible();

  // Weiter ohne Fragen → Hinweis
  await page.getByRole('button', { name: 'Weiter: Zielgruppe' }).click();
  await expect(
    page.getByText('Das Abschluss-Quiz braucht mindestens eine aktive Frage im Fragenpool.').first(),
  ).toBeVisible();

  // Fragenpool
  await page.getByRole('button', { name: 'Frage hinzufügen' }).click();
  const qs = page.getByRole('dialog', { name: 'Neue Frage' });
  await qs.getByLabel('Frage', { exact: true }).fill('Was ist die erste Sicherheitsregel?');
  await qs.getByLabel('Antwort 1', { exact: true }).fill('Erden');
  await qs.getByLabel('Antwort 2', { exact: true }).fill('Freischalten');
  await qs.getByLabel('Antwort 3', { exact: true }).fill('Abdecken');
  await qs.getByLabel('Antwort 2 ist richtig').check({ force: true });
  await qs.getByLabel('Erklärung').fill('Zuerst wird freigeschaltet.');
  await qs.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Was ist die erste Sicherheitsregel?')).toBeVisible();
  await expect(page.getByText('1 aktive Frage · je Versuch werden 1 zufällig gezogen')).toBeVisible();

  await page.getByRole('button', { name: 'Weiter: Zielgruppe' }).click();

  // ── Zielgruppe ─────────────────────────────────────────────
  await expect(page).toHaveURL(/schritt=3/);
  await page.getByLabel(/^Service Nord/).check();
  await page.getByLabel(/^Lea Wagner/).check();
  await expect(page.getByText('4 Personen werden eingeladen').first()).toBeAttached();
  await expect(page.getByText('1 Person ohne E-Mail – Link kopieren oder drucken')).toBeVisible();
  await page.getByRole('button', { name: 'Weiter: Prüfen & einladen' }).click();

  // ── Prüfen & einladen ──────────────────────────────────────
  await expect(page).toHaveURL(/schritt=4/);
  await expect(
    page.getByText('Version 1 wird beim Einladen veröffentlicht und ist danach unveränderlich.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Veröffentlichen und einladen' }).click();
  await expect(page.getByRole('heading', { name: 'Einladungen erstellt' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('4 Einladungen erstellt')).toBeVisible();
  await expect(page.getByText('3 E-Mails eingereiht')).toBeVisible();
  await expect(page.getByText('1 Person ohne E-Mail-Adresse:')).toBeVisible();
  await expect(page.getByText('Kai Neumann', { exact: true })).toBeVisible();

  // Links für Personen ohne E-Mail erzeugen (E-12)
  await page.getByRole('button', { name: 'Links kopieren / als Liste drucken' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Links erzeugen' }).click();
  await expect(page.getByTestId('einladungslink')).toHaveCount(1);
  await expect(page.getByTestId('einladungslink').first()).toHaveText(/\/s\/[A-Za-z0-9_-]{20,}/);
  await page.getByRole('button', { name: 'Link für Kai Neumann kopieren' }).click();
  await expect(page.getByText('Kopiert').first()).toBeVisible();

  // ── Durchführung ───────────────────────────────────────────
  await page.getByRole('link', { name: 'Zur Durchführung' }).click();
  await expect(page).toHaveURL(/\/verwaltung\/durchfuehrungen\//);
  const runId = page.url().split('/').pop()!;
  const table = page.getByRole('table', { name: 'Einladungen' });
  await expect(table.getByRole('row')).toHaveCount(5);
  await expect(table.getByText('Eingeladen')).toHaveCount(4);
  // Link neu erzeugen mit Warnung
  await page.getByRole('button', { name: 'Link für Anna Schulz neu erzeugen' }).click();
  await expect(page.getByRole('dialog', { name: 'Neuen Link für Anna Schulz erzeugen?' })).toContainText(
    'ungültig',
  );
  await page.getByRole('button', { name: 'Neuen Link erzeugen' }).click();
  await expect(page.getByTestId('neuer-link')).toHaveText(/\/s\//);
  // Erinnern (nur mit E-Mail)
  await expect(page.getByRole('button', { name: /Kai Neumann erinnern/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Tobias Meier erinnern' }).click();
  await expect(page.getByText('Erinnerung an Tobias Meier eingereiht.')).toBeVisible();

  // Lea liest zwei Seiten (Teilnehmer-API, echte Serverzeit)
  const admin = new ApiClient();
  await admin.call('POST', '/auth/login', { email, password });
  const run = await admin.call<{ invitations: Array<{ id: string; person_name: string }> }>(
    'GET',
    `/runs/${runId}`,
  );
  const lea = run.invitations.find((i) => i.person_name === 'Lea Wagner')!;
  const p = await participantFor(admin, lea.id);
  await readPages(p, lea.id, [1, 2], (n) => (n === 1 ? 8 : 3), 1500);

  // ── Lesenachweis ───────────────────────────────────────────
  await page.reload();
  await expect(table.getByRole('row', { name: /Lea Wagner/ })).toContainText('Geöffnet');
  await page.getByRole('link', { name: 'Lesenachweis von Lea Wagner ansehen' }).click();
  await expect(page.getByRole('heading', { name: 'Lea Wagner' })).toBeVisible();
  await expect(page.getByText('E2E Sicherheitsunterweisung · Version 1')).toBeVisible();
  await expect(page.getByText('In Bearbeitung')).toBeVisible();
  const protocol = page.getByRole('table', { name: 'Seitenprotokoll' });
  await expect(protocol.getByRole('row')).toHaveCount(5);
  await expect(protocol.getByRole('row').nth(1)).toContainText('erfüllt');
  await expect(protocol.getByRole('row').nth(2)).toContainText('teilweise');
  await expect(protocol.getByRole('row').nth(4)).toContainText('nicht gesehen');
  await expect(page.getByText('Lesesitzung gestartet')).toBeVisible();
  await page.getByRole('button', { name: 'Hash-Kette prüfen' }).click();
  await expect(page.getByText(/Hash-Kette verifiziert · \d+ Einträge geprüft/)).toBeVisible();

  // ── Dashboard zeigt die laufende Schulung ──────────────────
  await page.getByRole('link', { name: 'Dashboard' }).first().click();
  await expect(page.getByRole('heading', { name: 'Laufende Schulungen' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'E2E Sicherheitsunterweisung' })).toBeVisible();
  await expect(page.getByText('0 / 4')).toBeVisible();

  // ── Einstellungen: Kollegen einladen ───────────────────────
  const colleague = uniqueEmail('kollege');
  await page.getByRole('link', { name: /Einstellungen/ }).first().click();
  await expect(page.getByText(email).first()).toBeVisible();
  await page.getByRole('button', { name: 'Kollegen einladen' }).click();
  const member = page.getByRole('dialog', { name: 'Kollegen einladen' });
  await member.getByLabel('Name').fill('Kim Kollegin');
  await member.getByLabel('E-Mail').fill(colleague);
  await member.getByRole('button', { name: 'Kollegen einladen' }).click();
  await expect(page.getByText('Einladung zum Festlegen des Passworts eingereiht.')).toBeVisible();
  await expect(page.getByText(colleague)).toBeVisible();
  const box = (await (
    await fetch(`${API}/api/dev/postausgang?an=${encodeURIComponent(colleague)}`)
  ).json()) as Array<{
    text: string;
  }>;
  const setLink = /\/passwort-festlegen#token=[^\s"<]+/.exec(box.map((m) => m.text).join('\n'))?.[0];
  expect(setLink, 'Link zum Festlegen des Passworts im Postausgang').toBeTruthy();

  // ── Abmelden ───────────────────────────────────────────────
  await page.getByRole('button', { name: 'Abmelden' }).first().click();
  await expect(page).toHaveURL(/\/anmelden/);
  await page.goto('/verwaltung');
  await expect(page).toHaveURL(/\/anmelden/);

  // Kollegin legt ihr Passwort fest und landet in der Verwaltung desselben Mandanten
  await page.goto(setLink!);
  await page.getByLabel('Neues Passwort').fill('kollegin-passwort-1');
  await page.getByLabel('Passwort wiederholen').fill('kollegin-passwort-2');
  await page.getByRole('button', { name: 'Passwort speichern' }).click();
  await expect(page.getByText('Die Passwörter stimmen nicht überein')).toBeVisible();
  await page.getByLabel('Passwort wiederholen').fill('kollegin-passwort-1');
  await page.getByRole('button', { name: 'Passwort speichern' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('Kim Kollegin').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'E2E Sicherheitsunterweisung' })).toBeVisible();
  await page.getByRole('button', { name: 'Abmelden' }).first().click();
  await expect(page).toHaveURL(/\/anmelden/);

  // Wieder anmelden (falsches Passwort zuerst)
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort').fill('falsch-falsch-falsch');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.getByLabel('Passwort')).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Passwort').fill(password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});
