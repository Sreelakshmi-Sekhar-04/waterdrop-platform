/**
 * Phase 5 delivery and ledgers on a real database: assignment, the delivery person's day, the
 * single-transaction delivery confirmation, offline replay, undo, failed delivery and reschedule,
 * day-end reconciliation, stock and the ledger invariants (scenarios 2, 5, 11 and 12).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { and, eq, sql } from 'drizzle-orm';
import { createHarness, bearer, type TestHarness, type TestUser } from './helpers';
import {
  accountLedger,
  auditLogs,
  canLedger,
  customers,
  depositLedger,
  payments,
  windowBookings,
} from '../src/db/schema';

let h: TestHarness;
let ownerA: TestUser;
let ravi: TestUser; // delivery person A
let suresh: TestUser; // delivery person B
let ownerB: TestUser;
let W: { Morning: string; Afternoon: string; Evening: string };
const api = () => request(h.app);
const idem = () => ({ 'Idempotency-Key': `k_${randomUUID()}` });
let seq = 0;
const newPhone = () =>
  `9895${String(process.pid % 1000).padStart(3, '0')}${String(++seq).padStart(3, '0')}`;

// Thursday 19 Nov 2026, 10:00 in India.
const THU_10AM = new Date('2026-11-19T10:00:00+05:30');
const TODAY = '2026-11-19';
const FRI = '2026-11-20';
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

/** An office order (accepted at once) for `qty` cans, today evening unless said otherwise. */
async function order(c: Customer, qty = 2, date = TODAY, windowId = W.Evening) {
  const r = await api().post('/api/v1/admin/orders').set(bearer(ownerA)).set(idem()).send({
    customerId: c.customerId,
    clientRequestId: randomUUID(),
    addressId: c.addressId,
    windowId,
    date,
    qty,
  });
  expect(r.status).toBe(201);
  return r.body.order.id as string;
}

const assign = (staff: TestUser, orderIds: string[], date = TODAY) =>
  api()
    .post('/api/v1/admin/deliveries/assign')
    .set(bearer(ownerA))
    .set(idem())
    .send({ date, staffUserId: staff.userId, orderIds });

const day = (staff: TestUser) => api().get(`/api/v1/staff/day?date=${TODAY}`).set(bearer(staff));

const start = (staff: TestUser, tripId: string, loadFull: number) =>
  api()
    .post(`/api/v1/staff/trips/${tripId}/start`)
    .set(bearer(staff))
    .send({ clientActionId: randomUUID(), loadFull });

const deliver = (
  staff: TestUser,
  orderId: string,
  body: { full: number; empties: number; method: 'cash' | 'upi' | 'later'; amountPaise: number },
  clientActionId = randomUUID(),
) =>
  api()
    .post(`/api/v1/staff/orders/${orderId}/deliver`)
    .set(bearer(staff))
    .send({
      clientActionId,
      full: body.full,
      empties: body.empties,
      payment: { method: body.method, amountPaise: body.amountPaise },
      at: AT,
    });

const failed = (staff: TestUser, orderId: string, reason = 'NOT_HOME') =>
  api()
    .post(`/api/v1/staff/orders/${orderId}/not-delivered`)
    .set(bearer(staff))
    .send({ clientActionId: randomUUID(), reason, at: AT });

const balances = async (customerId: string) => {
  const [c] = await h.handle.db.select().from(customers).where(eq(customers.id, customerId));
  return c!;
};

/** Scenario 5: every cached balance equals the sum of its ledger entries. */
async function ledgersAgree() {
  const r = await h.handle.db.execute<{ bad: string }>(sql`
    select count(*)::text as bad from customers c
    where c.cans_held <> coalesce((select sum(delta) from can_ledger where customer_id = c.id), 0)
       or c.balance_paise <> coalesce((select sum(delta_paise) from account_ledger where customer_id = c.id), 0)
       or c.deposit_held_paise <> coalesce((select sum(delta_paise) from deposit_ledger where customer_id = c.id), 0)
       or c.deposit_cover_cans <> coalesce((select sum(delta_cans) from deposit_ledger where customer_id = c.id), 0)`);
  expect(r.rows[0]!.bad).toBe('0');
}

const reserved = async (windowId: string, date: string) => {
  const [b] = await h.handle.db
    .select({ r: windowBookings.reservedCans })
    .from(windowBookings)
    .where(and(eq(windowBookings.windowId, windowId), eq(windowBookings.date, date)));
  return b?.r ?? 0;
};

