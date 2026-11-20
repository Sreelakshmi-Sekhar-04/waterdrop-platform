/**
 * Phase 6 payments and corrections on a real database: office payments and duplicate submissions
 * (scenario 8), UPI checking and "not received", dues and credit limits (D-03), deposit refunds
 * (M-05, M-22), corrections, opening balances (M-04) and the monthly statement (D-11). Every test
 * also checks that cached balances equal the ledger entries (scenario 5).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { and, eq, sql } from 'drizzle-orm';
import { createHarness, bearer, type TestHarness, type TestUser } from './helpers';
import { auditLogs, customers, payments, stockMovements, users } from '../src/db/schema';

let h: TestHarness;
let ownerA: TestUser;
let adminA: TestUser;
let ravi: TestUser;
let ownerB: TestUser;
let driver: TestUser; // the delivery person of the latest `delivered()`
let W: { Morning: string; Afternoon: string; Evening: string };
const api = () => request(h.app);
const idem = () => ({ 'Idempotency-Key': `k_${randomUUID()}` });
let seq = 0;
const newPhone = () =>
  `9896${String(process.pid % 1000).padStart(3, '0')}${String(++seq).padStart(3, '0')}`;

// Thursday 19 Nov 2026, 10:00 in India.
const THU_10AM = new Date('2026-11-19T10:00:00+05:30');
const TODAY = '2026-11-19';
const AT = THU_10AM.toISOString();

interface Customer {
  auth: Record<string, string>;
  addressId: string;
  customerId: string;
}

async function newCustomer(): Promise<Customer> {
  const phone = newPhone();
  await api().post('/api/v1/auth/otp/request').send({ phone });
  const v = await api()
    .post('/api/v1/auth/otp/verify')
    .send({ app: 'customer', phone, code: h.lastCode(`+91${phone}`) });
  const auth = { Authorization: `Bearer ${v.body.accessToken}` };
  const a = await api()
    .post('/api/v1/customer/addresses')
    .set(auth)
    .set(idem())
    .send({ label: 'Home', line: 'Rose Villa', landmark: 'Near the church', pincode: '682030' });
  const p = await api().get('/api/v1/customer/profile').set(auth);
  return { auth, addressId: a.body.address.id, customerId: p.body.customer.id };
}

const balances = async (customerId: string) => {
  const [c] = await h.handle.db.select().from(customers).where(eq(customers.id, customerId));
  return c!;
};

async function ledgersAgree() {
  const r = await h.handle.db.execute<{ bad: string }>(sql`
    select count(*)::text as bad from customers c
    where c.cans_held <> coalesce((select sum(delta) from can_ledger where customer_id = c.id), 0)
       or c.balance_paise <> coalesce((select sum(delta_paise) from account_ledger where customer_id = c.id), 0)
       or c.deposit_held_paise <> coalesce((select sum(delta_paise) from deposit_ledger where customer_id = c.id), 0)
       or c.deposit_cover_cans <> coalesce((select sum(delta_cans) from deposit_ledger where customer_id = c.id), 0)`);
  expect(r.rows[0]!.bad).toBe('0');
}

const pay = (
  c: Customer,
  body: Partial<{ method: string; amountPaise: number; paidOn: string; reference: string }> = {},
  clientRequestId = randomUUID(),
  who: TestUser = adminA,
) =>
  api()
    .post(`/api/v1/admin/customers/${c.customerId}/payments`)
    .set(bearer(who))
    .set(idem())
    .send({ clientRequestId, method: 'cash', amountPaise: 10_000, paidOn: TODAY, ...body });

/** One delivered stop for `c` (2 cans, pay later unless said otherwise), returns the attempt. */
async function delivered(
  c: Customer,
  payment: { method: 'cash' | 'upi' | 'later'; amountPaise: number } = {
    method: 'later',
    amountPaise: 0,
  },
) {
  const o = await api().post('/api/v1/admin/orders').set(bearer(ownerA)).set(idem()).send({
    customerId: c.customerId,
    clientRequestId: randomUUID(),
    addressId: c.addressId,
    windowId: W.Evening,
    date: TODAY,
    qty: 2,
  });
  const orderId = o.body.order.id as string;
  // A route cannot take stops once it has started, so each delivery here gets its own person.
  driver = await h.makeUser(h.supplierA, 'staff');
  const a = await api()
    .post('/api/v1/admin/deliveries/assign')
    .set(bearer(ownerA))
    .set(idem())
    .send({ date: TODAY, staffUserId: driver.userId, orderIds: [orderId] });
  const day = await api().get(`/api/v1/staff/day?date=${TODAY}`).set(bearer(driver));
  if (day.body.trip.status === 'planned')
    await api()
      .post(`/api/v1/staff/trips/${a.body.tripId}/start`)
      .set(bearer(driver))
      .send({ clientActionId: randomUUID(), loadFull: 50 });
  const d = await api()
    .post(`/api/v1/staff/orders/${orderId}/deliver`)
    .set(bearer(driver))
    .send({ clientActionId: randomUUID(), full: 2, empties: 0, payment, at: AT });
  expect(d.status).toBe(200);
  return d.body.attempt as { id: string };
}

