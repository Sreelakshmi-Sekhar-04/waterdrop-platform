import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client';

/** Absolute path of the SQL migrations folder, in source and in the built bundle. */
export function migrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/db → src/db/migrations ; dist → ../src/db/migrations
  return here.endsWith(`${path.sep}dist`)
    ? path.resolve(here, '../src/db/migrations')
    : path.resolve(here, 'migrations');
}

export async function runMigrations(databaseUrl: string): Promise<void> {
  const { db, close } = createDb(databaseUrl);
  try {
    await migrate(db, { migrationsFolder: migrationsFolder() });
  } finally {
    await close();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  runMigrations(url)
    .then(() => console.log('Migrations applied'))
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
