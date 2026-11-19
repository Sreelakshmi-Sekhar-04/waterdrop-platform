/**
 * Integration-test harness: every test file gets its own freshly migrated
 * PostgreSQL database (a real database, not a mock), dropped afterwards.
 *
 * TEST_DATABASE_URL must point at a server where the user may CREATE DATABASE.
 * Default: postgres://wtrdrop@localhost:5432/postgres (see README).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Role } from '@wtrdrop/shared';
import { createApp } from '../src/app';
import { loadEnv } from '../src/config/env';
import { createDb, type DbHandle } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { suppliers, userRoles, users } from '../src/db/schema';
import { createLogger } from '../src/lib/logger';
import { TokenService } from '../src/lib/tokens';

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://wtrdrop@localhost:5432/postgres';
export const TEST_JWT_SECRET = randomBytes(48).toString('base64');

export interface TestUser {
  userId: string;
  supplierId: string;
  role: Role;
  token: string;
}

export interface TestHarness {
  app: ReturnType<typeof createApp>;
  handle: DbHandle;
  tokens: TokenService;
  supplierA: string;
  supplierB: string;
  makeUser: (supplierId: string, role: Role) => Promise<TestUser>;
  cleanup: () => Promise<void>;
}

export async function createHarness(
  envOverrides: Record<string, string> = {},
): Promise<TestHarness> {
  const dbName = `wtrdrop_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  const databaseUrl = url.toString();
  await runMigrations(databaseUrl);

  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    JWT_SECRET: TEST_JWT_SECRET,
    CORS_ORIGINS: 'http://localhost:5173',
    LOG_LEVEL: 'silent',
    ...envOverrides,
  });
  const handle = createDb(databaseUrl);
  const app = createApp({ env, db: handle.db, logger: createLogger('silent') });
  const tokens = new TokenService(TEST_JWT_SECRET);

  const [a] = await handle.db
    .insert(suppliers)
    .values({ name: 'Supplier A', slug: 'a' })
    .returning({ id: suppliers.id });
  const [b] = await handle.db
    .insert(suppliers)
    .values({ name: 'Supplier B', slug: 'b' })
    .returning({ id: suppliers.id });

  let phoneSeq = 0;
  const makeUser = async (supplierId: string, role: Role): Promise<TestUser> => {
    phoneSeq++;
    const phone = `+9198${String(Date.now() % 1e6).padStart(6, '0')}${String(phoneSeq).padStart(2, '0')}`;
    const [u] = await handle.db
      .insert(users)
      .values({ phone, name: `${role} ${phoneSeq}` })
      .returning({ id: users.id });
    await handle.db.insert(userRoles).values({ userId: u!.id, supplierId, role });
    const token = await tokens.issueAccessToken({
      userId: u!.id,
      supplierId,
      role,
      sessionId: randomUUID(),
    });
    return { userId: u!.id, supplierId, role, token };
  };

  const cleanup = async () => {
    await handle.close();
    const c = new pg.Client({ connectionString: ADMIN_URL });
    await c.connect();
    await c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await c.end();
  };

  return { app, handle, tokens, supplierA: a!.id, supplierB: b!.id, makeUser, cleanup };
}

export const bearer = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });
