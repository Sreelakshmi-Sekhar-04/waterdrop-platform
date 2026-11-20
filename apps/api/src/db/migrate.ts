import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client';

/**
 * Absolute path of the SQL migrations folder, in source (src/db/migrations) and in the built
 * bundle (dist/… → src/db/migrations next to dist, as the container image lays it out).
 * MIGRATIONS_DIR overrides it.
 */
export function migrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.MIGRATIONS_DIR,
    path.resolve(here, 'migrations'),
    path.resolve(here, '../src/db/migrations'),
    path.resolve(here, '../../src/db/migrations'),
  ].filter((p): p is string => !!p);
  const found = candidates.find((p) => existsSync(path.join(p, 'meta', '_journal.json')));
  if (!found) throw new Error(`SQL migrations not found (looked in ${candidates.join(', ')})`);
  return found;
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
