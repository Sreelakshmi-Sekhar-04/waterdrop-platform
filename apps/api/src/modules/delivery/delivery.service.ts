/**
 * Delivery (Phase 5): routes ("trips"), assignment, the delivery person's day, and day-end
 * reconciliation (M-03). Rules from the approved decisions:
 * - D-05: each try at a stop is an attempt. "Couldn't deliver" moves the order to
 *   RESCHEDULE_PENDING (capacity given back); a short delivery closes the order as delivered.
 * - D-09: the app pre-fills empties with the full cans; the server accepts whatever is counted.
 * - D-04: the deposit is charged for cans held beyond what the deposit already covers.
 * - D-03: "pay later" is always possible at the door; dues above the credit limit are flagged.
 * - R-07: empties beyond what the customer held never take the balance below 0.
 * - Confirming a delivery writes order, item, three ledgers, payment, stock and audit in one
 *   transaction (Phase 0 §9 decision 8). A delivery person sees only their own route (scenario 2).
 */
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  deliveryMoney,
  istDate,
  type DeliverInput,
  type EndTripInput,
  type NotDeliveredInput,
  type OrderStatus,
} from '@wtrdrop/shared';
import type { Database, DbOrTx } from '../../db/client';
import {
  customers,
  deliveryAttempts,
  deliveryWindows,
  orderItems,
  orders,
  payments,
  trips,
  userRoles,
  users,
} from '../../db/schema';
import { AppError, errors } from '../../lib/errors';
import { recordAudit } from '../../lib/audit';
import type { TenantContext } from '../../lib/context';
import { orderSettings } from '../ordering/catalog.service';
import { writeHistory } from '../ordering/orders.service';
import { releaseWindow, reserveWindow } from '../ordering/windows.service';
import {
  lockCustomer,
  moveStock,
  postAccount,
  postCans,
  postDeposit,
  reverseAttemptEntries,
  reverseAttemptStock,
} from './ledgers';

const conflict = (code: string, message: string, details?: unknown) =>
  new AppError(409, code, message, details);

async function undoMinutes(db: DbOrTx, supplierId: string) {
  const s = await orderSettings(db, supplierId);
  return (s as { staffUndoWindowMinutes?: number }).staffUndoWindowMinutes ?? 10;
}

// ---------------------------------------------------------------- reading a route

const stopColumns = {
  orderId: orders.id,
  orderNo: orders.orderNo,
  status: orders.status,
  seq: orders.stopSeq,
  qty: orders.totalQty,
  totalPaise: orders.totalPaise,
  deliveryChargePaise: orders.deliveryChargePaise,
  note: orders.note,
  address: orders.addressSnapshot,
  windowNameEn: deliveryWindows.nameEn,
  windowNameMl: deliveryWindows.nameMl,
  windowStart: deliveryWindows.startTime,
  windowEnd: deliveryWindows.endTime,
  customerId: customers.id,
  customerName: users.name,
  customerPhone: users.phone,
  cansHeld: customers.cansHeld,
  depositCoverCans: customers.depositCoverCans,
  balancePaise: customers.balancePaise,
  creditLimitPaise: customers.creditLimitPaise,
  unitPricePaise: orderItems.unitPricePaise,
  depositPerCanPaise: orderItems.depositPerCanPaise,
};

async function tripStops(db: DbOrTx, tripId: string) {
  const rows = await db
    .select(stopColumns)
    .from(orders)
    .innerJoin(deliveryWindows, eq(deliveryWindows.id, orders.windowId))
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .where(eq(orders.tripId, tripId))
    .orderBy(asc(orders.stopSeq), asc(orders.orderNo));
  const attempts = await db
    .select()
    .from(deliveryAttempts)
    .where(and(eq(deliveryAttempts.tripId, tripId), isNull(deliveryAttempts.undoneAt)))
    .orderBy(asc(deliveryAttempts.recordedAt));
  const last = new Map(attempts.map((a) => [a.orderId, a]));
  // Stops the office cancelled stay listed (marked cancelled) so nobody delivers them by mistake.
  return rows.map((r) => ({ ...r, attempt: last.get(r.orderId) ?? null }));
}

