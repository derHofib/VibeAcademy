import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  ApiClient,
  apiUp,
  makePdf,
  participantFor,
  quizAttempt,
  readPages,
  registerDozent,
  sign,
  uniqueEmail,
  uploadAndWait,
} from './admin-seed';

/**
 * Screenshots der Verwaltung (Screens 1–3, Personen, Durchführung) mit Demo-Daten in einem eigenen Mandanten,
 * jeweils 1440×900 und 390×844 (deviceScaleFactor 1) → docs/screenshots/phase-1/admin/. Prüft zusätzlich axe (WCAG 2.2 AA).
 * Start: pnpm --filter @sn/web exec playwright test -c playwright.admin.config.ts --trace off admin-screenshots
 */
test.skip(
  ({ baseURL }) => !baseURL?.includes(':5176'),
  'nur mit playwright.admin.config.ts (Proxy auf die API)',
);

const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../docs/screenshots/phase-1/admin',
);

interface Seed {
  email: string;
  password: string;
  trainingDraftId: string;
  runBId: string;
  leaInvitationId: string;
}
let seed: Seed;

const CONFIRM = (titel: string) =>
  `Ich habe die Unterweisung „${titel}, Version 1“ vollständig gelesen und verstanden. Rückfragen konnte ich an Dennis Hofmann richten.`;

async function training(api: ApiClient, titel: string, kategorie: string) {
  return (
    await api.call<{ id: string }>('POST', '/trainings', {
      titel,
      kategorie,
      rechtsgrundlage: 'DGUV Vorschrift 1 § 4, ArbSchG § 12',
      ansprechpartner: 'Dennis Hofmann, 0761 123456',
      confirmText: CONFIRM(titel),
    })
  ).id;
}

const QUESTIONS: Array<[string, string[], number, string]> = [
  [
    'Was ist die erste der fünf Sicherheitsregeln?',
    ['Erden und kurzschließen', 'Freischalten', 'Abdecken'],
    1,
    'Vor jeder Arbeit wird zuerst freigeschaltet.',
  ],
  [
    'Wann wird der Spannungsprüfer geprüft?',
    ['Nur vor der Messung', 'Vor und nach der Messung', 'Einmal jährlich'],
    1,
    'Vor und nach der Messung auf Funktion prüfen.',
  ],
  [
    'Was tun bei einem Brand im Schaltschrank?',
    ['Mit Wasser löschen', 'CO₂-Löscher verwenden', 'Tür öffnen und lüften'],
    1,
    'Elektrobrände mit CO₂ löschen.',
  ],
  [
    'Wo hängt der Notfallplan?',
    ['Am schwarzen Brett im Eingang', 'Im Büro der Geschäftsführung', 'Nirgends'],
    0,
    'Der Notfallplan hängt am schwarzen Brett.',
  ],
];
const CORRECT = new Map(QUESTIONS.map(([t, , c]) => [t, c]));

async function addQuestions(api: ApiClient, id: string, n = QUESTIONS.length) {
  for (const [text, options, correct, explanation] of QUESTIONS.slice(0, n)) {
    await api.call('POST', `/trainings/${id}/questions`, { text, options, correct, explanation });
  }
}

const isoIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

