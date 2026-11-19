import { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { suppliers, userRoles, users } from '../../db/schema';
import { requireAuth, tenant } from '../../middleware/auth';
import { errors } from '../../lib/errors';

/** The signed-in user's own profile and role. Used by the apps to choose navigation. */
export function meRoutes(db: Database): Router {
  const r = Router();
  r.get('/me', requireAuth, async (req, res) => {
    const ctx = tenant(req);
    const [row] = await db
      .select({
        id: users.id,
        name: users.name,
        phone: users.phone,
        preferredLanguage: users.preferredLanguage,
        userStatus: users.status,
        role: userRoles.role,
        roleStatus: userRoles.status,
        supplierId: suppliers.id,
        supplierName: suppliers.name,
        supplierStatus: suppliers.status,
      })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(suppliers, eq(suppliers.id, userRoles.supplierId))
      .where(
        and(
          eq(users.id, ctx.userId),
          eq(userRoles.supplierId, ctx.supplierId),
          eq(userRoles.role, ctx.role),
        ),
      );
    // A disabled user, a removed role or a disabled supplier loses access immediately.
    if (
      !row ||
      row.userStatus !== 'active' ||
      row.roleStatus !== 'active' ||
      row.supplierStatus !== 'active'
    ) {
      throw errors.unauthenticated();
    }
    res.json({
      id: row.id,
      name: row.name,
      phone: row.phone,
      preferredLanguage: row.preferredLanguage,
      role: row.role,
      supplier: { id: row.supplierId, name: row.supplierName },
    });
  });
  return r;
}
