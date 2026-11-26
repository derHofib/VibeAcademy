import { spawn } from 'node:child_process';
import { repoPath, type AppConfig } from '../config';

export interface SealInfo {
  level: string;
  signer: string | null;
  tsa: string | null;
}
/** Siegel + Zeitstempel hinter einer Schnittstelle (E-10): austauschbar gegen Firmen-Siegel oder FES/QES-Anbieter. */
export interface Sealer {
  seal(pdf: Buffer): Promise<{ pdf: Buffer; info: SealInfo }>;
}
export const SEALER = Symbol('SEALER');

/** pyHanko im Unterprozess: PAdES-B-T mit RFC-3161-Zeitstempel. */
export class PyHankoSealer implements Sealer {
  constructor(private readonly c: AppConfig) {
    if (!c.SEAL_P12_PATH) throw new Error('SEAL_P12_PATH fehlt (Siegelzertifikat). Für die Entwicklung: scripts/setup-seal.sh');
  }
  seal(pdf: Buffer): Promise<{ pdf: Buffer; info: SealInfo }> {
    return new Promise((resolve, reject) => {
      const p = spawn(this.c.SEAL_PYTHON, [repoPath(this.c.SEAL_SCRIPT)], {
        env: {
          PATH: process.env.PATH ?? '',
          SEAL_P12_PATH: this.c.SEAL_P12_PATH!,
          SEAL_P12_PASSWORD: this.c.SEAL_P12_PASSWORD,
          TSA_URL: this.c.TSA_URL,
          SEAL_DEV_TSA_KEY: this.c.SEAL_DEV_TSA_KEY ?? '',
          SEAL_DEV_TSA_CERT: this.c.SEAL_DEV_TSA_CERT ?? '',
        },
        timeout: 60_000,
      });
      const out: Buffer[] = [];
      let err = '';
      p.stdout.on('data', (d: Buffer) => out.push(d));
      p.stderr.on('data', (d: Buffer) => (err += d.toString()));
      p.on('error', reject);
      p.on('close', (code) => {
        if (code !== 0) return reject(new Error(`Versiegeln fehlgeschlagen (${code}): ${err.trim().split('\n').pop()}`));
        try {
          const info = JSON.parse(err.trim().split('\n').pop()!) as SealInfo;
          resolve({ pdf: Buffer.concat(out), info });
        } catch (e) {
          reject(e);
        }
      });
      p.stdin.end(pdf);
    });
  }
}

/** Nur für Entwicklung ohne Python: kein Siegel, deutlich gekennzeichnet. */
export class NoSealer implements Sealer {
  async seal(pdf: Buffer) {
    return { pdf, info: { level: 'unversiegelt', signer: null, tsa: null } };
  }
}