test.beforeAll(async () => {
  test.setTimeout(420_000);
  expect(await apiUp(), 'API auf Port 3000 erreichbar').toBe(true);
  const api = new ApiClient();
  const email = uniqueEmail('demo');
  const password = 'demo-passwort-sicher';
  await registerDozent(api, {
    name: 'Dennis Hofmann',
    organisation: 'Muster Elektrotechnik GmbH',
    email,
    password,
  });

  const units: Record<string, string> = {};
  for (const name of ['Service Nord', 'Service Süd', 'Werkstatt'])
    units[name] = (await api.call<{ id: string }>('POST', '/org-units', { name })).id;
  const people: Array<[string, string, boolean]> = [
    ['Anna Schulz', 'Service Nord', true],
    ['Julia Becker', 'Service Nord', true],
    ['Lea Wagner', 'Service Nord', true],
    ['Tobias Meier', 'Service Süd', true],
    ['Kai Neumann', 'Service Süd', true],
    ['Sven Albrecht', 'Service Süd', true],
    ['Paul Weber', 'Werkstatt', true],
    ['Mehmet Aydın', 'Werkstatt', true],
    ['Jonas Krüger', 'Werkstatt', false],
  ];
  const ids: Record<string, string> = {};
  for (const [i, [name, unit, withMail]] of people.entries()) {
    const local = name.split(' ')[0]!.toLowerCase().replace('ı', 'i');
    ids[name] = (
      await api.call<{ id: string }>('POST', '/persons', {
        name,
        personalnr: String(1040 + i),
        email: withMail ? `${local}.${email}` : null,
        orgUnitId: units[unit],
      })
    ).id;
  }
  await api.call('PATCH', `/org-units/${units['Service Nord']}`, { leiterPersonId: ids['Anna Schulz'] });
  await api.call('PATCH', `/org-units/${units['Werkstatt']}`, { leiterPersonId: ids['Paul Weber'] });

  // A: Sicherheitsunterweisung (14 Seiten, Kapitel aus Lesezeichen), läuft noch knapp drei Wochen
  const a = await training(api, 'Sicherheitsunterweisung 2026', 'Arbeitsschutz');
  await api.call('PATCH', `/trainings/${a}/settings`, { quizQuestionCount: 3 });
  const pdfA = await makePdf({
    wordsPerPage: [60, 110, 140, 90, 0, 120, 150, 130, 70, 0, 110, 95, 135, 40],
    chapters: [
      { title: '1 Grundlagen', page: 1 },
      { title: '2 Elektrische Gefährdungen', page: 4 },
      { title: '3 Brandschutz', page: 8 },
      { title: '4 Notfall', page: 11 },
    ],
    heading: (n) => `Abschnitt ${n}`,
  });
  const va = await uploadAndWait(api, a, pdfA, 'Sicherheitsunterweisung_2026.pdf');
  await addQuestions(api, a);
  await api.call('POST', `/trainings/${a}/versions/${va}/publish`, {});
  const runA = await api.call<{ id: string }>('POST', '/runs', { trainingId: a, deadline: isoIn(19) });
  await api.call('POST', `/runs/${runA.id}/invite`, { orgUnitIds: Object.values(units), sendMail: true });

  // B: kurze Unterweisung, Frist in 5 Tagen – Lea liest vollständig, besteht im 2. Versuch und unterschreibt
  const b = await training(api, 'Unterweisung Leitern und Tritte', 'Arbeitsschutz');
  await api.call('PATCH', `/trainings/${b}/settings`, { quizQuestionCount: 3, maxAttempts: 3 });
  const pdfB = await makePdf({ wordsPerPage: [30, 45, 60, 0, 40, 28], heading: (n) => `Leitern ${n}` });
  const vb = await uploadAndWait(api, b, pdfB, 'Leitern_und_Tritte.pdf');
  await addQuestions(api, b, 3);
  await api.call('POST', `/trainings/${b}/versions/${vb}/publish`, {});
  const runB = await api.call<{ id: string }>('POST', '/runs', { trainingId: b, deadline: isoIn(5) });
  await api.call('POST', `/runs/${runB.id}/invite`, {
    orgUnitIds: [units['Service Nord'], units['Werkstatt']],
    sendMail: true,
  });

  // D: Frist abgelaufen → Überfällige
  const d = await training(api, 'IT- und Datenschutzrichtlinie', 'Datenschutz');
  await api.call('PATCH', `/trainings/${d}`, { quizRequired: false });
  const vd = await uploadAndWait(
    api,
    d,
    await makePdf({ wordsPerPage: [80, 120, 60, 90, 70, 40] }),
    'IT-Richtlinie.pdf',
  );
  await api.call('POST', `/trainings/${d}/versions/${vd}/publish`, {});
  const runD = await api.call<{ id: string }>('POST', '/runs', { trainingId: d, deadline: isoIn(-6) });
  await api.call('POST', `/runs/${runD.id}/invite`, {
    personIds: [ids['Mehmet Aydın'], ids['Sven Albrecht'], ids['Jonas Krüger'], ids['Kai Neumann']],
    sendMail: false,
  });

  // C: Version 2 als Entwurf (Screen 2: Analyse, Seiten ohne Text, Art der Änderung)
  const c = await training(api, 'Elektrotechnische Unterweisung EFK', 'Elektrotechnik');
  const vc1 = await uploadAndWait(
    api,
    c,
    await makePdf({
      wordsPerPage: [100, 120, 90, 140, 110, 80, 60, 95, 130, 70],
      heading: (n) => `Teil ${n}`,
    }),
    'EFK_Unterweisung_v1.pdf',
  );
  await addQuestions(api, c);
  await api.call('POST', `/trainings/${c}/versions/${vc1}/publish`, {});
  const pdfC2 = await makePdf({
    wordsPerPage: [100, 172, 233, 150, 0, 200, 250, 216, 122, 0, 183, 155, 228, 66],
    heading: (n) => `Teil ${n}`,
  });
  const vc2 = await uploadAndWait(api, c, pdfC2, 'EFK_Unterweisung_2026_v2.pdf');
  await api.call('PATCH', `/trainings/${c}/versions/${vc2}/pages/10`, { tMinManual: 20 });

  // Lesen/Quiz/Unterschrift parallel
  const runBDetail = await api.call<{ invitations: Array<{ id: string; person_name: string }> }>(
    'GET',
    `/runs/${runB.id}`,
  );
  const runADetail = await api.call<{ invitations: Array<{ id: string; person_name: string }> }>(
    'GET',
    `/runs/${runA.id}`,
  );
  const runDDetail = await api.call<{ invitations: Array<{ id: string; person_name: string }> }>(
    'GET',
    `/runs/${runD.id}`,
  );
  const inv = (list: { invitations: Array<{ id: string; person_name: string }> }, n: string) =>
    list.invitations.find((x) => x.person_name === n)!.id;
  const leaId = inv(runBDetail, 'Lea Wagner');
  const vB = await api.call<{ pages: Array<{ page_no: number; t_min_effective: number }> }>(
    'GET',
    `/trainings/${b}/versions/${vb}`,
  );
  const tmin = new Map(vB.pages.map((p) => [p.page_no, p.t_min_effective]));
  const extra = [1.9, 1.6, 1.4, 2.2, 1.5, 1.7];

  await Promise.all([
    (async () => {
      const p = await participantFor(api, leaId);
      await readPages(p, leaId, [1, 2, 3, 4, 5, 6], (n) => Math.ceil((tmin.get(n) ?? 4) * extra[n - 1]!));
      await quizAttempt(p, leaId, CORRECT, 1);
      await quizAttempt(p, leaId, CORRECT, 0);
      await sign(p, leaId, `lea.${email}`, CONFIRM('Unterweisung Leitern und Tritte'));
    })(),
    (async () => {
      const id = inv(runBDetail, 'Julia Becker');
      const p = await participantFor(api, id);
      await readPages(p, id, [1, 2], (n) => (n === 1 ? 7 : 4));
    })(),
    (async () => {
      const id = inv(runADetail, 'Anna Schulz');
      const p = await participantFor(api, id);
      await readPages(p, id, [1, 2], (n) => (n === 1 ? 12 : 6));
    })(),
    (async () => {
      const id = inv(runDDetail, 'Sven Albrecht');
      const p = await participantFor(api, id);
      await readPages(p, id, [1], () => 3, 1500);
    })(),
  ]);

  seed = { email, password, trainingDraftId: c, runBId: runB.id, leaInvitationId: leaId };
});