beforeAll(async () => {
  h = await createHarness();
  ownerA = await h.makeUser(h.supplierA, 'owner');
  adminA = await h.makeUser(h.supplierA, 'admin');
  ravi = await h.makeUser(h.supplierA, 'staff');
  ownerB = await h.makeUser(h.supplierB, 'owner');
  W = (await h.setupOrdering(h.supplierA)).windows as typeof W;
  await h.setupOrdering(h.supplierB);
  await api()
    .post('/api/v1/admin/service-areas')
    .set(bearer(ownerA))
    .set(idem())
    .send({ name: 'Kakkanad', pincodes: ['682030'] });
});
beforeEach(() => {
  h.clock.now = THU_10AM;
});
afterAll(async () => {
  await h?.cleanup();
});

describe('office payments', () => {
  it('records a payment once, however many times it is sent (scenario 8)', async () => {
    const c = await newCustomer();
    await delivered(c); // owes ₹380: 2 × ₹40 + 2 × ₹150 deposit
    expect((await balances(c.customerId)).balancePaise).toBe(38_000);

    const id = randomUUID();
    const all = await Promise.all(
      Array.from({ length: 5 }, () => pay(c, { amountPaise: 20_000 }, id)),
    );
    expect(all.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(new Set(all.map((r) => r.body.payment.id)).size).toBe(1);
    const rows = await h.handle.db.select().from(payments).where(eq(payments.clientRequestId, id));
    expect(rows).toHaveLength(1);
    expect((await balances(c.customerId)).balancePaise).toBe(18_000);
    // Cash the office took itself needs no checking.
    expect(all[0]!.body.payment.verifiedAt).not.toBeNull();
    await ledgersAgree();
  });

  it('refuses a date in the future, other roles and another supplier', async () => {
    const c = await newCustomer();
    expect((await pay(c, { paidOn: '2026-11-20' })).body.error.code).toBe('DATE_IN_FUTURE');
    expect((await pay(c, {}, randomUUID(), ravi)).status).toBe(403);
    const asCustomer = await api()
      .post(`/api/v1/admin/customers/${c.customerId}/payments`)
      .set(c.auth)
      .set(idem())
      .send({ clientRequestId: randomUUID(), method: 'cash', amountPaise: 100, paidOn: TODAY });
    expect(asCustomer.status).toBe(403);
    expect((await pay(c, {}, randomUUID(), ownerB)).status).toBe(404);
    expect((await pay(c, { method: 'later' })).status).toBe(400);
  });
});

describe('checking UPI and "not received"', () => {
  it('lists UPI to check, marks it received, or reverses it with a reason', async () => {
    const c = await newCustomer();
    const good = await pay(c, { method: 'upi', amountPaise: 5_000, reference: 'UTR 1122' });
    const bad = await pay(c, { method: 'upi', amountPaise: 7_000 });
    expect((await balances(c.customerId)).balancePaise).toBe(-12_000);

    const list = await api().get('/api/v1/admin/payments?toCheck=1').set(bearer(adminA));
    const ids = list.body.payments.map((p: { id: string }) => p.id);
    expect(ids).toEqual(expect.arrayContaining([good.body.payment.id, bad.body.payment.id]));
    expect(list.body.toCheck.count).toBeGreaterThanOrEqual(2);

    const v = await api()
      .post(`/api/v1/admin/payments/${good.body.payment.id}/verify`)
      .set(bearer(adminA));
    expect(v.body.payment.verifiedAt).not.toBeNull();

    const noReason = await api()
      .post(`/api/v1/admin/payments/${bad.body.payment.id}/reverse`)
      .set(bearer(adminA))
      .set(idem())
      .send({ reason: '' });
    expect(noReason.status).toBe(400);
    const r = await api()
      .post(`/api/v1/admin/payments/${bad.body.payment.id}/reverse`)
      .set(bearer(adminA))
      .set(idem())
      .send({ reason: 'Not on the bank statement' });
    expect(r.body.payment.reverseReason).toBe('Not on the bank statement');
    expect((await balances(c.customerId)).balancePaise).toBe(-5_000);
    const twice = await api()
      .post(`/api/v1/admin/payments/${bad.body.payment.id}/reverse`)
      .set(bearer(adminA))
      .set(idem())
      .send({ reason: 'Again' });
    expect(twice.body.error.code).toBe('PAYMENT_REVERSED');
    const verifyReversed = await api()
      .post(`/api/v1/admin/payments/${bad.body.payment.id}/verify`)
      .set(bearer(adminA));
    expect(verifyReversed.body.error.code).toBe('PAYMENT_REVERSED');

    const day = await api().get(`/api/v1/admin/payments?from=${TODAY}`).set(bearer(adminA));
    expect(day.body.totals.upiPaise).toBeGreaterThanOrEqual(5_000);
    expect(
      day.body.payments.find((p: { id: string }) => p.id === bad.body.payment.id).reversedAt,
    ).not.toBeNull();
    // Another supplier cannot see or touch it.
    expect(
      (
        await api()
          .post(`/api/v1/admin/payments/${good.body.payment.id}/verify`)
          .set(bearer(ownerB))
      ).status,
    ).toBe(404);
    await ledgersAgree();
  });

  it('a delivery payment reversed by the office is not reversed again by an undo', async () => {
    const c = await newCustomer();
    const attempt = await delivered(c, { method: 'upi', amountPaise: 38_000 });
    expect((await balances(c.customerId)).balancePaise).toBe(0);
    const [p] = await h.handle.db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.attemptId, attempt.id));
    await api()
      .post(`/api/v1/admin/payments/${p!.id}/reverse`)
      .set(bearer(adminA))
      .set(idem())
      .send({ reason: 'UPI failed' });
    expect((await balances(c.customerId)).balancePaise).toBe(38_000);
    const undo = await api()
      .post(`/api/v1/staff/attempts/${attempt.id}/undo`)
      .set(bearer(driver))
      .send({});
    expect(undo.status).toBe(200);
    // The charge is undone; the payment, already reversed, is not reversed twice.
    expect((await balances(c.customerId)).balancePaise).toBe(0);
    expect((await balances(c.customerId)).cansHeld).toBe(0);
    await ledgersAgree();
  });
});

