/**
 * Secrets handling for sign-in: codes, refresh tokens, PINs and passwords.
 * Nothing here is ever logged or returned except the freshly issued token.
 */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

/** 6-digit sign-in code from a cryptographic random source. */
export function newOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Codes are stored as HMACs keyed by a server secret, so a database leak does not reveal them. */
export function hashOtp(secret: string, phone: string, code: string): string {
  return createHmac('sha256', secret).update(`otp:${phone}:${code}`).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Opaque refresh token. Only its SHA-256 is stored. */
export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// argon2id with OWASP-recommended minimums (19 MiB, 2 passes).
const ARGON = { algorithm: 2 /* Argon2id */, memoryCost: 19456, timeCost: 2, parallelism: 1 };
export const hashSecret = (plain: string) => hash(plain, ARGON);
export async function verifySecret(stored: string, plain: string): Promise<boolean> {
  try {
    return await verify(stored, plain);
  } catch {
    return false;
  }
}

export { isWeakPin } from '@wtrdrop/shared';
