/**
 * Phase 3 sign-in, against a real PostgreSQL database. Only SMS delivery is
 * replaced (codes are captured instead of sent); everything else is the
 * production code path.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { createHarness, bearer, type TestHarness } from './helpers';
import { otpRequests, sessions, staffDevices, userRoles, users } from '../src/db/schema';

let h: TestHarness;
let seq = 0;
/** A fresh valid Indian mobile for each test, so rate limits don't interact. */
const newPhone = () =>
  `+9196${String(process.pid % 1000).padStart(3, '0')}${String(++seq).padStart(5, '0')}`;
const local = (p: string) => p.slice(3);
const api = () => request(h.app);
const ADMIN = { 'X-WtrDrop-Client': 'admin' };
const DEVICE = 'device_abcdefghijklmnop';

async function askCode(phone: string) {
  const res = await api()
    .post('/api/v1/auth/otp/request')
    .send({ phone: local(phone) });
  expect(res.status).toBe(200);
  return h.lastCode(phone);
}
/** Lets the 30-second resend wait pass without sleeping. */
async function ageCodes(phone: string, seconds = 31) {
  await h.handle.pool.query(
    `update otp_requests set created_at = created_at - make_interval(secs => $2) where phone = $1`,
    [phone, seconds],
  );
}

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h?.cleanup();
});

