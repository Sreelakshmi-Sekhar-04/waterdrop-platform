import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHarness, type TestHarness } from './helpers';

let h: TestHarness;
beforeAll(async () => {
  h = await createHarness({ RATE_LIMIT_PER_MINUTE: '3' });
});
afterAll(async () => h?.cleanup());

it('limits requests per client and explains why', async () => {
  for (let i = 0; i < 3; i++) expect((await request(h.app).get('/api/v1/health')).status).toBe(200);
  const res = await request(h.app).get('/api/v1/health');
  expect(res.status).toBe(429);
  expect(res.body.error.code).toBe('RATE_LIMITED');
});
