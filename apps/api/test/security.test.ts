/**
 * Phase 8 security regression, driven by the app's own route table: every route the API serves is
 * listed from Express itself, so a route added later without a role check fails this test.
 *
 * - every /admin route: 401 without a token, 403 for customers and delivery staff (scenario 3)
 * - every /staff route: 401 without a token, 403 for customers and the office (scenario 2)
 * - every /customer route: 401 without a token, 403 for delivery staff and the office (scenario 1)
 * - every /me route: 401 without a token
 * - the owner-only routes: 403 for office admins
 * - an old token after sign-out, a forged token, and a token for another supplier are refused
 * - security headers, CORS, body size limit, and no stack traces or SQL in error answers
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { bearer, createHarness, TEST_JWT_SECRET, type TestHarness, type TestUser } from './helpers';

let h: TestHarness;
let owner: TestUser;
let admin: TestUser;
let staff: TestUser;
let customer: TestUser;

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
interface Route {
  method: Method;
  path: string;
}

/** Lists every route mounted on the app (Express 5 router stacks). */
function routeTable(app: TestHarness['app']): Route[] {
  const out: Route[] = [];
  type Layer = {
    route?: { path: string; methods: Record<string, boolean> };
    handle?: { stack?: Layer[] };
    name?: string;
  };
  const walk = (stack: Layer[]) => {
    for (const l of stack) {
      if (l.route) {
        for (const m of Object.keys(l.route.methods))
          if (['get', 'post', 'put', 'patch', 'delete'].includes(m))
            out.push({ method: m as Method, path: l.route.path });
      } else if (l.handle?.stack) walk(l.handle.stack);
    }
  };
  walk((app as unknown as { router: { stack: Layer[] } }).router.stack);
  return out;
}

/** A concrete URL for a route pattern: ids become random UUIDs. */
const url = (path: string) =>
  `/api/v1${path
    .replace(':name', 'sales')
    .replace(':date', '2026-11-20')
    .replace(/:[a-zA-Z]+/g, () => randomUUID())}`;

function send(r: Route, auth?: Record<string, string>) {
  const req = request(h.app)[r.method](url(r.path));
  if (auth) req.set(auth);
  return r.method === 'get' || r.method === 'delete' ? req : req.send({});
}

/** Routes that only the owner may use, from the decisions log (D-01, ADR 0003–0007). */
const OWNER_ONLY: Route[] = [
  { method: 'patch', path: '/admin/settings' },
  { method: 'patch', path: '/admin/business' },
  { method: 'put', path: '/admin/customers/:id/credit-limit' },
  { method: 'post', path: '/admin/opening-balances' },
];

let routes: Route[];

beforeAll(async () => {
  // Hundreds of requests from one address; the limit itself is tested in rate-limit.test.ts.
  h = await createHarness({ RATE_LIMIT_PER_MINUTE: '100000' });
  owner = await h.makeUser(h.supplierA, 'owner');
  admin = await h.makeUser(h.supplierA, 'admin');
  staff = await h.makeUser(h.supplierA, 'staff');
  customer = await h.makeUser(h.supplierA, 'customer');
  routes = routeTable(h.app);
});
afterAll(async () => {
  await h?.cleanup();
});

describe('the route table', () => {
  it('lists every route the API serves', () => {
    // A sanity floor, so a change to how routes are read cannot make every check below pass empty.
    expect(routes.length).toBeGreaterThan(90);
    for (const r of routes)
      expect(r.path, JSON.stringify(r)).toMatch(
        /^\/(health|auth|me|admin|staff|customer|service-areas)\b/,
      );
  });
});