describe('SMS codes', () => {
  it('sends a 6-digit code and stores only a hash of it', async () => {
    const phone = newPhone();
    const res = await api()
      .post('/api/v1/auth/otp/request')
      .send({ phone: `${local(phone).slice(0, 5)} ${local(phone).slice(5)}` });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ expiresInSeconds: 300, resendAfterSeconds: 30 });
    const code = h.lastCode(phone);
    expect(code).toMatch(/^\d{6}$/);
    const [row] = await h.handle.db.select().from(otpRequests).where(eq(otpRequests.phone, phone));
    expect(row!.codeHash).not.toContain(code);
    expect(row!.codeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('answers the same for unknown and known numbers (no account probing)', async () => {
    const known = await h.makeUser(h.supplierA, 'staff');
    const [u] = await h.handle.db
      .select({ phone: users.phone })
      .from(users)
      .where(eq(users.id, known.userId));
    const a = await api()
      .post('/api/v1/auth/otp/request')
      .send({ phone: local(u!.phone) });
    const b = await api()
      .post('/api/v1/auth/otp/request')
      .send({ phone: local(newPhone()) });
    expect(a.status).toBe(b.status);
    expect(a.body).toEqual(b.body);
  });

  it('rejects invalid numbers', async () => {
    const res = await api().post('/api/v1/auth/otp/request').send({ phone: '12345' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('makes you wait 30 seconds before a new code, and limits codes per number', async () => {
    const phone = newPhone();
    await askCode(phone);
    const soon = await api()
      .post('/api/v1/auth/otp/request')
      .send({ phone: local(phone) });
    expect(soon.status).toBe(429);
    expect(soon.body.error.code).toBe('OTP_RESEND_TOO_SOON');
    expect(soon.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
    await ageCodes(phone);
    await askCode(phone);
    await ageCodes(phone);
    await askCode(phone);
    await ageCodes(phone);
    const fourth = await api()
      .post('/api/v1/auth/otp/request')
      .send({ phone: local(phone) });
    expect(fourth.status).toBe(429);
    expect(fourth.body.error.code).toBe('OTP_LIMIT');
  });

  it('a code that could not be sent cannot be used', async () => {
    const phone = newPhone();
    h.failNextSend.value = true;
    const res = await api()
      .post('/api/v1/auth/otp/request')
      .send({ phone: local(phone) });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('OTP_SEND_FAILED');
    const [row] = await h.handle.db.select().from(otpRequests).where(eq(otpRequests.phone, phone));
    expect(row!.consumedAt).not.toBeNull();
  });

  it('allows 5 attempts, then requires a new code', async () => {
    const phone = newPhone();
    const code = await askCode(phone);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let left = 4; left >= 0; left--) {
      const r = await api()
        .post('/api/v1/auth/otp/verify')
        .send({ app: 'customer', phone: local(phone), code: wrong });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatchObject({ code: 'OTP_INVALID', details: { attemptsLeft: left } });
    }
    const right = await api()
      .post('/api/v1/auth/otp/verify')
      .send({ app: 'customer', phone: local(phone), code });
    expect(right.status).toBe(429);
    expect(right.body.error.code).toBe('OTP_TOO_MANY_ATTEMPTS');
  });

  it('parallel guesses cannot exceed the attempt limit', async () => {
    const phone = newPhone();
    const code = await askCode(phone);
    const wrong = code === '000000' ? '111111' : '000000';
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        api()
          .post('/api/v1/auth/otp/verify')
          .send({ app: 'customer', phone: local(phone), code: wrong }),
      ),
    );
    expect(results.filter((r) => r.body.error?.code === 'OTP_INVALID')).toHaveLength(5);
    const [row] = await h.handle.db.select().from(otpRequests).where(eq(otpRequests.phone, phone));
    expect(row!.attempts).toBe(5);
  });

  it('an expired code does not work', async () => {
    const phone = newPhone();
    const code = await askCode(phone);
    await h.handle.pool.query(
      `update otp_requests set expires_at = now() - interval '1 second' where phone = $1`,
      [phone],
    );
    const r = await api()
      .post('/api/v1/auth/otp/verify')
      .send({ app: 'customer', phone: local(phone), code });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('OTP_INVALID');
  });

  it('a code works only once', async () => {
    const phone = newPhone();
    const code = await askCode(phone);
    const first = await api()
      .post('/api/v1/auth/otp/verify')
      .send({ app: 'customer', phone: local(phone), code });
    expect(first.status).toBe(200);
    const again = await api()
      .post('/api/v1/auth/otp/verify')
      .send({ app: 'customer', phone: local(phone), code });
    expect(again.status).toBe(400);
  });
});

describe('customer sign-in (scenario 1: registration)', () => {
  it('first sign-in creates the customer and asks for profile and address', async () => {
    const phone = newPhone();
    const code = await askCode(phone);
    const res = await api()
      .post('/api/v1/auth/otp/verify')
      .send({ app: 'customer', phone: local(phone), code });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'signed_in',
      role: 'customer',
      next: { profileComplete: false, hasAddress: false },
      accessTokenExpiresIn: 900,
    });
    expect(res.body.refreshToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const me = await api().get('/api/v1/me').set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ phone, role: 'customer' });
    // The refresh token itself is never stored.
    const rows = await h.handle.db.select().from(sessions).where(eq(sessions.userId, me.body.id));
    expect(rows[0]!.refreshTokenHash).not.toBe(res.body.refreshToken);
  });

  it('a switched-off customer cannot sign in', async () => {
    const phone = newPhone();
    const first = await api()
      .post('/api/v1/auth/otp/verify')
      .send({ app: 'customer', phone: local(phone), code: await askCode(phone) });
    const me = await api()
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${first.body.accessToken}`);
    await h.handle.db
      .update(userRoles)
      .set({ status: 'disabled' })
      .where(eq(userRoles.userId, me.body.id));
    await ageCodes(phone);
    const res = await api()
      .post('/api/v1/auth/otp/verify')
      .send({ app: 'customer', phone: local(phone), code: await askCode(phone) });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });
});

async function signInCustomer() {
  const phone = newPhone();
  const res = await api()
    .post('/api/v1/auth/otp/verify')
    .send({ app: 'customer', phone: local(phone), code: await askCode(phone) });
  expect(res.status).toBe(200);
  return { phone, ...res.body } as { phone: string; accessToken: string; refreshToken: string };
}

describe('sessions', () => {
  it('refresh gives new tokens and the old refresh token stops working', async () => {
    const s = await signInCustomer();
    const r1 = await api().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken });
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).not.toBe(s.refreshToken);
    const me = await api().get('/api/v1/me').set('Authorization', `Bearer ${r1.body.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('re-use of an old refresh token signs out the whole sign-in (theft detection)', async () => {
    const s = await signInCustomer();
    const r1 = await api().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken });
    const stolen = await api().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken });
    expect(stolen.status).toBe(401);
    expect(stolen.body.error.code).toBe('SESSION_REVOKED');
    // The legitimate newer token is now dead too, and so is its access token.
    const r2 = await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: r1.body.refreshToken });
    expect(r2.status).toBe(401);
    const me = await api().get('/api/v1/me').set('Authorization', `Bearer ${r1.body.accessToken}`);
    expect(me.status).toBe(401);
  });

  it('sign-out ends the session immediately, including the access token', async () => {
    const s = await signInCustomer();
    const out = await api()
      .post('/api/v1/auth/sign-out')
      .set('Authorization', `Bearer ${s.accessToken}`);
    expect(out.status).toBe(200);
    expect(
      (await api().get('/api/v1/me').set('Authorization', `Bearer ${s.accessToken}`)).status,
    ).toBe(401);
    expect(
      (await api().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken })).status,
    ).toBe(401);
  });

  it('an expired session cannot be refreshed', async () => {
    const s = await signInCustomer();
    await h.handle.pool.query(
      `update sessions set expires_at = now() - interval '1 second' where revoked_at is null and user_id = (select id from users where phone = $1)`,
      [s.phone],
    );
    expect(
      (await api().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken })).status,
    ).toBe(401);
  });
});

describe('staff sign-in: SMS code once, then PIN (decision D-02)', () => {
  async function staffPhone() {
    const u = await h.makeUser(h.supplierA, 'staff');
    const [row] = await h.handle.db
      .select({ phone: users.phone })
      .from(users)
      .where(eq(users.id, u.userId));
    return { ...u, phone: row!.phone };
  }

  it('refuses numbers that are not staff, with a plain message', async () => {
    const phone = newPhone();
    const res = await api()
      .post('/api/v1/auth/otp/verify')
      .send({ app: 'staff', phone: local(phone), code: await askCode(phone), deviceId: DEVICE });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_STAFF');
  });

  it('first sign-in asks for a PIN; then the PIN signs in on that phone only', async () => {
    const s = await staffPhone();
    const first = await api()
      .post('/api/v1/auth/otp/verify')
      .send({
        app: 'staff',
        phone: local(s.phone),
        code: await askCode(s.phone),
        deviceId: DEVICE,
      });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ role: 'staff', next: { pinSet: false } });

    const weak = await api()
      .post('/api/v1/auth/staff/pin')
      .set('Authorization', `Bearer ${first.body.accessToken}`)
      .send({ pin: '1234' });
    expect(weak.body.error.code).toBe('PIN_TOO_SIMPLE');
    const set = await api()
      .post('/api/v1/auth/staff/pin')
      .set('Authorization', `Bearer ${first.body.accessToken}`)
      .send({ pin: '4826' });
    expect(set.status).toBe(200);
    const [d] = await h.handle.db
      .select()
      .from(staffDevices)
      .where(eq(staffDevices.userId, s.userId));
    expect(d!.pinHash).toMatch(/^\$argon2id\$/);

    const ok = await api()
      .post('/api/v1/auth/staff/pin/sign-in')
      .send({ phone: local(s.phone), deviceId: DEVICE, pin: '4826' });
    expect(ok.status).toBe(200);
    expect(ok.body.role).toBe('staff');

    const otherPhone = await api()
      .post('/api/v1/auth/staff/pin/sign-in')
      .send({ phone: local(s.phone), deviceId: 'another_device_123456', pin: '4826' });
    expect(otherPhone.status).toBe(401);
    expect(otherPhone.body.error.code).toBe('PIN_NOT_SET');
  });

  it('5 wrong PINs lock the PIN; an SMS code is needed again', async () => {
    const s = await staffPhone();
    const first = await api()
      .post('/api/v1/auth/otp/verify')
      .send({
        app: 'staff',
        phone: local(s.phone),
        code: await askCode(s.phone),
        deviceId: DEVICE,
      });
    await api()
      .post('/api/v1/auth/staff/pin')
      .set('Authorization', `Bearer ${first.body.accessToken}`)
      .send({ pin: '4826' });
    for (let left = 4; left >= 1; left--) {
      const r = await api()
        .post('/api/v1/auth/staff/pin/sign-in')
        .send({ phone: local(s.phone), deviceId: DEVICE, pin: '9173' });
      expect(r.body.error).toMatchObject({ code: 'PIN_WRONG', details: { attemptsLeft: left } });
    }
    const fifth = await api()
      .post('/api/v1/auth/staff/pin/sign-in')
      .send({ phone: local(s.phone), deviceId: DEVICE, pin: '9173' });
    expect(fifth.status).toBe(423);
    expect(fifth.body.error.code).toBe('PIN_LOCKED');
    const right = await api()
      .post('/api/v1/auth/staff/pin/sign-in')
      .send({ phone: local(s.phone), deviceId: DEVICE, pin: '4826' });
    expect(right.status).toBe(401);
    expect(right.body.error.code).toBe('PIN_NOT_SET');
  });

  it('a correct PIN resets the wrong-PIN count', async () => {
    const s = await staffPhone();
    const first = await api()
      .post('/api/v1/auth/otp/verify')
      .send({
        app: 'staff',
        phone: local(s.phone),
        code: await askCode(s.phone),
        deviceId: DEVICE,
      });
    await api()
      .post('/api/v1/auth/staff/pin')
      .set('Authorization', `Bearer ${first.body.accessToken}`)
      .send({ pin: '4826' });
    await api()
      .post('/api/v1/auth/staff/pin/sign-in')
      .send({ phone: local(s.phone), deviceId: DEVICE, pin: '9173' });
    await api()
      .post('/api/v1/auth/staff/pin/sign-in')
      .send({ phone: local(s.phone), deviceId: DEVICE, pin: '4826' });
    const [d] = await h.handle.db
      .select()
      .from(staffDevices)
      .where(and(eq(staffDevices.userId, s.userId)));
    expect(d!.failedAttempts).toBe(0);
  });

  it('only staff can set a PIN', async () => {
    const c = await signInCustomer();
    const r = await api()
      .post('/api/v1/auth/staff/pin')
      .set('Authorization', `Bearer ${c.accessToken}`)
      .send({ pin: '4826' });
    expect(r.status).toBe(403);
  });
});

