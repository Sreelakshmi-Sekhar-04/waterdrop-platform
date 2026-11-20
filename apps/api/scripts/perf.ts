/**
 * Phase 8 performance check (Phase 0 §12.2: "morning peak: concurrent orders on the last capacity,
 * 50 staff syncing at once"), plus the reports on a year of data.
 *
 * Runs the real API over real HTTP on a throwaway PostgreSQL database (the same harness the tests
 * use), then drops it. Nothing is mocked except SMS and push delivery.
 *
 *   pnpm --filter @wtrdrop/api perf            # full run (a year of deliveries, a few minutes)
 *   PERF_DAYS=30 pnpm --filter @wtrdrop/api perf   # shorter history
 *
 * Writes the results to PERF_OUT (default perf-results.json) and prints a summary table. The
 * numbers are from whatever machine runs it: compare runs on the same machine only.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { sql } from 'drizzle-orm';
import { addDays, deliveryChargeFor, depositCansFor, priceOrder } from '@wtrdrop/shared';
import { createHarness, type TestHarness } from '../test/helpers';
import { deliveryWindows, productPrices, sessions, userRoles, users } from '../src/db/schema';
import type { Role } from '@wtrdrop/shared';

const DAYS = Number(process.env.PERF_DAYS ?? 365);
const OUT = process.env.PERF_OUT ?? 'perf-results.json';
const RUSH_CUSTOMERS = 300;
const RUSH_CAPACITY = 50;
const DRIVERS = 50;
const STOPS_PER_DRIVER = 10;
const HISTORY_CUSTOMERS = 400;
const HISTORY_PER_DAY = 100;
const HISTORY_DRIVERS = 5;

let h: TestHarness;
let base = '';

// ---------------------------------------------------------------- small HTTP client and timing

interface Res {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  ms: number;
}
async function http(method: string, path: string, token?: string, body?: unknown): Promise<Res> {
  const t0 = performance.now();
  const r = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(method !== 'GET' ? { 'Idempotency-Key': randomUUID() } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  const ms = performance.now() - t0;
  const json = (r.headers.get('content-type') ?? '').includes('json');
  return { status: r.status, body: text && json ? JSON.parse(text) : text, ms };
}
async function ok(method: string, path: string, token: string, body?: unknown) {
  const r = await http(method, path, token, body);
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r;
}

/** Runs tasks with at most `n` at a time. */
async function pool<T>(n: number, tasks: (() => Promise<T>)[]): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        out[i] = await tasks[i]!();
      }
    }),
  );
  return out;
}

function stats(ms: number[]) {
  const s = [...ms].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  const r = (x: number) => Math.round(x);
  return { n: s.length, p50: r(q(0.5)), p95: r(q(0.95)), max: r(s[s.length - 1] ?? 0) };
}

/** A signed-in user whose token outlives a long run (6 hours, real session row). */
async function longUser(supplierId: string, role: Role, userId?: string) {
  let id = userId;
  if (!id) {
    const phone = `+9196${randomBytes(4).readUInt32BE() % 1e8}`.padEnd(13, '7');
    const [u] = await h.handle.db
      .insert(users)
      .values({ phone, name: `${role} perf` })
      .returning({ id: users.id });
    id = u!.id;
    await h.handle.db.insert(userRoles).values({ userId: id, supplierId, role });
  }
  const [s] = await h.handle.db
    .insert(sessions)
    .values({
      userId: id,
      supplierId,
      role,
      familyId: randomUUID(),
      refreshTokenHash: randomBytes(32).toString('hex'),
      expiresAt: new Date(Date.now() + 6 * 3600_000),
    })
    .returning({ id: sessions.id });
  const token = await h.tokens.issueAccessToken(
    { userId: id, supplierId, role, sessionId: s!.id },
    6 * 3600,
  );
  return { userId: id, token };
}

async function ledgerMismatches() {
  const r = await h.handle.db.execute<{ bad: string }>(sql`
    select count(*)::text as bad from customers c
    where c.cans_held <> coalesce((select sum(delta) from can_ledger where customer_id = c.id), 0)
       or c.balance_paise <> coalesce((select sum(delta_paise) from account_ledger where customer_id = c.id), 0)
       or c.deposit_held_paise <> coalesce((select sum(delta_paise) from deposit_ledger where customer_id = c.id), 0)`);
  return Number(r.rows[0]!.bad);
}

const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);
let phoneSeq = 0;
const phone = () =>
  `98${String(process.pid % 100).padStart(2, '0')}${String(++phoneSeq).padStart(6, '0')}`;