describe('dues and credit limits (D-03)', () => {
  it('lists who owes, how long, and who is above their limit; only the owner sets limits', async () => {
    const c = await newCustomer();
    await delivered(c);
    const dues = await api().get('/api/v1/admin/dues').set(bearer(adminA));
    const row = dues.body.dues.find((d: { customerId: string }) => d.customerId === c.customerId);
    expect(row).toMatchObject({ balancePaise: 38_000, creditLimitPaise: 0, overLimit: true });
    expect(row.owingSince).toBeTruthy();
    expect(row.areaName).toBe('Kakkanad');
    expect(row.phoneLast4).toHaveLength(4);
    expect(dues.body.totals.duePaise).toBeGreaterThanOrEqual(38_000);

    const asAdmin = await api()
      .put(`/api/v1/admin/customers/${c.customerId}/credit-limit`)
      .set(bearer(adminA))
      .send({ creditLimitPaise: 50_000 });
    expect(asAdmin.status).toBe(403);
    const set = await api()
      .put(`/api/v1/admin/customers/${c.customerId}/credit-limit`)
      .set(bearer(ownerA))
      .send({ creditLimitPaise: 50_000 });
    expect(set.body.balances.creditLimitPaise).toBe(50_000);
    const after = await api().get('/api/v1/admin/dues').set(bearer(adminA));
    expect(
      after.body.dues.find((d: { customerId: string }) => d.customerId === c.customerId).overLimit,
    ).toBe(false);
    const [audit] = await h.handle.db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.action, 'customer.credit_limit'), eq(auditLogs.entityId, c.customerId)),
      );
    expect(audit!.before).toEqual({ creditLimitPaise: 0 });

    // Paying it all takes them off the list.
    await pay(c, { amountPaise: 38_000 });
    const cleared = await api().get('/api/v1/admin/dues').set(bearer(adminA));
    expect(
      cleared.body.dues.some((d: { customerId: string }) => d.customerId === c.customerId),
    ).toBe(false);
  });
});

