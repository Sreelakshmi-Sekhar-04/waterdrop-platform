/**
 * Phase 7 on a real database: the Today page, the six reports (with CSV), the activity log,
 * business details, complaints, customer messages with push, and dues reminders.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createHarness, bearer, type TestHarness, type TestUser } from './helpers';
import { notifications, pushTokens, users } from '../src/db/schema';

let h: TestHarness;
let ownerA: TestUser;
let adminA: TestUser;
let ownerB: TestUser;
let W: { Morning: string; Afternoon: string; Evening: string };
const api = () => request(h.app);
const idem = () => ({ 'Idempotency-Key': `k_${randomUUID()}` });
let seq = 0;
const newPhone = () =>
  `9897${String(process.pid % 1000).padStart(3, '0')}${String(++seq).padStart(3, '0')}`;

// Thursday 19 Nov 2026, 10:00 in India.
const THU_10AM = new Date('2026-11-19T10:00:00+05:30');
const TODAY = '2026-11-19';
const AT = THU_10AM.toISOString();

interface Customer {
  auth: Record<string, string>;
  addressId: string;
  customerId: string;
  userId: string;
}

async function newCustomer(name = 'Mary Joseph'): Promise<Customer> {
  const phone = newPhone();
  await api().post('/api/v1/auth/otp/request').send({ phone });
  const v = await api()
    .post('/api/v1/auth/otp/verify')
    .send({ app: 'customer', phone, code: h.lastCode(`+91${phone}`) });
  const auth = { Authorization: `Bearer ${v.body.accessToken}` };
  await api().patch('/api/v1/me').set(auth).send({ name });
  const a = await api()
    .post('/api/v1/customer/addresses')
    .set(auth)
    .set(idem())
    .send({ label: 'Home', line: 'Rose Villa', landmark: 'Near the church', pincode: '682030' });
  const p = await api().get('/api/v1/customer/profile').set(auth);
  const [u] = await h.handle.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.phone, `+91${phone}`));
  return { auth, addressId: a.body.address.id, customerId: p.body.customer.id, userId: u!.id };
}

async function officeOrder(c: Customer, qty = 2, date = TODAY) {
  const o = await api().post('/api/v1/admin/orders').set(bearer(ownerA)).set(idem()).send({
    customerId: c.customerId,
    clientRequestId: randomUUID(),
    addressId: c.addressId,
    windowId: W.Evening,
    date,
    qty,
  });
  expect(o.status).toBe(201);
  return o.body.order as { id: string; orderNo: number };
}

const token = (c: string) => `ExponentPushToken[${c}xxxxxxxxxxxx]`;

let mary: Customer;
let joseph: Customer;
let delivered: { id: string; orderNo: number };
let failed: { id: string; orderNo: number };
let driver: TestUser;

beforeAll(async () => {
  h = await createHarness();
  ownerA = await h.makeUser(h.supplierA, 'owner');
  adminA = await h.makeUser(h.supplierA, 'admin');
  ownerB = await h.makeUser(h.supplierB, 'owner');
  W = (await h.setupOrdering(h.supplierA)).windows as typeof W;
  await h.setupOrdering(h.supplierB);
  await api()
    .post('/api/v1/admin/service-areas')
    .set(bearer(ownerA))
    .set(idem())
    .send({ name: 'Kakkanad', pincodes: ['682030'] });
  h.clock.now = THU_10AM;
  mary = await newCustomer('Mary Joseph');
  joseph = await newCustomer('Joseph Paul');
});
beforeEach(() => {
  h.clock.now = THU_10AM;
});
afterAll(async () => {
  await h?.cleanup();
});

describe('customer messages and push (outbox)', () => {
  it('tells customers when the van leaves, after delivery and when a stop fails', async () => {
    // Mary's phone has push; Joseph's does not.
    expect(
      (
        await api()
          .post('/api/v1/me/push-tokens')
          .set(mary.auth)
          .send({ token: token('Mary'), platform: 'android' })
      ).status,
    ).toBe(204);
    await api().patch('/api/v1/me').set(joseph.auth).send({ preferredLanguage: 'ml' });

    delivered = await officeOrder(mary);
    failed = await officeOrder(joseph, 1);
    driver = await h.makeUser(h.supplierA, 'staff');
    const a = await api()
      .post('/api/v1/admin/deliveries/assign')
      .set(bearer(ownerA))
      .set(idem())
      .send({ date: TODAY, staffUserId: driver.userId, orderIds: [delivered.id, failed.id] });
    await api()
      .post(`/api/v1/staff/trips/${a.body.tripId}/start`)
      .set(bearer(driver))
      .send({ clientActionId: randomUUID(), loadFull: 3 });
    await api()
      .post(`/api/v1/staff/orders/${delivered.id}/deliver`)
      .set(bearer(driver))
      .send({
        clientActionId: randomUUID(),
        full: 2,
        empties: 0,
        payment: { method: 'cash', amountPaise: 20_000 },
        at: AT,
      });
    await api()
      .post(`/api/v1/staff/orders/${failed.id}/not-delivered`)
      .set(bearer(driver))
      .send({ clientActionId: randomUUID(), reason: 'NOT_HOME', at: AT });
    await api().post(`/api/v1/staff/trips/${a.body.tripId}/end`).set(bearer(driver)).send({
      clientActionId: randomUUID(),
      returnFull: 1,
      returnEmpty: 0,
      returnDamaged: 0,
      cashPaise: 15_000, // ₹50 short
      note: 'Short',
    });
    await h.app.pushDispatcher.kick();

    // Mary's phone got the two pushes, in English, with no phone numbers inside.
    const toMary = h.pushes.filter((p) => p.token === token('Mary'));
    expect(toMary.map((p) => p.title)).toEqual(['Your water is on the way', 'Delivered']);
    expect(toMary[1]!.body).toBe(
      `WD-${delivered.orderNo}: 2 cans delivered. ₹200 received. Amount due ₹180.`,
    );
    expect(JSON.stringify(toMary)).not.toMatch(/\+91|98\d{8}/);

    // Joseph has no phone registered: his messages wait in the app, in Malayalam.
    const rows = await h.handle.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, joseph.userId));
    expect(rows.map((r) => [r.kind, r.pushStatus])).toEqual([
      ['out_for_delivery', 'no_device'],
      ['not_delivered', 'no_device'],
    ]);
    const list = await api().get('/api/v1/customer/messages').set(joseph.auth);
    expect(list.body.unread).toBe(2);
    expect(list.body.messages[0]).toMatchObject({
      kind: 'not_delivered',
      title: 'ഡെലിവർ ചെയ്യാനായില്ല',
      read: false,
    });
    expect(list.body.messages[0].body).toContain('വീട്ടിൽ ആരുമില്ലായിരുന്നു');
    await api()
      .post('/api/v1/customer/messages/read')
      .set(joseph.auth)
      .send({ upToId: list.body.messages[0].id });
    expect((await api().get('/api/v1/customer/messages').set(joseph.auth)).body.unread).toBe(0);
    // Mary cannot read Joseph's messages: each list is the caller's own.
    const maryList = await api().get('/api/v1/customer/messages').set(mary.auth);
    expect(maryList.body.messages.every((m: { kind: string }) => m.kind !== 'not_delivered')).toBe(
      true,
    );
  });

  it('tells the customer when the office cancels, and forgets a phone that is gone', async () => {
    await api()
      .post('/api/v1/me/push-tokens')
      .set(mary.auth)
      .send({ token: token('Gone'), platform: 'android' });
    const o = await officeOrder(mary, 1, '2026-11-20');
    const before = h.pushes.length;
    const c = await api()
      .post(`/api/v1/admin/orders/${o.id}/transition`)
      .set(bearer(adminA))
      .set(idem())
      .send({ to: 'CANCELLED', reason: 'Customer phoned to cancel' });
    expect(c.status).toBe(200);
    await h.app.pushDispatcher.kick();
    expect(h.pushes.slice(before).map((p) => p.title)).toEqual([
      'Order cancelled',
      'Order cancelled',
    ]);
    const left = await h.handle.db
      .select({ token: pushTokens.token })
      .from(pushTokens)
      .where(eq(pushTokens.userId, mary.userId));
    expect(left.map((t) => t.token)).toEqual([token('Mary')]);
    // A customer cancelling their own order is not told about it.
    const own = await officeOrder(mary, 1, '2026-11-20');
    const n = h.pushes.length;
    await api()
      .post(`/api/v1/customer/orders/${own.id}/cancel`)
      .set(mary.auth)
      .set(idem())
      .send({});
    await h.app.pushDispatcher.kick();
    expect(h.pushes.length).toBe(n);
  });

  it('checks push tokens', async () => {
    const bad = await api()
      .post('/api/v1/me/push-tokens')
      .set(mary.auth)
      .send({ token: 'not-a-token', platform: 'android' });
    expect(bad.status).toBe(400);
    expect((await api().post('/api/v1/me/push-tokens').send({})).status).toBe(401);
  });
});

describe('dues reminders', () => {
  it('reminds once a day, and only customers who owe', async () => {
    const url = `/api/v1/admin/customers/${mary.customerId}/remind`;
    const r = await api().post(url).set(bearer(adminA));
    expect(r.status).toBe(201);
    expect(r.body.reminder.duePaise).toBe(18_000);
    expect((await api().post(url).set(bearer(adminA))).body.error.code).toBe('REMINDED_RECENTLY');
    // A day later it can be sent again.
    h.clock.now = new Date(THU_10AM.getTime() + 25 * 3_600_000);
    expect((await api().post(url).set(bearer(adminA))).status).toBe(201);
    const fresh = await newCustomer('Asha Nair');
    expect(
      (await api().post(`/api/v1/admin/customers/${fresh.customerId}/remind`).set(bearer(adminA)))
        .body.error.code,
    ).toBe('NOTHING_DUE');
    expect((await api().post(url).set(bearer(ownerB))).status).toBe(404);
    expect((await api().post(url).set(mary.auth)).status).toBe(403);
    await h.app.pushDispatcher.kick();
    expect(h.pushes.at(-1)).toMatchObject({
      title: 'Payment reminder',
      body: 'Your amount due is ₹180. Please pay on the next delivery or by UPI. Thank you.',
    });
  });
});

describe('complaints', () => {
  it('a customer reports a problem once, the office resolves it and the customer is told', async () => {
    const id = randomUUID();
    const send = () =>
      api().post('/api/v1/customer/complaints').set(mary.auth).set(idem()).send({
        clientRequestId: id,
        category: 'CAN_COUNT',
        orderId: delivered.id,
        note: '1 empty',
      });
    const [a, b] = await Promise.all([send(), send()]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.complaint.id).toBe(b.body.complaint.id);
    expect(a.body.complaint).toMatchObject({ orderNo: delivered.orderNo, status: 'open' });

    // Someone else's order is not found; "something else" needs words.
    const other = await api()
      .post('/api/v1/customer/complaints')
      .set(mary.auth)
      .set(idem())
      .send({ clientRequestId: randomUUID(), category: 'LATE', orderId: failed.id });
    expect(other.status).toBe(404);
    const empty = await api()
      .post('/api/v1/customer/complaints')
      .set(mary.auth)
      .set(idem())
      .send({ clientRequestId: randomUUID(), category: 'OTHER' });
    expect(empty.status).toBe(400);

    const open = await api().get('/api/v1/admin/complaints?status=open').set(bearer(adminA));
    expect(open.body.complaints).toHaveLength(1);
    expect(open.body.complaints[0]).toMatchObject({ customerName: 'Mary Joseph' });
    expect(
      (await api().get('/api/v1/admin/complaints').set(bearer(ownerB))).body.complaints,
    ).toEqual([]);

    const url = `/api/v1/admin/complaints/${a.body.complaint.id}/resolve`;
    const res = await api()
      .post(url)
      .set(bearer(adminA))
      .set(idem())
      .send({ resolution: 'Corrected to 1 empty' });
    expect(res.body.complaint.status).toBe('resolved');
    const again = await api()
      .post(url)
      .set(bearer(adminA))
      .set(idem())
      .send({ resolution: 'Again' });
    expect(again.body.error.code).toBe('ALREADY_RESOLVED');
    await h.app.pushDispatcher.kick();
    expect(h.pushes.at(-1)).toMatchObject({
      title: 'Your complaint',
      body: 'Resolved: Corrected to 1 empty',
    });
    const mine = await api().get('/api/v1/customer/complaints').set(mary.auth);
    expect(mine.body.complaints[0]).toMatchObject({ status: 'resolved' });
    expect(mine.body.complaints[0].phoneLast4).toBeUndefined();

    // The office notes a complaint that came by phone.
    const byPhone = await api()
      .post(`/api/v1/admin/customers/${joseph.customerId}/complaints`)
      .set(bearer(adminA))
      .set(idem())
      .send({ clientRequestId: randomUUID(), category: 'WATER_QUALITY', note: 'Taste' });
    expect(byPhone.status).toBe(201);
    expect(
      (await api().get('/api/v1/customer/complaints').set(joseph.auth)).body.complaints,
    ).toHaveLength(1);
  });
});

describe('the Today page', () => {
  it('lists what needs attention and today’s numbers', async () => {
    // One order still waiting to be given to a delivery person, and tomorrow needs more full cans
    // than the depot has.
    await officeOrder(joseph, 3);
    await officeOrder(joseph, 9, '2026-11-20');
    const d = await api().get('/api/v1/admin/dashboard').set(bearer(adminA));
    expect(d.status).toBe(200);
    expect(d.body.attention).toMatchObject({
      unassigned: 1,
      toReschedule: 1,
      complaints: 1,
      routesToCheck: { count: 1, cashDifferencePaise: -5_000 },
      lowStock: { needed: 9 },
    });
    expect(d.body.numbers).toMatchObject({
      deliveredToday: 1,
      cansDeliveredToday: 2,
      cashTodayPaise: 20_000,
      duePaise: 18_000,
      customersOwing: 1,
      cansWithCustomers: 2,
    });
    expect(d.body.routes).toHaveLength(1);
    expect(d.body.routes[0]).toMatchObject({
      delivered: 1,
      failed: 1,
      remaining: 0,
      cashPaise: 20_000,
    });
    // Another supplier sees none of it.
    const b = await api().get('/api/v1/admin/dashboard').set(bearer(ownerB));
    expect(b.body.numbers.deliveredToday).toBe(0);
    expect(b.body.attention.unassigned).toBe(0);
    expect((await api().get('/api/v1/admin/dashboard').set(mary.auth)).status).toBe(403);
  });
});

describe('reports', () => {
  const get = (name: string, q = '', who = adminA) =>
    api().get(`/api/v1/admin/reports/${name}${q}`).set(bearer(who));

  it('sales and collections by day add up', async () => {
    const r = await get('sales', `?from=2026-11-18&to=${TODAY}`);
    expect(r.body.report.rows).toEqual([
      expect.objectContaining({ date: '2026-11-18', deliveries: 0, cash_paise: 0 }),
      expect.objectContaining({
        date: TODAY,
        deliveries: 1,
        cans: 2,
        sales_paise: 8_000,
        deposits_paise: 30_000,
        cash_paise: 20_000,
        upi_paise: 0,
      }),
    ]);
    expect(r.body.report.totals.cash_paise).toBe(20_000);
  });

  it('dues and cans with ageing, staff days, deliveries and the can pool', async () => {
    const dues = (await get('dues')).body.report;
    expect(dues.rows).toEqual([
      expect.objectContaining({ customer: 'Mary Joseph', due_paise: 18_000, age: '0-7' }),
    ]);
    expect(dues.totals['age_0-7']).toBe(18_000);
    const cans = (await get('cans')).body.report;
    expect(cans.rows[0]).toMatchObject({ customer: 'Mary Joseph', cans_held: 2, above_deposit: 0 });
    const staff = (await get('staff', `?from=${TODAY}&to=${TODAY}`)).body.report;
    expect(staff.rows[0]).toMatchObject({
      delivered: 1,
      failed: 1,
      cans: 2,
      cash_expected_paise: 20_000,
      cash_handed_paise: 15_000,
      cash_difference_paise: -5_000,
    });
    const del = (await get('deliveries', `?from=${TODAY}&to=${TODAY}`)).body.report;
    expect(del.rows[0]).toMatchObject({ delivered: 1, on_time: 1, late: 0, failed: 1 });
    expect(del.facts.failed_NOT_HOME).toBe(1);
    // Stock movements are stamped by the database clock, so the range runs to the real today.
    const realToday = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const stock = (await get('stock', `?from=${TODAY}&to=${realToday}`)).body.report;
    expect(stock.facts).toMatchObject({ with_customers: 2, pool_adds_up: true });
    expect(stock.rows.find((r: { kind: string }) => r.kind === 'delivery')).toMatchObject({
      cans: 2,
    });
  });

  it('downloads CSV that spreadsheets read safely', async () => {
    const r = await get('cans', '?format=csv');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.headers['content-disposition']).toMatch(/attachment; filename="wtrdrop-cans-now-/);
    expect(r.text.startsWith('﻿customer,phone_last4,area,cans_held')).toBe(true);
    expect(r.text).toContain('Mary Joseph,');
    expect(r.text).not.toMatch(/\+91/);
  });

  it('refuses a bad range, other roles and unknown reports', async () => {
    expect((await get('sales', '?from=2026-11-20&to=2026-11-19')).body.error.code).toBe(
      'BAD_RANGE',
    );
    expect((await get('sales', '?from=2025-01-01&to=2026-11-19')).body.error.code).toBe(
      'BAD_RANGE',
    );
    expect((await get('nope')).status).toBe(400);
    expect((await api().get('/api/v1/admin/reports/sales').set(mary.auth)).status).toBe(403);
    expect((await get('dues', '', ownerB)).body.report.rows).toEqual([]);
  });
});

describe('activity log and business details', () => {
  it('filters the activity log and pages through it', async () => {
    const all = await api().get('/api/v1/admin/audit-logs?limit=200').set(bearer(adminA));
    expect(all.body.items.length).toBeGreaterThan(10);
    const pay = await api().get('/api/v1/admin/audit-logs?action=complaint').set(bearer(adminA));
    expect(pay.body.items.map((i: { action: string }) => i.action).sort()).toEqual([
      'complaint.created',
      'complaint.created',
      'complaint.resolved',
    ]);
    expect(pay.body.items[0].actorName).toBeTruthy();
    const page1 = await api().get('/api/v1/admin/audit-logs?limit=3').set(bearer(adminA));
    expect(page1.body.items).toHaveLength(3);
    const page2 = await api()
      .get(`/api/v1/admin/audit-logs?limit=3&before=${page1.body.nextBefore}`)
      .set(bearer(adminA));
    expect(page2.body.items[0].id).toBeLessThan(page1.body.items[2].id);
    const order = await api()
      .get(`/api/v1/admin/audit-logs?entityType=order&entityId=${delivered.id}`)
      .set(bearer(adminA));
    expect(order.body.items.map((i: { action: string }) => i.action)).toContain(
      'delivery.delivered',
    );
    expect(
      (
        await api()
          .get(`/api/v1/admin/audit-logs?from=2026-12-01&to=2026-12-31`)
          .set(bearer(adminA))
      ).body.items,
    ).toEqual([]);
    expect(
      (await api().get('/api/v1/admin/audit-logs?action=DROP%20TABLE').set(bearer(adminA))).status,
    ).toBe(400);
  });

  it('only the owner changes the business name, GSTIN and FSSAI number', async () => {
    const patch = (who: TestUser, body: object) =>
      api().patch('/api/v1/admin/business').set(bearer(who)).set(idem()).send(body);
    expect((await patch(adminA, { name: 'Clear Water Co' })).status).toBe(403);
    expect((await patch(ownerA, { gstin: 'nope' })).status).toBe(400);
    const ok = await patch(ownerA, { name: 'Clear Water Co', gstin: '32aaacw1234k1z5' });
    expect(ok.body.business).toEqual({
      name: 'Clear Water Co',
      gstin: '32AAACW1234K1Z5',
      fssaiNo: null,
    });
    const got = await api().get('/api/v1/admin/business').set(bearer(adminA));
    expect(got.body.business.name).toBe('Clear Water Co');
    const log = await api().get('/api/v1/admin/audit-logs?action=business').set(bearer(ownerA));
    expect(log.body.items[0].before).toMatchObject({ name: 'Supplier A' });
    // The statement shows the new name.
    const s = await api()
      .get(`/api/v1/admin/customers/${mary.customerId}/statement?month=2026-11`)
      .set(bearer(adminA));
    expect(s.body.statement.supplier).toEqual({ name: 'Clear Water Co', gstin: '32AAACW1234K1Z5' });
  });
});