function tripTotals(trip: typeof trips.$inferSelect, stops: Awaited<ReturnType<typeof tripStops>>) {
  const done = stops.filter((s) => s.attempt);
  const delivered = done.filter((s) => s.attempt!.outcome === 'delivered');
  const sum = (f: (a: typeof deliveryAttempts.$inferSelect) => number) =>
    delivered.reduce((n, s) => n + f(s.attempt!), 0);
  const fullDelivered = sum((a) => a.fullDelivered);
  return {
    stops: stops.filter((s) => s.status !== 'CANCELLED' || s.attempt).length,
    done: done.length,
    left: stops.filter((s) => s.status === 'ASSIGNED' || s.status === 'OUT_FOR_DELIVERY').length,
    plannedLoad: stops
      .filter((s) => s.status === 'ASSIGNED' || s.status === 'OUT_FOR_DELIVERY' || s.attempt)
      .reduce((n, s) => n + s.qty, 0),
    fullDelivered,
    emptiesCollected: sum((a) => a.emptyCollected + a.extraEmpties),
    cashPaise: sum((a) => (a.paymentMethod === 'cash' ? a.amountCollectedPaise : 0)),
    upiPaise: sum((a) => (a.paymentMethod === 'upi' ? a.amountCollectedPaise : 0)),
    laterPaise: sum((a) => (a.paymentMethod === 'later' ? a.chargePaise + a.depositPaise : 0)),
    fullOnVan: trip.loadFull === null ? null : trip.loadFull - fullDelivered,
  };
}

/** The delivery person's route for a day (their own only), with every stop and running totals. */
export async function staffDay(db: Database, ctx: TenantContext, date: string, now: Date) {
  const [trip] = await db
    .select()
    .from(trips)
    .where(
      and(
        eq(trips.supplierId, ctx.supplierId),
        eq(trips.staffUserId, ctx.userId),
        eq(trips.date, date),
      ),
    );
  if (!trip) return { date, trip: null, stops: [], totals: null, undoMinutes: 0 };
  const minutes = await undoMinutes(db, ctx.supplierId);
  const stops = (await tripStops(db, trip.id)).map((s) => ({
    ...s,
    canUndo:
      !!s.attempt &&
      trip.status === 'on_route' &&
      now.getTime() - s.attempt.recordedAt.getTime() <= minutes * 60_000,
  }));
  return { date, trip, stops, totals: tripTotals(trip, stops), undoMinutes: minutes };
}

async function ownTrip(tx: DbOrTx, ctx: TenantContext, tripId: string) {
  const [t] = await tx
    .select()
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.supplierId, ctx.supplierId)))
    .for('update');
  // Scenario 2: another person's route looks exactly like a missing one.
  if (!t || (ctx.role === 'staff' && t.staffUserId !== ctx.userId)) throw errors.notFound('Route');
  return t;
}

// ---------------------------------------------------------------- the delivery person's actions

/** Load-out confirmed and route started: every assigned stop becomes "out for delivery". */
export async function startTrip(
  db: Database,
  ctx: TenantContext,
  tripId: string,
  loadFull: number,
) {
  await db.transaction(async (tx) => {
    const t = await ownTrip(tx, ctx, tripId);
    if (t.status !== 'planned') return; // a repeat from the offline queue
    const stops = await tx
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(and(eq(orders.tripId, t.id), eq(orders.status, 'ASSIGNED')))
      .for('update');
    if (!stops.length) throw conflict('NO_STOPS', 'There are no stops on this route.');
    await tx
      .update(trips)
      .set({ status: 'on_route', loadFull, startedAt: new Date(), updatedAt: new Date() })
      .where(eq(trips.id, t.id));
    await tx
      .update(orders)
      .set({ status: 'OUT_FOR_DELIVERY', updatedAt: new Date() })
      .where(
        inArray(
          orders.id,
          stops.map((s) => s.id),
        ),
      );
    for (const s of stops)
      await writeHistory(tx, ctx.supplierId, s.id, 'ASSIGNED', 'OUT_FOR_DELIVERY', {
        userId: ctx.userId,
        role: ctx.role,
      });
    await moveStock(tx, {
      supplierId: ctx.supplierId,
      from: ['depot', 'full'],
      to: ['trip', 'full'],
      qty: loadFull,
      kind: 'load_out',
      tripId: t.id,
      actorUserId: ctx.userId,
    });
    await recordAudit(tx, ctx, {
      action: 'trip.started',
      entityType: 'trip',
      entityId: t.id,
      after: { loadFull, stops: stops.length },
    });
  });
}

async function stopForAction(tx: DbOrTx, ctx: TenantContext, orderId: string) {
  const [o] = await tx
    .select({
      id: orders.id,
      status: orders.status,
      customerId: orders.customerId,
      tripId: orders.tripId,
      totalQty: orders.totalQty,
      deliveryChargePaise: orders.deliveryChargePaise,
      windowId: orders.windowId,
      deliveryDate: orders.deliveryDate,
      capacityHeld: orders.capacityHeld,
      orderNo: orders.orderNo,
    })
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.supplierId, ctx.supplierId)))
    .for('update');
  if (!o?.tripId) throw errors.notFound('Order');
  const t = await ownTrip(tx, ctx, o.tripId);
  if (t.status !== 'on_route')
    throw conflict('ROUTE_NOT_STARTED', 'Start the route before recording deliveries.');
  return { o, t };
}

