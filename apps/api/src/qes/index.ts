import { DiffController } from '../diff/diff.controller';
import { QesController, TestQesController } from './qes.controller';
import { QesService } from './qes.service';
import { SignatureProviders } from './signature-providers';
import { TestQesProvider } from './test-qes.provider';

/** Phase 3, Paket C: Seiten-Diff (E-38) und FES/QES (E-40). */
export const DIFF_QES_CONTROLLERS = [DiffController, QesController, TestQesController];
export const DIFF_QES_PROVIDERS = [TestQesProvider, SignatureProviders, QesService];