beforeAll(async () => {
  h = await createHarness();
  ownerA = await h.makeUser(h.supplierA, 'owner');
  ravi = await h.makeUser(h.supplierA, 'staff');
  suresh = await h.makeUser(h.supplierA, 'staff');
  ownerB = await h.makeUser(h.supplierB, 'owner');
  W = (await h.setupOrdering(h.supplierA)).windows as typeof W;
  await h.setupOrdering(h.supplierB);
  await api()
    .post('/api/v1/admin/service-areas')
    .set(bearer(ownerA))
    .set(idem())
    .send({ name: 'Kakkanad', pincodes: ['682030'] });
  // The depot's opening count, so stock numbers are meaningful.
  const count = await api()
    .post('/api/v1/admin/stock')
    .set(bearer(ownerA))
    .set(idem())
    .send({ kind: 'count', full: 100, empty: 40, damaged: 0, note: 'Opening count' });
  expect(count.status).toBe(200);
});
beforeEach(() => {
  h.clock.now = THU_10AM;
});
afterAll(async () => {
  await h?.cleanup();
});

describe('a delivery day', () => {
  let anitha: Customer;
  let mary: Customer;
  let o1: string; // anitha, 2 cans
  let o2: string; // mary, 3 cans
  let o3: string; // mary, 2 cans (will fail)
  let tripId: string;

  it('the office assigns orders; each delivery person sees only their own route (scenario 2)', async () => {
    anitha = await newCustomer();
    mary = await newCustomer();
    o1 = await order(anitha, 2);
    o2 = await order(mary, 3);
    o3 = await order(mary, 2, TODAY, W.Afternoon);
    const a = await assign(ravi, [o1, o2]);
    expect(a.status).toBe(200);
    expect(a.body.assigned).toBe(2);
    expect((await assign(ravi, [o3])).body.assigned).toBe(1);

    const d = await day(ravi);
    expect(d.status).toBe(200);
    tripId = d.body.trip.id;
    expect(d.body.stops.map((s: { orderId: string }) => s.orderId)).toEqual([o1, o2, o3]);
    expect(d.body.stops[0].status).toBe('ASSIGNED');
    expect(d.body.totals.plannedLoad).toBe(7);

    // Suresh has no route, cannot see Ravi's, and cannot act on Ravi's stops.
    expect((await day(suresh)).body.trip).toBeNull();
    expect((await start(suresh, tripId, 7)).status).toBe(404);
    expect(
      (await deliver(suresh, o1, { full: 2, empties: 0, method: 'cash', amountPaise: 38000 }))
        .status,
    ).toBe(404);
    // Customers and the office cannot use the delivery person's routes.
    expect((await api().get('/api/v1/staff/day').set(anitha.auth)).status).toBe(403);
    expect((await api().get('/api/v1/staff/day').set(bearer(ownerA))).status).toBe(403);
  });

  it('the office can reorder the stops before the route starts', async () => {
    const r = await api()
      .put(`/api/v1/admin/trips/${tripId}/sequence`)
      .set(bearer(ownerA))
      .send({ orderIds: [o2, o1, o3] });
    expect(r.status).toBe(200);
    expect((await day(ravi)).body.stops.map((s: { orderId: string }) => s.orderId)).toEqual([
      o2,
      o1,
      o3,
    ]);
  });

  it('deliveries cannot be recorded before the route starts; starting sends every stop out', async () => {
    expect(
      (await deliver(ravi, o1, { full: 2, empties: 0, method: 'cash', amountPaise: 38000 })).body
        .error.code,
    ).toBe('ROUTE_NOT_STARTED');
    expect((await start(ravi, tripId, 7)).status).toBe(200);
    const d = await day(ravi);
    expect(d.body.trip.status).toBe('on_route');
    expect(d.body.stops.every((s: { status: string }) => s.status === 'OUT_FOR_DELIVERY')).toBe(
      true,
    );
    const mine = await api().get(`/api/v1/customer/orders/${o1}`).set(anitha.auth);
    expect(mine.body.order.status).toBe('OUT_FOR_DELIVERY');
    // A route that has started takes no new stops.
    const late = await order(anitha, 1);
    expect((await assign(ravi, [late])).body.error.code).toBe('ROUTE_ALREADY_STARTED');
  });

  it('Delivered writes the order, the three ledgers, the payment, stock and audit together (scenario 11)', async () => {
    // A first-time customer: 2 cans × ₹40 + deposit 2 × ₹150 = ₹380, paid in cash.
    const r = await deliver(ravi, o1, { full: 2, empties: 0, method: 'cash', amountPaise: 38000 });
    expect(r.status).toBe(200);
    expect(r.body.attempt).toMatchObject({
      outcome: 'delivered',
      fullDelivered: 2,
      depositCans: 2,
    });

    const o = await api().get(`/api/v1/admin/orders/${o1}`).set(bearer(ownerA));
    expect(o.body.order.status).toBe('DELIVERED');
    expect(o.body.order.items[0].qtyDelivered).toBe(2);
    const c = await balances(anitha.customerId);
    expect(c).toMatchObject({
      cansHeld: 2,
      depositCoverCans: 2,
      depositHeldPaise: 30000,
      balancePaise: 0,
    });
    const pay = await h.handle.db
      .select()
      .from(payments)
      .where(eq(payments.customerId, anitha.customerId));
    expect(pay).toHaveLength(1);
    expect(pay[0]).toMatchObject({ method: 'cash', amountPaise: 38000, collectedBy: ravi.userId });
    const audit = await h.handle.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, o1), eq(auditLogs.action, 'delivery.delivered')));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorUserId).toBe(ravi.userId);
    const acct = await api().get('/api/v1/customer/account').set(anitha.auth);
    expect(acct.body).toEqual({ cansHeld: 2, depositHeldPaise: 30000, balancePaise: 0 });
    await ledgersAgree();
  });

  it('the same delivery sent again from the offline queue is saved once', async () => {
    const id = randomUUID();
    const body = { full: 2, empties: 0, method: 'later' as const, amountPaise: 0 };
    const first = await deliver(ravi, o2, { ...body, full: 3 }, id);
    const again = await deliver(ravi, o2, { ...body, full: 3 }, id);
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.body.attempt.id).toBe(first.body.attempt.id);
    const entries = await h.handle.db
      .select()
      .from(canLedger)
      .where(eq(canLedger.customerId, mary.customerId));
    expect(entries).toHaveLength(1);
    // Paid later: the whole ₹570 is owed, and the office is told it is above the credit limit (D-03).
    const c = await balances(mary.customerId);
    expect(c.balancePaise).toBe(3 * 4000 + 3 * 15000);
    expect(first.body.attempt.overCreditLimit).toBe(true);
    // A different action on a stop that is done is refused.
    expect((await deliver(ravi, o2, body)).body.error.code).toBe('ALREADY_RECORDED');
    await ledgersAgree();
  });

  it('undo within the allowed minutes reverses everything; later it is refused', async () => {
    const d = await day(ravi);
    const stop = d.body.stops.find((s: { orderId: string }) => s.orderId === o2);
    expect(stop.canUndo).toBe(true);
    const u = await api().post(`/api/v1/staff/attempts/${stop.attempt.id}/undo`).set(bearer(ravi));
    expect(u.status).toBe(200);
    const c = await balances(mary.customerId);
    expect(c).toMatchObject({
      cansHeld: 0,
      balancePaise: 0,
      depositCoverCans: 0,
      depositHeldPaise: 0,
    });
    // Nothing was deleted: the original entries stay, each with a reversal.
    const money = await h.handle.db
      .select()
      .from(accountLedger)
      .where(eq(accountLedger.customerId, mary.customerId));
    expect(money.map((m) => m.entryType)).toEqual(['delivery_charge', 'reversal']);
    expect(money[1]!.reversesEntryId).toBe(money[0]!.id);
    const o = await api().get(`/api/v1/admin/orders/${o2}`).set(bearer(ownerA));
    expect(o.body.order.status).toBe('OUT_FOR_DELIVERY');

    // Delivered again, correctly: 3 full, pays ₹500 of ₹570 by UPI.
    const again = await deliver(ravi, o2, {
      full: 3,
      empties: 0,
      method: 'upi',
      amountPaise: 50000,
    });
    expect(again.status).toBe(200);
    expect((await balances(mary.customerId)).balancePaise).toBe(7000);
    h.clock.now = new Date(THU_10AM.getTime() + 11 * 60_000);
    const late = await api()
      .post(`/api/v1/staff/attempts/${again.body.attempt.id}/undo`)
      .set(bearer(ravi));
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('UNDO_EXPIRED');
    // Another person's delivery cannot be undone at all.
    expect(
      (await api().post(`/api/v1/staff/attempts/${again.body.attempt.id}/undo`).set(bearer(suresh)))
        .status,
    ).toBe(404);
    await ledgersAgree();
  });

  it("couldn't deliver: the order waits to be rescheduled and its capacity is given back", async () => {
    const before = await reserved(W.Afternoon, TODAY);
    const f = await failed(ravi, o3);
    expect(f.status).toBe(200);
    expect(await reserved(W.Afternoon, TODAY)).toBe(before - 2);
    const o = await api().get(`/api/v1/admin/orders/${o3}`).set(bearer(ownerA));
    expect(o.body.order.status).toBe('RESCHEDULE_PENDING');
    expect(o.body.order.history.at(-1).reason).toBe('NOT_HOME');
    const office = await api().get(`/api/v1/admin/deliveries?date=${TODAY}`).set(bearer(ownerA));
    expect(office.body.toReschedule.map((x: { orderId: string }) => x.orderId)).toContain(o3);
    expect(
      office.body.toReschedule.find((x: { orderId: string }) => x.orderId === o3).failure.reason,
    ).toBe('NOT_HOME');
  });

  it('the day cannot end with stops left; at the end the counts are compared (M-03)', async () => {
    // Anitha's extra order from earlier is not on the route, so nothing is left.
    const end = (body: Record<string, number>) =>
      api()
        .post(`/api/v1/staff/trips/${tripId}/end`)
        .set(bearer(ravi))
        .send({ clientActionId: randomUUID(), ...body });
    // Loaded 7, delivered 2 + 3 → 2 full should come back; no empties; ₹380 cash.
    const r = await end({ returnFull: 2, returnEmpty: 0, returnDamaged: 0, cashPaise: 35000 });
    expect(r.status).toBe(200);
    const office = await api().get(`/api/v1/admin/deliveries?date=${TODAY}`).set(bearer(ownerA));
    const route = office.body.routes.find((x: { trip: { id: string } }) => x.trip.id === tripId);
    expect(route.trip.status).toBe('ended');
    expect(route.differences).toEqual({ full: 0, empty: 0, cashPaise: -3000 });
    // ₹30 short: the office must say what happened.
    const noReason = await api()
      .post(`/api/v1/admin/trips/${tripId}/reconcile`)
      .set(bearer(ownerA))
      .set(idem())
      .send({});
    expect(noReason.body.error.code).toBe('REASON_REQUIRED');
    const ok = await api()
      .post(`/api/v1/admin/trips/${tripId}/reconcile`)
      .set(bearer(ownerA))
      .set(idem())
      .send({ note: 'Ravi gave change to Anitha; collect next time' });
    expect(ok.status).toBe(200);
  });

  it('the stock adds up: depot + vans + customers + damaged stays the same (can pool)', async () => {
    const s = await api().get('/api/v1/admin/stock').set(bearer(ownerA));
    expect(s.status).toBe(200);
    // 100 full + 40 empty at the start. 7 loaded, 5 delivered, 2 back.
    expect(s.body).toMatchObject({
      depotFull: 95,
      depotEmpty: 40,
      vanFull: 0,
      vanEmpty: 0,
      withCustomers: 5,
    });
    expect(s.body.total).toBe(140);
    const filled = await api()
      .post('/api/v1/admin/stock')
      .set(bearer(ownerA))
      .set(idem())
      .send({ kind: 'filled', qty: 30 });
    expect(filled.body).toMatchObject({ depotFull: 125, depotEmpty: 10, total: 140 });
    const tooMany = await api()
      .post('/api/v1/admin/stock')
      .set(bearer(ownerA))
      .set(idem())
      .send({ kind: 'filled', qty: 11 });
    expect(tooMany.body.error.code).toBe('NOT_ENOUGH_EMPTIES');
  });

  it('a rescheduled order books capacity again and can be assigned on its new day', async () => {
    const r = await api()
      .post(`/api/v1/admin/orders/${o3}/reschedule`)
      .set(bearer(ownerA))
      .set(idem())
      .send({ date: FRI, windowId: W.Morning });
    expect(r.status).toBe(200);
    expect(r.body.order.status).toBe('ACCEPTED');
    expect(r.body.order.deliveryDate).toBe(FRI);
    expect(await reserved(W.Morning, FRI)).toBe(2);
    expect((await assign(suresh, [o3], FRI)).body.assigned).toBe(1);
    expect((await assign(suresh, [o1], FRI)).body.skipped[0].code).toBe('DATE_MISMATCH');
  });
});

