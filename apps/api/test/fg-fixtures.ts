import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDF_RENDERER, type PdfRenderer } from '../src/evidence/pdf-renderer';
import { waitFor, type Client, type Harness } from './harness';

/** Hilfen für die Tests der Pakete F/G (Pflichtmatrix, Fristen, Externe Nachweise). */

/** Kollegen als Mitglied mit Rollen anlegen, Passwort setzen, optional mit einer Person verknüpfen. */
export async function memberClient(h: Harness, admin: Client, m: { email: string; name: string; roles: string[]; personId?: string }) {
  await admin.post('/api/tenant/members', { email: m.email, name: m.name, roles: m.roles });
  const mail = await waitFor(async () => (await admin.get(`/api/dev/postausgang?an=${m.email}`)).body[0]);
  const token = /#token=([A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
  const client = await h.agent();
  await client.post('/api/auth/password/set', { token, password: `${m.name.replace(/\s/g, '')}-passwort-1` });
  const accountId = (await client.get('/api/auth/me')).body.account.id as string;
  if (m.personId) await h.db.admin.query('UPDATE person SET account_id = $1 WHERE id = $2', [accountId, m.personId]);
  return { client, accountId };
}

/** Teilnehmerkonto (ohne Mitgliedschaft) anlegen und mit Personen verknüpfen (E-25; Verknüpfung hier direkt per SQL). */
export async function employeeClient(h: Harness, p: { email: string; name: string; personIds: string[] }) {
  const client = await h.agent();
  const r = await client.post('/api/auth/register-account', { name: p.name, email: p.email, password: 'mitarbeiter-passwort-1' });
  if (r.status !== 201) throw new Error(`Konto: ${JSON.stringify(r.body)}`);
  const accountId = (await client.get('/api/auth/me')).body.account.id as string;
  for (const id of p.personIds) await h.db.admin.query('UPDATE person SET account_id = $1 WHERE id = $2', [accountId, id]);
  return { client, accountId };
}

export interface Certificate {
  provider: string;
  name: string;
  date: string;
  course: string;
}

/** Teilnahmebescheinigung wie in Screen 10a als HTML. */
export function certificateHtml(c: Certificate) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:Arial,Helvetica,sans-serif;margin:60px 70px;color:#111}
.p{font-size:15px;letter-spacing:.08em;text-transform:uppercase;color:#333}
h1{font-size:34px;margin:24px 0 28px}
p{font-size:22px;line-height:1.7;margin:0}
.n{font-size:26px;font-weight:bold}
</style></head><body>
<div class="p">${c.provider}</div>
<h1>Teilnahmebescheinigung</h1>
<p>Hiermit wird bestätigt, dass</p>
<p class="n">${c.name}</p>
<p>am ${c.date} an der</p>
<p><b>${c.course}</b></p>
<p>gemäß DGUV Grundsatz 304-001 teilgenommen hat.</p>
<p style="margin-top:80px">M. Muster</p>
</body></html>`;
}

export async function certificatePdf(h: Harness, c: Certificate): Promise<Buffer> {
  return h.app.get<PdfRenderer>(PDF_RENDERER).render(certificateHtml(c));
}

/** Foto der Bescheinigung (JPEG) – gerastert aus dem PDF. */
export function pdfToJpeg(pdf: Buffer): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'sn-cert-'));
  try {
    writeFileSync(join(dir, 'c.pdf'), pdf);
    execFileSync('pdftoppm', ['-jpeg', '-r', '150', '-singlefile', '-f', '1', '-l', '1', join(dir, 'c.pdf'), join(dir, 'c')]);
    return readFileSync(join(dir, 'c.jpg'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Binäre Antworten (PDF, ZIP) mit supertest einlesen. */
export const binary = (res: { on: (e: string, cb: (d?: Buffer) => void) => void }, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (d) => chunks.push(d!));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

export async function pdfText(buf: Buffer): Promise<{ text: string; pages: number }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
  let s = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    s += tc.items.map((x) => ('str' in x ? x.str : '')).join(' ') + '\n';
  }
  return { text: s.replace(/\s+/g, ' '), pages: doc.numPages };
}

/** PUT mit CSRF-Header (der Test-Client kennt nur get/post/patch/delete). */
export const put = (c: Client, url: string, body: object) =>
  c.http.put(url).set('x-csrf-token', (c as unknown as { csrf: string }).csrf).send(body);