async function replay(tx: DbOrTx, supplierId: string, clientActionId: string) {
  const [a] = await tx
    .select()
    .from(deliveryAttempts)
    .where(
      and(
        eq(deliveryAttempts.supplierId, supplierId),
        eq(deliveryAttempts.clientActionId, clientActionId),
      ),
    );
  return a ?? null;
}

function notOpen(status: OrderStatus) {
  if (status === 'CANCELLED')
    return conflict('ORDER_CANCELLED', 'The office cancelled this order. Do not deliver it.');
  return conflict('ALREADY_RECORDED', 'This stop is already done.');
}

/** "Delivered": one transaction for the order, the three ledgers, the payment and the stock. */
export async function deliver(
  db: Database,
  ctx: TenantContext,
  orderId: string,
  input: DeliverInput,
  now: Date,
) {
  return db.transaction(async (tx) => {
    const seen = await replay(tx, ctx.supplierId, input.clientActionId);
    if (seen) return seen;
    const { o, t } = await stopForAction(tx, ctx, orderId);
    if (o.status !== 'OUT_FOR_DELIVERY') throw notOpen(o.status);
    if (input.full > o.totalQty)
      throw new AppError(422, 'MORE_THAN_ORDERED', 'More full cans than were ordered.', {
        ordered: o.totalQty,
      });
    const [item] = await tx
      .select({
        id: orderItems.id,
        unitPricePaise: orderItems.unitPricePaise,
        depositPerCanPaise: orderItems.depositPerCanPaise,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, o.id));
    const c = await lockCustomer(tx, ctx.supplierId, o.customerId);
    const m = deliveryMoney({
      full: input.full,
      empties: input.empties,
      held: c.cansHeld,
      cover: c.depositCoverCans,
      unitPricePaise: item!.unitPricePaise,
      deliveryChargePaise: o.deliveryChargePaise,
      depositPerCanPaise: item!.depositPerCanPaise,
    });
    const paid = input.payment.method === 'later' ? 0 : input.payment.amountPaise;
    const balanceAfter = c.balancePaise + m.totalPaise - paid;
    const [a] = await tx
      .insert(deliveryAttempts)
      .values({
        supplierId: ctx.supplierId,
        orderId: o.id,
        tripId: t.id,
        staffUserId: ctx.userId,
        outcome: 'delivered',
        fullDelivered: input.full,
        emptyCollected: input.empties - m.extraEmpties,
        extraEmpties: m.extraEmpties,
        chargePaise: m.goodsPaise + m.deliveryChargePaise,
        depositCans: m.depositCans,
        depositPaise: m.depositPaise,
        paymentMethod: input.payment.method,
        amountCollectedPaise: paid,
        overCreditLimit: balanceAfter > 0 && balanceAfter > c.creditLimitPaise,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        happenedAt: new Date(input.at),
        recordedAt: now,
        clientActionId: input.clientActionId,
      })
      .returning();
    const ref = { orderId: o.id, attemptId: a!.id, actorUserId: ctx.userId };
    await postCans(tx, c, 'delivery', input.full, ref);
    await postCans(tx, c, 'return', -(input.empties - m.extraEmpties), ref);
    if (m.depositCans > 0) await postDeposit(tx, c, 'charge', m.depositPaise, m.depositCans, ref);
    await postAccount(tx, c, 'delivery_charge', m.totalPaise, ref);
    if (paid > 0) {
      const [p] = await tx
        .insert(payments)
        .values({
          supplierId: ctx.supplierId,
          customerId: c.id,
          method: input.payment.method,
          amountPaise: paid,
          reference: input.payment.reference || null,
          collectedBy: ctx.userId,
          tripId: t.id,
          attemptId: a!.id,
          paidOn: istDate(new Date(input.at)),
        })
        .returning({ id: payments.id });
      await postAccount(tx, c, 'payment', -paid, { ...ref, paymentId: p!.id });
    }
    await tx
      .update(orderItems)
      .set({ qtyDelivered: input.full })
      .where(eq(orderItems.id, item!.id));
    await tx
      .update(orders)
      .set({ status: 'DELIVERED', capacityHeld: false, updatedAt: new Date() })
      .where(eq(orders.id, o.id));
    await writeHistory(
      tx,
      ctx.supplierId,
      o.id,
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      { userId: ctx.userId, role: ctx.role },
      input.full < o.totalQty ? `Short delivery: ${input.full} of ${o.totalQty} cans` : null,
    );
    await moveStock(tx, {
      supplierId: ctx.supplierId,
      from: ['trip', 'full'],
      to: ['customer', 'full'],
      qty: input.full,
      kind: 'delivery',
      tripId: t.id,
      attemptId: a!.id,
      customerId: c.id,
      actorUserId: ctx.userId,
    });
    await moveStock(tx, {
      supplierId: ctx.supplierId,
      from: ['customer', 'empty'],
      to: ['trip', 'empty'],
      qty: input.empties,
      kind: 'pickup',
      tripId: t.id,
      attemptId: a!.id,
      customerId: c.id,
      actorUserId: ctx.userId,
    });
    await recordAudit(tx, ctx, {
      action: 'delivery.delivered',
      entityType: 'order',
      entityId: o.id,
      after: {
        full: input.full,
        empties: input.empties,
        extraEmpties: m.extraEmpties,
        chargedPaise: m.totalPaise,
        method: input.payment.method,
        paidPaise: paid,
      },
    });
    return a!;
  });
}

