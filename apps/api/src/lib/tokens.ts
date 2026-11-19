/**
 * Short-lived access tokens (JWT, HS256). Refresh tokens and OTP sign-in are
 * built in Phase 3 on top of this. There is no way to obtain a token without
 * a real session: no test or demo login exists in the API.
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
