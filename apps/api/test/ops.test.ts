/**
 * Phase 8 operations: the nightly data check finds nothing on correct data and finds a balance
 * that no longer matches its ledger.
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { bearer, createHarness, type TestHarness, type TestUser } from './helpers';
import { customers } from '../src/db/schema';
import { checkIntegrity } from '../src/ops/integrity';

let h: TestHarness;
let owner: TestUser;

beforeAll(async () => {
  h = await createHarness();
  owner = await h.makeUser(h.supplierA, 'owner');
  await h.setupOrdering(h.supplierA);
});
afterAll(async () => {
  await h?.cleanup();
});

describe('nightly data check', () => {
  it('passes on correct data and reports a cached balance that drifted from its ledger', async () => {
    await request(h.app)
      .post('/api/v1/admin/service-areas')
      .set(bearer(owner))
      .set('Idempotency-Key', randomUUID())
      .send({ name: 'Ops', pincodes: ['682030'] });
    const c = await request(h.app)
      .post('/api/v1/admin/customers')
      .set(bearer(owner))
      .set('Idempotency-Key', randomUUID())
      .send({
        phone: '9847066001',
        name: 'Ops Check',
        address: { label: 'Home', line: 'House 1', landmark: 'Near the school', pincode: '682030' },
      });
    expect(c.status).toBe(201);
    const id = c.body.customer.id as string;
    await request(h.app)
      .post(`/api/v1/admin/customers/${id}/corrections`)
      .set(bearer(owner))
      .set('Idempotency-Key', randomUUID())
      .send({ cansHeld: 2, balancePaise: 8000, reason: 'Opening count' })
      .expect(200);

    const good = await checkIntegrity(h.handle.db);
    expect(good.ok).toBe(true);
    expect(Object.values(good.problems).every((v) => v === 0)).toBe(true);

    // Someone edits the cached number by hand in the database (never done by the app).
    await h.handle.db.update(customers).set({ cansHeld: 5 }).where(eq(customers.id, id));
    const bad = await checkIntegrity(h.handle.db);
    expect(bad.ok).toBe(false);
    expect(bad.problems.cansHeldNotLedger).toBe(1);
    expect(bad.problems.canPoolSuppliers).toBe(1);
    expect(bad.problems.balanceNotLedger).toBe(0);
  });
});
