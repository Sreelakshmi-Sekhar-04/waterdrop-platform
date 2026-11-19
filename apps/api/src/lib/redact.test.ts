import { describe, expect, it } from 'vitest';
import { maskPhone, redact } from './redact';
import { loadEnv } from '../config/env';

describe('redact', () => {
  it('masks phones and removes secrets at any depth', () => {
    expect(
      redact({
        phone: '+919847012345',
        nested: { otp: '123456', refreshToken: 'abc', name: 'Anitha' },
      }),
    ).toEqual({
      phone: '******2345',
      nested: { otp: '[REDACTED]', refreshToken: '[REDACTED]', name: 'Anitha' },
    });
    expect(maskPhone('12')).toBe('****');
  });
});

describe('environment', () => {
  it('refuses to start with a weak secret or no database', () => {
    expect(() => loadEnv({ DATABASE_URL: 'postgres://x@y/z', JWT_SECRET: 'short' })).toThrow(
      /JWT_SECRET/,
    );
    expect(() => loadEnv({ JWT_SECRET: 'x'.repeat(40) })).toThrow(/DATABASE_URL/);
  });
});
