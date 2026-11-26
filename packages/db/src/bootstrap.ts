import pg from 'pg';

export interface BootstrapOptions {
  adminUrl: string;
  dbName: string;
  migratorPassword: string;
  appPassword: string;
}

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`Ungültiger Bezeichner: ${s}`);
  return s;
};
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * Legt Rollen, Datenbank und Extensions an (E-04). Idempotent. Benötigt Superuser.
 *  - app_migrator: Owner aller Objekte, führt Migrationen aus
 *  - app_user:     Laufzeitrolle der API, ohne BYPASSRLS, nicht Owner
 *  - app_definer:  NOLOGIN, BYPASSRLS; Owner weniger SECURITY-DEFINER-Funktionen (Login, Registrierung, Audit-Kette)
 */
export async function bootstrap(o: BootstrapOptions): Promise<void> {
  const db = ident(o.dbName);
  const admin = new pg.Client({ connectionString: o.adminUrl });
  await admin.connect();
  try {
    const roles: Array<[string, string]> = [
      ['app_migrator', `LOGIN PASSWORD ${lit(o.migratorPassword)} NOBYPASSRLS`],
      ['app_user', `LOGIN PASSWORD ${lit(o.appPassword)} NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE`],
      ['app_definer', 'NOLOGIN BYPASSRLS'],
    ];
    for (const [name, attrs] of roles) {
      const { rowCount } = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [name]);
      await admin.query(`${rowCount ? 'ALTER' : 'CREATE'} ROLE ${name} WITH ${attrs}`);
    }
    await admin.query('GRANT app_definer TO app_migrator');
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [db]);
    if (!rowCount) await admin.query(`CREATE DATABASE ${db} OWNER app_migrator ENCODING 'UTF8' TEMPLATE template0`);
  } finally {
    await admin.end();
  }

  const url = new URL(o.adminUrl);
  url.pathname = `/${db}`;
  const c = new pg.Client({ connectionString: url.toString() });
  await c.connect();
  try {
    await c.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE EXTENSION IF NOT EXISTS citext;
      REVOKE ALL ON DATABASE ${db} FROM PUBLIC;
      GRANT CONNECT ON DATABASE ${db} TO app_user, app_migrator;
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      ALTER SCHEMA public OWNER TO app_migrator;
      GRANT USAGE ON SCHEMA public TO app_user, app_definer;
      CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION app_migrator;
      GRANT USAGE ON SCHEMA app TO app_user, app_definer;
      GRANT CREATE ON SCHEMA app TO app_definer;
      ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user, app_definer;
      ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO app_user, app_definer;
      ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA app
        GRANT EXECUTE ON FUNCTIONS TO app_user, app_definer;
    `);
  } finally {
    await c.end();
  }
}
