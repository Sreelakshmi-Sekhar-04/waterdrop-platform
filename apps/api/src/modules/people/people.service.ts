/** Office management of staff and admin accounts. Owner-only for admins. */
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Role } from '@wtrdrop/shared';
import type { Database, DbOrTx } from '../../db/client';
import { staffDevices, userRoles, users } from '../../db/schema';
import { AppError, errors } from '../../lib/errors';
import { recordAudit } from '../../lib/audit';
import type { TenantContext } from '../../lib/context';
import { revokeRoleSessions } from '../customers/customers.service';

export type TeamRole = 'staff' | 'admin';

export async function listTeam(db: Database, supplierId: string, roles: Role[]) {
  return db
    .select({
      userId: users.id,
      name: users.name,
      phone: users.phone,
      role: userRoles.role,
      status: userRoles.status,
      since: userRoles.createdAt,
      pinDevices: sql<number>`(select count(*)::int from staff_devices d where d.user_id = ${users.id}
                  and d.supplier_id = ${supplierId} and d.revoked_at is null)`,
      passwordSet: sql<boolean>`${users.passwordHash} is not null`,
    })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(eq(userRoles.supplierId, supplierId), inArray(userRoles.role, roles)))
    .orderBy(asc(users.name));
}

export async function addTeamMember(
  db: Database,
  ctx: TenantContext,
  input: { phone: string; name: string; role: TeamRole },
) {
  return db.transaction(async (tx) => {
    await tx.insert(users).values({ phone: input.phone, name: input.name }).onConflictDoNothing();
    const [u] = await tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.phone, input.phone));
    if (!u!.name) await tx.update(users).set({ name: input.name }).where(eq(users.id, u!.id));
    const [row] = await tx
      .insert(userRoles)
      .values({ userId: u!.id, supplierId: ctx.supplierId, role: input.role })
      .onConflictDoNothing()
      .returning({ id: userRoles.id });
    if (!row) {
      throw new AppError(
        409,
        'ALREADY_IN_TEAM',
        'This number is already in the team. Switch it on instead.',
      );
    }
    await recordAudit(tx, ctx, {
      action: `${input.role}.added`,
      entityType: 'user',
      entityId: u!.id,
      after: { phone: input.phone, name: input.name, role: input.role },
    });
    return { userId: u!.id };
  });
}

async function teamRow(tx: DbOrTx, supplierId: string, userId: string, role: TeamRole) {
  const [row] = await tx
    .select({ id: userRoles.id, status: userRoles.status })
    .from(userRoles)
    .where(
      and(
        eq(userRoles.userId, userId),
        eq(userRoles.supplierId, supplierId),
        eq(userRoles.role, role),
      ),
    );
  if (!row) throw errors.notFound('Team member');
  return row;
}

export async function setTeamMemberStatus(
  db: Database,
  ctx: TenantContext,
  userId: string,
  role: TeamRole,
  status: 'active' | 'disabled',
) {
  if (userId === ctx.userId)
    throw new AppError(422, 'CANNOT_CHANGE_SELF', 'You cannot switch off your own account.');
  await db.transaction(async (tx) => {
    const before = await teamRow(tx, ctx.supplierId, userId, role);
    await tx.update(userRoles).set({ status }).where(eq(userRoles.id, before.id));
    if (status === 'disabled') {
      await revokeRoleSessions(tx, userId, ctx.supplierId, role);
      if (role === 'staff') await revokeDevices(tx, ctx.supplierId, userId);
    }
    await recordAudit(tx, ctx, {
      action: `${role}.${status === 'active' ? 'enabled' : 'disabled'}`,
      entityType: 'user',
      entityId: userId,
      before: { status: before.status },
      after: { status },
    });
  });
}

async function revokeDevices(tx: DbOrTx, supplierId: string, userId: string) {
  await tx
    .update(staffDevices)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(staffDevices.userId, userId),
        eq(staffDevices.supplierId, supplierId),
        isNull(staffDevices.revokedAt),
      ),
    );
}

/** Lost phone or forgotten PIN: the staff member signs in with an SMS code again and sets a new PIN. */
export async function resetStaffPin(db: Database, ctx: TenantContext, userId: string) {
  await db.transaction(async (tx) => {
    await teamRow(tx, ctx.supplierId, userId, 'staff');
    await revokeDevices(tx, ctx.supplierId, userId);
    await revokeRoleSessions(tx, userId, ctx.supplierId, 'staff');
    await recordAudit(tx, ctx, { action: 'staff.pin_reset', entityType: 'user', entityId: userId });
  });
}