/** "Couldn't deliver": a failed attempt, the order waits for the office to reschedule (D-05). */
export async function notDelivered(
  db: Database,
  ctx: TenantContext,
  orderId: string,
  input: NotDeliveredInput,
  now: Date,
) {
  return db.transaction(async (tx) => {
    const seen = await replay(tx, ctx.supplierId, input.clientActionId);
    if (seen) return seen;
    const { o, t } = await stopForAction(tx, ctx, orderId);
    if (o.status !== 'OUT_FOR_DELIVERY') throw notOpen(o.status);
    const [a] = await tx
      .insert(deliveryAttempts)
      .values({
        supplierId: ctx.supplierId,
        orderId: o.id,
        tripId: t.id,
        staffUserId: ctx.userId,
        outcome: 'failed',
        failureReason: input.reason,
        note: input.note || null,
        happenedAt: new Date(input.at),
        recordedAt: now,
        clientActionId: input.clientActionId,
      })
      .returning();
    // The cans stay on the van; the day's capacity is given back so the office can rebook it.
    if (o.capacityHeld)
      await releaseWindow(tx, { windowId: o.windowId, date: o.deliveryDate, qty: o.totalQty });
    await tx
      .update(orders)
      .set({ status: 'RESCHEDULE_PENDING', capacityHeld: false, updatedAt: new Date() })
      .where(eq(orders.id, o.id));
    await writeHistory(
      tx,
      ctx.supplierId,
      o.id,
      'OUT_FOR_DELIVERY',
      'RESCHEDULE_PENDING',
      { userId: ctx.userId, role: ctx.role },
      input.note ? `${input.reason}: ${input.note}` : input.reason,
    );
    await recordAudit(tx, ctx, {
      action: 'delivery.failed',
      entityType: 'order',
      entityId: o.id,
      after: { reason: input.reason, note: input.note ?? null },
    });
    return a!;
  });
}

/**
 * Undo within the time allowed (setting staffUndoWindowMinutes, 10 by default): every ledger entry
 * and stock movement gets an opposite entry, and the stop is open again. Nothing is deleted.
 */
export async function undoAttempt(db: Database, ctx: TenantContext, attemptId: string, now: Date) {
  const minutes = await undoMinutes(db, ctx.supplierId);
  await db.transaction(async (tx) => {
    const [a] = await tx
      .select()
      .from(deliveryAttempts)
      .where(
        and(eq(deliveryAttempts.id, attemptId), eq(deliveryAttempts.supplierId, ctx.supplierId)),
      )
      .for('update');
    if (!a || a.staffUserId !== ctx.userId) throw errors.notFound('Delivery');
    if (a.undoneAt) return;
    const t = await ownTrip(tx, ctx, a.tripId);
    if (t.status !== 'on_route' || now.getTime() - a.recordedAt.getTime() > minutes * 60_000)
      throw conflict('UNDO_EXPIRED', 'It is too late to undo this. Ask the office to correct it.', {
        minutes,
      });
    const [o] = await tx
      .select({
        id: orders.id,
        status: orders.status,
        customerId: orders.customerId,
        windowId: orders.windowId,
        deliveryDate: orders.deliveryDate,
        totalQty: orders.totalQty,
        tripId: orders.tripId,
      })
      .from(orders)
      .where(eq(orders.id, a.orderId))
      .for('update');
    // Only the latest action on a stop that is still on this route can be undone.
    if (!o || o.tripId !== t.id || !['DELIVERED', 'RESCHEDULE_PENDING'].includes(o.status))
      throw conflict('UNDO_EXPIRED', 'This stop has changed since. Ask the office to correct it.', {
        minutes,
      });
    if (a.outcome === 'delivered') {
      const c = await lockCustomer(tx, ctx.supplierId, o.customerId);
      await reverseAttemptEntries(tx, c, a.id, {
        actorUserId: ctx.userId,
        reason: 'Undone by delivery person',
      });
      await reverseAttemptStock(tx, a.id, ctx.userId);
      await tx.update(orderItems).set({ qtyDelivered: null }).where(eq(orderItems.orderId, o.id));
    }
    // The cans are back on the van either way, so the order holds its capacity again.
    await reserveWindowUnchecked(tx, o.windowId, o.deliveryDate, o.totalQty);
    await tx
      .update(deliveryAttempts)
      .set({ undoneAt: now, undoneBy: ctx.userId })
      .where(eq(deliveryAttempts.id, a.id));
    await tx
      .update(orders)
      .set({ status: 'OUT_FOR_DELIVERY', capacityHeld: true, updatedAt: new Date() })
      .where(eq(orders.id, o.id));
    await writeHistory(
      tx,
      ctx.supplierId,
      o.id,
      o.status,
      'OUT_FOR_DELIVERY',
      { userId: ctx.userId, role: ctx.role },
      'Undone by delivery person',
    );
    await recordAudit(tx, ctx, {
      action: 'delivery.undone',
      entityType: 'order',
      entityId: o.id,
      before: { status: o.status, attemptId: a.id },
      after: { status: 'OUT_FOR_DELIVERY' },
    });
  });
}