describe('opening balances (M-04), refunds (M-05) and corrections', () => {
  const ph = { a: newPhone(), b: newPhone(), c: newPhone() };
  let existing: Customer;
  let importedId: string;

  it('checks a file without saving, then imports it once', async () => {
    existing = await newCustomer();
    const [r] = await h.handle.db
      .select({ phone: users.phone })
      .from(users)
      .where(eq(users.id, ravi.userId));
    const raviPhone = r!.phone;
    await delivered(existing); // has entries already
    const rows = [
      {
        line: 2,
        phone: ph.a,
        name: 'Joseph K',
        cansHeld: 1,
        depositHeldPaise: 45_000,
        depositCoverCans: 3,
        duePaise: 10_000,
      },
      { line: 3, phone: ph.b, cansHeld: 0, depositHeldPaise: 0, depositCoverCans: 0, duePaise: 0 },
      {
        line: 4,
        phone: raviPhone.slice(3),
        name: 'Ravi',
        cansHeld: 1,
        depositHeldPaise: 0,
        depositCoverCans: 0,
        duePaise: 0,
      },
      {
        line: 5,
        phone: ph.c,
        name: 'Advance Paid',
        cansHeld: 2,
        depositHeldPaise: 30_000,
        depositCoverCans: 2,
        duePaise: -5_000,
      },
    ];
    const existingPhone = (
      await api().get(`/api/v1/admin/customers/${existing.customerId}`).set(bearer(ownerA))
    ).body.customer.phone as string;
    rows.push({
      line: 6,
      phone: existingPhone.slice(3),
      name: 'Xavier',
      cansHeld: 1,
      depositHeldPaise: 0,
      depositCoverCans: 0,
      duePaise: 0,
    });

    const asAdmin = await api()
      .post('/api/v1/admin/opening-balances')
      .set(bearer(adminA))
      .set(idem())
      .send({ rows, dryRun: true });
    expect(asAdmin.status).toBe(403);

    const dry = await api()
      .post('/api/v1/admin/opening-balances')
      .set(bearer(ownerA))
      .set(idem())
      .send({ rows, dryRun: true });
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(
      dry.body.results.map((r: { status: string; code?: string }) => r.code ?? r.status),
    ).toEqual(['new', 'NAME_NEEDED', 'NOT_A_CUSTOMER_HERE', 'new', 'HAS_ENTRIES']);
    const stockBefore = (await api().get('/api/v1/admin/stock').set(bearer(ownerA))).body
      .withCustomers as number;

    const real = await api()
      .post('/api/v1/admin/opening-balances')
      .set(bearer(ownerA))
      .set(idem())
      .send({ rows, dryRun: false });
    expect(real.body.summary).toEqual({ new: 2, existing: 0, errors: 3 });
    const found = await api()
      .get(`/api/v1/admin/customers?q=${ph.a.slice(-4)}`)
      .set(bearer(ownerA));
    importedId = found.body.customers[0].id;
    expect(await balances(importedId)).toMatchObject({
      cansHeld: 1,
      depositHeldPaise: 45_000,
      depositCoverCans: 3,
      balancePaise: 10_000,
    });
    const stockAfter = (await api().get('/api/v1/admin/stock').set(bearer(ownerA))).body
      .withCustomers as number;
    expect(stockAfter - stockBefore).toBe(3);

    // The same file again changes nothing.
    const again = await api()
      .post('/api/v1/admin/opening-balances')
      .set(bearer(ownerA))
      .set(idem())
      .send({ rows: rows.slice(0, 1), dryRun: false });
    expect(again.body.results[0].code).toBe('HAS_ENTRIES');
    expect((await balances(importedId)).balancePaise).toBe(10_000);
    await ledgersAgree();
  });

  it('refunds deposit only for cans that came back, once per request', async () => {
    const url = `/api/v1/admin/customers/${importedId}/deposit-refund`;
    const tooMany = await api()
      .post(url)
      .set(bearer(adminA))
      .set(idem())
      .send({ clientRequestId: randomUUID(), cans: 3, method: 'cash' });
    expect(tooMany.body.error).toMatchObject({
      code: 'NOTHING_TO_REFUND',
      details: { refundableCans: 2 },
    });
    const id = randomUUID();
    const r = await api()
      .post(url)
      .set(bearer(adminA))
      .set(idem())
      .send({ clientRequestId: id, cans: 2, method: 'adjust' });
    expect(r.status).toBe(201);
    expect(r.body.refund).toMatchObject({ cans: 2, amountPaise: 30_000, method: 'adjust' });
    // ₹300 back: the deposit now covers 1 can, and it paid off the ₹100 due with ₹200 to spare.
    expect(await balances(importedId)).toMatchObject({
      depositHeldPaise: 15_000,
      depositCoverCans: 1,
      balancePaise: -20_000,
    });
    // It shows on the account (and the statement) as a deposit refund, not a plain correction.
    const led = await api()
      .get(`/api/v1/admin/customers/${importedId}/ledgers`)
      .set(bearer(adminA));
    expect(led.body.money[0]).toMatchObject({
      entryType: 'deposit_refund',
      deltaPaise: -30_000,
    });
    const replay = await api()
      .post(url)
      .set(bearer(adminA))
      .set(idem())
      .send({ clientRequestId: id, cans: 2, method: 'adjust' });
    expect(replay.body.refund.id).toBe(r.body.refund.id);
    expect((await balances(importedId)).depositHeldPaise).toBe(15_000);
    const list = await api().get(`/api/v1/admin/payments?from=${TODAY}`).set(bearer(adminA));
    expect(list.body.refunds.some((x: { id: string }) => x.id === r.body.refund.id)).toBe(true);
    await ledgersAgree();
  });

  it('corrects balances with a reason, as new entries, and keeps the can pool right', async () => {
    const url = `/api/v1/admin/customers/${importedId}/corrections`;
    const same = await api()
      .post(url)
      .set(bearer(adminA))
      .set(idem())
      .send({ cansHeld: 1, reason: 'Counted at the house' });
    expect(same.body.error.code).toBe('NOTHING_CHANGED');
    const noReason = await api().post(url).set(bearer(adminA)).set(idem()).send({ cansHeld: 3 });
    expect(noReason.status).toBe(400);

    const ok = await api()
      .post(url)
      .set(bearer(adminA))
      .set(idem())
      .send({ cansHeld: 3, balancePaise: 0, reason: 'Counted at the house; advance given back' });
    expect(ok.status).toBe(200);
    expect(ok.body.balances).toMatchObject({ cansHeld: 3, balancePaise: 0 });
    expect(ok.body.cans[0]).toMatchObject({ entryType: 'adjustment', delta: 2 });
    const moved = await h.handle.db
      .select()
      .from(stockMovements)
      .where(and(eq(stockMovements.customerId, importedId), eq(stockMovements.kind, 'correction')));
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ fromPlace: 'outside', toPlace: 'customer', qty: 2 });
    const [audit] = await h.handle.db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, 'customer.balances_corrected'),
          eq(auditLogs.entityId, importedId),
        ),
      );
    expect(audit!.before).toMatchObject({ cansHeld: 1, balancePaise: -20_000 });
    await ledgersAgree();
  });
});

