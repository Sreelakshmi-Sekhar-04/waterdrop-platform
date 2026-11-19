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
import {
  deliveryWindows,
  productPrices,
  products,
  sessions,
  settings,
  suppliers,
  userRoles,
  users,
} from '../src/db/schema';
import { DEMO_SETTINGS } from '../src/modules/settings/settings.schema';
import type { OtpProvider } from '../src/providers/otp';
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
  /** SMS codes "sent" during the test, newest last. Delivery is the only part replaced. */
  sms: { phone: string; code: string; language: string }[];
  lastCode: (phone: string) => string;
  /** When set, the next send fails like a provider outage. */
  failNextSend: { value: boolean };
  /** Set `now` to fix the time the ordering rules see; null = the real time. */
  clock: { now: Date | null };
  /** DEMO settings, the 20 L can at ₹40 and Morning/Afternoon/Evening windows (Mon–Sat, 100 cans). */
  setupOrdering: (
    supplierId: string,
  ) => Promise<{ productId: string; windows: Record<string, string> }>;
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
    DEFAULT_SUPPLIER_SLUG: 'a',
    // Every test request comes from 127.0.0.1; the per-network limit has its own test.
    OTP_PER_IP_PER_HOUR: '100000',
    ...envOverrides,
  });
  const handle = createDb(databaseUrl);
  const sms: TestHarness['sms'] = [];
  const failNextSend = { value: false };
  const otpProvider: OtpProvider = {
    name: 'test-capture',
    send: async (m) => {
      if (failNextSend.value) {
        failNextSend.value = false;
        const { OtpDeliveryError } = await import('../src/providers/otp');
        throw new OtpDeliveryError('test outage');
      }
      sms.push(m);
    },
  };
  const clock: TestHarness['clock'] = { now: null };
  const app = createApp({
    env,
    db: handle.db,
    logger: createLogger('silent'),
    otpProvider,
    clock: () => clock.now ?? new Date(),
  });
  const lastCode = (phone: string) => {
    const m = [...sms].reverse().find((x) => x.phone === phone);
    if (!m) throw new Error(`no SMS sent to ${phone}`);
    return m.code;
  };
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
    // A real session row: access tokens only work while their session is open.
    const [s] = await handle.db
      .insert(sessions)
      .values({
        userId: u!.id,
        supplierId,
        role,
        familyId: randomUUID(),
        refreshTokenHash: randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + 3600_000),
      })
      .returning({ id: sessions.id });
    const token = await tokens.issueAccessToken({
      userId: u!.id,
      supplierId,
      role,
      sessionId: s!.id,
    });
    return { userId: u!.id, supplierId, role, token };
  };

  const setupOrdering: TestHarness['setupOrdering'] = async (supplierId) => {
    await handle.db
      .insert(settings)
      .values(
        Object.entries(DEMO_SETTINGS)
          .filter(([, v]) => v !== null)
          .map(([key, value]) => ({ supplierId, key, value })),
      )
      .onConflictDoNothing();
    const [p] = await handle.db
      .insert(products)
      .values({ supplierId, sku: 'CAN-20L', nameEn: '20 litre water can', nameMl: '20 ലിറ്റർ ക്യാൻ' })
      .returning({ id: products.id });
    await handle.db
      .insert(productPrices)
      .values({ supplierId, productId: p!.id, pricePaise: 4000, validFrom: '2026-01-01' });
    const days = [1, 2, 3, 4, 5, 6];
    const rows = await handle.db
      .insert(deliveryWindows)
      .values([
        {
          supplierId,
          nameEn: 'Morning',
          nameMl: 'രാവിലെ',
          startTime: '07:00',
          endTime: '11:00',
          capacityCans: 100,
          daysOfWeek: days,
        },
        {
          supplierId,
          nameEn: 'Afternoon',
          nameMl: 'ഉച്ചയ്ക്ക്',
          startTime: '11:00',
          endTime: '15:00',
          capacityCans: 100,
          daysOfWeek: days,
        },
        {
          supplierId,
          nameEn: 'Evening',
          nameMl: 'വൈകുന്നേരം',
          startTime: '15:00',
          endTime: '19:00',
          capacityCans: 100,
          daysOfWeek: days,
        },
      ])
      .returning({ id: deliveryWindows.id, name: deliveryWindows.nameEn });
    return { productId: p!.id, windows: Object.fromEntries(rows.map((r) => [r.name, r.id])) };
  };

  const cleanup = async () => {
    await handle.close();
    const c = new pg.Client({ connectionString: ADMIN_URL });
    await c.connect();
    await c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await c.end();
  };

  return {
    app,
    handle,
    tokens,
    supplierA: a!.id,
    supplierB: b!.id,
    makeUser,
    sms,
    lastCode,
    failNextSend,
    clock,
    setupOrdering,
    cleanup,
  };
}

export const bearer = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });
