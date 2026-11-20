import { randomUUID } from 'node:crypto';
import { expect, request, type APIRequestContext, type Page } from '@playwright/test';
import { API_PORT } from '../playwright.config';
import { latestCode } from './support';

/**
 * Real API calls for steps that happen outside the portal in real life: what a delivery person
 * does on their phone, and quick setup the portal already tests elsewhere.
 */
export interface Api {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
}

async function read<T>(r: Awaited<ReturnType<APIRequestContext['get']>>, what: string) {
  if (!r.ok()) throw new Error(`${what} → ${r.status()} ${await r.text()}`);
  return (await r.json()) as T;
}

function client(ctx: APIRequestContext, token: string, prefix: string): Api {
  const headers = () => ({ Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() });
  return {
    get: async (path) => read(await ctx.get(prefix + path, { headers: headers() }), path),
    post: async (path, body) =>
      read(await ctx.post(prefix + path, { headers: headers(), data: body }), path),
  };
}

/** The signed-in office person in this browser: a fresh access token from the portal's cookie. */
export async function officeFromPage(page: Page): Promise<Api> {
  const r = await page.request.post('/api/v1/auth/refresh', {
    headers: { 'X-WtrDrop-Client': 'admin' },
    data: {},
  });
  const { accessToken } = await read<{ accessToken: string }>(r, 'refresh');
  return client(page.request, accessToken, '/api/v1/');
}

/** A delivery person's phone: SMS code sign-in with a device id, straight to the API. */
export async function staffPhone(phone: string): Promise<Api & { dispose(): Promise<void> }> {
  const ctx = await request.newContext({ baseURL: `http://localhost:${API_PORT}/api/v1/` });
  const asked = Date.now() - 1000;
  expect((await ctx.post('auth/otp/request', { data: { phone } })).ok()).toBe(true);
  const code = await latestCode(phone, asked);
  const v = await read<{ accessToken: string }>(
    await ctx.post('auth/otp/verify', {
      data: { app: 'staff', phone, code, deviceId: `e2e-${randomUUID()}` },
    }),
    'staff sign-in',
  );
  return { ...client(ctx, v.accessToken, ''), dispose: () => ctx.dispose() };
}
