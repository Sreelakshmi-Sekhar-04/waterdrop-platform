/**
 * The three customer ledgers (cans, deposit, money) and the stock movement log (Phase 5).
 *
 * Every function here must run inside a transaction that has locked the customer row with
 * `lockCustomer`. Each entry stores the balance after it, and the cached balance on the customer is
 * updated in the same statement sequence, so the cache always equals the sum of the entries
 * (checked by tests). Entries are never edited: a mistake gets a reversing entry.
 */
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client';
import {
  accountEntryEnum,
  accountLedger,
  canLedger,
  customers,
  depositLedger,
  payments,
  stockMovements,
} from '../../db/schema';
import { errors } from '../../lib/errors';

export interface LockedCustomer {
  id: string;
  supplierId: string;
  cansHeld: number;
  depositHeldPaise: number;
  depositCoverCans: number;
  balancePaise: number;
  creditLimitPaise: number;
}

export async function lockCustomer(
  tx: DbOrTx,
  supplierId: string,
  customerId: string,
): Promise<LockedCustomer> {
  const [c] = await tx
    .select({
      id: customers.id,
      supplierId: customers.supplierId,
      cansHeld: customers.cansHeld,
      depositHeldPaise: customers.depositHeldPaise,
      depositCoverCans: customers.depositCoverCans,
      balancePaise: customers.balancePaise,
      creditLimitPaise: customers.creditLimitPaise,
    })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.supplierId, supplierId)))
    .for('update');
  if (!c) throw errors.notFound('Customer');
  return c;
}

interface EntryRef {
  orderId?: string | null;
  attemptId?: string | null;
  reason?: string | null;
  actorUserId: string | null;
  reversesEntryId?: number | null;
}

async function saveBalances(tx: DbOrTx, c: LockedCustomer) {
  await tx
    .update(customers)
    .set({
      cansHeld: c.cansHeld,
      depositHeldPaise: c.depositHeldPaise,
      depositCoverCans: c.depositCoverCans,
      balancePaise: c.balancePaise,
      updatedAt: new Date(),
    })
    .where(eq(customers.id, c.id));
}

export async function postCans(
  tx: DbOrTx,
  c: LockedCustomer,
  entryType: 'delivery' | 'return' | 'reversal' | 'opening' | 'adjustment',
  delta: number,
  ref: EntryRef,
) {
  if (delta === 0) return null;
  c.cansHeld += delta;
  const [row] = await tx
    .insert(canLedger)
    .values({
      supplierId: c.supplierId,
      customerId: c.id,
      entryType,
      delta,
      balanceAfter: c.cansHeld,
      orderId: ref.orderId ?? null,
      attemptId: ref.attemptId ?? null,
      reason: ref.reason ?? null,
      actorUserId: ref.actorUserId,
      reversesEntryId: ref.reversesEntryId ?? null,
    })
    .returning({ id: canLedger.id });
  await saveBalances(tx, c);
  return row!.id;
}

export async function postDeposit(
  tx: DbOrTx,
  c: LockedCustomer,
  entryType: 'charge' | 'reversal' | 'refund' | 'opening' | 'adjustment',
  deltaPaise: number,
  deltaCans: number,
  ref: EntryRef,
) {
  if (deltaPaise === 0 && deltaCans === 0) return null;
  c.depositHeldPaise += deltaPaise;
  c.depositCoverCans += deltaCans;
  const [row] = await tx
    .insert(depositLedger)
    .values({
      supplierId: c.supplierId,
      customerId: c.id,
      entryType,
      deltaPaise,
      deltaCans,
      balanceAfterPaise: c.depositHeldPaise,
      coverAfterCans: c.depositCoverCans,
      orderId: ref.orderId ?? null,
      attemptId: ref.attemptId ?? null,
      reason: ref.reason ?? null,
      actorUserId: ref.actorUserId,
      reversesEntryId: ref.reversesEntryId ?? null,
    })
    .returning({ id: depositLedger.id });
  await saveBalances(tx, c);
  return row!.id;
}

export async function postAccount(
  tx: DbOrTx,
  c: LockedCustomer,
  entryType: (typeof accountEntryEnum.enumValues)[number],
  deltaPaise: number,
  ref: EntryRef & { paymentId?: string | null },
) {
  if (deltaPaise === 0) return null;
  c.balancePaise += deltaPaise;
  const [row] = await tx
    .insert(accountLedger)
    .values({
      supplierId: c.supplierId,
      customerId: c.id,
      entryType,
      deltaPaise,
      balanceAfterPaise: c.balancePaise,
      paymentId: ref.paymentId ?? null,
      orderId: ref.orderId ?? null,
      attemptId: ref.attemptId ?? null,
      reason: ref.reason ?? null,
      actorUserId: ref.actorUserId,
      reversesEntryId: ref.reversesEntryId ?? null,
    })
    .returning({ id: accountLedger.id });
  await saveBalances(tx, c);
  return row!.id;
}

