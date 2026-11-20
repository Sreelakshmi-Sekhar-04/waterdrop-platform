/** Phase 4 ordering on a real database: prices, delivery times, capacity, cancel, accept, office orders. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { and, eq, sql } from 'drizzle-orm';
import { createHarness, bearer, type TestHarness, type TestUser } from './helpers';
import { orderStatusHistory, orders, settings, windowBookings } from '../src/db/schema';

let h: TestHarness;
let ownerA: TestUser;
let adminA: TestUser;
let ownerB: TestUser;
let W: { Morning: string; Afternoon: string; Evening: string }; // window ids by name
const api = () => request(h.app);
const idem = () => ({ 'Idempotency-Key': `k_${randomUUID()}` });
let seq = 0;
const newPhone = () =>
  `9896${String(process.pid % 1000).padStart(3, '0')}${String(++seq).padStart(3, '0')}`;

// Thursday 19 Nov 2026, 10:00 in India. Friday 20 Nov is the next day; Sunday 22 Nov is closed.
const THU_10AM = new Date('2026-11-19T10:00:00+05:30');
const TODAY = '2026-11-19';
const FRI = '2026-11-20';

interface Customer {
  auth: Record<string, string>;
  addressId: string;
  customerId: string;
}

async function newCustomer(pincode = '682030'): Promise<Customer> {
  const phone = newPhone();
  await api().post('/api/v1/auth/otp/request').send({ phone });
  const v = await api()
    .post('/api/v1/auth/otp/verify')
    .send({ app: 'customer', phone, code: h.lastCode(`+91${phone}`) });
  expect(v.status).toBe(200);
  const auth = { Authorization: `Bearer ${v.body.accessToken}` };
  const a = await api()
    .post('/api/v1/customer/addresses')
    .set(auth)
    .set(idem())
    .send({ label: 'Home', line: 'Rose Villa', landmark: 'Near the church', pincode });
  expect(a.status).toBe(201);
  const p = await api().get('/api/v1/customer/profile').set(auth);
  return { auth, addressId: a.body.address.id, customerId: p.body.customer.id };
}

const place = (c: Customer, over: Record<string, unknown> = {}) =>
  api()
    .post('/api/v1/customer/orders')
    .set(c.auth)
    .set(idem())
    .send({
      clientRequestId: randomUUID(),
      addressId: c.addressId,
      windowId: W.Evening,
      date: TODAY,
      qty: 2,
      expectedTotalPaise: 2 * 4000 + 2 * 15000,
      ...over,
    });

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
  adminA = await h.makeUser(h.supplierA, 'admin');
  ownerB = await h.makeUser(h.supplierB, 'owner');
  W = (await h.setupOrdering(h.supplierA)).windows as typeof W;
  await h.setupOrdering(h.supplierB);
  const area = await api()
    .post('/api/v1/admin/service-areas')
    .set(bearer(ownerA))
    .set(idem())
    .send({ name: 'Kakkanad', pincodes: ['682030'] });
  expect(area.status).toBe(201);
  const charged = await api()
    .post('/api/v1/admin/service-areas')
    .set(bearer(ownerA))
    .set(idem())
    .send({ name: 'Far side', pincodes: ['682050'], deliveryChargePaise: 2000, freeAboveCans: 3 });
  expect(charged.status).toBe(201);
});
beforeEach(() => {
  h.clock.now = THU_10AM;
});
afterAll(async () => {
  await h?.cleanup();
});

describe('order screen options', () => {
  it('gives price, deposit, default quantity 2 and only the times that can still be booked', async () => {
    const c = await newCustomer();
    const r = await api().get('/api/v1/customer/order-options').set(c.auth);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      unitPricePaise: 4000,
      depositPerCanPaise: 15000,
      defaultQty: 2,
      maxCans: 10,
      addressId: c.addressId,
      delivery: { chargePaise: 0, freeAboveCans: 0 },
    });
    const slots = r.body.windows.map(
      (w: { date: string; nameEn: string }) => `${w.date} ${w.nameEn}`,
    );
    // 10 am Thursday: morning has started, so today offers Afternoon and Evening only.
    expect(slots.slice(0, 3)).toEqual([`${TODAY} Afternoon`, `${TODAY} Evening`, `${FRI} Morning`]);
    expect(slots.some((s: string) => s.startsWith('2026-11-22'))).toBe(false); // Sunday
  });

  it('after the 2 pm cut-off nothing today can be booked by the customer', async () => {
    const c = await newCustomer();
    h.clock.now = new Date('2026-11-19T14:05:00+05:30');
    const r = await api().get('/api/v1/customer/order-options').set(c.auth);
    expect(r.body.windows[0]).toMatchObject({ date: FRI, nameEn: 'Morning' });
    const late = await place(c, { windowId: W.Evening, date: TODAY });
    expect(late.status).toBe(422);
    expect(late.body.error.code).toBe('TOO_LATE_FOR_WINDOW');
  });
});

describe('placing an order', () => {
  it('saves prices and address as they are now, reserves capacity and accepts automatically (D-14)', async () => {
    const c = await newCustomer();
    const before = await reserved(W.Evening, TODAY);
    const r = await place(c);
    expect(r.status).toBe(201);
    expect(r.body.order).toMatchObject({
      status: 'ACCEPTED',
      qty: 2,
      subtotalPaise: 8000,
      depositPaise: 30000,
      deliveryChargePaise: 0,
      totalPaise: 38000,
      deliveryDate: TODAY,
      windowNameEn: 'Evening',
      canCancel: true,
      address: { line: 'Rose Villa', areaName: 'Kakkanad' },
    });
    expect(r.body.order.orderNo).toBeGreaterThanOrEqual(1001);
    expect(
      r.body.order.history.map((x: { to: string; actorRole: string }) => `${x.to}:${x.actorRole}`),
    ).toEqual(['PLACED:customer', 'ACCEPTED:system']);
    expect(await reserved(W.Evening, TODAY)).toBe(before + 2);

    // Editing the address later does not change the order.
    await api()
      .patch(`/api/v1/customer/addresses/${c.addressId}`)
      .set(c.auth)
      .set(idem())
      .send({ line: 'New House' });
    const again = await api().get(`/api/v1/customer/orders/${r.body.order.id}`).set(c.auth);
    expect(again.body.order.address.line).toBe('Rose Villa');
  });

  it('the same order sent twice (double tap, retry) is saved once', async () => {
    const c = await newCustomer();
    const clientRequestId = randomUUID();
    const before = await reserved(W.Evening, TODAY);
    const [a, b] = await Promise.all([
      place(c, { clientRequestId }),
      place(c, { clientRequestId }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.order.id).toBe(b.body.order.id);
    expect(await reserved(W.Evening, TODAY)).toBe(before + 2);
    const list = await api().get('/api/v1/customer/orders').set(c.auth);
    expect(list.body.orders).toHaveLength(1);
  });

  it('refuses when the total the customer saw is no longer right, and says the new total', async () => {
    const c = await newCustomer();
    const r = await place(c, { expectedTotalPaise: 100 });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: 'PRICE_CHANGED', details: { totalPaise: 38000 } });
  });

  it('customers can order at most the maximum; the office can enter more (D-10)', async () => {
    const c = await newCustomer();
    const r = await place(c, { qty: 11, expectedTotalPaise: 0 });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('QTY_ABOVE_MAX');
    const office = await api().post('/api/v1/admin/orders').set(bearer(adminA)).set(idem()).send({
      customerId: c.customerId,
      clientRequestId: randomUUID(),
      addressId: c.addressId,
      windowId: W.Morning,
      date: FRI,
      qty: 12,
    });
    expect(office.status).toBe(201);
    expect(office.body.order).toMatchObject({ qty: 12, status: 'ACCEPTED', channel: 'office' });
  });

  it('area delivery charge applies, and is waived above the free limit (D-12)', async () => {
    const c = await newCustomer('682050');
    const two = await place(c, { expectedTotalPaise: 8000 + 2000 + 30000 });
    expect(two.status).toBe(201);
    expect(two.body.order.deliveryChargePaise).toBe(2000);
    const four = await place(c, { qty: 4, expectedTotalPaise: 16000 + 60000 });
    expect(four.status).toBe(201);
    expect(four.body.order.deliveryChargePaise).toBe(0);
  });

  it('a switched-off customer cannot order', async () => {
    const c = await newCustomer();
    await api()
      .patch(`/api/v1/admin/customers/${c.customerId}`)
      .set(bearer(adminA))
      .set(idem())
      .send({ status: 'disabled' });
    const r = await place(c);
    expect([401, 403]).toContain(r.status); // switched off also signs them out
  });
});

describe('capacity (D-08, R-05)', () => {
  it('never books more cans than a delivery time can take, even when customers order at the same moment', async () => {
    const date = '2026-11-21'; // Saturday
    const cap = await api()
      .put(`/api/v1/admin/windows/${W.Afternoon}/capacity/${date}`)
      .set(bearer(adminA))
      .send({ capacityCans: 5 });
    expect(cap.status).toBe(200);
    const people = await Promise.all(Array.from({ length: 4 }, () => newCustomer()));
    const results = await Promise.all(
      people.map((c) => place(c, { windowId: W.Afternoon, date, qty: 2 })),
    );
    const ok = results.filter((r) => r.status === 201);
    const full = results.filter((r) => r.status === 409);
    expect(ok).toHaveLength(2);
    expect(full).toHaveLength(2);
    expect(full[0]!.body.error.code).toBe('WINDOW_FULL');
    expect(await reserved(W.Afternoon, date)).toBe(4);

    const slots = await api()
      .get(`/api/v1/admin/window-slots?from=${date}&days=1`)
      .set(bearer(adminA));
    expect(
      slots.body.slots.find((s: { windowId: string }) => s.windowId === W.Afternoon),
    ).toMatchObject({
      capacityCans: 5,
      reservedCans: 4,
      remainingCans: 1,
    });
  });

  it('cancelling gives the cans back to the delivery time', async () => {
    const c = await newCustomer();
    const r = await place(c, { windowId: W.Morning, date: FRI });
    const before = await reserved(W.Morning, FRI);
    const cancel = await api()
      .post(`/api/v1/customer/orders/${r.body.order.id}/cancel`)
      .set(c.auth)
      .set(idem())
      .send({});
    expect(cancel.status).toBe(200);
    expect(cancel.body.order.status).toBe('CANCELLED');
    expect(await reserved(W.Morning, FRI)).toBe(before - 2);
    const twice = await api()
      .post(`/api/v1/customer/orders/${r.body.order.id}/cancel`)
      .set(c.auth)
      .set(idem())
      .send({});
    expect(twice.status).toBe(409);
    expect(await reserved(W.Morning, FRI)).toBe(before - 2);
  });

  it('a customer cannot cancel once the order is on the way (R-08)', async () => {
    const c = await newCustomer();
    const r = await place(c, { windowId: W.Morning, date: FRI });
    // Dispatch arrives in Phase 5; set the status directly to test the rule.
    await h.handle.db
      .update(orders)
      .set({ status: 'OUT_FOR_DELIVERY' })
      .where(eq(orders.id, r.body.order.id));
    const cancel = await api()
      .post(`/api/v1/customer/orders/${r.body.order.id}/cancel`)
      .set(c.auth)
      .set(idem())
      .send({});
    expect(cancel.status).toBe(409);
    expect(cancel.body.error.code).toBe('TOO_LATE_TO_CANCEL');
  });
});

describe('closed days (M-12)', () => {
  it('a closed day cannot be booked, and the office is told about orders already booked', async () => {
    const c = await newCustomer();
    const date = '2026-11-24'; // Tuesday
    await place(c, { windowId: W.Morning, date });
    const close = await api()
      .post('/api/v1/admin/closed-days')
      .set(bearer(adminA))
      .set(idem())
      .send({ date, reason: 'Heavy rain warning' });
    expect(close.status).toBe(201);
    expect(close.body.closedDay.ordersAlreadyBooked).toBe(1);
    const r = await place(c, { windowId: W.Evening, date });
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({
      code: 'DAY_CLOSED',
      details: { reason: 'Heavy rain warning' },
    });
    const opts = await api().get('/api/v1/customer/order-options').set(c.auth);
    expect(opts.body.windows.some((w: { date: string }) => w.date === date)).toBe(false);

    const reopen = await api()
      .delete(`/api/v1/admin/closed-days/${close.body.closedDay.id}`)
      .set(bearer(adminA));
    expect(reopen.status).toBe(200);
    expect((await place(c, { windowId: W.Evening, date })).status).toBe(201);
  });
});

describe('office handling', () => {
  it('with auto-accept off, orders wait; the office accepts in bulk and must give a reason to reject', async () => {
    await h.handle.db
      .update(settings)
      .set({ value: false })
      .where(and(eq(settings.supplierId, h.supplierA), eq(settings.key, 'autoAcceptOrders')));
    try {
      const [c1, c2, c3] = await Promise.all([newCustomer(), newCustomer(), newCustomer()]);
      const o = await Promise.all(
        [c1, c2, c3].map((c) => place(c, { windowId: W.Morning, date: FRI })),
      );
      expect(o.map((x) => x.body.order.status)).toEqual(['PLACED', 'PLACED', 'PLACED']);

      const bulk = await api()
        .post('/api/v1/admin/orders/bulk-accept')
        .set(bearer(adminA))
        .set(idem())
        .send({ ids: [o[0]!.body.order.id, o[1]!.body.order.id] });
      expect(bulk.body).toEqual({ accepted: 2, skipped: [] });

      const noReason = await api()
        .post(`/api/v1/admin/orders/${o[2]!.body.order.id}/transition`)
        .set(bearer(adminA))
        .set(idem())
        .send({ to: 'REJECTED' });
      expect(noReason.status).toBe(400);
      const before = await reserved(W.Morning, FRI);
      const rej = await api()
        .post(`/api/v1/admin/orders/${o[2]!.body.order.id}/transition`)
        .set(bearer(adminA))
        .set(idem())
        .send({ to: 'REJECTED', reason: 'Address is a closed shop' });
      expect(rej.status).toBe(200);
      expect(rej.body.order.history.at(-1)).toMatchObject({
        to: 'REJECTED',
        reason: 'Address is a closed shop',
      });
      expect(await reserved(W.Morning, FRI)).toBe(before - 2);

      const again = await api()
        .post('/api/v1/admin/orders/bulk-accept')
        .set(bearer(adminA))
        .set(idem())
        .send({ ids: [o[2]!.body.order.id] });
      expect(again.body).toEqual({
        accepted: 0,
        skipped: [{ id: o[2]!.body.order.id, code: 'INVALID_TRANSITION' }],
      });
    } finally {
      await h.handle.db
        .update(settings)
        .set({ value: true })
        .where(and(eq(settings.supplierId, h.supplierA), eq(settings.key, 'autoAcceptOrders')));
    }
  });

  it('the office may book today after the customer cut-off, until a delivery time ends', async () => {
    const c = await newCustomer();
    h.clock.now = new Date('2026-11-19T14:30:00+05:30');
    const r = await api().post('/api/v1/admin/orders').set(bearer(adminA)).set(idem()).send({
      customerId: c.customerId,
      clientRequestId: randomUUID(),
      addressId: c.addressId,
      windowId: W.Evening,
      date: TODAY,
      qty: 1,
    });
    expect(r.status).toBe(201);
    expect(r.body.order.history.map((x: { actorRole: string }) => x.actorRole)).toEqual([
      'admin',
      'admin',
    ]);

    // A delivery time that has already ended today cannot be booked, even by the office.
    const ended = await api().post('/api/v1/admin/orders').set(bearer(adminA)).set(idem()).send({
      customerId: c.customerId,
      clientRequestId: randomUUID(),
      addressId: c.addressId,
      windowId: W.Morning,
      date: TODAY,
      qty: 1,
    });
    expect(ended.status).toBe(422);
    expect(ended.body.error.code).toBe('TOO_LATE_FOR_WINDOW');
    const opts = await api()
      .get(`/api/v1/admin/customers/${c.customerId}/order-options`)
      .set(bearer(adminA));
    const today = opts.body.windows.filter((w: { date: string }) => w.date === TODAY);
    expect(today.map((w: { unavailable?: string }) => w.unavailable ?? 'open')).toEqual([
      'TOO_LATE',
      'open',
      'open',
    ]);
  });

  it('lists orders for a date and finds them by order number or customer', async () => {
    const c = await newCustomer();
    const r = await place(c, { windowId: W.Evening, date: '2026-11-25' });
    const list = await api().get('/api/v1/admin/orders?date=2026-11-25').set(bearer(adminA));
    expect(list.body.orders.map((o: { id: string }) => o.id)).toContain(r.body.order.id);
    const row = list.body.orders.find((o: { id: string }) => o.id === r.body.order.id);
    expect(row.phoneLast4).toHaveLength(4);
    expect(row).not.toHaveProperty('customerPhone');
    const byNo = await api()
      .get(`/api/v1/admin/orders?date=2026-11-25&q=WD-${r.body.order.orderNo}`)
      .set(bearer(adminA));
    expect(byNo.body.orders).toHaveLength(1);
  });
});

describe('prices (D-11, M-21)', () => {
  it('only the owner changes prices; past dates are refused; a later price does not change today', async () => {
    const byAdmin = await api()
      .post('/api/v1/admin/catalog/prices')
      .set(bearer(adminA))
      .set(idem())
      .send({ pricePaise: 4500, validFrom: '2026-12-01' });
    expect(byAdmin.status).toBe(403);
    const past = await api()
      .post('/api/v1/admin/catalog/prices')
      .set(bearer(ownerA))
      .set(idem())
      .send({ pricePaise: 4500, validFrom: '2026-11-01' });
    expect(past.body.error.code).toBe('DATE_IN_PAST');
    const later = await api()
      .post('/api/v1/admin/catalog/prices')
      .set(bearer(ownerA))
      .set(idem())
      .send({ pricePaise: 4500, validFrom: '2026-12-01' });
    expect(later.status).toBe(201);
    const cat = await api().get('/api/v1/admin/catalog').set(bearer(adminA));
    expect(cat.body).toMatchObject({
      currentPricePaise: 4000,
      scheduled: [{ pricePaise: 4500, validFrom: '2026-12-01' }],
    });
    h.clock.now = new Date('2026-12-01T09:00:00+05:30');
    const c = await newCustomer();
    const opts = await api().get('/api/v1/customer/order-options').set(c.auth);
    expect(opts.body.unitPricePaise).toBe(4500);
  });

  it('an office customer can get their own price, and back to standard', async () => {
    const c = await newCustomer();
    const set = await api()
      .put(`/api/v1/admin/customers/${c.customerId}/price`)
      .set(bearer(ownerA))
      .send({ pricePaise: 3500 });
    expect(set.status).toBe(200);
    let opts = await api().get('/api/v1/customer/order-options').set(c.auth);
    expect(opts.body).toMatchObject({ unitPricePaise: 3500, specialPrice: true });
    const r = await place(c, { expectedTotalPaise: 7000 + 30000 });
    expect(r.status).toBe(201);
    expect(r.body.order.items[0].unitPricePaise).toBe(3500);

    await api()
      .put(`/api/v1/admin/customers/${c.customerId}/price`)
      .set(bearer(ownerA))
      .send({ pricePaise: null });
    opts = await api().get('/api/v1/customer/order-options').set(c.auth);
    expect(opts.body).toMatchObject({ unitPricePaise: 4000, specialPrice: false });
    // The order placed earlier keeps the price it was placed at.
    const old = await api().get(`/api/v1/customer/orders/${r.body.order.id}`).set(c.auth);
    expect(old.body.order.items[0].unitPricePaise).toBe(3500);
  });
});

describe('privacy between customers and suppliers', () => {
  it("a customer cannot see or cancel someone else's order; another supplier sees nothing", async () => {
    const [c1, c2] = await Promise.all([newCustomer(), newCustomer()]);
    const r = await place(c1, { windowId: W.Morning, date: FRI });
    const id = r.body.order.id;
    expect((await api().get(`/api/v1/customer/orders/${id}`).set(c2.auth)).status).toBe(404);
    expect(
      (await api().post(`/api/v1/customer/orders/${id}/cancel`).set(c2.auth).set(idem()).send({}))
        .status,
    ).toBe(404);
    expect((await api().get(`/api/v1/admin/orders/${id}`).set(bearer(ownerB))).status).toBe(404);
    const listB = await api().get(`/api/v1/admin/orders?date=${FRI}`).set(bearer(ownerB));
    expect(listB.body.orders).toEqual([]);
    const transition = await api()
      .post(`/api/v1/admin/orders/${id}/transition`)
      .set(bearer(ownerB))
      .set(idem())
      .send({ to: 'CANCELLED', reason: 'not mine' });
    expect(transition.status).toBe(404);
    expect((await api().get('/api/v1/customer/order-options').set(bearer(adminA))).status).toBe(
      403,
    );
  });

  it('order history cannot be edited or deleted', async () => {
    const failure = (q: Promise<unknown>) =>
      q.then(
        () => 'succeeded',
        (e: Error & { cause?: Error }) => String(e.cause?.message ?? e.message),
      );
    expect(
      await failure(h.handle.db.execute(sql`update ${orderStatusHistory} set reason = 'x'`)),
    ).toMatch(/append-only/);
    expect(await failure(h.handle.db.execute(sql`delete from ${orderStatusHistory}`))).toMatch(
      /append-only/,
    );
  });
});
