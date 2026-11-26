import { requireEnv } from './env';
import { migrate } from '../migrate';

const applied = await migrate(requireEnv('DATABASE_MIGRATOR_URL'));
console.log(applied.length ? `${applied.length} Migration(en) ausgeführt.` : 'Datenbank ist aktuell.');
