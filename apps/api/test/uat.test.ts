/**
 * Phase 7 exit check: the six UAT workflows of the Phase 0 plan, end to end through the API on a
 * real database, the way the apps and the portal call it. Each workflow checks what the customer,
 * the driver and the office would see at the end, and that the ledgers still add up.
 *
 * 1. new customer → first order → delivered with deposit → paid by UPI (checked in the bank)
 * 2. regular reorder → some empties back → dues
 * 3. failed delivery → reschedule → delivered
 * 4. a driver's day: load-out → 10 stops (1 sent from the offline queue, twice) → day-end check
 * 5. office phone orders → bulk assign → move the route when the driver is absent
 * 6. ledger correction → visible in the activity log
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq, sql } from 'drizzle-orm';
import { deliveryChargeFor, depositCansFor, priceOrder } from '@wtrdrop/shared';
import { createHarness, bearer, type TestHarness, type TestUser } from './helpers';
import { customers } from '../src/db/schema';

let h: TestHarness;
let owner: TestUser;
let office: TestUser;
let W: { Morning: string; Afternoon: string; Evening: string };
const api = () => request(h.app);
const idem = () => ({ 'Idempotency-Key': `k_${randomUUID()}` });
let seq = 0;
const newPhone = () =>
  `9796${String(process.pid % 1000).padStart(3, '0')}${String(++seq).padStart(3, '0')}`;

// Thursday 19 Nov 2026, 10:00 in India, and the Friday after.
const THU_10AM = new Date('2026-11-19T10:00:00+05:30');
const FRI_9AM = new Date('2026-11-20T09:00:00+05:30');
const THU = '2026-11-19';
const FRI = '2026-11-20';
const PRICE = 4000; // ₹40 a can (test catalogue)
const DEPOSIT = 15000; // ₹150 a can (demo settings)

interface Customer {
  auth: Record<string, string>;
  addressId: string;
  customerId: string;
  phone: string;
}

/** Signs up in the app exactly as a new customer would: OTP, name, first address. */
async function signUp(name: string): Promise<Customer> {
  const phone = newPhone();
  expect((await api().post('/api/v1/auth/otp/request').send({ phone })).status).toBe(200);
  const v = await api()
    .post('/api/v1/auth/otp/verify')
    .send({ app: 'customer', phone, code: h.lastCode(`+91${phone}`) });
  expect(v.status).toBe(200);
  const auth = { Authorization: `Bearer ${v.body.accessToken}` };
  await api().patch('/api/v1/me').set(auth).send({ name });
  const a = await api()
    .post('/api/v1/customer/addresses')
    .set(auth)
    .set(idem())
    .send({ label: 'Home', line: `${name} house`, landmark: 'Near the school', pincode: '682030' });
  expect(a.status).toBe(201);
  const p = await api().get('/api/v1/customer/profile').set(auth);
  return { auth, addressId: a.body.address.id, customerId: p.body.customer.id, phone };
}

/** Orders from the app the way the order screen does: the total it showed is sent along. */
async function appOrder(c: Customer, qty: number, date: string, windowId = W.Evening) {
  const opts = (await api().get('/api/v1/customer/order-options').set(c.auth)).body;
  const depositCans = depositCansFor(qty, opts.cansHeld, opts.depositCoverCans);
  const rule = opts.delivery ?? { chargePaise: 0, freeAboveCans: 0 };
  const { totalPaise } = priceOrder({
    qty,
    unitPricePaise: opts.unitPricePaise,
    depositPerCanPaise: opts.depositPerCanPaise,
    depositCans,
    deliveryChargePaise: deliveryChargeFor(qty, rule.chargePaise, rule.freeAboveCans),
  });
  const o = await api().post('/api/v1/customer/orders').set(c.auth).set(idem()).send({
    clientRequestId: randomUUID(),
    addressId: c.addressId,
    windowId,
    date,
    qty,
    expectedTotalPaise: totalPaise,
  });
  expect(o.status).toBe(201);
  return o.body.order as { id: string; orderNo: number; status: string };
}

