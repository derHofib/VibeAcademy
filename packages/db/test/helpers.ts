import { randomBytes } from 'node:crypto';
import pg from 'pg';
import '../src/cli/env';
import { bootstrap } from '../src/bootstrap';
import { migrate } from '../src/migrate';

export const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres@127.0.0.1:54329/postgres';
const MIGRATOR_PW = process.env.DB_MIGRATOR_PASSWORD ?? 'test-migrator';
const APP_PW = process.env.DB_APP_PASSWORD ?? 'test-app';

function urlFor(user: string, pw: string, db: string) {
  const u = new URL(ADMIN_URL);
  u.username = user;
  u.password = pw;
  u.pathname = `/${db}`;
  return u.toString();
}

export interface TestDb {
  name: string;
  app: pg.Pool;
  migrator: pg.Pool;
  admin: pg.Pool;
  drop(): Promise<void>;
}

/** Legt eine frische Testdatenbank an (Bootstrap + alle Migrationen). */
export async function createTestDb(): Promise<TestDb> {
  const name = `sn_test_${randomBytes(4).toString('hex')}`;
  await bootstrap({ adminUrl: ADMIN_URL, dbName: name, migratorPassword: MIGRATOR_PW, appPassword: APP_PW });
  await migrate(urlFor('app_migrator', MIGRATOR_PW, name), undefined, () => undefined);
  const app = new pg.Pool({ connectionString: urlFor('app_user', APP_PW, name), max: 5 });
  const migrator = new pg.Pool({ connectionString: urlFor('app_migrator', MIGRATOR_PW, name), max: 2 });
  const adminUrl = new URL(ADMIN_URL);
  adminUrl.pathname = `/${name}`;
  const admin = new pg.Pool({ connectionString: adminUrl.toString(), max: 2 });
  return {
    name,
    app,
    migrator,
    admin,
    async drop() {
      await Promise.all([app.end(), migrator.end(), admin.end()]);
      const c = new pg.Client({ connectionString: ADMIN_URL });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.end();
    },
  };
}
