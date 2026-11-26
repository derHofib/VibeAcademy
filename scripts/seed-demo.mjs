#!/usr/bin/env node
// Demo-Daten über die laufende API (http://127.0.0.1:3000) anlegen. Voraussetzung: scripts/dev.sh läuft.
// Ausgabe: Zugangsdaten Dozent + persönliche Einladungslinks.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { makeTestPdf } = require('../apps/api/dist/trainings/pdf-fixtures.js');

const BASE = process.env.API_URL ?? 'http://127.0.0.1:3000';
let cookie = '';
let csrf = '';
async function call(method, path, body, isForm = false) {
  const headers = { cookie };
  if (method !== 'GET') headers['x-csrf-token'] = csrf;
  if (body && !isForm) headers['content-type'] = 'application/json';
  const r = await fetch(`${BASE}/api${path}`, { method, headers, body: isForm ? body : body ? JSON.stringify(body) : undefined });
  for (const c of r.headers.getSetCookie()) {
    const [kv] = c.split(';');
    const [k] = kv.split('=');
    cookie = [...cookie.split('; ').filter((x) => x && !x.startsWith(`${k}=`)), kv].join('; ');
    if (k === 'sn_csrf') csrf = kv.split('=')[1];
  }
  const t = r.headers.get('content-type') ?? '';
  const data = t.includes('json') ? await r.json() : null;
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(data)}`);
  return data;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DOZENT = { name: 'Dennis Hofmann', organisation: 'Muster Elektrotechnik GmbH', email: 'demo@example.org', password: 'demo-passwort-1' };
await call('GET', '/auth/csrf');
try {
  await call('POST', '/auth/register', DOZENT);
} catch {
  await call('POST', '/auth/login', { email: DOZENT.email, password: DOZENT.password });
}
const units = {};
for (const name of ['Service Nord', 'Service Süd', 'Werkstatt']) units[name] = (await call('POST', '/org-units', { name })).id;
const people = [
  ['Anna Schulz', 'Service Nord'], ['Julia Becker', 'Service Nord'], ['Tobias Meier', 'Service Süd'], ['Kai Neumann', 'Service Süd'],
  ['Lea Wagner', 'Service Nord'], ['Paul Weber', 'Werkstatt'], ['Mehmet Aydın', 'Werkstatt'], ['Sven Albrecht', 'Service Süd'],
];
const personIds = [];
for (const [i, [name, unit]] of people.entries()) {
  const email = `${name.split(' ')[0].toLowerCase().replace('ı', 'i')}@example.org`;
  personIds.push((await call('POST', '/persons', { name, email, personalnr: String(1040 + i), orgUnitId: units[unit] })).id);
}
const t = await call('POST', '/trainings', {
  titel: 'Sicherheitsunterweisung 2026', kategorie: 'Arbeitsschutz', rechtsgrundlage: 'DGUV Vorschrift 1 § 4, ArbSchG § 12',
  ansprechpartner: 'Dennis Hofmann, Telefon 0761 123456',
  confirmText: 'Ich habe die Unterweisung „Sicherheitsunterweisung 2026, Version 1“ vollständig gelesen und verstanden. Rückfragen konnte ich an Dennis Hofmann richten.',
});
await call('PATCH', `/trainings/${t.id}/settings`, { quizQuestionCount: 3 });
const pdf = await makeTestPdf({
  wordsPerPage: [60, 110, 140, 90, 0, 120, 150, 130, 70, 0, 110, 95, 135, 40],
  chapters: [
    { title: '1 Grundlagen', page: 1 }, { title: '2 Elektrische Gefährdungen', page: 4 },
    { title: '3 Brandschutz', page: 8 }, { title: '4 Notfall', page: 11 },
  ],
  heading: (n) => `Abschnitt ${n}`,
});
const form = new FormData();
form.append('datei', new Blob([pdf], { type: 'application/pdf' }), 'Sicherheitsunterweisung_2026.pdf');
const v = await call('POST', `/trainings/${t.id}/versions`, form, true);
for (let i = 0; i < 60; i++) {
  if ((await call('GET', `/trainings/${t.id}/versions/${v.id}`)).status === 'bereit') break;
  await sleep(500);
}
const qs = [
  ['Was ist die erste der fünf Sicherheitsregeln?', ['Erden und kurzschließen', 'Freischalten', 'Abdecken'], 1, 'Vor jeder Arbeit wird zuerst freigeschaltet.'],
  ['Wann wird der Spannungsprüfer geprüft?', ['Nur vor der Messung', 'Vor und nach der Messung', 'Einmal jährlich'], 1, 'Vor und nach der Messung auf Funktion prüfen.'],
  ['Was tun bei einem Brand im Schaltschrank?', ['Mit Wasser löschen', 'CO₂-Löscher verwenden', 'Tür öffnen und lüften'], 1, 'Elektrobrände mit CO₂ löschen.'],
  ['Wo hängt der Notfallplan?', ['Am schwarzen Brett im Eingang', 'Im Büro der Geschäftsführung', 'Nirgends'], 0, 'Der Notfallplan hängt am schwarzen Brett.'],
];
for (const [text, options, correct, explanation] of qs) await call('POST', `/trainings/${t.id}/questions`, { text, options, correct, explanation });
await call('POST', `/trainings/${t.id}/versions/${v.id}/publish`, {});
const run = await call('POST', '/runs', { trainingId: t.id });
await call('POST', `/runs/${run.id}/invite`, { personIds });
await sleep(1500);
const box = await call('GET', '/dev/postausgang');
console.log(`\nDozent: ${DOZENT.email} / ${DOZENT.password}`);
for (const m of box.filter((x) => x.subject.includes('bitte bis')).slice(0, 8)) {
  console.log(`${m.to.padEnd(24)} ${/(http\S+\/s\/\S+)/.exec(m.text)?.[1]}`);
}