/** Undo puts already-loaded cans back on the day; the van carries them, so no capacity check. */
async function reserveWindowUnchecked(tx: DbOrTx, windowId: string, date: string, qty: number) {
  await tx.execute(sql`
    insert into window_bookings (supplier_id, window_id, date, reserved_cans)
    select supplier_id, id, ${date}, ${qty} from delivery_windows where id = ${windowId}
    on conflict (window_id, date) do update set reserved_cans = window_bookings.reserved_cans + ${qty}, updated_at = now()`);
}

/** Day-end (M-03): the counts brought back are compared with what the app expected. */
export async function endTrip(
  db: Database,
  ctx: TenantContext,
  tripId: string,
  input: EndTripInput,
) {
  await db.transaction(async (tx) => {
    const t = await ownTrip(tx, ctx, tripId);
    if (t.status === 'ended' || t.status === 'reconciled') return;
    if (t.status !== 'on_route')
      throw conflict('ROUTE_NOT_STARTED', 'Start the route before ending the day.');
    const stops = await tripStops(tx, t.id);
    const totals = tripTotals(t, stops);
    if (totals.left > 0)
      throw conflict('STOPS_LEFT', 'Some stops are not done yet.', { left: totals.left });
    await tx
      .update(trips)
      .set({
        status: 'ended',
        endedAt: new Date(),
        expectedFull: totals.fullOnVan ?? 0,
        expectedEmpty: totals.emptiesCollected,
        expectedCashPaise: totals.cashPaise,
        returnFull: input.returnFull,
        returnEmpty: input.returnEmpty,
        returnDamaged: input.returnDamaged,
        cashHandedPaise: input.cashPaise,
        endNote: input.note || null,
        updatedAt: new Date(),
      })
      .where(eq(trips.id, t.id));
    const base = { supplierId: ctx.supplierId, tripId: t.id, actorUserId: ctx.userId };
    await moveStock(tx, {
      ...base,
      from: ['trip', 'full'],
      to: ['depot', 'full'],
      qty: input.returnFull,
      kind: 'day_end',
    });
    await moveStock(tx, {
      ...base,
      from: ['trip', 'empty'],
      to: ['depot', 'empty'],
      qty: input.returnEmpty - input.returnDamaged,
      kind: 'day_end',
    });
    await moveStock(tx, {
      ...base,
      from: ['trip', 'empty'],
      to: ['damaged', 'damaged'],
      qty: input.returnDamaged,
      kind: 'day_end',
    });
    await recordAudit(tx, ctx, {
      action: 'trip.ended',
      entityType: 'trip',
      entityId: t.id,
      after: {
        expected: {
          full: totals.fullOnVan,
          empty: totals.emptiesCollected,
          cashPaise: totals.cashPaise,
        },
        counted: input,
      },
    });
  });
}

/** What a trip is short (negative) or over (positive) against what the app expected. */
export function tripDifferences(t: typeof trips.$inferSelect) {
  if (t.status !== 'ended' && t.status !== 'reconciled') return null;
  return {
    full: (t.returnFull ?? 0) - (t.expectedFull ?? 0),
    empty: (t.returnEmpty ?? 0) - (t.expectedEmpty ?? 0),
    cashPaise: (t.cashHandedPaise ?? 0) - (t.expectedCashPaise ?? 0),
  };
}

// ---------------------------------------------------------------- office

async function activeStaff(db: DbOrTx, supplierId: string, userId?: string) {
  return db
    .select({ userId: users.id, name: users.name, phone: users.phone })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(
      and(
        eq(userRoles.supplierId, supplierId),
        eq(userRoles.role, 'staff'),
        eq(userRoles.status, 'active'),
        eq(users.status, 'active'),
        userId ? eq(users.id, userId) : undefined,
      ),
    )
    .orderBy(asc(users.name));
}