describe('every protected route checks the role on the server', () => {
  it('/admin routes: 401 without a token, 403 for customers and delivery staff', async () => {
    const admins = routes.filter((r) => r.path.startsWith('/admin/'));
    expect(admins.length).toBeGreaterThan(50);
    for (const r of admins) {
      expect((await send(r)).status, `anonymous ${r.method} ${r.path}`).toBe(401);
      for (const u of [customer, staff]) {
        const res = await send(r, bearer(u));
        expect(res.status, `${u.role} ${r.method} ${r.path}`).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
    }
  });

  it('/staff routes: 401 without a token, 403 for customers and the office', async () => {
    const list = routes.filter((r) => r.path.startsWith('/staff/'));
    expect(list.length).toBeGreaterThan(4);
    for (const r of list) {
      expect((await send(r)).status, `anonymous ${r.method} ${r.path}`).toBe(401);
      for (const u of [customer, admin, owner])
        expect((await send(r, bearer(u))).status, `${u.role} ${r.method} ${r.path}`).toBe(403);
    }
  });

  it('/customer routes: 401 without a token, 403 for delivery staff and the office', async () => {
    const list = routes.filter((r) => r.path.startsWith('/customer/'));
    expect(list.length).toBeGreaterThan(10);
    for (const r of list) {
      expect((await send(r)).status, `anonymous ${r.method} ${r.path}`).toBe(401);
      for (const u of [staff, admin, owner])
        expect((await send(r, bearer(u))).status, `${u.role} ${r.method} ${r.path}`).toBe(403);
    }
  });

  it('/me routes and the delivery-area list need a signed-in user', async () => {
    const list = routes.filter(
      (r) => r.path === '/me' || r.path.startsWith('/me/') || r.path === '/service-areas',
    );
    expect(list.length).toBeGreaterThan(1);
    for (const r of list) expect((await send(r)).status, `${r.method} ${r.path}`).toBe(401);
  });

  it('owner-only routes are refused to office admins', async () => {
    for (const r of OWNER_ONLY) {
      expect(
        routes.some((x) => x.method === r.method && x.path === r.path),
        `${r.path} exists`,
      ).toBe(true);
      expect((await send(r, bearer(admin))).status, `${r.method} ${r.path}`).toBe(403);
    }
  });
});

describe('tokens', () => {
  it('refuses a forged token and a token with no open session', async () => {
    const forged = await new SignJWT({ role: 'owner', sid: randomUUID(), sup: h.supplierA })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(owner.userId)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode('not-the-real-secret-not-the-real-secret-00'));
    const r1 = await request(h.app)
      .get('/api/v1/admin/settings')
      .set({ Authorization: `Bearer ${forged}` });
    expect(r1.status).toBe(401);

    // Correctly signed, but its session was never opened (or has been signed out).
    const noSession = await h.tokens.issueAccessToken({
      userId: owner.userId,
      supplierId: h.supplierA,
      role: 'owner',
      sessionId: randomUUID(),
    });
    const r3 = await request(h.app)
      .get('/api/v1/admin/settings')
      .set({ Authorization: `Bearer ${noSession}` });
    expect(r3.status).toBe(401);
    expect(TEST_JWT_SECRET.length).toBeGreaterThan(32);
  });

  it("an owner of one supplier cannot read another supplier's records", async () => {
    const ownerB = await h.makeUser(h.supplierB, 'owner');
    const a = await request(h.app)
      .post('/api/v1/admin/service-areas')
      .set(bearer(owner))
      .set('Idempotency-Key', randomUUID())
      .send({ name: 'Only A', pincodes: ['682011'] });
    expect(a.status).toBe(201);
    const list = await request(h.app).get('/api/v1/admin/service-areas').set(bearer(ownerB));
    expect(JSON.stringify(list.body)).not.toContain('Only A');
    const patch = await request(h.app)
      .patch(`/api/v1/admin/service-areas/${a.body.area.id}`)
      .set(bearer(ownerB))
      .set('Idempotency-Key', randomUUID())
      .send({ name: 'Taken over' });
    expect(patch.status).toBe(404);
  });
});

describe('transport and error answers', () => {
  it('sends security headers and no framework banner', async () => {
    const res = await request(h.app).get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });

  it('allows only the listed browser origins', async () => {
    const bad = await request(h.app).get('/api/v1/health').set('Origin', 'https://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    const good = await request(h.app).get('/api/v1/health').set('Origin', 'http://localhost:5173');
    expect(good.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('refuses bodies over 100 kB', async () => {
    const res = await request(h.app)
      .post('/api/v1/auth/otp/request')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ phone: '9847000000', pad: 'x'.repeat(120_000) }));
    expect(res.status).toBe(413);
  });

  it('never shows stack traces, SQL or internal paths in error answers', async () => {
    const answers = await Promise.all([
      request(h.app)
        .post('/api/v1/auth/otp/request')
        .set('Content-Type', 'application/json')
        .send('{"phone":'),
      request(h.app).get(`/api/v1/admin/orders/not-a-uuid`).set(bearer(owner)),
      request(h.app).get(`/api/v1/admin/orders?status=DROP%20TABLE`).set(bearer(owner)),
      request(h.app).get('/api/v1/no/such/route'),
    ]);
    for (const res of answers) {
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      const text = JSON.stringify(res.body);
      expect(text).toMatch(/"code"/);
      expect(text).not.toMatch(/at \w+ \(|node_modules|\/src\/|select |insert |postgres/i);
    }
  });
});
