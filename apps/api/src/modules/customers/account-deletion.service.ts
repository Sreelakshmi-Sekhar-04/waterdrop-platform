/**
 * A customer deletes their own account from the app (store rules and the DPDP Act; ADR 0007).
 *
 * The person is removed, the business record stays: name, phone, addresses, complaint notes,
 * messages, sessions and push tokens are erased or blanked, while orders, payments, ledgers and
 * the activity log are kept because the supplier must keep accounts. Only an account with nothing
 * outstanding can be deleted, so no cans, deposit or money are lost track of.
 */
import { and, eq, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import { TERMINAL_STATUSES } from '@wtrdrop/shared';
import type { Database, DbOrTx } from '../../db/client';
import {
  addresses,
  complaints,
  customers,
  notifications,
  orders,
  pushTokens,
  sessions,
  userRoles,
  users,
} from '../../db/schema';
import { AppError, errors } from '../../lib/errors';
import { recordAudit } from '../../lib/audit';
import type { TenantContext } from '../../lib/context';

/** The phone a deleted user is left with: unique, and never a real number. */
export const DELETED_PHONE_PREFIX = 'deleted-';

export interface DeletionBlockers {
  cansHeld: number;
  depositHeldPaise: number;
  balancePaise: number;
  openOrders: number;
  otherRoles: boolean;
}

async function blockersFor(db: DbOrTx, ctx: TenantContext, customerId: string) {
  const [c] = await db
    .select({
      cansHeld: customers.cansHeld,
      depositHeldPaise: customers.depositHeldPaise,
      balancePaise: customers.balancePaise,
    })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.supplierId, ctx.supplierId)));
  if (!c) throw errors.notFound('Customer');
  const [{ open }] = (await db
    .select({ open: sql<number>`count(*)::int` })
    .from(orders)
    .where(
      and(eq(orders.customerId, customerId), notInArray(orders.status, [...TERMINAL_STATUSES])),
    )) as [{ open: number }];
  // Any other role, or a customer account with another supplier, keeps the person's login alive.
  const [{ others }] = (await db
    .select({ others: sql<number>`count(*)::int` })
    .from(userRoles)
    .where(
      and(
        eq(userRoles.userId, ctx.userId),
        eq(userRoles.status, 'active'),
        or(ne(userRoles.role, 'customer'), ne(userRoles.supplierId, ctx.supplierId)),
      ),
    )) as [{ others: number }];
  return { ...c, openOrders: open, otherRoles: others > 0 } satisfies DeletionBlockers;
}

const blocked = (b: DeletionBlockers) =>
  b.cansHeld !== 0 ||
  b.depositHeldPaise !== 0 ||
  b.balancePaise !== 0 ||
  b.openOrders > 0 ||
  b.otherRoles;

/** What stands in the way of deleting, for the app's confirm screen. */
export async function deletionCheck(db: Database, ctx: TenantContext, customerId: string) {
  const b = await blockersFor(db, ctx, customerId);
  return { canDelete: !blocked(b), blockers: b };
}

export async function deleteOwnAccount(db: Database, ctx: TenantContext, customerId: string) {
  await db.transaction(async (tx) => {
    // Lock the customer so no delivery, payment or order lands while the account is erased.
    const [locked] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.supplierId, ctx.supplierId)))
      .for('update');
    if (!locked) throw errors.notFound('Customer');
    const b = await blockersFor(tx, ctx, customerId);
    if (b.otherRoles)
      throw new AppError(409, 'ACCOUNT_HAS_OTHER_ROLES', 'This phone is also used for other work.');
    if (b.openOrders > 0)
      throw new AppError(409, 'ACCOUNT_HAS_OPEN_ORDERS', 'Some orders are not finished yet.', b);
    if (b.cansHeld !== 0 || b.depositHeldPaise !== 0 || b.balancePaise !== 0)
      throw new AppError(
        409,
        'ACCOUNT_HAS_BALANCES',
        'Cans, deposit or money are still due between you and the supplier.',
        b,
      );

    const now = new Date();
    await tx
      .update(users)
      .set({
        phone: `${DELETED_PHONE_PREFIX}${ctx.userId}`,
        name: null,
        status: 'disabled',
        passwordHash: null,
        updatedAt: now,
      })
      .where(eq(users.id, ctx.userId));
    await tx
      .update(customers)
      .set({ status: 'disabled', privacyAcceptedAt: null, privacyVersion: null, updatedAt: now })
      .where(eq(customers.id, customerId));
    await tx
      .update(userRoles)
      .set({ status: 'disabled' })
      .where(and(eq(userRoles.userId, ctx.userId), eq(userRoles.supplierId, ctx.supplierId)));
    // Old orders keep their address snapshot (a tax record); the address book itself is erased.
    await tx
      .update(addresses)
      .set({
        label: '',
        line: '',
        landmark: '',
        pincode: '',
        latitude: null,
        longitude: null,
        deliveryNote: null,
        isDefault: false,
        archivedAt: sql`coalesce(${addresses.archivedAt}, now())`,
        updatedAt: now,
      })
      .where(eq(addresses.customerId, customerId));
    await tx.update(complaints).set({ note: null }).where(eq(complaints.customerId, customerId));
    await tx.delete(notifications).where(eq(notifications.userId, ctx.userId));
    await tx.delete(pushTokens).where(eq(pushTokens.userId, ctx.userId));
    await tx
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.userId, ctx.userId), isNull(sessions.revokedAt)));
    // No personal details in the log: only that it happened.
    await recordAudit(tx, ctx, {
      action: 'customer.deleted',
      entityType: 'customer',
      entityId: customerId,
    });
  });
}
