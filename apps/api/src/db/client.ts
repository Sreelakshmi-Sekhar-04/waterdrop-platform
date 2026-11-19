import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
/** A database handle or an open transaction; services accept either. */
export type DbOrTx = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export interface DbHandle {
  db: Database;
  pool: pg.Pool;
  close: () => Promise<void>;
}

export function createDb(databaseUrl: string): DbHandle {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  // An idle connection dropped by the server (restart, failover) must not crash the process.
  // The pool replaces it on the next query.
  pool.on('error', (err) => {
    console.error('PostgreSQL idle client error:', err.message);
  });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}
