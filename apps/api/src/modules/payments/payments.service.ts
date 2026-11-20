/**
 * Payments and corrections (Phase 6). Rules from the approved decisions:
 * - D-03: pay later per customer up to a credit limit; above it is flagged, never blocked. The limit
 *   is the owner's to set.
 * - D-19: no online gateway in the MVP. Cash and UPI are recorded (by the delivery person or the
 *   office) and the office checks UPI against the bank statement.
 * - D-04, M-05, M-22: deposit is refunded for returned cans the deposit covers; every refund is a
 *   record, and can pay off dues instead of being handed over.
 * - M-04: opening balances are imported once per customer, as `opening` ledger entries.
 * - D-11: a monthly statement for any customer.
 * - Corrections never edit an entry: the difference is a new `adjustment` entry with a reason.
 * Every write locks the customer row first, so ledger balances stay equal to their entries.
 */
import { and, asc, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import {
  depositRefund,
  istDate,
  monthRange,
  type BalanceCorrectionInput,
  type DepositRefundInput,
  type OfficePaymentInput,
  type OpeningImportInput,
} from '@wtrdrop/shared';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Database, DbOrTx } from '../../db/client';
import {
  accountLedger,
  canLedger,
  customers,
  deliveryAttempts,
  depositRefunds,
  orders,
  payments,
  suppliers,
  userRoles,
  users,
} from '../../db/schema';
import { AppError, errors } from '../../lib/errors';
import { recordAudit } from '../../lib/audit';
import type { TenantContext } from '../../lib/context';
import {
  lockCustomer,
  moveStock,
  postAccount,
  postCans,
  postDeposit,
  type LockedCustomer,
} from '../delivery/ledgers';

const conflict = (code: string, message: string, details?: unknown) =>
  new AppError(409, code, message, details);
const unprocessable = (code: string, message: string, details?: unknown) =>
  new AppError(422, code, message, details);

// ---------------------------------------------------------------- payments

const paymentColumns = {
  id: payments.id,
  customerId: payments.customerId,
  customerName: users.name,
  method: payments.method,
  amountPaise: payments.amountPaise,
  reference: payments.reference,
  paidOn: payments.paidOn,
  note: payments.note,
  fromDelivery: sql<boolean>`${payments.attemptId} is not null`,
  verifiedAt: payments.verifiedAt,
  reversedAt: payments.reversedAt,
  reverseReason: payments.reverseReason,
  createdAt: payments.createdAt,
};

