/**
 * A customer deletes their own account (ADR 0007): refused while anything is outstanding, then the
 * person is erased and the business records stay.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq, sql } from 'drizzle-orm';
import { createHarness, bearer, type TestHarness, type TestUser } from './helpers';
import {
  addresses,
  auditLogs,
  complaints,
  customers,
  orders,
  otpRequests,
  userRoles,
  users,
} from '../src/db/schema';

let h: TestHarness;
let owner: TestUser;
let windowId: string;
const api = () => request(h.app);
const idem = () => ({ 'Idempotency-Key': `k_${randomUUID()}` });
let seq = 0;
const newPhone = () =>
  `9795${String(process.pid % 1000).padStart(3, '0')}${String(++seq).padStart(3, '0')}`;

interface Customer {
  auth: Record<string, string>;
  addressId: string;
  customerId: string;
  userId: string;
  phone: string;
}

async function signUp(name: string, phone = newPhone()): Promise<Customer> {
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
  const [c] = await h.handle.db
    .select({ userId: customers.userId })
    .from(customers)
    .where(eq(customers.id, p.body.customer.id));
  return {
    auth,
    addressId: a.body.address.id,
    customerId: p.body.customer.id,
    userId: c!.userId,
    phone,
  };
}

const check = (c: Customer) => api().get('/api/v1/customer/account/deletion').set(c.auth);
const del = (c: Customer) =>
  api().post('/api/v1/customer/account/delete').set(c.auth).send({ confirm: true });

beforeAll(async () => {
  h = await createHarness({ RATE_LIMIT_PER_MINUTE: '5000' });
  owner = await h.makeUser(h.supplierA, 'owner');
  windowId = (await h.setupOrdering(h.supplierA)).windows.Evening!;
  await api()
    .post('/api/v1/admin/service-areas')
    .set(bearer(owner))
    .set(idem())
    .send({ name: 'Kakkanad', pincodes: ['682030'] });
  h.clock.now = new Date('2026-11-19T10:00:00+05:30');
});
afterAll(async () => {
  await h?.cleanup();
});

describe('deleting a customer account', () => {
  it('needs an explicit confirm', async () => {
    const c = await signUp('Confirm Test');
    const r = await api().post('/api/v1/customer/account/delete').set(c.auth).send({});
    expect(r.status).toBe(400);
  });

  it('is refused while an order is open, then erases the person and keeps the records', async () => {
    const c = await signUp('Deepa Nair');
    expect((await check(c)).body).toMatchObject({ canDelete: true });

    const o = await api().post('/api/v1/admin/orders').set(bearer(owner)).set(idem()).send({
      customerId: c.customerId,
      clientRequestId: randomUUID(),
      addressId: c.addressId,
      windowId,
      date: '2026-11-19',
      qty: 1,
    });
    expect(o.status).toBe(201);
    const blocked = await check(c);
    expect(blocked.body).toMatchObject({ canDelete: false, blockers: { openOrders: 1 } });
    const refused = await del(c);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('ACCOUNT_HAS_OPEN_ORDERS');

    const cancel = await api()
      .post(`/api/v1/customer/orders/${o.body.order.id}/cancel`)
      .set(c.auth)
      .set(idem())
      .send({});
    expect(cancel.status).toBe(200);
    const complaint = await api().post('/api/v1/customer/complaints').set(c.auth).set(idem()).send({
      clientRequestId: randomUUID(),
      category: 'OTHER',
      note: 'Call me on my sister phone',
    });
    expect(complaint.status).toBe(201);

    const ok = await del(c);
    expect(ok.status).toBe(200);

    // Signed out everywhere at once.
    expect((await api().get('/api/v1/customer/profile').set(c.auth)).status).toBe(401);

    const db = h.handle.db;
    const [u] = await db.select().from(users).where(eq(users.id, c.userId));
    expect(u).toMatchObject({ phone: `deleted-${c.userId}`, name: null, status: 'disabled' });
    const [cu] = await db.select().from(customers).where(eq(customers.id, c.customerId));
    expect(cu!.status).toBe('disabled');
    const roles = await db.select().from(userRoles).where(eq(userRoles.userId, c.userId));
    expect(roles.every((r) => r.status === 'disabled')).toBe(true);
    const [a] = await db.select().from(addresses).where(eq(addresses.id, c.addressId));
    expect(a).toMatchObject({ line: '', landmark: '', pincode: '', latitude: null });
    expect(a!.archivedAt).not.toBeNull();
    const [cp] = await db.select().from(complaints).where(eq(complaints.customerId, c.customerId));
    expect(cp!.note).toBeNull();
    // The order stays for the accounts.
    const kept = await db.select().from(orders).where(eq(orders.customerId, c.customerId));
    expect(kept).toHaveLength(1);
    // The log says it happened and nothing else.
    const [log] = await db
      .select()
      .from(auditLogs)
      .where(
        sql`${auditLogs.action} = 'customer.deleted' and ${auditLogs.entityId} = ${c.customerId}`,
      );
    expect(log).toMatchObject({ before: null, after: null });
    expect(
      JSON.stringify(await db.select().from(users).where(eq(users.id, c.userId))),
    ).not.toContain(c.phone);

    // The same phone can sign up again, as a new customer (past the resend wait).
    await db.delete(otpRequests).where(eq(otpRequests.phone, `+91${c.phone}`));
    const again = await signUp('Deepa again', c.phone);
    expect(again.customerId).not.toBe(c.customerId);
    expect(again.userId).not.toBe(c.userId);
  });

  it('is refused while cans, deposit or money are outstanding', async () => {
    const c = await signUp('Owes Money');
    await h.handle.db
      .update(customers)
      .set({ balancePaise: 4000 })
      .where(eq(customers.id, c.customerId));
    const r = await del(c);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ACCOUNT_HAS_BALANCES');
    expect((await api().get('/api/v1/customer/profile').set(c.auth)).status).toBe(200);
  });

  it('is refused when the phone also signs in for other work', async () => {
    const c = await signUp('Also Staff');
    await h.handle.db
      .insert(userRoles)
      .values({ userId: c.userId, supplierId: h.supplierA, role: 'staff' });
    const r = await del(c);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ACCOUNT_HAS_OTHER_ROLES');
  });
});
