import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { ProviderLevel, SignatureLevel, SignatureProvider } from './signature-provider';
import { TestQesProvider } from './test-qes.provider';

/**
 * Verfügbare Signaturanbieter (E-40). Ohne Vertrag mit einem Vertrauensdiensteanbieter nur der Test-Anbieter;
 * ein echter Anbieter wird hier zusätzlich (und vorrangig) registriert.
 */
@Injectable()
export class SignatureProviders {
  private readonly list: SignatureProvider[] = [];

  constructor(test: TestQesProvider) {
    this.list.push(test);
  }

  register(p: SignatureProvider) {
    this.list.unshift(p);
  }

  forLevel(level: ProviderLevel): SignatureProvider {
    const p = this.list.find((x) => x.info.levels.includes(level));
    if (!p) throw new ServiceUnavailableException('Für dieses Signaturniveau ist kein Anbieter eingerichtet');
    return p;
  }

  byName(name: string): SignatureProvider | undefined {
    return this.list.find((x) => x.info.name === name);
  }

  /** Für die Teilnehmersicht: Niveau und (bei FES/QES) Anbieter */
  levelInfo(level: SignatureLevel) {
    if (level === 'ees') return { level, provider: null };
    const p = this.list.find((x) => x.info.levels.includes(level));
    return { level, provider: p ? { name: p.info.name, label: p.info.label, test: p.info.test } : null };
  }
}