describe('monthly statement (D-11)', () => {
  it('adds up the month for the office, and the customer sees their own without office notes', async () => {
    const c = await newCustomer();
    await delivered(c);
    await pay(c, { amountPaise: 20_000 });
    await api()
      .post(`/api/v1/admin/customers/${c.customerId}/corrections`)
      .set(bearer(adminA))
      .set(idem())
      .send({ balancePaise: 15_000, reason: 'Discount for late delivery' });

    const s = await api()
      .get(`/api/v1/admin/customers/${c.customerId}/statement?month=2026-11`)
      .set(bearer(adminA));
    expect(s.body.statement.money).toEqual({
      openingPaise: 0,
      chargedPaise: 38_000,
      paidPaise: 23_000,
      closingPaise: 15_000,
    });
    expect(s.body.statement.cans).toEqual({ opening: 0, delivered: 2, returned: 0, closing: 2 });
    expect(s.body.statement.entries.map((e: { entryType: string }) => e.entryType)).toEqual([
      'delivery_charge',
      'payment',
      'adjustment',
    ]);
    expect(s.body.statement.entries[0]).toMatchObject({ cans: 2 });
    expect(s.body.statement.entries[2].reason).toBe('Discount for late delivery');

    const october = await api()
      .get(`/api/v1/admin/customers/${c.customerId}/statement?month=2026-10`)
      .set(bearer(adminA));
    expect(october.body.statement.entries).toEqual([]);
    expect(october.body.statement.money.closingPaise).toBe(0);

    const own = await api().get('/api/v1/customer/statement').set(c.auth);
    expect(own.body.statement.month).toBe('2026-11');
    expect(own.body.statement.money.closingPaise).toBe(15_000);
    expect(own.body.statement.customer.phone).toBeUndefined();
    expect(own.body.statement.entries[2].reason).toBeUndefined();
    expect(
      (await api().get('/api/v1/customer/statement?month=2027-01').set(c.auth)).body.statement,
    ).toBeNull();
    expect(
      (await api().get(`/api/v1/admin/customers/${c.customerId}/statement`).set(bearer(ownerB)))
        .status,
    ).toBe(404);
    expect((await api().get('/api/v1/customer/statement').set(bearer(ravi))).status).toBe(403);
  });
});

describe('office routes are closed to customers and delivery staff (scenario 3)', () => {
  it.each([
    ['get', '/api/v1/admin/payments'],
    ['get', '/api/v1/admin/dues'],
    ['post', '/api/v1/admin/opening-balances'],
  ] as const)('%s %s', async (method, path) => {
    const c = await newCustomer();
    for (const auth of [c.auth, bearer(ravi)]) {
      const res = await (method === 'get' ? api().get(path) : api().post(path).set(idem()))
        .set(auth)
        .send({});
      expect(res.status).toBe(403);
    }
  });
});
