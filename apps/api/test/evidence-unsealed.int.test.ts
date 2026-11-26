import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestPdf } from '../src/trainings/pdf-fixtures';
import { binary, pdfText } from './fg-fixtures';
import { registerDozent } from './fixtures';
import { startHarness, waitFor, type Client, type Harness } from './harness';

/** E-45: Standard ohne Siegel/Zeitstempel – Nachweis trotzdem unveränderbar gespeichert und über Prüfcode/SHA-256 prüfbar. */
let h: Harness;
let dozent: Client;

beforeAll(async () => {
  h = await startHarness([], { SEAL_MODE: 'none' });
  dozent = await registerDozent(h);
});
afterAll(async () => h?.close());

describe('Nachweis ohne Siegel (Standard)', () => {
  it('PDF ohne PAdES-Signatur, neutraler Hinweis, Prüfung über Prüfcode und SHA-256', async () => {
    const personId = (await dozent.post('/api/persons', { name: 'Anna Schulz', email: 'anna@example.org' })).body.id;
    const up = await dozent.upload('/api/external-uploads', 'datei', await makeTestPdf({ wordsPerPage: [30] }), 'Bescheinigung.pdf');
    expect(up.status).toBe(201);
    const r = await dozent.post('/api/external-records', {
      mode: 'einzel', personIds: [personId], freeTitle: 'Brandschutzhelfer', provider: 'Muster Akademie',
      heldOn: new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10), receipts: { mode: 'one', uploadIds: [up.body.id] },
    });
    expect(r.status).toBe(201);
    const ev = r.body.records[0].evidence as { id: string; verifyCode: string };
    const pdf = await waitFor(async () => {
      const res = await dozent.http.get(`/api/evidence/${ev.id}/pdf`).buffer(true).parse(binary);
      return res.status === 200 && (res.body as Buffer);
    }, 30000);
    expect(pdf.includes('/ByteRange')).toBe(false); // keine eingebettete Signatur
    const text = (await pdfText(pdf)).text.replace(/\s/g, '');
    expect(text).toContain('Elektronischerstelltundunveränderbargespeichert');
    expect(text).not.toContain('versiegelt');
    const v = (await (await h.agent()).get(`/api/verify/${ev.verifyCode}`)).body;
    expect(v).toMatchObject({ status: 'gueltig', art: 'extern' });
    expect(v.sha256).toBe(createHash('sha256').update(pdf).digest('hex'));
  });
});
