import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Msg91OtpProvider } from './msg91';
import { DevOutboxOtpProvider } from './dev-outbox';
import { OtpDeliveryError } from './otp-provider';
import { loadEnv } from '../../config/env';

const base = { DATABASE_URL: 'postgres://x@localhost/x', JWT_SECRET: 'x'.repeat(40) };

describe('OTP provider configuration', () => {
  it('refuses the development outbox in production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', OTP_PROVIDER: 'dev-outbox' })).toThrow(
      /not allowed in production/,
    );
    // Production defaults to dev-outbox only if not set; that is refused too.
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(/not allowed in production/);
  });
  it('requires MSG91 credentials when MSG91 is chosen', () => {
    expect(() => loadEnv({ ...base, OTP_PROVIDER: 'msg91' })).toThrow(/MSG91_AUTH_KEY/);
    expect(() =>
      loadEnv({
        ...base,
        NODE_ENV: 'production',
        OTP_PROVIDER: 'msg91',
        MSG91_AUTH_KEY: 'k',
        MSG91_TEMPLATE_ID: 't',
        PUSH_PROVIDER: 'expo',
      }),
    ).not.toThrow();
  });

  it('refuses the development push outbox in production', () => {
    const prod = {
      ...base,
      NODE_ENV: 'production',
      OTP_PROVIDER: 'msg91',
      MSG91_AUTH_KEY: 'k',
      MSG91_TEMPLATE_ID: 't',
    };
    expect(() => loadEnv(prod)).toThrow(/PUSH_PROVIDER/);
    expect(() => loadEnv({ ...prod, PUSH_PROVIDER: 'none' })).not.toThrow();
  });
});

describe('MSG91 provider (request format, against a stand-in HTTP function)', () => {
  it('sends the template request with the number without "+"', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const p = new Msg91OtpProvider({
      authKey: 'key123',
      templateId: 'tpl9',
      baseUrl: 'https://control.msg91.com',
      fetchImpl: (async (url: string, init: RequestInit) => {
        seen = { url, init };
        return new Response(JSON.stringify({ type: 'success' }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    await p.send({ phone: '+919847012345', code: '482913', language: 'en' });
    expect(seen!.url).toBe('https://control.msg91.com/api/v5/flow');
    expect((seen!.init.headers as Record<string, string>).authkey).toBe('key123');
    expect(JSON.parse(String(seen!.init.body))).toEqual({
      template_id: 'tpl9',
      short_url: '0',
      recipients: [{ mobiles: '919847012345', otp: '482913' }],
    });
  });
  it('turns provider errors and network failures into OtpDeliveryError without echoing details', async () => {
    const rejecting = new Msg91OtpProvider({
      authKey: 'k',
      templateId: 't',
      baseUrl: 'https://x',
      fetchImpl: (async () =>
        new Response('{"type":"error","message":"+919847012345 invalid"}', {
          status: 200,
        })) as unknown as typeof fetch,
    });
    await expect(
      rejecting.send({ phone: '+919847012345', code: '1', language: 'en' }),
    ).rejects.toThrow(OtpDeliveryError);
    await expect(
      rejecting.send({ phone: '+919847012345', code: '1', language: 'en' }),
    ).rejects.not.toThrow(/9847/);
    const down = new Msg91OtpProvider({
      authKey: 'k',
      templateId: 't',
      baseUrl: 'https://x',
      fetchImpl: (async () => {
        throw new Error('ECONNRESET');
      }) as unknown as typeof fetch,
    });
    await expect(down.send({ phone: '+919847012345', code: '1', language: 'en' })).rejects.toThrow(
      'SMS provider unreachable',
    );
  });
});

describe('development outbox', () => {
  it('writes one line per message to a file only the owner can read', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'outbox-'));
    const file = path.join(dir, 'sub', 'sms.jsonl');
    const p = new DevOutboxOtpProvider(file);
    await p.send({ phone: '+919847012345', code: '123456', language: 'ml' });
    const line = JSON.parse((await readFile(file, 'utf8')).trim());
    expect(line).toMatchObject({ phone: '+919847012345', code: '123456', language: 'ml' });
    expect((await stat(file)).mode & 0o077).toBe(0);
  });
});