/** The office's view of one day: every route with its stops, what is unassigned, what failed. */
export async function officeDay(db: Database, supplierId: string, date: string) {
  const staff = await activeStaff(db, supplierId);
  const dayTrips = await db
    .select({ trip: trips, staffName: users.name })
    .from(trips)
    .innerJoin(users, eq(users.id, trips.staffUserId))
    .where(and(eq(trips.supplierId, supplierId), eq(trips.date, date)))
    .orderBy(asc(users.name));
  const routes = [];
  for (const { trip, staffName } of dayTrips) {
    const stops = await tripStops(db, trip.id);
    routes.push({
      trip,
      staffName,
      stops: stops.map((s) => ({
        ...s,
        customerPhone: undefined,
        phoneLast4: s.customerPhone.slice(-4),
      })),
      totals: tripTotals(trip, stops),
      differences: tripDifferences(trip),
    });
  }
  const waiting = await db
    .select({
      orderId: orders.id,
      orderNo: orders.orderNo,
      status: orders.status,
      deliveryDate: orders.deliveryDate,
      qty: orders.totalQty,
      address: orders.addressSnapshot,
      customerName: users.name,
      windowNameEn: deliveryWindows.nameEn,
      windowNameMl: deliveryWindows.nameMl,
      windowStart: deliveryWindows.startTime,
      windowEnd: deliveryWindows.endTime,
    })
    .from(orders)
    .innerJoin(deliveryWindows, eq(deliveryWindows.id, orders.windowId))
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(
      and(
        eq(orders.supplierId, supplierId),
        sql`((${orders.status} = 'ACCEPTED' and ${orders.deliveryDate} = ${date}) or ${orders.status} = 'RESCHEDULE_PENDING')`,
      ),
    )
    .orderBy(asc(deliveryWindows.startTime), asc(orders.orderNo));
  const failedIds = waiting.filter((w) => w.status === 'RESCHEDULE_PENDING').map((w) => w.orderId);
  const lastFail = failedIds.length
    ? await db
        .select({
          orderId: deliveryAttempts.orderId,
          reason: deliveryAttempts.failureReason,
          note: deliveryAttempts.note,
          at: deliveryAttempts.recordedAt,
        })
        .from(deliveryAttempts)
        .where(
          and(
            inArray(deliveryAttempts.orderId, failedIds),
            eq(deliveryAttempts.outcome, 'failed'),
            isNull(deliveryAttempts.undoneAt),
          ),
        )
        .orderBy(desc(deliveryAttempts.recordedAt))
    : [];
  const failOf = new Map<string, (typeof lastFail)[number]>();
  for (const f of lastFail) if (!failOf.has(f.orderId)) failOf.set(f.orderId, f);
  return {
    date,
    staff: staff.map((p) => ({ userId: p.userId, name: p.name })),
    routes,
    unassigned: waiting.filter((w) => w.status === 'ACCEPTED'),
    toReschedule: waiting
      .filter((w) => w.status === 'RESCHEDULE_PENDING')
      .map((w) => ({ ...w, failure: failOf.get(w.orderId) ?? null })),
  };
}

async function tripFor(tx: DbOrTx, supplierId: string, staffUserId: string, date: string) {
  await tx.insert(trips).values({ supplierId, staffUserId, date }).onConflictDoNothing();
  const [t] = await tx
    .select()
    .from(trips)
    .where(
      and(
        eq(trips.supplierId, supplierId),
        eq(trips.staffUserId, staffUserId),
        eq(trips.date, date),
      ),
    )
    .for('update');
  return t!;
}

async function nextSeq(tx: DbOrTx, tripId: string) {
  const [r] = await tx
    .select({ max: sql<number>`coalesce(max(${orders.stopSeq}), 0)` })
    .from(orders)
    .where(eq(orders.tripId, tripId));
  return Number(r?.max ?? 0) + 1;
}

