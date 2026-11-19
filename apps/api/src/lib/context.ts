import type { Role } from '@wtrdrop/shared';

/**
 * Who is making the request, and for which supplier. The supplier always
 * comes from the verified token, never from the request body or URL, so one
 * supplier's users can never address another supplier's data.
 */
export interface RequestContext {
  requestId: string;
  ip: string | undefined;
  auth?: AuthContext;
}

export interface AuthContext {
  userId: string;
  supplierId: string;
  role: Role;
  sessionId: string;
}

/** The context every tenant-scoped service function requires. */
export type TenantContext = AuthContext & { requestId: string; ip: string | undefined };

declare module 'express-serve-static-core' {
  interface Request {
    ctx: RequestContext;
  }
}
