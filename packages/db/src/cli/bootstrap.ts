import { requireEnv } from './env';
import { bootstrap } from '../bootstrap';

await bootstrap({
  adminUrl: requireEnv('DATABASE_ADMIN_URL'),
  dbName: process.env.DB_NAME ?? 'schulungsnachweis',
  migratorPassword: requireEnv('DB_MIGRATOR_PASSWORD'),
  appPassword: requireEnv('DB_APP_PASSWORD'),
});
console.log('Bootstrap abgeschlossen.');