describe('more at the door', () => {
  it('returns beyond what the customer holds never go below 0 (R-07); short deliveries close the order', async () => {
    const c = await newCustomer();
    const a = await order(c, 2);
    const b = await order(c, 3, TODAY, W.Afternoon);
    await assign(suresh, [a, b]);
    const trip = (await day(suresh)).body.trip.id;
    await start(suresh, trip, 5);
    // Holds 0, gets 1 of 2, hands back 3 old empties (cans from before the app).
    const r = await deliver(suresh, a, { full: 1, empties: 3, method: 'cash', amountPaise: 4000 });
    expect(r.status).toBe(200);
    expect(r.body.attempt).toMatchObject({ emptyCollected: 1, extraEmpties: 2, depositCans: 0 });
    const o = await api().get(`/api/v1/admin/orders/${a}`).set(bearer(ownerA));
    expect(o.body.order.status).toBe('DELIVERED');
    expect(o.body.order.history.at(-1).reason).toBe('Short delivery: 1 of 2 cans');
    expect((await balances(c.customerId)).cansHeld).toBe(0);
    // More than ordered is refused.
    const over = await deliver(suresh, b, { full: 4, empties: 0, method: 'later', amountPaise: 0 });
    expect(over.body.error.code).toBe('MORE_THAN_ORDERED');
    await ledgersAgree();
  });

  it('M-13: a route that has not started moves to another person in one step', async () => {
    const c = await newCustomer();
    const a = await order(c, 1, FRI, W.Afternoon);
    const b = await order(c, 1, FRI, W.Evening);
    await assign(ravi, [a, b], FRI);
    const office = await api().get(`/api/v1/admin/deliveries?date=${FRI}`).set(bearer(ownerA));
    const raviTrip = office.body.routes.find(
      (x: { trip: { staffUserId: string } }) => x.trip.staffUserId === ravi.userId,
    );
    const m = await api()
      .post(`/api/v1/admin/trips/${raviTrip.trip.id}/move`)
      .set(bearer(ownerA))
      .set(idem())
      .send({ staffUserId: suresh.userId });
    expect(m.status).toBe(200);
    expect(m.body.moved).toBe(2);
    const after = await api().get(`/api/v1/admin/deliveries?date=${FRI}`).set(bearer(ownerA));
    const sureshTrip = after.body.routes.find(
      (x: { trip: { staffUserId: string } }) => x.trip.staffUserId === suresh.userId,
    );
    // Suresh already had the rescheduled order; Ravi's two stops come after it.
    expect(sureshTrip.stops.map((s: { orderId: string }) => s.orderId).slice(-2)).toEqual([a, b]);
    // Unassign puts a stop back to "needs a driver".
    const u = await api()
      .post('/api/v1/admin/deliveries/unassign')
      .set(bearer(ownerA))
      .set(idem())
      .send({ orderIds: [b] });
    expect(u.body.removed).toBe(1);
    const o = await api().get(`/api/v1/admin/orders/${b}`).set(bearer(ownerA));
    expect(o.body.order.status).toBe('ACCEPTED');
  });

  it("another supplier's office sees none of it", async () => {
    const r = await api().get(`/api/v1/admin/deliveries?date=${TODAY}`).set(bearer(ownerB));
    expect(r.body.routes).toEqual([]);
    expect(r.body.unassigned).toEqual([]);
    const s = await api().get('/api/v1/admin/stock').set(bearer(ownerB));
    expect(s.body.total).toBe(0);
    const ravisTrip = (await day(ravi)).body.trip.id;
    expect(
      (
        await api()
          .post(`/api/v1/admin/trips/${ravisTrip}/reconcile`)
          .set(bearer(ownerB))
          .set(idem())
          .send({})
      ).status,
    ).toBe(404);
  });

  it('ledgers cannot be edited or deleted', async () => {
    for (const t of ['can_ledger', 'deposit_ledger', 'account_ledger', 'stock_movements']) {
      await expect(h.handle.db.execute(sql.raw(`delete from ${t}`))).rejects.toThrow();
      await expect(h.handle.db.execute(sql.raw(`update ${t} set id = id`))).rejects.toThrow();
    }
    const [d] = await h.handle.db.select({ n: sql<string>`count(*)::text` }).from(depositLedger);
    expect(Number(d!.n)).toBeGreaterThan(0);
  });
});
