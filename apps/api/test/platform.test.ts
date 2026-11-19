import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { auditLogs, users } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { bearer, createHarness, type TestHarness, type TestUser } from './helpers';

let h: TestHarness;
let ownerA: TestUser, adminA: TestUser, staffA: TestUser, customerA: TestUser, ownerB: TestUser;

beforeAll(async () => {
  h = await createHarness();
  ownerA = await h.makeUser(h.supplierA, 'owner');
  adminA = await h.makeUser(h.supplierA, 'admin');
  staffA = await h.makeUser(h.supplierA, 'staff');
  customerA = await h.makeUser(h.supplierA, 'customer');
  ownerB = await h.makeUser(h.supplierB, 'owner');
});
afterAll(async () => h?.cleanup());

describe('health and error shape', () => {
  it('reports a healthy database', async () => {
    const res = await request(h.app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'ok' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('uses one error shape and never leaks internals', async () => {
    const res = await request(h.app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'ROUTE_NOT_FOUND' });
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts/);
  });

  it('rejects malformed JSON with a clear code', async () => {
    const res = await request(h.app)
      .patch('/api/v1/admin/settings')
      .set(bearer(ownerA))
      .set('Content-Type', 'application/json')
      .send('{"oops"');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(h.app).get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeTruthy();
  });

  it('allows only configured browser origins', async () => {
    const ok = await request(h.app).get('/api/v1/health').set('Origin', 'http://localhost:5173');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const bad = await request(h.app).get('/api/v1/health').set('Origin', 'https://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('authentication', () => {
  it('requires a token for /me', async () => {
    const res = await request(h.app).get('/api/v1/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects malformed, forged and expired tokens', async () => {
    const forged = await new SignJWT({ sup: h.supplierA, role: 'owner', sid: randomUUID() })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(ownerA.userId)
      .setIssuer('wtrdrop-api')
      .setAudience('wtrdrop-apps')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('x'.repeat(40)));
    const expired = await h.tokens.issueAccessToken(
      { userId: ownerA.userId, supplierId: h.supplierA, role: 'owner', sessionId: randomUUID() },
      -10,
    );
    for (const value of [
      'Bearer',
      'Bearer not-a-jwt',
      `Bearer ${forged}`,
      `Bearer ${expired}`,
      'Basic abc',
    ]) {
      const res = await request(h.app).get('/api/v1/me').set('Authorization', value);
      expect(res.status, value).toBe(401);
    }
  });

  it('returns the signed-in user with role and supplier', async () => {
    const res = await request(h.app).get('/api/v1/me').set(bearer(staffA));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: staffA.userId,
      role: 'staff',
      supplier: { id: h.supplierA },
    });
  });

  it('cuts off a disabled user even with a valid token', async () => {
    const temp = await h.makeUser(h.supplierA, 'staff');
    await h.handle.db.update(users).set({ status: 'disabled' }).where(eq(users.id, temp.userId));
    const res = await request(h.app).get('/api/v1/me').set(bearer(temp));
    expect(res.status).toBe(401);
  });

  it('rejects a token claiming a role the user does not hold', async () => {
    const token = await h.tokens.issueAccessToken({
      userId: customerA.userId,
      supplierId: h.supplierA,
      role: 'owner',
      sessionId: randomUUID(),
    });
    const res = await request(h.app).get('/api/v1/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});

const call = (method: 'get' | 'patch', path: string) =>
  method === 'get' ? request(h.app).get(path) : request(h.app).patch(path);

describe('role-based access control (QA scenario 3)', () => {
  const adminRoutes: ['get' | 'patch', string][] = [
    ['get', '/api/v1/admin/audit-logs'],
    ['get', '/api/v1/admin/settings'],
    ['patch', '/api/v1/admin/settings'],
  ];

  it.each(adminRoutes)('%s %s is closed to customers and staff', async (method, path) => {
    for (const u of [customerA, staffA]) {
      const res = await call(method, path).set(bearer(u)).send({ maxCansPerOrder: 5 });
      expect(res.status, `${u.role}`).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it.each(adminRoutes)('%s %s is closed to anonymous callers', async (method, path) => {
    const res = await call(method, path).send({});
    expect(res.status).toBe(401);
  });

  it('lets admins read settings but only the owner change them', async () => {
    expect((await request(h.app).get('/api/v1/admin/settings').set(bearer(adminA))).status).toBe(
      200,
    );
    const res = await request(h.app)
      .patch('/api/v1/admin/settings')
      .set(bearer(adminA))
      .send({ maxCansPerOrder: 5 });
    expect(res.status).toBe(403);
  });
});

describe('settings, validation, audit and tenant isolation', () => {
  it('validates input and rejects unknown keys', async () => {
    for (const body of [
      {},
      { sameDayCutoff: '25:00' },
      { notASetting: 1 },
      { maxCansPerOrder: 0 },
    ]) {
      const res = await request(h.app)
        .patch('/api/v1/admin/settings')
        .set(bearer(ownerA))
        .send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('records who changed what (QA scenario 12)', async () => {
    const res = await request(h.app)
      .patch('/api/v1/admin/settings')
      .set(bearer(ownerA))
      .send({ sameDayCutoff: '13:30', supportPhone: '+919847012345' });
    expect(res.status).toBe(200);
    expect(res.body.settings.sameDayCutoff).toBe('13:30');

    const [row] = await h.handle.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'settings.update'))
      .orderBy(sql`id desc`)
      .limit(1);
    expect(row).toMatchObject({
      supplierId: h.supplierA,
      actorUserId: ownerA.userId,
      actorRole: 'owner',
    });
    expect(row!.after).toMatchObject({ sameDayCutoff: '13:30', supportPhone: '******2345' });
    expect(row!.requestId).toBe(res.headers['x-request-id']);
  });

  it('clears an optional setting with null', async () => {
    const set = await request(h.app)
      .patch('/api/v1/admin/settings')
      .set(bearer(ownerA))
      .send({ supportPhone: '+919847012345' });
    expect(set.body.settings.supportPhone).toBe('+919847012345');
    const cleared = await request(h.app)
      .patch('/api/v1/admin/settings')
      .set(bearer(ownerA))
      .send({ supportPhone: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.settings.supportPhone).toBeUndefined();
  });

  it('keeps each supplier separate', async () => {
    await request(h.app)
      .patch('/api/v1/admin/settings')
      .set(bearer(ownerB))
      .send({ maxCansPerOrder: 7 });
    const a = await request(h.app).get('/api/v1/admin/settings').set(bearer(ownerA));
    const b = await request(h.app).get('/api/v1/admin/settings').set(bearer(ownerB));
    expect(b.body.settings.maxCansPerOrder).toBe(7);
    expect(a.body.settings.maxCansPerOrder).not.toBe(7);

    const logsB = await request(h.app).get('/api/v1/admin/audit-logs').set(bearer(ownerB));
    expect(logsB.body.items.length).toBeGreaterThan(0);
    expect(
      logsB.body.items.every((r: { supplierId: string }) => r.supplierId === h.supplierB),
    ).toBe(true);
  });

  it('refuses to change or delete audit records, even directly in the database', async () => {
    for (const q of [
      "update audit_logs set action = 'x'",
      'delete from audit_logs',
      'truncate audit_logs',
    ]) {
      await expect(h.handle.pool.query(q), q).rejects.toThrow(/append-only/);
    }
  });
});

describe('duplicate-request protection (QA scenario 4 foundation)', () => {
  const countAudits = async () =>
    (await h.handle.db.select().from(auditLogs).where(eq(auditLogs.actorUserId, ownerA.userId)))
      .length;

  it('applies a request once even when sent 10 times at the same moment', async () => {
    const key = `test-${randomUUID()}`;
    const before = await countAudits();
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(h.app)
          .patch('/api/v1/admin/settings')
          .set(bearer(ownerA))
          .set('Idempotency-Key', key)
          .send({ staffUndoWindowMinutes: 12 }),
      ),
    );
    for (const r of results) expect([200, 409]).toContain(r.status);
    expect(await countAudits()).toBe(before + 1);

    const replay = await request(h.app)
      .patch('/api/v1/admin/settings')
      .set(bearer(ownerA))
      .set('Idempotency-Key', key)
      .send({ staffUndoWindowMinutes: 12 });
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.settings.staffUndoWindowMinutes).toBe(12);
    expect(await countAudits()).toBe(before + 1);
  });

  it('refuses to reuse a key for a different request', async () => {
    const key = `test-${randomUUID()}`;
    const send = (n: number) =>
      request(h.app)
        .patch('/api/v1/admin/settings')
        .set(bearer(ownerA))
        .set('Idempotency-Key', key)
        .send({ staffUndoWindowMinutes: n });
    expect((await send(5)).status).toBe(200);
    const second = await send(6);
    expect(second.status).toBe(422);
    expect(second.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('rejects a malformed key', async () => {
    const res = await request(h.app)
      .patch('/api/v1/admin/settings')
      .set(bearer(ownerA))
      .set('Idempotency-Key', 'short')
      .send({ staffUndoWindowMinutes: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_INVALID');
  });

  it('scopes keys to the user, so two users never share a stored response', async () => {
    const key = `shared-${randomUUID()}`;
    const a = await request(h.app)
      .patch('/api/v1/admin/settings')
      .set(bearer(ownerA))
      .set('Idempotency-Key', key)
      .send({ maxCansPerOrder: 9 });
    const b = await request(h.app)
      .patch('/api/v1/admin/settings')
      .set(bearer(ownerB))
      .set('Idempotency-Key', key)
      .send({ maxCansPerOrder: 9 });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.headers['idempotent-replayed']).toBeUndefined();
  });
});
