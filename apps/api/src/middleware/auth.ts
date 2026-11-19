import type { Request, RequestHandler } from 'express';
import type { Role } from '@wtrdrop/shared';
import { errors } from '../lib/errors';
import type { TokenService } from '../lib/tokens';
import type { TenantContext } from '../lib/context';

/** Reads a Bearer token if present. Invalid tokens are rejected, not ignored. */
export function authenticate(tokens: TokenService): RequestHandler {
  return async (req, _res, next) => {
    const header = req.header('authorization');
    if (!header) return next();
    const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(header);
    if (!match?.[1]) throw errors.unauthenticated();
    const claims = await tokens.verifyAccessToken(match[1]);
    if (!claims) throw errors.unauthenticated();
    req.ctx.auth = claims;
    next();
  };
}

/** Rejects anonymous requests. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.ctx.auth) throw errors.unauthenticated();
  next();
};

/**
 * Role-based access control, enforced on the server for every protected route.
 * Deny by default: a route must list the roles that may use it.
 */
export function requireRole(...allowed: Role[]): RequestHandler {
  if (allowed.length === 0) throw new Error('requireRole needs at least one role');
  return (req, _res, next) => {
    const auth = req.ctx.auth;
    if (!auth) throw errors.unauthenticated();
    if (!allowed.includes(auth.role)) throw errors.forbidden();
    next();
  };
}

/** The tenant context for service calls. Only valid after requireAuth. */
export function tenant(req: Request): TenantContext {
  const auth = req.ctx.auth;
  if (!auth) throw errors.unauthenticated();
  return { ...auth, requestId: req.ctx.requestId, ip: req.ctx.ip };
}
