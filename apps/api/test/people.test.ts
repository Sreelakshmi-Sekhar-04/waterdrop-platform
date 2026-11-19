/** Phase 3 profiles, addresses, service areas and team management, on a real database. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createHarness, bearer, type TestHarness, type TestUser } from './helpers';
import { auditLogs, users } from '../src/db/schema';

let h: TestHarness;
let ownerA: TestUser;
let adminA: TestUser;
let ownerB: TestUser;
let staffA: TestUser;
let kakkanad: string;
const api = () => request(h.app);
const idem = () => ({
  'Idempotency-Key': `k_${Math.random().toString(36).slice(2)}_${Date.now()}`,
});
let seq = 0;
const newPhone = () =>
  `9895${String(process.pid % 1000).padStart(3, '0')}${String(++seq).padStart(3, '0')}`;

async function newCustomer() {
  const phone = newPhone();
  await api().post('/api/v1/auth/otp/request').send({ phone });
  const res = await api()
    .post('/api/v1/auth/otp/verify')
    .send({ app: 'customer', phone, code: h.lastCode(`+91${phone}`) });
  expect(res.status).toBe(200);
  return { phone, auth: { Authorization: `Bearer ${res.body.accessToken}` } };
}

const home = {
  label: 'Home',
  line: '12/4 Rose Villa, 2nd lane',
  landmark: "Near St. Mary's Church",
  pincode: '682030',
};

beforeAll(async () => {
  h = await createHarness();
  ownerA = await h.makeUser(h.supplierA, 'owner');
  adminA = await h.makeUser(h.supplierA, 'admin');
  ownerB = await h.makeUser(h.supplierB, 'owner');
  staffA = await h.makeUser(h.supplierA, 'staff');
  const a = await api()
    .post('/api/v1/admin/service-areas')
    .set(bearer(ownerA))
    .set(idem())
    .send({ name: 'Kakkanad', nameMl: 'കാക്കനാട്', pincodes: ['682030', '682021'] });
  expect(a.status).toBe(201);
  kakkanad = a.body.area.id;
});
afterAll(async () => {
  await h?.cleanup();
});

describe('service areas', () => {
  it('a PIN code can belong to only one active area', async () => {
    const r = await api()
      .post('/api/v1/admin/service-areas')
      .set(bearer(adminA))
      .set(idem())
      .send({ name: 'Infopark', pincodes: ['682042', '682030'] });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({
      code: 'PINCODE_IN_OTHER_AREA',
      details: { pincodes: ['682030'], area: 'Kakkanad' },
    });
  });

  it('staff and customers cannot change areas; any signed-in user can list active ones', async () => {
    const r = await api()
      .post('/api/v1/admin/service-areas')
      .set(bearer(staffA))
      .set(idem())
      .send({ name: 'X', pincodes: ['682001'] });
    expect(r.status).toBe(403);
    const list = await api().get('/api/v1/service-areas').set(bearer(staffA));
    expect(list.body.areas.map((a: { name: string }) => a.name)).toEqual(['Kakkanad']);
  });

  it("another supplier sees none of supplier A's areas and cannot edit them", async () => {
    const list = await api().get('/api/v1/admin/service-areas').set(bearer(ownerB));
    expect(list.body.areas).toEqual([]);
    const edit = await api()
      .patch(`/api/v1/admin/service-areas/${kakkanad}`)
      .set(bearer(ownerB))
      .set(idem())
      .send({ name: 'Hijack' });
    expect(edit.status).toBe(404);
  });

  it('changes are audited', async () => {
    const rows = await h.handle.db.select().from(auditLogs).where(eq(auditLogs.entityId, kakkanad));
    expect(rows.map((r) => r.action)).toContain('service_area.created');
  });
});

describe('customer profile and addresses (registration and address management)', () => {
  it('profile needs privacy acceptance the first time and records the version', async () => {
    const c = await newCustomer();
    const no = await api()
      .put('/api/v1/customer/profile')
      .set(c.auth)
      .send({ name: 'Anitha R', preferredLanguage: 'ml' });
    expect(no.status).toBe(400);
    expect(no.body.error.code).toBe('PRIVACY_NOT_ACCEPTED');
    const yes = await api()
      .put('/api/v1/customer/profile')
      .set(c.auth)
      .send({ name: 'Anitha R', preferredLanguage: 'ml', acceptPrivacy: true });
    expect(yes.status).toBe(200);
    expect(yes.body.customer).toMatchObject({ name: 'Anitha R', preferredLanguage: 'ml' });
    expect(yes.body.customer.privacyAcceptedAt).toBeTruthy();
    // Later changes don't need it again.
    const later = await api()
      .put('/api/v1/customer/profile')
      .set(c.auth)
      .send({ name: 'Anitha Raj', preferredLanguage: 'en' });
    expect(later.status).toBe(200);
  });

  it('an address must be inside a service area', async () => {
    const c = await newCustomer();
    const out = await api()
      .post('/api/v1/customer/addresses')
      .set(c.auth)
      .set(idem())
      .send({ ...home, pincode: '695001' });
    expect(out.status).toBe(422);
    expect(out.body.error.code).toBe('OUTSIDE_SERVICE_AREA');
    const ok = await api()
      .post('/api/v1/customer/addresses')
      .set(c.auth)
      .set(idem())
      .send({ ...home, latitude: 10.0159, longitude: 76.3419 });
    expect(ok.status).toBe(201);
    expect(ok.body.address).toMatchObject({
      isDefault: true,
      areaName: 'Kakkanad',
      areaNameMl: 'കാക്കനാട്',
      latitude: 10.0159,
    });
  });

  it('keeps exactly one default address, and removing it hands the default on', async () => {
    const c = await newCustomer();
    const a1 = await api().post('/api/v1/customer/addresses').set(c.auth).set(idem()).send(home);
    const a2 = await api()
      .post('/api/v1/customer/addresses')
      .set(c.auth)
      .set(idem())
      .send({ ...home, label: 'Office', pincode: '682021' });
    expect(a2.body.address.isDefault).toBe(false);
    await api()
      .patch(`/api/v1/customer/addresses/${a2.body.address.id}`)
      .set(c.auth)
      .set(idem())
      .send({ isDefault: true });
    let list = (await api().get('/api/v1/customer/addresses').set(c.auth)).body.addresses;
    expect(
      list
        .filter((a: { isDefault: boolean }) => a.isDefault)
        .map((a: { label: string }) => a.label),
    ).toEqual(['Office']);
    await api().delete(`/api/v1/customer/addresses/${a2.body.address.id}`).set(c.auth);
    list = (await api().get('/api/v1/customer/addresses').set(c.auth)).body.addresses;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: a1.body.address.id, isDefault: true });
  });

  it("a customer cannot see or change another customer's address", async () => {
    const c1 = await newCustomer();
    const c2 = await newCustomer();
    const a = await api().post('/api/v1/customer/addresses').set(c1.auth).set(idem()).send(home);
    const edit = await api()
      .patch(`/api/v1/customer/addresses/${a.body.address.id}`)
      .set(c2.auth)
      .set(idem())
      .send({ line: 'Hacked' });
    expect(edit.status).toBe(404);
    const del = await api().delete(`/api/v1/customer/addresses/${a.body.address.id}`).set(c2.auth);
    expect(del.status).toBe(404);
    expect((await api().get('/api/v1/customer/addresses').set(c2.auth)).body.addresses).toEqual([]);
  });

  it('staff cannot use customer endpoints', async () => {
    expect((await api().get('/api/v1/customer/profile').set(bearer(staffA))).status).toBe(403);
  });

  it('second sign-in reports the profile and address as done', async () => {
    const c = await newCustomer();
    await api()
      .put('/api/v1/customer/profile')
      .set(c.auth)
      .send({ name: 'Meera S', preferredLanguage: 'en', acceptPrivacy: true });
    await api().post('/api/v1/customer/addresses').set(c.auth).set(idem()).send(home);
    await h.handle.pool.query(
      `update otp_requests set created_at = created_at - interval '1 minute' where phone = $1`,
      [`+91${c.phone}`],
    );
    await api().post('/api/v1/auth/otp/request').send({ phone: c.phone });
    const again = await api()
      .post('/api/v1/auth/otp/verify')
      .send({ app: 'customer', phone: c.phone, code: h.lastCode(`+91${c.phone}`) });
    expect(again.body.next).toEqual({ profileComplete: true, hasAddress: true });
  });
});

describe('office: customers', () => {
  it('creates a customer who phoned in, with an address; the same number can then sign in', async () => {
    const phone = newPhone();
    const r = await api()
      .post('/api/v1/admin/customers')
      .set(bearer(adminA))
      .set(idem())
      .send({
        phone,
        name: 'Green Valley Office',
        type: 'office',
        address: { ...home, label: 'Office' },
      });
    expect(r.status).toBe(201);
    expect(r.body.customer).toMatchObject({
      name: 'Green Valley Office',
      type: 'office',
      privacyAcceptedAt: null,
    });
    expect(r.body.customer.addresses).toHaveLength(1);
    const dup = await api()
      .post('/api/v1/admin/customers')
      .set(bearer(adminA))
      .set(idem())
      .send({ phone, name: 'Dup' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.details.customerId).toBe(r.body.customer.id);

    await api().post('/api/v1/auth/otp/request').send({ phone });
    const signIn = await api()
      .post('/api/v1/auth/otp/verify')
      .send({ app: 'customer', phone, code: h.lastCode(`+91${phone}`) });
    // The office-entered name and address are already there; only privacy acceptance is missing.
    expect(signIn.body.next).toEqual({ profileComplete: false, hasAddress: true });
  });

  it('searches by name, last 4 digits and area, within the supplier only', async () => {
    const phone = newPhone();
    await api()
      .post('/api/v1/admin/customers')
      .set(bearer(adminA))
      .set(idem())
      .send({ phone, name: 'Lakshmi Stores', type: 'shop', address: home });
    const byName = await api().get('/api/v1/admin/customers?q=lakshmi').set(bearer(adminA));
    expect(byName.body.customers.map((c: { name: string }) => c.name)).toContain('Lakshmi Stores');
    const byDigits = await api()
      .get(`/api/v1/admin/customers?q=${phone.slice(-4)}`)
      .set(bearer(adminA));
    expect(byDigits.body.customers[0]).toMatchObject({ name: 'Lakshmi Stores', area: 'Kakkanad' });
    const byArea = await api().get('/api/v1/admin/customers?q=kakkanad').set(bearer(adminA));
    expect(byArea.body.customers.length).toBeGreaterThan(0);
    const other = await api().get('/api/v1/admin/customers?q=lakshmi').set(bearer(ownerB));
    expect(other.body.customers).toEqual([]);
    const id = byName.body.customers[0].id;
    expect((await api().get(`/api/v1/admin/customers/${id}`).set(bearer(ownerB))).status).toBe(404);
  });

  it('switching a customer off signs them out at once', async () => {
    const c = await newCustomer();
    const [u] = await h.handle.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.phone, `+91${c.phone}`));
    const list = await api()
      .get(`/api/v1/admin/customers?q=${c.phone.slice(-4)}`)
      .set(bearer(adminA));
    const id = list.body.customers.find((x: { phone: string }) => x.phone === `+91${c.phone}`).id;
    const off = await api()
      .patch(`/api/v1/admin/customers/${id}`)
      .set(bearer(adminA))
      .set(idem())
      .send({ status: 'disabled' });
    expect(off.status).toBe(200);
    expect((await api().get('/api/v1/customer/profile').set(c.auth)).status).toBe(401);
    void u;
  });
});

describe('office: staff and admin accounts', () => {
  it('adds staff; switching off or resetting the PIN ends their sessions and PINs', async () => {
    const phone = newPhone();
    const add = await api()
      .post('/api/v1/admin/staff')
      .set(bearer(adminA))
      .set(idem())
      .send({ phone, name: 'Ravi' });
    expect(add.status).toBe(201);
    // Staff signs in and sets a PIN.
    await api().post('/api/v1/auth/otp/request').send({ phone });
    const s = await api()
      .post('/api/v1/auth/otp/verify')
      .send({
        app: 'staff',
        phone,
        code: h.lastCode(`+91${phone}`),
        deviceId: 'ravi_phone_000000001',
      });
    expect(s.status).toBe(200);
    await api()
      .post('/api/v1/auth/staff/pin')
      .set('Authorization', `Bearer ${s.body.accessToken}`)
      .send({ pin: '5831' });
    let list = (await api().get('/api/v1/admin/staff').set(bearer(adminA))).body.staff;
    expect(list.find((x: { name: string }) => x.name === 'Ravi')).toMatchObject({
      status: 'active',
      pinDevices: 1,
    });

    const reset = await api()
      .post(`/api/v1/admin/staff/${add.body.userId}/reset-pin`)
      .set(bearer(adminA))
      .set(idem())
      .send({});
    expect(reset.status).toBe(200);
    expect(
      (await api().get('/api/v1/me').set('Authorization', `Bearer ${s.body.accessToken}`)).status,
    ).toBe(401);
    const pin = await api()
      .post('/api/v1/auth/staff/pin/sign-in')
      .send({ phone, deviceId: 'ravi_phone_000000001', pin: '5831' });
    expect(pin.body.error.code).toBe('PIN_NOT_SET');

    const off = await api()
      .patch(`/api/v1/admin/staff/${add.body.userId}`)
      .set(bearer(adminA))
      .set(idem())
      .send({ status: 'disabled' });
    expect(off.status).toBe(200);
    list = (await api().get('/api/v1/admin/staff').set(bearer(adminA))).body.staff;
    expect(list.find((x: { name: string }) => x.name === 'Ravi').status).toBe('disabled');
    await h.handle.pool.query(
      `update otp_requests set created_at = created_at - interval '1 minute' where phone = $1`,
      [`+91${phone}`],
    );
    await api().post('/api/v1/auth/otp/request').send({ phone });
    const denied = await api()
      .post('/api/v1/auth/otp/verify')
      .send({
        app: 'staff',
        phone,
        code: h.lastCode(`+91${phone}`),
        deviceId: 'ravi_phone_000000001',
      });
    expect(denied.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('only the owner manages office accounts, and cannot switch off themselves', async () => {
    const r = await api()
      .post('/api/v1/admin/team')
      .set(bearer(adminA))
      .set(idem())
      .send({ phone: newPhone(), name: 'Clerk' });
    expect(r.status).toBe(403);
    const ok = await api()
      .post('/api/v1/admin/team')
      .set(bearer(ownerA))
      .set(idem())
      .send({ phone: newPhone(), name: 'Clerk' });
    expect(ok.status).toBe(201);
    const self = await api()
      .patch(`/api/v1/admin/team/${ownerA.userId}`)
      .set(bearer(ownerA))
      .set(idem())
      .send({ status: 'disabled' });
    expect(self.status).toBe(422);
  });

  it("supplier B cannot touch supplier A's staff", async () => {
    const r = await api()
      .post(`/api/v1/admin/staff/${staffA.userId}/reset-pin`)
      .set(bearer(ownerB))
      .set(idem())
      .send({});
    expect(r.status).toBe(404);
  });

  it('phone numbers in audit records keep only the last 4 digits', async () => {
    const res = await h.handle.pool.query(
      `select after::text as a from audit_logs where action = 'staff.added'`,
    );
    expect(res.rows[0].a).toMatch(/\*{6}\d{4}/);
    expect(res.rows[0].a).not.toMatch(/\+91\d{10}/);
  });
});