async function phoneOrder(c: Customer, qty: number, date: string, windowId = W.Evening) {
  const o = await api().post('/api/v1/admin/orders').set(bearer(office)).set(idem()).send({
    customerId: c.customerId,
    clientRequestId: randomUUID(),
    addressId: c.addressId,
    windowId,
    date,
    qty,
  });
  expect(o.status).toBe(201);
  return o.body.order as { id: string; orderNo: number; status: string };
}

async function assign(driver: TestUser, orderIds: string[], date: string) {
  const a = await api()
    .post('/api/v1/admin/deliveries/assign')
    .set(bearer(office))
    .set(idem())
    .send({ date, staffUserId: driver.userId, orderIds });
  expect(a.status).toBe(200);
  return a.body as { tripId: string; assigned: number };
}

async function start(driver: TestUser, tripId: string, loadFull: number) {
  const s = await api()
    .post(`/api/v1/staff/trips/${tripId}/start`)
    .set(bearer(driver))
    .send({ clientActionId: randomUUID(), loadFull });
  expect(s.status).toBe(200);
}

type Payment = { method: 'cash' | 'upi' | 'later'; amountPaise: number };
function deliver(
  driver: TestUser,
  orderId: string,
  full: number,
  empties: number,
  payment: Payment,
  clientActionId: string = randomUUID(),
  at: Date = h.clock.now ?? new Date(),
) {
  return api()
    .post(`/api/v1/staff/orders/${orderId}/deliver`)
    .set(bearer(driver))
    .send({ clientActionId, full, empties, payment, at: at.toISOString() });
}

async function endDay(driver: TestUser, tripId: string, cashPaise: number, returnFull = 0) {
  const e = await api().post(`/api/v1/staff/trips/${tripId}/end`).set(bearer(driver)).send({
    clientActionId: randomUUID(),
    returnFull,
    returnEmpty: 0,
    returnDamaged: 0,
    cashPaise,
  });
  expect(e.status).toBe(200);
}

const account = async (c: Customer) =>
  (await api().get('/api/v1/customer/account').set(c.auth)).body as {
    cansHeld: number;
    depositHeldPaise: number;
    balancePaise: number;
  };
const orderStatus = async (id: string) =>
  (await api().get(`/api/v1/admin/orders/${id}`).set(bearer(office))).body.order.status as string;

/** Every cached balance equals the sum of its ledger entries (Phase 5 scenario 5). */
async function ledgersAgree() {
  const r = await h.handle.db.execute<{ bad: string }>(sql`
    select count(*)::text as bad from customers c
    where c.cans_held <> coalesce((select sum(delta) from can_ledger where customer_id = c.id), 0)
       or c.balance_paise <> coalesce((select sum(delta_paise) from account_ledger where customer_id = c.id), 0)
       or c.deposit_held_paise <> coalesce((select sum(delta_paise) from deposit_ledger where customer_id = c.id), 0)
       or c.deposit_cover_cans <> coalesce((select sum(delta_cans) from deposit_ledger where customer_id = c.id), 0)`);
  return Number(r.rows[0]!.bad);
}

beforeAll(async () => {
  h = await createHarness({ RATE_LIMIT_PER_MINUTE: '5000' });
  owner = await h.makeUser(h.supplierA, 'owner');
  office = await h.makeUser(h.supplierA, 'admin');
  W = (await h.setupOrdering(h.supplierA)).windows as typeof W;
  await api()
    .post('/api/v1/admin/service-areas')
    .set(bearer(owner))
    .set(idem())
    .send({ name: 'Kakkanad', pincodes: ['682030'] });
  h.clock.now = THU_10AM;
});
afterAll(async () => {
  await h?.cleanup();
});