// ---------------------------------------------------------------- scenarios

async function main() {
  h = await createHarness({ RATE_LIMIT_PER_MINUTE: '10000000', LOG_LEVEL: 'silent' });
  const server = h.app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const results: Record<string, unknown> = { startedAt: new Date().toISOString(), days: DAYS };
  try {
    const sup = h.supplierA;
    const { productId } = await h.setupOrdering(sup);
    // The test catalogue's price starts in 2026; the history goes back a year before that.
    await h.handle.db
      .insert(productPrices)
      .values({ supplierId: sup, productId, pricePaise: 4000, validFrom: '2024-01-01' });
    const owner = await longUser(sup, 'owner');
    await ok('POST', '/admin/service-areas', owner.token, {
      name: 'Perf area',
      pincodes: ['682030'],
    });
    // Open all day, every day, so the clock never closes a window mid-run.
    const [allDay] = await h.handle.db
      .insert(deliveryWindows)
      .values({
        supplierId: sup,
        nameEn: 'All day',
        nameMl: 'മുഴുവൻ ദിവസം',
        startTime: '00:00',
        endTime: '23:59',
        capacityCans: 5000,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      })
      .returning({ id: deliveryWindows.id });
    const [rush] = await h.handle.db
      .insert(deliveryWindows)
      .values({
        supplierId: sup,
        nameEn: 'Rush',
        nameMl: 'തിരക്ക്',
        startTime: '16:00',
        endTime: '19:00',
        capacityCans: RUSH_CAPACITY,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      })
      .returning({ id: deliveryWindows.id });

    // History starts DAYS ago; the rush and driver scenarios run on the last day.
    const lastDay = '2026-11-19';
    const firstDay = addDays(lastDay, -DAYS);

    // ------------------------------------------------------------ customers
    h.clock.now = ist(firstDay, '07:00');
    console.log(`Adding ${HISTORY_CUSTOMERS} customers…`);
    const customers = await pool(
      20,
      Array.from({ length: HISTORY_CUSTOMERS }, (_, i) => async () => {
        const r = await ok('POST', '/admin/customers', owner.token, {
          phone: phone(),
          name: `Customer ${i + 1}`,
          address: {
            label: 'Home',
            line: `House ${i + 1}`,
            landmark: 'Near the school',
            pincode: '682030',
          },
        });
        return {
          customerId: r.body.customer.id as string,
          addressId: r.body.customer.addresses[0].id as string,
        };
      }),
    );

    // ------------------------------------------------------------ a year of deliveries
    const drivers = await Promise.all(
      Array.from({ length: HISTORY_DRIVERS }, () => longUser(sup, 'staff')),
    );
    console.log(`Delivering ${HISTORY_PER_DAY} orders a day for ${DAYS} days…`);
    const hist: number[] = [];
    const t0 = performance.now();
    for (let d = 0; d < DAYS; d++) {
      const day = addDays(firstDay, d);
      h.clock.now = ist(day, '07:00');
      const todays = Array.from(
        { length: HISTORY_PER_DAY },
        (_, i) => customers[(d * 37 + i) % customers.length]!,
      );
      const orders = await pool(
        20,
        todays.map((c) => async () => {
          const r = await ok('POST', '/admin/orders', owner.token, {
            ...c,
            clientRequestId: randomUUID(),
            windowId: allDay!.id,
            date: day,
            qty: 1 + ((d + c.customerId.charCodeAt(0)) % 3),
          });
          hist.push(r.ms);
          return r.body.order as { id: string; totalPaise: number; qty: number };
        }),
      );
      const per = Math.ceil(orders.length / drivers.length);
      await Promise.all(
        drivers.map(async (drv, k) => {
          const mine = orders.slice(k * per, (k + 1) * per);
          if (!mine.length) return;
          const a = await ok('POST', '/admin/deliveries/assign', owner.token, {
            date: day,
            staffUserId: drv.userId,
            orderIds: mine.map((o) => o.id),
          });
          await ok('POST', `/staff/trips/${a.body.tripId}/start`, drv.token, {
            clientActionId: randomUUID(),
            loadFull: 200,
          });
          let cash = 0;
          for (const [j, o] of mine.entries()) {
            const at = h.clock.now!.toISOString();
            if (j % 25 === 7) {
              await ok('POST', `/staff/orders/${o.id}/not-delivered`, drv.token, {
                clientActionId: randomUUID(),
                reason: 'NOT_HOME',
                at,
              });
              continue;
            }
            const later = j % 6 === 0;
            const full = o.qty;
            const r = await ok('POST', `/staff/orders/${o.id}/deliver`, drv.token, {
              clientActionId: randomUUID(),
              full,
              empties: Math.max(0, full - (j % 2)),
              payment: later
                ? { method: 'later', amountPaise: 0 }
                : { method: j % 3 === 0 ? 'upi' : 'cash', amountPaise: o.totalPaise },
              at,
            });
            hist.push(r.ms);
            if (!later && j % 3 !== 0) cash += o.totalPaise;
          }
          await ok('POST', `/staff/trips/${a.body.tripId}/end`, drv.token, {
            clientActionId: randomUUID(),
            returnFull: 0,
            returnEmpty: 0,
            returnDamaged: 0,
            cashPaise: cash,
          });
        }),
      );
      if (d % 30 === 29)
        console.log(`  day ${d + 1}/${DAYS} (${Math.round((performance.now() - t0) / 1000)} s)`);
    }
    const counts = await h.handle.db.execute<{
      orders: string;
      attempts: string;
      payments: string;
    }>(sql`
      select (select count(*) from orders)::text as orders,
             (select count(*) from delivery_attempts)::text as attempts,
             (select count(*) from payments)::text as payments`);
    results.history = {
      ...counts.rows[0],
      writeLatencyMs: stats(hist),
      seconds: Math.round((performance.now() - t0) / 1000),
      ledgerMismatches: await ledgerMismatches(),
    };

    // ------------------------------------------------------------ reports on the history
    h.clock.now = ist(lastDay, '09:00');
    console.log('Timing the Today page and reports…');
    const reads: Record<string, ReturnType<typeof stats>> = {};
    const time = async (label: string, path: string) => {
      const ms: number[] = [];
      for (let i = 0; i < 5; i++) {
        const r = await ok('GET', path, owner.token);
        ms.push(r.ms);
      }
      reads[label] = stats(ms);
    };
    const from = addDays(lastDay, -(DAYS - 1));
    await time('dashboard', '/admin/dashboard');
    for (const name of ['sales', 'staff', 'deliveries', 'stock'])
      await time(
        `report ${name} (${DAYS} days)`,
        `/admin/reports/${name}?from=${from}&to=${lastDay}`,
      );
    await time('report dues', '/admin/reports/dues');
    await time('report cans', '/admin/reports/cans');
    await time(
      `sales CSV (${DAYS} days)`,
      `/admin/reports/sales?from=${from}&to=${lastDay}&format=csv`,
    );
    await time('dues list', '/admin/dues');
    await time('activity log (first page)', '/admin/audit-logs?limit=50');
    await time('orders list (today)', `/admin/orders?date=${lastDay}`);
    await time('customer search', '/admin/customers?q=Customer%2012');
    await time('deliveries (today)', `/admin/deliveries?date=${lastDay}`);
    results.reads = reads;

    // ------------------------------------------------------------ morning rush on the last cans
    console.log(`Rush: ${RUSH_CUSTOMERS} customers order the last ${RUSH_CAPACITY} cans at once…`);
    h.clock.now = ist(lastDay, '08:00');
    const rushers = await pool(
      20,
      Array.from({ length: RUSH_CUSTOMERS }, (_, i) => async () => {
        // Signs up exactly as the app does: SMS code, name, address.
        const ph = phone();
        await http('POST', '/auth/otp/request', undefined, { phone: ph });
        const v = await http('POST', '/auth/otp/verify', undefined, {
          app: 'customer',
          phone: ph,
          code: h.lastCode(`+91${ph}`),
        });
        const c = { token: v.body.accessToken as string };
        await ok('PATCH', '/me', c.token, { name: `Rush ${i + 1}` });
        const a = await ok('POST', '/customer/addresses', c.token, {
          label: 'Home',
          line: `Flat ${i + 1}`,
          landmark: 'Opposite the bank',
          pincode: '682030',
        });
        const o = (await ok('GET', '/customer/order-options', c.token)).body;
        const depositCans = depositCansFor(1, o.cansHeld, o.depositCoverCans);
        const rule = o.delivery ?? { chargePaise: 0, freeAboveCans: 0 };
        const { totalPaise } = priceOrder({
          qty: 1,
          unitPricePaise: o.unitPricePaise,
          depositPerCanPaise: o.depositPerCanPaise,
          depositCans,
          deliveryChargePaise: deliveryChargeFor(1, rule.chargePaise, rule.freeAboveCans),
        });
        return { token: c.token, addressId: a.body.address.id as string, totalPaise };
      }),
    );
    const rushT0 = performance.now();
    const rushRes = await Promise.all(
      rushers.map((c) =>
        http('POST', '/customer/orders', c.token, {
          clientRequestId: randomUUID(),
          addressId: c.addressId,
          windowId: rush!.id,
          date: lastDay,
          qty: 1,
          expectedTotalPaise: c.totalPaise,
        }),
      ),
    );
    const by = (s: number) => rushRes.filter((r) => r.status === s).length;
    const codes = Object.fromEntries(
      [...new Set(rushRes.map((r) => r.body?.error?.code ?? String(r.status)))].map((k) => [
        k,
        rushRes.filter((r) => (r.body?.error?.code ?? String(r.status)) === k).length,
      ]),
    );
    const reserved = await h.handle.db.execute<{ r: string }>(sql`
      select coalesce(sum(reserved_cans), 0)::text as r from window_bookings where window_id = ${rush!.id}`);
    results.rush = {
      customers: RUSH_CUSTOMERS,
      capacity: RUSH_CAPACITY,
      accepted: by(201),
      answers: codes,
      reservedAfter: Number(reserved.rows[0]!.r),
      latencyMs: stats(rushRes.map((r) => r.ms)),
      wallMs: Math.round(performance.now() - rushT0),
    };

    // ------------------------------------------------------------ 50 drivers syncing at once
    console.log(`Sync: ${DRIVERS} drivers send ${STOPS_PER_DRIVER} deliveries each, twice…`);
    h.clock.now = ist(lastDay, '10:00');
    const team = await Promise.all(Array.from({ length: DRIVERS }, () => longUser(sup, 'staff')));
    const plan = await pool(
      10,
      team.map((drv, k) => async () => {
        const mine = await pool(
          5,
          Array.from({ length: STOPS_PER_DRIVER }, (_, j) => async () => {
            const c = customers[(k * STOPS_PER_DRIVER + j) % customers.length]!;
            const r = await ok('POST', '/admin/orders', owner.token, {
              ...c,
              clientRequestId: randomUUID(),
              windowId: allDay!.id,
              date: lastDay,
              qty: 1,
            });
            return r.body.order as { id: string; totalPaise: number };
          }),
        );
        const a = await ok('POST', '/admin/deliveries/assign', owner.token, {
          date: lastDay,
          staffUserId: drv.userId,
          orderIds: mine.map((o) => o.id),
        });
        await ok('POST', `/staff/trips/${a.body.tripId}/start`, drv.token, {
          clientActionId: randomUUID(),
          loadFull: STOPS_PER_DRIVER,
        });
        return { drv, orders: mine };
      }),
    );
    // Each phone was offline all morning: its queue sends every stop, then (lost replies) again.
    const syncT0 = performance.now();
    const sync = await Promise.all(
      plan.map(async ({ drv, orders }) => {
        const queue = orders.map((o) => ({
          id: o.id,
          body: {
            clientActionId: randomUUID(),
            full: 1,
            empties: 0,
            payment: { method: 'cash', amountPaise: o.totalPaise },
            at: h.clock.now!.toISOString(),
          },
        }));
        const out: Res[] = [];
        for (const pass of [1, 2])
          for (const q of queue) {
            const r = await http('POST', `/staff/orders/${q.id}/deliver`, drv.token, q.body);
            out.push(r);
            void pass;
          }
        return out;
      }),
    );
    const flat = sync.flat();
    const attempts = await h.handle.db.execute<{ n: string }>(sql`
      select count(*)::text as n from delivery_attempts a join orders o on o.id = a.order_id
      where o.delivery_date = ${lastDay} and a.outcome = 'delivered' and o.window_id = ${allDay!.id}`);
    results.sync = {
      drivers: DRIVERS,
      requests: flat.length,
      ok: flat.filter((r) => r.status === 200).length,
      deliveriesSaved: Number(attempts.rows[0]!.n),
      expected: DRIVERS * STOPS_PER_DRIVER,
      latencyMs: stats(flat.map((r) => r.ms)),
      wallMs: Math.round(performance.now() - syncT0),
      ledgerMismatches: await ledgerMismatches(),
    };
    const pool2 = await http('GET', `/admin/reports/stock?to=${lastDay}`, owner.token);
    results.canPoolAddsUp = pool2.body.report.facts.pool_adds_up;
  } finally {
    results.finishedAt = new Date().toISOString();
    writeFileSync(OUT, JSON.stringify(results, null, 2) + '\n');
    console.log(JSON.stringify(results, null, 2));
    server.close();
    await h.cleanup();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