async function login(page: Page) {
  await page.goto('/anmelden');
  await page.getByLabel('E-Mail').fill(seed.email);
  await page.getByLabel('Passwort').fill(seed.password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const serious = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({
      id: v.id,
      help: v.help,
      targets: v.nodes.slice(0, 5).map((n) => `${n.target.join(' ')} — ${n.failureSummary ?? ''}`),
    }));
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
}

async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
  // Ganze Seite: Viewport auf Seitenhöhe ziehen, damit die feste Navigation über die volle Höhe reicht
  const vp = page.viewportSize()!;
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: vp.width, height: Math.max(vp.height, height) });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled' });
  await page.setViewportSize(vp);
}

for (const vp of [
  { label: '1440', width: 1440, height: 900 },
  { label: '390', width: 390, height: 844 },
] as const) {
  test.describe(`${vp.label} px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });

    test(`Verwaltung: Screenshots + axe (${vp.label})`, async ({ page }) => {
      test.setTimeout(180_000);
      await login(page);

      // Screen 1 – Dashboard
      await expect(page.getByRole('heading', { name: 'Laufende Schulungen' })).toBeVisible();
      await expect(page.getByText('Lea Wagner').or(page.getByText('Sven Albrecht')).first()).toBeVisible();
      await axe(page);
      await shot(page, `dashboard-${vp.label}`);

      // Screen 2 – Schulung anlegen, Schritt 2 nach der Analyse
      await page.goto(`/verwaltung/schulungen/${seed.trainingDraftId}?schritt=2`);
      await expect(page.getByText('Wörter gesamt')).toBeVisible();
      await page.getByLabel(/^Inhaltlich/).check();
      await page.getByLabel('Geänderte Seiten').fill('3, 7, 8');
      await page.waitForFunction(() => [...document.images].every((i) => i.complete));
      await axe(page);
      await shot(page, `schulung-anlegen-${vp.label}`);

      // Screen 3 – Lesenachweis je Person
      await page.goto(`/verwaltung/nachweise/${seed.leaInvitationId}`);
      await expect(page.getByRole('heading', { name: 'Lea Wagner' })).toBeVisible();
      await page.getByRole('button', { name: 'Hash-Kette prüfen' }).click();
      await expect(page.getByText(/Hash-Kette verifiziert/)).toBeVisible();
      await axe(page);
      await shot(page, `lesenachweis-${vp.label}`);

      // Durchführung
      await page.goto(`/verwaltung/durchfuehrungen/${seed.runBId}`);
      await expect(page.getByRole('heading', { name: 'Unterweisung Leitern und Tritte' })).toBeVisible();
      await axe(page);
      await shot(page, `durchfuehrung-${vp.label}`);

      // Personen
      await page.goto('/verwaltung/personen');
      await expect(page.getByText('Jonas Krüger').first()).toBeVisible();
      await axe(page);
      await shot(page, `personen-${vp.label}`);
    });
  });
}