describe('UAT workflows (Phase 7 exit)', () => {
  let anitha: Customer;

  it('1. new customer → first order → delivered with deposit → paid by UPI', async () => {
    h.clock.now = THU_10AM;
    anitha = await signUp('Anitha Kumar');
    const order = await appOrder(anitha, 2, THU);
    expect(order.status).toBe('ACCEPTED'); // demo setting: accept automatically

    const ravi = await h.makeUser(h.supplierA, 'staff');
    const { tripId } = await assign(ravi, [order.id], THU);
    await start(ravi, tripId, 2);
    // First delivery: 2 cans and the deposit for both, paid by UPI at the door.
    const due = 2 * PRICE + 2 * DEPOSIT;
    const d = await deliver(ravi, order.id, 2, 0, { method: 'upi', amountPaise: due });
    expect(d.status).toBe(200);
    expect(d.body.attempt).toMatchObject({ depositCans: 2 });
    await endDay(ravi, tripId, 0);

    expect(await orderStatus(order.id)).toBe('DELIVERED');
    expect(await account(anitha)).toMatchObject({
      cansHeld: 2,
      depositHeldPaise: 2 * DEPOSIT,
      balancePaise: 0,
    });

    // The office sees the UPI payment to check, and checks it in the bank.
    const dash = await api().get('/api/v1/admin/dashboard').set(bearer(office));
    expect(dash.body.attention.upiToCheck).toEqual({ count: 1, amountPaise: due });
    const toCheck = await api().get('/api/v1/admin/payments?toCheck=1').set(bearer(office));
    const p = toCheck.body.payments.find(
      (x: { customerId: string }) => x.customerId === anitha.customerId,
    );
    expect(p).toMatchObject({ method: 'upi', amountPaise: due });
    const v = await api().post(`/api/v1/admin/payments/${p.id}/verify`).set(bearer(office));
    expect(v.body.payment.verifiedAt).not.toBeNull();
    const after = await api().get('/api/v1/admin/dashboard').set(bearer(office));
    expect(after.body.attention.upiToCheck.count).toBe(0);

    // Anitha's phone app tells her it was delivered.
    await h.app.pushDispatcher.kick();
    const m = await api().get('/api/v1/customer/messages').set(anitha.auth);
    expect(m.body.messages.map((x: { kind: string }) => x.kind)).toEqual([
      'delivered',
      'out_for_delivery',
    ]);
    expect(await ledgersAgree()).toBe(0);
  });

  it('2. regular reorder → some empties back → dues', async () => {
    h.clock.now = FRI_9AM;
    // The home screen's usual order is 2 cans; she reorders it, now 3.
    const opts = await api().get('/api/v1/customer/order-options').set(anitha.auth);
    expect(opts.body.defaultQty).toBe(2);
    const order = await appOrder(anitha, 3, FRI);
    const suresh = await h.makeUser(h.supplierA, 'staff');
    const { tripId } = await assign(suresh, [order.id], FRI);
    await start(suresh, tripId, 3);
    // 3 full cans in, only 1 empty back: she now holds 4, so 2 more cans need a deposit.
    const d = await deliver(suresh, order.id, 3, 1, { method: 'later', amountPaise: 0 });
    expect(d.status).toBe(200);
    expect(d.body.attempt).toMatchObject({ emptyCollected: 1, depositCans: 2 });
    await endDay(suresh, tripId, 0);

    const owed = 3 * PRICE + 2 * DEPOSIT;
    expect(await account(anitha)).toMatchObject({ cansHeld: 4, balancePaise: owed });
    const dues = await api().get('/api/v1/admin/dues').set(bearer(office));
    const row = dues.body.dues.find(
      (x: { customerId: string }) => x.customerId === anitha.customerId,
    );
    expect(row).toMatchObject({ balancePaise: owed, cansHeld: 4 });
    // The office reminds her once; a second tap the same day is refused.
    expect(
      (await api().post(`/api/v1/admin/customers/${anitha.customerId}/remind`).set(bearer(office)))
        .status,
    ).toBe(201);
    const again = await api()
      .post(`/api/v1/admin/customers/${anitha.customerId}/remind`)
      .set(bearer(office));
    expect(again.body.error.code).toBe('REMINDED_RECENTLY');
    const report = await api().get('/api/v1/admin/reports/dues').set(bearer(office));
    expect(
      report.body.report.rows.find(
        (r: { customer_id: string }) => r.customer_id === anitha.customerId,
      ),
    ).toMatchObject({ due_paise: owed });
    expect(await ledgersAgree()).toBe(0);
  });

  it('3. failed delivery → reschedule → delivered', async () => {
    h.clock.now = THU_10AM;
    const biju = await signUp('Biju Thomas');
    const order = await appOrder(biju, 1, THU);
    const anil = await h.makeUser(h.supplierA, 'staff');
    const t1 = await assign(anil, [order.id], THU);
    await start(anil, t1.tripId, 1);
    const f = await api()
      .post(`/api/v1/staff/orders/${order.id}/not-delivered`)
      .set(bearer(anil))
      .send({ clientActionId: randomUUID(), reason: 'NOT_HOME', at: THU_10AM.toISOString() });
    expect(f.status).toBe(200);
    await endDay(anil, t1.tripId, 0, 1);
    expect(await orderStatus(order.id)).toBe('RESCHEDULE_PENDING');
    const dash = await api().get('/api/v1/admin/dashboard').set(bearer(office));
    expect(dash.body.attention.toReschedule).toBeGreaterThanOrEqual(1);

    const r = await api()
      .post(`/api/v1/admin/orders/${order.id}/reschedule`)
      .set(bearer(office))
      .set(idem())
      .send({ date: FRI, windowId: W.Morning });
    expect(r.status).toBe(200);
    expect(r.body.order).toMatchObject({ status: 'ACCEPTED', deliveryDate: FRI });

    h.clock.now = FRI_9AM;
    const t2 = await assign(anil, [order.id], FRI);
    await start(anil, t2.tripId, 1);
    const d = await deliver(anil, order.id, 1, 0, { method: 'cash', amountPaise: PRICE + DEPOSIT });
    expect(d.status).toBe(200);
    await endDay(anil, t2.tripId, PRICE + DEPOSIT);
    expect(await orderStatus(order.id)).toBe('DELIVERED');
    expect(await account(biju)).toMatchObject({ cansHeld: 1, balancePaise: 0 });
    // Biju was told both times.
    const kinds = (await api().get('/api/v1/customer/messages').set(biju.auth)).body.messages.map(
      (x: { kind: string }) => x.kind,
    );
    expect(kinds).toEqual(['delivered', 'out_for_delivery', 'not_delivered', 'out_for_delivery']);
  });

  it("4. a driver's day: load-out → 10 stops (1 offline) → day-end check", async () => {
    h.clock.now = THU_10AM;
    const people = [];
    for (let i = 0; i < 10; i++) people.push(await signUp(`Stop ${i + 1}`));
    const orders = [];
    for (const c of people) orders.push(await phoneOrder(c, 1, THU, W.Afternoon));
    const joby = await h.makeUser(h.supplierA, 'staff');
    const { tripId, assigned } = await assign(
      joby,
      orders.map((o) => o.id),
      THU,
    );
    expect(assigned).toBe(10);
    const day = await api().get(`/api/v1/staff/day?date=${THU}`).set(bearer(joby));
    expect(day.status).toBe(200);
    await start(joby, tripId, 10); // load-out: 10 full cans on the van

    const each = PRICE + DEPOSIT;
    for (const o of orders.slice(0, 9)) {
      const d = await deliver(joby, o.id, 1, 0, { method: 'cash', amountPaise: each });
      expect(d.status).toBe(200);
    }
    // Stop 10 was delivered with no signal at 10:40; the phone sends it when the signal is back,
    // and the queue sends it a second time. It is saved once, at the time it happened.
    const offlineId = randomUUID();
    const happened = new Date(THU_10AM.getTime() + 40 * 60_000);
    h.clock.now = new Date(THU_10AM.getTime() + 90 * 60_000);
    const last = orders[9]!.id;
    const first = await deliver(
      joby,
      last,
      1,
      0,
      { method: 'cash', amountPaise: each },
      offlineId,
      happened,
    );
    const replay = await deliver(
      joby,
      last,
      1,
      0,
      { method: 'cash', amountPaise: each },
      offlineId,
      happened,
    );
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body.attempt.id).toBe(first.body.attempt.id);

    // Day end: the van is empty and all the cash is handed over.
    await endDay(joby, tripId, 10 * each);
    const dash = await api().get('/api/v1/admin/dashboard').set(bearer(office));
    const route = dash.body.routes.find((r: { id: string }) => r.id === tripId);
    expect(route).toMatchObject({ status: 'ended', delivered: 10, failed: 0, remaining: 0 });
    expect(route.cashPaise).toBe(10 * each);
    const ok = await api()
      .post(`/api/v1/admin/trips/${tripId}/reconcile`)
      .set(bearer(office))
      .set(idem())
      .send({});
    expect(ok.status).toBe(200);

    const staff = await api()
      .get(`/api/v1/admin/reports/staff?from=${THU}&to=${THU}`)
      .set(bearer(office));
    const row = staff.body.report.rows.find(
      (r: { status: string; delivered: number }) => r.status === 'reconciled' && r.delivered === 10,
    );
    expect(row).toMatchObject({ cash_difference_paise: 0, cans: 10 });
    // The cans pool still adds up after the day.
    const stock = await api().get(`/api/v1/admin/reports/stock?to=${FRI}`).set(bearer(office));
    expect(stock.body.report.facts.pool_adds_up).toBe(true);
    expect(await ledgersAgree()).toBe(0);
  });

  it('5. office phone orders → bulk assign → move the route when the driver is absent', async () => {
    h.clock.now = THU_10AM;
    const callers = [
      await signUp('Caller One'),
      await signUp('Caller Two'),
      await signUp('Caller Three'),
    ];
    const orders = [];
    for (const c of callers) orders.push(await phoneOrder(c, 2, FRI, W.Morning));
    expect(orders.every((o) => o.status === 'ACCEPTED')).toBe(true);
    const absent = await h.makeUser(h.supplierA, 'staff');
    const cover = await h.makeUser(h.supplierA, 'staff');
    const { tripId, assigned } = await assign(
      absent,
      orders.map((o) => o.id),
      FRI,
    );
    expect(assigned).toBe(3);

    // Friday morning: the driver calls in sick. The whole route moves to another driver.
    h.clock.now = FRI_9AM;
    const m = await api()
      .post(`/api/v1/admin/trips/${tripId}/move`)
      .set(bearer(office))
      .set(idem())
      .send({ staffUserId: cover.userId });
    expect(m.status).toBe(200);
    expect(m.body.moved).toBe(3);
    const coverDay = await api().get(`/api/v1/staff/day?date=${FRI}`).set(bearer(cover));
    expect(JSON.stringify(coverDay.body)).toContain(orders[0]!.id);
    const absentDay = await api().get(`/api/v1/staff/day?date=${FRI}`).set(bearer(absent));
    expect(JSON.stringify(absentDay.body)).not.toContain(orders[0]!.id);
    const audit = await api().get('/api/v1/admin/audit-logs?action=trip.moved').set(bearer(office));
    expect(audit.body.items).toHaveLength(1);
  });

  it('6. ledger correction → visible in the activity log', async () => {
    h.clock.now = FRI_9AM;
    const before = await account(anitha);
    // The office counted 3 cans at Anitha's house, not 4.
    const c = await api()
      .post(`/api/v1/admin/customers/${anitha.customerId}/corrections`)
      .set(bearer(owner))
      .set(idem())
      .send({ cansHeld: before.cansHeld - 1, reason: 'Counted at the house' });
    expect(c.status).toBe(200);
    expect((await account(anitha)).cansHeld).toBe(before.cansHeld - 1);

    const log = await api()
      .get('/api/v1/admin/audit-logs?action=customer.balances_corrected')
      .set(bearer(office));
    expect(log.body.items).toHaveLength(1);
    expect(log.body.items[0]).toMatchObject({
      action: 'customer.balances_corrected',
      entityId: anitha.customerId,
      actorRole: 'owner',
    });
    expect(JSON.stringify(log.body.items[0])).toContain('Counted at the house');
    // The customer's own statement shows the correction too.
    const st = await api().get('/api/v1/customer/statement?month=2026-11').set(anitha.auth);
    expect(st.status).toBe(200);
    const [row] = await h.handle.db
      .select({ cans: customers.cansHeld })
      .from(customers)
      .where(eq(customers.id, anitha.customerId));
    expect(row!.cans).toBe(before.cansHeld - 1);
    expect(await ledgersAgree()).toBe(0);
  });
});