/** Gives orders to a delivery person for their date, at the end of their route. */
export async function assignOrders(
  db: Database,
  ctx: TenantContext,
  input: { date: string; staffUserId: string; orderIds: string[] },
) {
  return db.transaction(async (tx) => {
    const [person] = await activeStaff(tx, ctx.supplierId, input.staffUserId);
    if (!person) throw errors.notFound('Delivery staff');
    const t = await tripFor(tx, ctx.supplierId, input.staffUserId, input.date);
    if (t.status !== 'planned')
      throw conflict('ROUTE_ALREADY_STARTED', 'This route has started; stops cannot be added now.');
    let seq = await nextSeq(tx, t.id);
    let assigned = 0;
    const skipped: { id: string; code: string }[] = [];
    for (const id of input.orderIds) {
      const [o] = await tx
        .select({
          id: orders.id,
          status: orders.status,
          deliveryDate: orders.deliveryDate,
          tripId: orders.tripId,
          tripStatus: trips.status,
        })
        .from(orders)
        .leftJoin(trips, eq(trips.id, orders.tripId))
        .where(and(eq(orders.id, id), eq(orders.supplierId, ctx.supplierId)))
        .for('update', { of: orders });
      if (!o) {
        skipped.push({ id, code: 'NOT_FOUND' });
        continue;
      }
      if (o.deliveryDate !== input.date) {
        skipped.push({ id, code: 'DATE_MISMATCH' });
        continue;
      }
      const moving = o.status === 'ASSIGNED' && o.tripStatus === 'planned';
      if (o.status !== 'ACCEPTED' && !moving) {
        skipped.push({ id, code: 'INVALID_TRANSITION' });
        continue;
      }
      if (o.tripId === t.id) continue;
      await tx
        .update(orders)
        .set({ status: 'ASSIGNED', tripId: t.id, stopSeq: seq++, updatedAt: new Date() })
        .where(eq(orders.id, o.id));
      if (!moving)
        await writeHistory(
          tx,
          ctx.supplierId,
          o.id,
          'ACCEPTED',
          'ASSIGNED',
          {
            userId: ctx.userId,
            role: ctx.role,
          },
          person.name ? `To ${person.name}` : null,
        );
      assigned++;
    }
    await recordAudit(tx, ctx, {
      action: 'orders.assigned',
      entityType: 'trip',
      entityId: t.id,
      after: { staffUserId: input.staffUserId, date: input.date, assigned, skipped },
    });
    return { tripId: t.id, assigned, skipped };
  });
}

/** Takes stops off a route that has not started; they go back to "needs a driver". */
export async function unassignOrders(db: Database, ctx: TenantContext, orderIds: string[]) {
  return db.transaction(async (tx) => {
    let removed = 0;
    for (const id of orderIds) {
      const [o] = await tx
        .select({ id: orders.id, status: orders.status, tripStatus: trips.status })
        .from(orders)
        .innerJoin(trips, eq(trips.id, orders.tripId))
        .where(and(eq(orders.id, id), eq(orders.supplierId, ctx.supplierId)))
        .for('update', { of: orders });
      if (!o || o.status !== 'ASSIGNED' || o.tripStatus !== 'planned') continue;
      await tx
        .update(orders)
        .set({ status: 'ACCEPTED', tripId: null, stopSeq: null, updatedAt: new Date() })
        .where(eq(orders.id, o.id));
      await writeHistory(tx, ctx.supplierId, o.id, 'ASSIGNED', 'ACCEPTED', {
        userId: ctx.userId,
        role: ctx.role,
      });
      removed++;
    }
    if (removed)
      await recordAudit(tx, ctx, {
        action: 'orders.unassigned',
        entityType: 'order',
        entityId: orderIds[0]!,
        after: { orderIds, removed },
      });
    return { removed };
  });
}

/** Sets the stop order of a route (the office arranges; Phase 0 §2B "manual is enough"). */
export async function sequenceTrip(
  db: Database,
  ctx: TenantContext,
  tripId: string,
  orderIds: string[],
) {
  await db.transaction(async (tx) => {
    const t = await ownTrip(tx, ctx, tripId);
    if (t.status === 'ended' || t.status === 'reconciled')
      throw conflict('ROUTE_ENDED', 'This route has ended.');
    const onTrip = await tx.select({ id: orders.id }).from(orders).where(eq(orders.tripId, t.id));
    const known = new Set(onTrip.map((r) => r.id));
    if (orderIds.length !== known.size || !orderIds.every((id) => known.has(id)))
      throw new AppError(422, 'STOPS_CHANGED', 'The stops changed. Reload and try again.');
    for (const [i, id] of orderIds.entries())
      await tx
        .update(orders)
        .set({ stopSeq: i + 1 })
        .where(eq(orders.id, id));
    await recordAudit(tx, ctx, {
      action: 'trip.sequenced',
      entityType: 'trip',
      entityId: t.id,
      after: { orderIds },
    });
  });
}

/** M-13: a delivery person is off; their whole route (not started) goes to someone else. */
export async function moveTrip(
  db: Database,
  ctx: TenantContext,
  tripId: string,
  toStaffUserId: string,
) {
  return db.transaction(async (tx) => {
    const t = await ownTrip(tx, ctx, tripId);
    if (t.status !== 'planned')
      throw conflict('ROUTE_ALREADY_STARTED', 'This route has started and cannot be moved.');
    const [person] = await activeStaff(tx, ctx.supplierId, toStaffUserId);
    if (!person) throw errors.notFound('Delivery staff');
    if (toStaffUserId === t.staffUserId) return { tripId: t.id, moved: 0 };
    const target = await tripFor(tx, ctx.supplierId, toStaffUserId, t.date);
    if (target.status !== 'planned')
      throw conflict('ROUTE_ALREADY_STARTED', 'That person has already started their route.');
    let seq = await nextSeq(tx, target.id);
    const stops = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.tripId, t.id), eq(orders.status, 'ASSIGNED')))
      .orderBy(asc(orders.stopSeq));
    for (const s of stops)
      await tx
        .update(orders)
        .set({ tripId: target.id, stopSeq: seq++, updatedAt: new Date() })
        .where(eq(orders.id, s.id));
    await recordAudit(tx, ctx, {
      action: 'trip.moved',
      entityType: 'trip',
      entityId: t.id,
      before: { staffUserId: t.staffUserId },
      after: { staffUserId: toStaffUserId, tripId: target.id, stops: stops.length },
    });
    return { tripId: target.id, moved: stops.length };
  });
}