describe('admin sign-in: SMS code + password (decision D-02)', () => {
  async function owner() {
    const u = await h.makeUser(h.supplierA, 'owner');
    const [row] = await h.handle.db
      .select({ phone: users.phone })
      .from(users)
      .where(eq(users.id, u.userId));
    return { ...u, phone: row!.phone };
  }
  const cookieOf = (res: request.Response) =>
    ([] as string[])
      .concat(res.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('wtrdrop_admin_rt='));

  it('first sign-in sets a password; refresh token goes in an httpOnly cookie, not the body', async () => {
    const o = await owner();
    const v = await api()
      .post('/api/v1/auth/otp/verify')
      .set(ADMIN)
      .send({ app: 'admin', phone: local(o.phone), code: await askCode(o.phone) });
    expect(v.status).toBe(200);
    expect(v.body.status).toBe('password_setup_required');

    const weak = await api()
      .post('/api/v1/auth/admin/password/setup')
      .set(ADMIN)
      .send({ setupToken: v.body.setupToken, password: '1234567890' });
    expect(weak.status).toBe(400);
    const set = await api()
      .post('/api/v1/auth/admin/password/setup')
      .set(ADMIN)
      .send({ setupToken: v.body.setupToken, password: 'clear water 2026' });
    expect(set.status).toBe(200);
    expect(set.body.refreshToken).toBeUndefined();
    const cookie = cookieOf(set);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    const [u] = await h.handle.db
      .select({ h: users.passwordHash })
      .from(users)
      .where(eq(users.id, o.userId));
    expect(u!.h).toMatch(/^\$argon2id\$/);

    // The setup step works once only.
    const again = await api()
      .post('/api/v1/auth/admin/password/setup')
      .set(ADMIN)
      .send({ setupToken: v.body.setupToken, password: 'another pass 2026' });
    expect(again.status).toBe(409);

    // Refresh with the cookie.
    const r = await api()
      .post('/api/v1/auth/refresh')
      .set(ADMIN)
      .set('Cookie', cookie!.split(';')[0]!)
      .send({});
    expect(r.status).toBe(200);
    expect(r.body.accessToken).toBeTruthy();
    expect(cookieOf(r)).toBeTruthy();
  });

  it('later sign-ins need the password; a wrong password counts as a wrong attempt', async () => {
    const o = await owner();
    const v = await api()
      .post('/api/v1/auth/otp/verify')
      .set(ADMIN)
      .send({ app: 'admin', phone: local(o.phone), code: await askCode(o.phone) });
    await api()
      .post('/api/v1/auth/admin/password/setup')
      .set(ADMIN)
      .send({ setupToken: v.body.setupToken, password: 'clear water 2026' });
    await ageCodes(o.phone);
    const code = await askCode(o.phone);
    const bad = await api()
      .post('/api/v1/auth/otp/verify')
      .set(ADMIN)
      .send({ app: 'admin', phone: local(o.phone), code, password: 'wrong password!' });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toMatchObject({
      code: 'ADMIN_SIGN_IN_FAILED',
      details: { attemptsLeft: 4 },
    });
    const good = await api()
      .post('/api/v1/auth/otp/verify')
      .set(ADMIN)
      .send({ app: 'admin', phone: local(o.phone), code, password: 'clear water 2026' });
    expect(good.status).toBe(200);
    expect(good.body).toMatchObject({ status: 'signed_in', role: 'owner' });
  });

  it('customers and staff cannot sign in to the admin portal, and get the same message', async () => {
    const c = await signInCustomer();
    await ageCodes(c.phone);
    const r = await api()
      .post('/api/v1/auth/otp/verify')
      .set(ADMIN)
      .send({
        app: 'admin',
        phone: local(c.phone),
        code: await askCode(c.phone),
        password: 'whatever pass',
      });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('ADMIN_SIGN_IN_FAILED');
  });

  it('admin sign-in only works from the admin portal client', async () => {
    const o = await owner();
    const r = await api()
      .post('/api/v1/auth/otp/verify')
      .send({ app: 'admin', phone: local(o.phone), code: await askCode(o.phone) });
    expect(r.status).toBe(403);
  });

  it('changing the password signs out other browsers', async () => {
    const o = await owner();
    const v = await api()
      .post('/api/v1/auth/otp/verify')
      .set(ADMIN)
      .send({ app: 'admin', phone: local(o.phone), code: await askCode(o.phone) });
    const a = await api()
      .post('/api/v1/auth/admin/password/setup')
      .set(ADMIN)
      .send({ setupToken: v.body.setupToken, password: 'clear water 2026' });
    await ageCodes(o.phone);
    const b = await api()
      .post('/api/v1/auth/otp/verify')
      .set(ADMIN)
      .send({
        app: 'admin',
        phone: local(o.phone),
        code: await askCode(o.phone),
        password: 'clear water 2026',
      });
    const change = await api()
      .post('/api/v1/auth/admin/password/change')
      .set('Authorization', `Bearer ${b.body.accessToken}`)
      .send({ currentPassword: 'clear water 2026', newPassword: 'fresh water 2027' });
    expect(change.status).toBe(200);
    expect(
      (await api().get('/api/v1/me').set('Authorization', `Bearer ${a.body.accessToken}`)).status,
    ).toBe(401);
    expect(
      (await api().get('/api/v1/me').set('Authorization', `Bearer ${b.body.accessToken}`)).status,
    ).toBe(200);
  });

  it('sign-in codes and passwords never appear in audit records', async () => {
    const res = await h.handle.pool.query(`select before::text, after::text from audit_logs`);
    const all = res.rows.map((r) => `${r.before} ${r.after}`).join(' ');
    expect(all).not.toMatch(/clear water 2026|\$argon2/);
    void bearer;
  });
});

describe('per-network code limit', () => {
  it('limits how many codes one network address can ask for in an hour', async () => {
    const h2 = await createHarness({ OTP_PER_IP_PER_HOUR: '2' });
    try {
      const ask = (n: number) =>
        request(h2.app)
          .post('/api/v1/auth/otp/request')
          .send({ phone: `98470${String(n).padStart(5, '0')}` });
      expect((await ask(1)).status).toBe(200);
      expect((await ask(2)).status).toBe(200);
      const third = await ask(3);
      expect(third.status).toBe(429);
      expect(third.body.error.code).toBe('OTP_LIMIT');
    } finally {
      await h2.cleanup();
    }
  });
});