async function paymentRow(db: DbOrTx, supplierId: string, id: string) {
  const collector = sql<
    string | null
  >`(select name from users u where u.id = ${payments.collectedBy})`;
  const [p] = await db
    .select({ ...paymentColumns, collectedByName: collector })
    .from(payments)
    .innerJoin(customers, eq(customers.id, payments.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(and(eq(payments.id, id), eq(payments.supplierId, supplierId)));
  if (!p) throw errors.notFound('Payment');
  return p;
}

/**
 * The office records money a customer paid (at the depot, by UPI to the business, ...). A retry
 * with the same `clientRequestId` returns the first payment and never credits twice (scenario 8).
 * Cash the office took itself counts as checked; UPI waits to be checked against the bank.
 */
export async function recordOfficePayment(
  db: Database,
  ctx: TenantContext,
  customerId: string,
  input: OfficePaymentInput,
  now: Date,
) {
  if (input.paidOn > istDate(now))
    throw unprocessable('DATE_IN_FUTURE', 'The payment date cannot be in the future.');
  const id = await db.transaction(async (tx) => {
    // Locking the customer first lines up every retry of the same request behind the first one.
    const c = await lockCustomer(tx, ctx.supplierId, customerId);
    const [seen] = await tx
      .select({ id: payments.id, customerId: payments.customerId })
      .from(payments)
      .where(
        and(
          eq(payments.supplierId, ctx.supplierId),
          eq(payments.clientRequestId, input.clientRequestId),
        ),
      );
    if (seen) {
      if (seen.customerId !== customerId)
        throw conflict('REQUEST_REUSED', 'This request id was already used for another customer.');
      return seen.id;
    }
    const [p] = await tx
      .insert(payments)
      .values({
        supplierId: ctx.supplierId,
        customerId: c.id,
        method: input.method,
        amountPaise: input.amountPaise,
        reference: input.reference || null,
        note: input.note || null,
        paidOn: input.paidOn,
        collectedBy: ctx.userId,
        clientRequestId: input.clientRequestId,
        verifiedAt: input.method === 'cash' ? now : null,
        verifiedBy: input.method === 'cash' ? ctx.userId : null,
      })
      .returning({ id: payments.id });
    await postAccount(tx, c, 'payment', -input.amountPaise, {
      actorUserId: ctx.userId,
      paymentId: p!.id,
      reason: input.note || null,
    });
    await recordAudit(tx, ctx, {
      action: 'payment.recorded',
      entityType: 'customer',
      entityId: c.id,
      after: {
        paymentId: p!.id,
        method: input.method,
        amountPaise: input.amountPaise,
        paidOn: input.paidOn,
      },
    });
    return p!.id;
  });
  return paymentRow(db, ctx.supplierId, id);
}

export async function listPayments(
  db: Database,
  supplierId: string,
  q: { from: string; to: string; toCheck?: boolean },
) {
  const collector = sql<
    string | null
  >`(select name from users u where u.id = ${payments.collectedBy})`;
  const rows = await db
    .select({ ...paymentColumns, collectedByName: collector })
    .from(payments)
    .innerJoin(customers, eq(customers.id, payments.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(
      and(
        eq(payments.supplierId, supplierId),
        q.toCheck
          ? and(
              eq(payments.method, 'upi'),
              isNull(payments.verifiedAt),
              isNull(payments.reversedAt),
            )
          : and(gte(payments.paidOn, q.from), lt(payments.paidOn, q.to)),
      ),
    )
    .orderBy(desc(payments.paidOn), desc(payments.createdAt))
    .limit(500);
  const refunds = q.toCheck
    ? []
    : await db
        .select({
          id: depositRefunds.id,
          customerId: depositRefunds.customerId,
          customerName: users.name,
          cans: depositRefunds.cans,
          amountPaise: depositRefunds.amountPaise,
          method: depositRefunds.method,
          reason: depositRefunds.reason,
          createdAt: depositRefunds.createdAt,
        })
        .from(depositRefunds)
        .innerJoin(customers, eq(customers.id, depositRefunds.customerId))
        .innerJoin(users, eq(users.id, customers.userId))
        .where(
          and(
            eq(depositRefunds.supplierId, supplierId),
            sql`(${depositRefunds.createdAt} at time zone 'Asia/Kolkata')::date >= ${q.from}`,
            sql`(${depositRefunds.createdAt} at time zone 'Asia/Kolkata')::date < ${q.to}`,
          ),
        )
        .orderBy(desc(depositRefunds.createdAt));
  const live = rows.filter((r) => !r.reversedAt);
  const sum = (m: string) =>
    live.filter((r) => r.method === m).reduce((n, r) => n + r.amountPaise, 0);
  const [toCheck] = await db
    .select({
      n: sql<string>`count(*)::text`,
      paise: sql<string>`coalesce(sum(amount_paise),0)::text`,
    })
    .from(payments)
    .where(
      and(
        eq(payments.supplierId, supplierId),
        eq(payments.method, 'upi'),
        isNull(payments.verifiedAt),
        isNull(payments.reversedAt),
      ),
    );
  return {
    payments: rows,
    refunds,
    totals: {
      cashPaise: sum('cash'),
      upiPaise: sum('upi'),
      refundedPaise: refunds
        .filter((r) => r.method !== 'adjust')
        .reduce((n, r) => n + r.amountPaise, 0),
    },
    toCheck: { count: Number(toCheck?.n ?? 0), amountPaise: Number(toCheck?.paise ?? 0) },
  };
}

/** UPI seen on the bank statement. Doing it twice is harmless. */
export async function verifyPayment(db: Database, ctx: TenantContext, id: string, now: Date) {
  await db.transaction(async (tx) => {
    const [p] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.id, id), eq(payments.supplierId, ctx.supplierId)))
      .for('update');
    if (!p) throw errors.notFound('Payment');
    if (p.reversedAt) throw conflict('PAYMENT_REVERSED', 'This payment was marked not received.');
    if (p.verifiedAt) return;
    await tx
      .update(payments)
      .set({ verifiedAt: now, verifiedBy: ctx.userId })
      .where(eq(payments.id, p.id));
    await recordAudit(tx, ctx, {
      action: 'payment.verified',
      entityType: 'payment',
      entityId: p.id,
      after: { method: p.method, amountPaise: p.amountPaise },
    });
  });
  return paymentRow(db, ctx.supplierId, id);
}

/**
 * "Not received": the money never arrived (a UPI that failed, cash not handed over). The payment
 * stays, marked reversed, and the customer owes the amount again through a reversing entry.
 */
export async function reversePayment(
  db: Database,
  ctx: TenantContext,
  id: string,
  reason: string,
  now: Date,
) {
  await db.transaction(async (tx) => {
    const [head] = await tx
      .select({ customerId: payments.customerId })
      .from(payments)
      .where(and(eq(payments.id, id), eq(payments.supplierId, ctx.supplierId)));
    if (!head) throw errors.notFound('Payment');
    const c = await lockCustomer(tx, ctx.supplierId, head.customerId);
    const [p] = await tx.select().from(payments).where(eq(payments.id, id)).for('update');
    if (p!.reversedAt) throw conflict('PAYMENT_REVERSED', 'This payment was already reversed.');
    const [entry] = await tx
      .select({ id: accountLedger.id, deltaPaise: accountLedger.deltaPaise })
      .from(accountLedger)
      .where(and(eq(accountLedger.paymentId, p!.id), eq(accountLedger.entryType, 'payment')));
    if (entry)
      await postAccount(tx, c, 'reversal', -entry.deltaPaise, {
        actorUserId: ctx.userId,
        paymentId: p!.id,
        reversesEntryId: entry.id,
        reason,
        attemptId: p!.attemptId,
      });
    await tx
      .update(payments)
      .set({ reversedAt: now, reversedBy: ctx.userId, reverseReason: reason })
      .where(eq(payments.id, p!.id));
    await recordAudit(tx, ctx, {
      action: 'payment.reversed',
      entityType: 'payment',
      entityId: p!.id,
      before: { method: p!.method, amountPaise: p!.amountPaise },
      after: { reason },
    });
  });
  return paymentRow(db, ctx.supplierId, id);
}

// ---------------------------------------------------------------- dues and credit limits

/**
 * Everyone who owes money, largest first. "Owing since" is the first entry after the balance was
 * last 0 or less: how long this run of dues has been open.
 */
export async function listDues(db: Database, supplierId: string) {
  const rows = await db
    .select({
      customerId: customers.id,
      name: users.name,
      phoneLast4: sql<string>`right(${users.phone}, 4)`,
      areaName: sql<string | null>`(
        select sa.name from addresses a join service_areas sa on sa.id = a.service_area_id
        where a.customer_id = ${customers.id} and a.archived_at is null
        order by a.is_default desc, a.created_at asc limit 1)`,
      balancePaise: customers.balancePaise,
      creditLimitPaise: customers.creditLimitPaise,
      cansHeld: customers.cansHeld,
      owingSince: sql<string | null>`(
        select min(al.at) from account_ledger al
        where al.customer_id = ${customers.id}
          and al.id > coalesce((select max(z.id) from account_ledger z
                                where z.customer_id = ${customers.id} and z.balance_after_paise <= 0), 0))`,
      lastPaidOn: sql<string | null>`(
        select max(p.paid_on)::text from payments p
        where p.customer_id = ${customers.id} and p.reversed_at is null)`,
    })
    .from(customers)
    .innerJoin(users, eq(users.id, customers.userId))
    .where(and(eq(customers.supplierId, supplierId), sql`${customers.balancePaise} > 0`))
    .orderBy(desc(customers.balancePaise))
    .limit(1000);
  return {
    dues: rows.map((r) => ({ ...r, overLimit: r.balancePaise > r.creditLimitPaise })),
    totals: {
      customers: rows.length,
      duePaise: rows.reduce((n, r) => n + r.balancePaise, 0),
      overLimit: rows.filter((r) => r.balancePaise > r.creditLimitPaise).length,
    },
  };
}

/** D-03: the owner decides how much each customer may owe. Changing it never blocks anything. */
export async function setCreditLimit(
  db: Database,
  ctx: TenantContext,
  customerId: string,
  creditLimitPaise: number,
) {
  await db.transaction(async (tx) => {
    const c = await lockCustomer(tx, ctx.supplierId, customerId);
    if (c.creditLimitPaise === creditLimitPaise) return;
    await tx
      .update(customers)
      .set({ creditLimitPaise, updatedAt: new Date() })
      .where(eq(customers.id, c.id));
    await recordAudit(tx, ctx, {
      action: 'customer.credit_limit',
      entityType: 'customer',
      entityId: c.id,
      before: { creditLimitPaise: c.creditLimitPaise },
      after: { creditLimitPaise },
    });
  });
}

// ---------------------------------------------------------------- deposit refunds

export async function refundDeposit(
  db: Database,
  ctx: TenantContext,
  customerId: string,
  input: DepositRefundInput,
  now: Date,
) {
  return db.transaction(async (tx) => {
    const c = await lockCustomer(tx, ctx.supplierId, customerId);
    const [seen] = await tx
      .select()
      .from(depositRefunds)
      .where(
        and(
          eq(depositRefunds.supplierId, ctx.supplierId),
          eq(depositRefunds.clientRequestId, input.clientRequestId),
        ),
      );
    if (seen) {
      if (seen.customerId !== customerId)
        throw conflict('REQUEST_REUSED', 'This request id was already used for another customer.');
      return seen;
    }
    const r = depositRefund({
      cans: input.cans,
      cansHeld: c.cansHeld,
      depositHeldPaise: c.depositHeldPaise,
      depositCoverCans: c.depositCoverCans,
    });
    if (r.amountPaise === 0)
      throw unprocessable(
        'NOTHING_TO_REFUND',
        'There is no deposit to refund for that many cans. Only cans that came back can be refunded.',
        { refundableCans: r.refundableCans },
      );
    const ref = {
      actorUserId: ctx.userId,
      reason: input.reason || (input.method === 'adjust' ? 'Deposit refund, used for dues' : null),
    };
    await postDeposit(tx, c, 'refund', -r.amountPaise, -input.cans, ref);
    if (input.method === 'adjust') await postAccount(tx, c, 'deposit_refund', -r.amountPaise, ref);
    const [row] = await tx
      .insert(depositRefunds)
      .values({
        supplierId: ctx.supplierId,
        customerId: c.id,
        cans: input.cans,
        amountPaise: r.amountPaise,
        method: input.method,
        reason: input.reason || null,
        actorUserId: ctx.userId,
        clientRequestId: input.clientRequestId,
        createdAt: now,
      })
      .returning();
    await recordAudit(tx, ctx, {
      action: 'deposit.refunded',
      entityType: 'customer',
      entityId: c.id,
      after: { cans: input.cans, amountPaise: r.amountPaise, method: input.method },
    });
    return row!;
  });
}

// ---------------------------------------------------------------- corrections

/**
 * The office sets a customer's balances to what is true (after a count at the house, a payment
 * that was written down wrong, ...). Each difference becomes an adjustment entry with the reason.
 * A change in cans held is also recorded as cans moving between the customer and "outside", so
 * the can pool still adds up.
 */
export async function correctBalances(
  db: Database,
  ctx: TenantContext,
  customerId: string,
  input: BalanceCorrectionInput,
) {
  await db.transaction(async (tx) => {
    const c = await lockCustomer(tx, ctx.supplierId, customerId);
    const before = snapshot(c);
    const ref = { actorUserId: ctx.userId, reason: input.reason };
    const cans = input.cansHeld === undefined ? 0 : input.cansHeld - c.cansHeld;
    const depositPaise =
      input.depositHeldPaise === undefined ? 0 : input.depositHeldPaise - c.depositHeldPaise;
    const depositCans =
      input.depositCoverCans === undefined ? 0 : input.depositCoverCans - c.depositCoverCans;
    const money = input.balancePaise === undefined ? 0 : input.balancePaise - c.balancePaise;
    if (cans === 0 && depositPaise === 0 && depositCans === 0 && money === 0)
      throw unprocessable('NOTHING_CHANGED', 'These are already the balances.');
    await postCans(tx, c, 'adjustment', cans, ref);
    await postDeposit(tx, c, 'adjustment', depositPaise, depositCans, ref);
    await postAccount(tx, c, 'adjustment', money, ref);
    const stock = { supplierId: ctx.supplierId, customerId: c.id, actorUserId: ctx.userId };
    if (cans > 0)
      await moveStock(tx, {
        ...stock,
        from: ['outside', 'full'],
        to: ['customer', 'full'],
        qty: cans,
        kind: 'correction',
        note: input.reason,
      });
    if (cans < 0)
      await moveStock(tx, {
        ...stock,
        from: ['customer', 'full'],
        to: ['outside', 'full'],
        qty: -cans,
        kind: 'correction',
        note: input.reason,
      });
    await recordAudit(tx, ctx, {
      action: 'customer.balances_corrected',
      entityType: 'customer',
      entityId: c.id,
      before,
      after: { ...snapshot(c), reason: input.reason },
    });
  });
}

const snapshot = (c: LockedCustomer) => ({
  cansHeld: c.cansHeld,
  depositHeldPaise: c.depositHeldPaise,
  depositCoverCans: c.depositCoverCans,
  balancePaise: c.balancePaise,
});

// ---------------------------------------------------------------- opening balances (M-04)

type OpeningResult = {
  line: number;
  phoneLast4: string;
  name: string | null;
  status: 'new' | 'existing' | 'error';
  code?: 'NAME_NEEDED' | 'HAS_ENTRIES' | 'NOT_A_CUSTOMER_HERE';
};

async function hasEntries(tx: DbOrTx, customerId: string) {
  const r = await tx.execute<{ n: string }>(sql`
    select ((select count(*) from can_ledger where customer_id = ${customerId})
          + (select count(*) from deposit_ledger where customer_id = ${customerId})
          + (select count(*) from account_ledger where customer_id = ${customerId}))::text as n`);
  return Number(r.rows[0]?.n ?? 0) > 0;
}

/**
 * Brings in each customer's cans, deposit and dues from before WtrDrop, once. A customer who
 * already has any ledger entry is refused, so a file imported twice changes nothing. New phone
 * numbers become customers (they add their address in the app, or the office adds it).
 * `dryRun` checks every line and saves nothing.
 */
export async function importOpeningBalances(
  db: Database,
  ctx: TenantContext,
  input: OpeningImportInput,
) {
  return db.transaction(async (tx) => {
    const results: OpeningResult[] = [];
    let cansIn = 0;
    for (const row of input.rows) {
      const [found] = await tx
        .select({ userId: users.id, name: users.name, customerId: customers.id })
        .from(users)
        .leftJoin(
          customers,
          and(eq(customers.userId, users.id), eq(customers.supplierId, ctx.supplierId)),
        )
        .where(eq(users.phone, row.phone));
      const base = {
        line: row.line,
        phoneLast4: row.phone.slice(-4),
        name: found?.name ?? row.name ?? null,
      };
      // Staff or office people are not turned into customers by a spreadsheet.
      if (found && !found.customerId) {
        const [role] = await tx
          .select({ role: userRoles.role })
          .from(userRoles)
          .where(and(eq(userRoles.userId, found.userId), eq(userRoles.supplierId, ctx.supplierId)));
        if (role) {
          results.push({ ...base, status: 'error', code: 'NOT_A_CUSTOMER_HERE' });
          continue;
        }
      }
      if (found?.customerId && (await hasEntries(tx, found.customerId))) {
        results.push({ ...base, status: 'error', code: 'HAS_ENTRIES' });
        continue;
      }
      if (!found?.customerId && !found?.name && !row.name) {
        results.push({ ...base, status: 'error', code: 'NAME_NEEDED' });
        continue;
      }
      results.push({ ...base, status: found?.customerId ? 'existing' : 'new' });
      if (input.dryRun) continue;

      let customerId = found?.customerId ?? null;
      if (!customerId) {
        await tx.insert(users).values({ phone: row.phone, name: row.name }).onConflictDoNothing();
        const [u] = await tx
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(eq(users.phone, row.phone));
        if (!u!.name && row.name)
          await tx.update(users).set({ name: row.name }).where(eq(users.id, u!.id));
        await tx
          .insert(userRoles)
          .values({ userId: u!.id, supplierId: ctx.supplierId, role: 'customer' })
          .onConflictDoNothing();
        const [c] = await tx
          .insert(customers)
          .values({
            userId: u!.id,
            supplierId: ctx.supplierId,
            type: 'household',
            createdBy: ctx.userId,
          })
          .returning({ id: customers.id });
        customerId = c!.id;
      }
      const c = await lockCustomer(tx, ctx.supplierId, customerId);
      const ref = { actorUserId: ctx.userId, reason: 'Opening balance' };
      await postCans(tx, c, 'opening', row.cansHeld, ref);
      await postDeposit(tx, c, 'opening', row.depositHeldPaise, row.depositCoverCans, ref);
      await postAccount(tx, c, 'opening', row.duePaise, ref);
      if (row.cansHeld > 0) {
        await moveStock(tx, {
          supplierId: ctx.supplierId,
          from: ['outside', 'full'],
          to: ['customer', 'full'],
          qty: row.cansHeld,
          kind: 'opening',
          customerId: c.id,
          actorUserId: ctx.userId,
        });
        cansIn += row.cansHeld;
      }
    }
    const count = (s: OpeningResult['status']) => results.filter((r) => r.status === s).length;
    const summary = { new: count('new'), existing: count('existing'), errors: count('error') };
    if (!input.dryRun && summary.new + summary.existing > 0)
      await recordAudit(tx, ctx, {
        action: 'opening_balances.imported',
        entityType: 'supplier',
        entityId: ctx.supplierId,
        after: { ...summary, cansWithCustomers: cansIn },
      });
    return { dryRun: input.dryRun, summary, results };
  });
}

// ---------------------------------------------------------------- monthly statement (D-11)

/**
 * One month of a customer's account: what they owed at the start, every charge and payment, and
 * what they owe at the end, with cans delivered and returned. `forCustomer` leaves out the office's
 * notes.
 */
export async function monthlyStatement(
  db: DbOrTx,
  supplierId: string,
  customerId: string,
  month: string,
  forCustomer = false,
) {
  const { from, to } = monthRange(month);
  const inMonth = (col: AnyPgColumn) =>
    and(
      sql`(${col} at time zone 'Asia/Kolkata')::date >= ${from}`,
      sql`(${col} at time zone 'Asia/Kolkata')::date < ${to}`,
    );
  const before = (col: AnyPgColumn) => sql`(${col} at time zone 'Asia/Kolkata')::date < ${from}`;

  const [head] = await db
    .select({
      name: users.name,
      phone: users.phone,
      type: customers.type,
      supplierName: suppliers.name,
      gstin: suppliers.gstin,
      cansHeld: customers.cansHeld,
      depositHeldPaise: customers.depositHeldPaise,
      depositCoverCans: customers.depositCoverCans,
      balancePaise: customers.balancePaise,
    })
    .from(customers)
    .innerJoin(users, eq(users.id, customers.userId))
    .innerJoin(suppliers, eq(suppliers.id, customers.supplierId))
    .where(and(eq(customers.id, customerId), eq(customers.supplierId, supplierId)));
  if (!head) throw errors.notFound('Customer');

  const [openMoney] = await db
    .select({ b: accountLedger.balanceAfterPaise })
    .from(accountLedger)
    .where(and(eq(accountLedger.customerId, customerId), before(accountLedger.at)))
    .orderBy(desc(accountLedger.id))
    .limit(1);
  const [openCans] = await db
    .select({ b: canLedger.balanceAfter })
    .from(canLedger)
    .where(and(eq(canLedger.customerId, customerId), before(canLedger.at)))
    .orderBy(desc(canLedger.id))
    .limit(1);

  const entries = await db
    .select({
      id: accountLedger.id,
      at: accountLedger.at,
      entryType: accountLedger.entryType,
      deltaPaise: accountLedger.deltaPaise,
      balanceAfterPaise: accountLedger.balanceAfterPaise,
      orderNo: orders.orderNo,
      cans: deliveryAttempts.fullDelivered,
      method: payments.method,
      reason: accountLedger.reason,
    })
    .from(accountLedger)
    .leftJoin(orders, eq(orders.id, accountLedger.orderId))
    .leftJoin(deliveryAttempts, eq(deliveryAttempts.id, accountLedger.attemptId))
    .leftJoin(payments, eq(payments.id, accountLedger.paymentId))
    .where(and(eq(accountLedger.customerId, customerId), inMonth(accountLedger.at)))
    .orderBy(asc(accountLedger.id));

  const cans = await db
    .select({
      entryType: canLedger.entryType,
      delta: canLedger.delta,
      after: canLedger.balanceAfter,
    })
    .from(canLedger)
    .where(and(eq(canLedger.customerId, customerId), inMonth(canLedger.at)))
    .orderBy(asc(canLedger.id));
  const sumCans = (types: string[], sign: 1 | -1) =>
    cans
      .filter((e) => types.includes(e.entryType) && Math.sign(e.delta) === sign)
      .reduce((n, e) => n + Math.abs(e.delta), 0);

  const openingPaise = openMoney?.b ?? 0;
  const closingPaise = entries.length
    ? entries[entries.length - 1]!.balanceAfterPaise
    : openingPaise;
  const charged = entries.filter((e) => e.deltaPaise > 0).reduce((n, e) => n + e.deltaPaise, 0);
  const credited = entries.filter((e) => e.deltaPaise < 0).reduce((n, e) => n - e.deltaPaise, 0);
  return {
    month,
    supplier: { name: head.supplierName, gstin: head.gstin },
    customer: forCustomer
      ? { name: head.name }
      : { name: head.name, phone: head.phone, type: head.type },
    money: { openingPaise, chargedPaise: charged, paidPaise: credited, closingPaise },
    cans: {
      opening: openCans?.b ?? 0,
      delivered: sumCans(['delivery'], 1),
      returned: sumCans(['return'], -1),
      closing: cans.length ? cans[cans.length - 1]!.after : (openCans?.b ?? 0),
    },
    deposit: { heldPaise: head.depositHeldPaise, coverCans: head.depositCoverCans },
    entries: entries.map((e) => ({
      ...e,
      reason: forCustomer ? undefined : e.reason,
    })),
  };
}

/** Payments and refunds of one customer, newest first, for the office's customer page. */
export async function customerPayments(db: DbOrTx, supplierId: string, customerId: string) {
  const collector = sql<
    string | null
  >`(select name from users u where u.id = ${payments.collectedBy})`;
  const list = await db
    .select({ ...paymentColumns, collectedByName: collector })
    .from(payments)
    .innerJoin(customers, eq(customers.id, payments.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(and(eq(payments.customerId, customerId), eq(payments.supplierId, supplierId)))
    .orderBy(desc(payments.createdAt))
    .limit(50);
  const refunds = await db
    .select()
    .from(depositRefunds)
    .where(
      and(eq(depositRefunds.customerId, customerId), eq(depositRefunds.supplierId, supplierId)),
    )
    .orderBy(desc(depositRefunds.createdAt))
    .limit(50);
  return { payments: list, refunds };
}