/** A failed order gets a new day and time (capacity booked again) and waits to be assigned. */
export async function rescheduleOrder(
  db: Database,
  ctx: TenantContext,
  orderId: string,
  slot: { date: string; windowId: string },
  now: Date,
) {
  const s = await orderSettings(db, ctx.supplierId);
  await db.transaction(async (tx) => {
    const [o] = await tx
      .select({
        id: orders.id,
        status: orders.status,
        totalQty: orders.totalQty,
        deliveryDate: orders.deliveryDate,
      })
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.supplierId, ctx.supplierId)))
      .for('update');
    if (!o) throw errors.notFound('Order');
    if (o.status !== 'RESCHEDULE_PENDING')
      throw conflict(
        'INVALID_TRANSITION',
        'Only an order that could not be delivered is rescheduled here.',
      );
    await reserveWindow(
      tx,
      ctx.supplierId,
      { windowId: slot.windowId, date: slot.date, qty: o.totalQty },
      { now, sameDayCutoff: s.sameDayCutoff, ignoreCutoff: true },
    );
    await tx
      .update(orders)
      .set({
        status: 'ACCEPTED',
        deliveryDate: slot.date,
        windowId: slot.windowId,
        capacityHeld: true,
        tripId: null,
        stopSeq: null,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, o.id));
    await writeHistory(
      tx,
      ctx.supplierId,
      o.id,
      'RESCHEDULE_PENDING',
      'ACCEPTED',
      { userId: ctx.userId, role: ctx.role },
      `Rescheduled to ${slot.date}`,
    );
    await recordAudit(tx, ctx, {
      action: 'order.rescheduled',
      entityType: 'order',
      entityId: o.id,
      before: { date: o.deliveryDate },
      after: slot,
    });
  });
}

/**
 * The office checks a finished day. Any difference between what came back and what was expected
 * needs a reason; the missing (or extra) cans are then written off the van so its count is 0.
 */
export async function reconcileTrip(
  db: Database,
  ctx: TenantContext,
  tripId: string,
  note: string | undefined,
) {
  await db.transaction(async (tx) => {
    const t = await ownTrip(tx, ctx, tripId);
    if (t.status === 'reconciled') return;
    if (t.status !== 'ended')
      throw conflict('ROUTE_NOT_ENDED', 'The delivery person has not ended this day yet.');
    const d = tripDifferences(t)!;
    const differs = d.full !== 0 || d.empty !== 0 || d.cashPaise !== 0;
    if (differs && (note?.trim().length ?? 0) < 3)
      throw new AppError(422, 'REASON_REQUIRED', 'Write what happened to the difference.');
    await tx
      .update(trips)
      .set({
        status: 'reconciled',
        reconciledBy: ctx.userId,
        reconciledAt: new Date(),
        reconcileNote: note?.trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(trips.id, t.id));
    const base = { supplierId: ctx.supplierId, tripId: t.id, actorUserId: ctx.userId, note };
    for (const [state, diff] of [
      ['full', d.full],
      ['empty', d.empty],
    ] as const) {
      if (diff < 0)
        await moveStock(tx, {
          ...base,
          from: ['trip', state],
          to: ['outside', state],
          qty: -diff,
          kind: 'shortage',
        });
      if (diff > 0)
        await moveStock(tx, {
          ...base,
          from: ['outside', state],
          to: ['trip', state],
          qty: diff,
          kind: 'surplus',
        });
    }
    await recordAudit(tx, ctx, {
      action: 'trip.reconciled',
      entityType: 'trip',
      entityId: t.id,
      after: { differences: d, note: note?.trim() || null },
    });
  });
}

/** Finished days the office has not checked yet, oldest first. */
export async function tripsToReconcile(db: Database, supplierId: string) {
  return db
    .select({ id: trips.id, date: trips.date, staffName: users.name })
    .from(trips)
    .innerJoin(users, eq(users.id, trips.staffUserId))
    .where(and(eq(trips.supplierId, supplierId), eq(trips.status, 'ended')))
    .orderBy(asc(trips.date));
}