/** Posts an equal and opposite entry for every ledger entry written by one delivery attempt. */
export async function reverseAttemptEntries(
  tx: DbOrTx,
  c: LockedCustomer,
  attemptId: string,
  ref: { actorUserId: string; reason: string },
) {
  const cans = await tx
    .select()
    .from(canLedger)
    .where(
      and(
        eq(canLedger.attemptId, attemptId),
        sql`${canLedger.entryType} <> 'reversal'`,
        sql`not exists (select 1 from can_ledger r where r.reverses_entry_id = ${canLedger.id})`,
      ),
    )
    .orderBy(asc(canLedger.id));
  for (const e of cans)
    await postCans(tx, c, 'reversal', -e.delta, {
      ...ref,
      attemptId,
      orderId: e.orderId,
      reversesEntryId: e.id,
    });
  const deposits = await tx
    .select()
    .from(depositLedger)
    .where(
      and(
        eq(depositLedger.attemptId, attemptId),
        sql`${depositLedger.entryType} <> 'reversal'`,
        sql`not exists (select 1 from deposit_ledger r where r.reverses_entry_id = ${depositLedger.id})`,
      ),
    )
    .orderBy(asc(depositLedger.id));
  for (const e of deposits)
    await postDeposit(tx, c, 'reversal', -e.deltaPaise, -e.deltaCans, {
      ...ref,
      attemptId,
      orderId: e.orderId,
      reversesEntryId: e.id,
    });
  const money = await tx
    .select()
    .from(accountLedger)
    .where(
      and(
        eq(accountLedger.attemptId, attemptId),
        sql`${accountLedger.entryType} <> 'reversal'`,
        // A payment the office already marked "not received" is not reversed twice.
        sql`not exists (select 1 from account_ledger r where r.reverses_entry_id = ${accountLedger.id})`,
      ),
    )
    .orderBy(asc(accountLedger.id));
  for (const e of money)
    await postAccount(tx, c, 'reversal', -e.deltaPaise, {
      ...ref,
      attemptId,
      orderId: e.orderId,
      paymentId: e.paymentId,
      reversesEntryId: e.id,
    });
  await tx
    .update(payments)
    .set({ reversedAt: new Date(), reversedBy: ref.actorUserId, reverseReason: ref.reason })
    .where(and(eq(payments.attemptId, attemptId), isNull(payments.reversedAt)));
}

export type Place = 'depot' | 'trip' | 'customer' | 'damaged' | 'outside';
export type CanState = 'full' | 'empty' | 'damaged';

export async function moveStock(
  tx: DbOrTx,
  m: {
    supplierId: string;
    from: [Place, CanState];
    to: [Place, CanState];
    qty: number;
    kind: string;
    tripId?: string | null;
    attemptId?: string | null;
    customerId?: string | null;
    note?: string | null;
    actorUserId: string;
  },
) {
  if (m.qty <= 0) return;
  await tx.insert(stockMovements).values({
    supplierId: m.supplierId,
    fromPlace: m.from[0],
    fromState: m.from[1],
    toPlace: m.to[0],
    toState: m.to[1],
    qty: m.qty,
    kind: m.kind,
    tripId: m.tripId ?? null,
    attemptId: m.attemptId ?? null,
    customerId: m.customerId ?? null,
    note: m.note ?? null,
    actorUserId: m.actorUserId,
  });
}

/** Undo moves: the same cans going back the way they came. */
export async function reverseAttemptStock(tx: DbOrTx, attemptId: string, actorUserId: string) {
  const rows = await tx
    .select()
    .from(stockMovements)
    .where(and(eq(stockMovements.attemptId, attemptId), sql`${stockMovements.kind} <> 'undo'`));
  for (const r of rows)
    await moveStock(tx, {
      supplierId: r.supplierId,
      from: [r.toPlace, r.toState],
      to: [r.fromPlace, r.fromState],
      qty: r.qty,
      kind: 'undo',
      tripId: r.tripId,
      attemptId,
      customerId: r.customerId,
      actorUserId,
    });
}

/** Balances and the latest entries of each ledger, for the office and (balances only) the customer. */
export async function customerLedgers(db: DbOrTx, supplierId: string, customerId: string) {
  const [c] = await db
    .select({
      cansHeld: customers.cansHeld,
      depositHeldPaise: customers.depositHeldPaise,
      depositCoverCans: customers.depositCoverCans,
      balancePaise: customers.balancePaise,
      creditLimitPaise: customers.creditLimitPaise,
    })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.supplierId, supplierId)));
  if (!c) throw errors.notFound('Customer');
  const cans = await db
    .select({
      id: canLedger.id,
      entryType: canLedger.entryType,
      delta: canLedger.delta,
      balanceAfter: canLedger.balanceAfter,
      orderId: canLedger.orderId,
      reason: canLedger.reason,
      at: canLedger.at,
    })
    .from(canLedger)
    .where(eq(canLedger.customerId, customerId))
    .orderBy(desc(canLedger.id))
    .limit(50);
  const deposit = await db
    .select({
      id: depositLedger.id,
      entryType: depositLedger.entryType,
      deltaPaise: depositLedger.deltaPaise,
      deltaCans: depositLedger.deltaCans,
      balanceAfterPaise: depositLedger.balanceAfterPaise,
      coverAfterCans: depositLedger.coverAfterCans,
      orderId: depositLedger.orderId,
      reason: depositLedger.reason,
      at: depositLedger.at,
    })
    .from(depositLedger)
    .where(eq(depositLedger.customerId, customerId))
    .orderBy(desc(depositLedger.id))
    .limit(50);
  const money = await db
    .select({
      id: accountLedger.id,
      entryType: accountLedger.entryType,
      deltaPaise: accountLedger.deltaPaise,
      balanceAfterPaise: accountLedger.balanceAfterPaise,
      orderId: accountLedger.orderId,
      paymentId: accountLedger.paymentId,
      reason: accountLedger.reason,
      at: accountLedger.at,
    })
    .from(accountLedger)
    .where(eq(accountLedger.customerId, customerId))
    .orderBy(desc(accountLedger.id))
    .limit(50);
  return { balances: c, cans, deposit, money };
}
