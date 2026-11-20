/// <reference types="node" />
import { randomUUID } from 'node:crypto';
import { expect, request, type APIRequestContext } from '@playwright/test';
import { API_PORT } from '../playwright.config';
import { latestCode } from './support';

/**
 * The office side of a browser test, done over the real API (the admin portal has its own browser
 * tests). Signs in the seeded test office account with an SMS code and a password, like a person.
 */
export interface Office {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  dispose(): Promise<void>;
}

const OFFICE_PHONE = '9847000003'; // seeded by apps/api e2e-server
const PASSWORD = 'tea at the depot 7';

export async function officeApi(): Promise<Office> {
  const ctx: APIRequestContext = await request.newContext({
    baseURL: `http://localhost:${API_PORT}/api/v1/`,
    extraHTTPHeaders: { 'X-WtrDrop-Client': 'admin' },
  });
  const asked = Date.now() - 1000;
  expect((await ctx.post('auth/otp/request', { data: { phone: OFFICE_PHONE } })).ok()).toBe(true);
  const code = await latestCode(OFFICE_PHONE, asked);
  const v = await (
    await ctx.post('auth/otp/verify', {
      data: { app: 'admin', phone: OFFICE_PHONE, code, password: PASSWORD },
    })
  ).json();
  let token: string = v.accessToken;
  if (v.status === 'password_setup_required') {
    const s = await ctx.post('auth/admin/password/setup', {
      data: { setupToken: v.setupToken, password: PASSWORD },
    });
    token = (await s.json()).accessToken;
  }
  expect(token).toBeTruthy();
  const auth = () => ({ Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() });
  const read = async <T>(r: Awaited<ReturnType<APIRequestContext['get']>>, what: string) => {
    if (!r.ok()) throw new Error(`${what} → ${r.status()} ${await r.text()}`);
    return (await r.json()) as T;
  };
  return {
    get: async (path) => read(await ctx.get(path, { headers: auth() }), path),
    post: async (path, body) => read(await ctx.post(path, { headers: auth(), data: body }), path),
    dispose: () => ctx.dispose(),
  };
}

/** A customer the office adds (as if they phoned), with an address in the DEMO delivery area. */
export async function officeCustomer(office: Office, phone: string, name: string) {
  const { customer } = await office.post<{
    customer: { id: string; addresses: { id: string }[] };
  }>('admin/customers', {
    phone,
    name,
    address: {
      label: 'Home',
      line: `${name} house, 3rd cross`,
      landmark: 'Near the temple',
      pincode: '682030',
    },
  });
  return { customerId: customer.id, addressId: customer.addresses[0]!.id };
}

export async function officeOrder(
  office: Office,
  c: { customerId: string; addressId: string },
  input: { date: string; windowId: string; qty: number },
) {
  const { order } = await office.post<{ order: { id: string; orderNo: number } }>('admin/orders', {
    ...c,
    ...input,
    clientRequestId: randomUUID(),
  });
  return order;
}
