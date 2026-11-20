/**
 * Short-lived access tokens (JWT, HS256), plus single-purpose step tokens
 * (e.g. "set your admin password", valid 10 minutes). Access tokens are only
 * issued for a real session row; no test or demo login exists in the API.
 */
import { SignJWT, jwtVerify } from 'jose';
import { ROLES, type Role } from '@wtrdrop/shared';
import { z } from 'zod';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const ISSUER = 'wtrdrop-api';
const AUDIENCE = 'wtrdrop-apps';

export interface AccessClaims {
  userId: string;
  supplierId: string;
  role: Role;
  sessionId: string;
}

const claimsSchema = z.object({
  sub: z.string().uuid(),
  sup: z.string().uuid(),
  role: z.enum(ROLES),
  sid: z.string().uuid(),
});

const stepSchema = z.object({
  sub: z.string().uuid(),
  sup: z.string().uuid(),
  role: z.enum(ROLES),
  pur: z.string(),
});

export class TokenService {
  private readonly key: Uint8Array;
  constructor(secret: string) {
    if (secret.length < 32) throw new Error('JWT secret too short');
    this.key = new TextEncoder().encode(secret);
  }

  async issueAccessToken(c: AccessClaims, ttlSeconds = ACCESS_TOKEN_TTL_SECONDS): Promise<string> {
    return new SignJWT({ sup: c.supplierId, role: c.role, sid: c.sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(c.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(this.key);
  }

  /** A short token that only allows one follow-up step, e.g. setting the first admin password. */
  async issueStepToken(purpose: string, c: Omit<AccessClaims, 'sessionId'>, ttlSeconds = 600) {
    return new SignJWT({ sup: c.supplierId, role: c.role, pur: purpose })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(c.userId)
      .setIssuer(ISSUER)
      .setAudience(`${AUDIENCE}:step`)
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(this.key);
  }

  async verifyStepToken(
    purpose: string,
    token: string,
  ): Promise<Omit<AccessClaims, 'sessionId'> | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: `${AUDIENCE}:step`,
        algorithms: ['HS256'],
      });
      const c = stepSchema.parse(payload);
      if (c.pur !== purpose) return null;
      return { userId: c.sub, supplierId: c.sup, role: c.role };
    } catch {
      return null;
    }
  }

  /** Returns the claims, or null for any invalid, expired or tampered token. */
  async verifyAccessToken(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      const c = claimsSchema.parse(payload);
      return { userId: c.sub, supplierId: c.sup, role: c.role, sessionId: c.sid };
    } catch {
      return null;
    }
  }
}
