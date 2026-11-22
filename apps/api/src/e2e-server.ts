/**
 * Browser-test server. Creates a fresh, throwaway database, migrates it, seeds the DEMO supplier
 * plus a test owner, a test office account and a test delivery staff member, then starts the real API with SMS codes
 * written to a local file (dev-outbox) that the browser tests read.
 *
 * Only for local and CI browser tests. It refuses to run with NODE_ENV=production.
 *
 *   E2E_DB_NAME        database to (re)create, must start with "wtrdrop_e2e"
 *   TEST_DATABASE_URL  server where the user may CREATE DATABASE
 *   PORT, CORS_ORIGINS, OTP_DEV_OUTBOX  passed to the API as usual
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { indianMobileSchema } from '@wtrdrop/shared';
import { createDb } from './db/client';
import { runMigrations } from './db/migrate';
import { seed } from './db/seed';
import { deliveryWindows, userRoles, users } from './db/schema';

export const E2E_OWNER_PHONE = '9847000001';
export const E2E_STAFF_PHONE = '9847000002';
export const E2E_ADMIN_PHONE = '9847000003';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('e2e-server never runs in production');
  const dbName = process.env.E2E_DB_NAME ?? 'wtrdrop_e2e';
  if (!/^wtrdrop_e2e[a-z0-9_]*$/.test(dbName))
    throw new Error('E2E_DB_NAME must start with wtrdrop_e2e');
  const adminUrl = process.env.TEST_DATABASE_URL ?? 'postgres://wtrdrop@localhost:5432/postgres';
  const outbox = process.env.OTP_DEV_OUTBOX;
  if (!outbox) throw new Error('OTP_DEV_OUTBOX is required');

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  const databaseUrl = url.toString();
  await runMigrations(databaseUrl);

  const { db, close } = createDb(databaseUrl);
  const { supplierId } = await seed(db, E2E_OWNER_PHONE);
  // The DEMO delivery times are Monday to Saturday; open them every day so the browser tests do not
  // fail when they happen to run on a Sunday.
  await db.update(deliveryWindows).set({ daysOfWeek: [0, 1, 2, 3, 4, 5, 6] });
  const [staff] = await db
    .insert(users)
    .values({ phone: indianMobileSchema.parse(E2E_STAFF_PHONE), name: 'Ravi (test staff)' })
    .returning({ id: users.id });
  const [office] = await db
    .insert(users)
    .values({ phone: indianMobileSchema.parse(E2E_ADMIN_PHONE), name: 'Anu (test office)' })
    .returning({ id: users.id });
  await db.insert(userRoles).values([
    { userId: staff!.id, supplierId, role: 'staff' },
    { userId: office!.id, supplierId, role: 'admin' },
  ]);
  await close();

  rmSync(outbox, { force: true });
  mkdirSync(path.dirname(outbox), { recursive: true });

  Object.assign(process.env, {
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    DATABASE_URL: databaseUrl,
    // A fresh random secret every run: nothing from a browser test outlives it.
    JWT_SECRET: randomBytes(48).toString('base64'),
    OTP_PROVIDER: 'dev-outbox',
    OTP_PER_IP_PER_HOUR: process.env.OTP_PER_IP_PER_HOUR ?? '10000',
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',
  });
  await import('./server');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
