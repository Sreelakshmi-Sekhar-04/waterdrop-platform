/**
 * Orders (Phase 4): quote, place, cancel, accept and reject. Rules:
 * - Prices are taken on the day the order is placed and stored on the order (M-21).
 * - Capacity is reserved when the order is placed and released on cancel or reject (R-05, D-08).
 * - Valid app orders are accepted automatically when the setting is on (D-14); office orders are
 *   accepted by the office user who made them.
 * - Status changes follow the shared state machine and are written to order_status_history.
 * - The same clientRequestId twice returns the first order instead of creating another.
 */
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import {
  checkOrderTransition,
  customerCanCancel,
  deliveryChargeFor,
  depositCansFor,
  istDate,
  priceOrder,
  type OrderChannel,
  type OrderStatus,
  type TransitionActor,
} from '@wtrdrop/shared';
import type { Database, DbOrTx } from '../../db/client';
import {
  addresses,
  customers,
  deliveryWindows,
  orderItems,
  orderStatusHistory,
  orders,
  serviceAreas,
  suppliers,
  users,
} from '../../db/schema';
import { AppError, errors } from '../../lib/errors';
import { recordAudit } from '../../lib/audit';
import type { TenantContext } from '../../lib/context';
import { mainProduct, orderSettings, unitPriceFor, type OrderSettings } from './catalog.service';
import { releaseWindow, reserveWindow, windowSlots } from './windows.service';

/** Largest order the office may enter for a phone-in customer (customers are held to the setting). */
export const OFFICE_MAX_CANS = 100;

/** Cans the customer holds and how many their deposit covers (cached from the ledgers, Phase 5). */
async function canPosition(db: DbOrTx, customerId: string) {
  const [c] = await db
    .select({ held: customers.cansHeld, cover: customers.depositCoverCans })
    .from(customers)
    .where(eq(customers.id, customerId));
  return { held: c?.held ?? 0, cover: c?.cover ?? 0 };
}

async function deliverableAddress(
  db: DbOrTx,
  supplierId: string,
  customerId: string,
  addressId: string,
) {
  const [a] = await db
    .select({
      id: addresses.id,
      label: addresses.label,
      line: addresses.line,
      landmark: addresses.landmark,
      pincode: addresses.pincode,
      latitude: addresses.latitude,
      longitude: addresses.longitude,
      deliveryNote: addresses.deliveryNote,
      archivedAt: addresses.archivedAt,
      areaId: serviceAreas.id,
      areaName: serviceAreas.name,
      areaStatus: serviceAreas.status,
      areaChargePaise: serviceAreas.deliveryChargePaise,
      areaFreeAbove: serviceAreas.freeAboveCans,
    })
    .from(addresses)
    .innerJoin(serviceAreas, eq(serviceAreas.id, addresses.serviceAreaId))
    .where(
      and(
        eq(addresses.id, addressId),
        eq(addresses.customerId, customerId),
        eq(addresses.supplierId, supplierId),
      ),
    );
  if (!a || a.archivedAt) throw errors.notFound('Address');
  if (a.areaStatus !== 'active') {
    throw new AppError(
      422,
      'OUTSIDE_SERVICE_AREA',
      'Sorry, we do not deliver to this address now.',
    );
  }
  return a;
}

/** The delivery charge rule for an address's area (D-12), falling back to the settings. */
export function chargeRule(
  area: { areaChargePaise: number | null; areaFreeAbove: number | null },
  s: OrderSettings,
) {
  return {
    chargePaise: area.areaChargePaise ?? s.deliveryChargePaise,
    freeAboveCans: area.areaFreeAbove ?? s.freeDeliveryAboveCans,
  };
}

export interface QuoteInput {
  addressId: string;
  qty: number;
}

/** Prices an order for a customer and address, the same way placing it will. */
export async function quote(
  db: DbOrTx,
  supplierId: string,
  customerId: string,
  input: QuoteInput,
  channel: OrderChannel,
  now: Date,
) {
  const s = await orderSettings(db, supplierId);
  const max = channel === 'app' ? s.maxCansPerOrder : OFFICE_MAX_CANS;
  if (input.qty > max) {
    throw new AppError(422, 'QTY_ABOVE_MAX', `At most ${max} cans per order.`, { max });
  }
  const address = await deliverableAddress(db, supplierId, customerId, input.addressId);
  const product = await mainProduct(db, supplierId);
  const unit = await unitPriceFor(db, customerId, product.id, istDate(now));
  const pos = await canPosition(db, customerId);
  const depositCans = depositCansFor(input.qty, pos.held, pos.cover);
  const rule = chargeRule(address, s);
  const price = priceOrder({
    qty: input.qty,
    unitPricePaise: unit.pricePaise,
    depositPerCanPaise: s.depositPerCanPaise,
    depositCans,
    deliveryChargePaise: deliveryChargeFor(input.qty, rule.chargePaise, rule.freeAboveCans),
  });
  return {
    settings: s,
    address,
    product,
    qty: input.qty,
    unitPricePaise: unit.pricePaise,
    specialPrice: unit.special,
    depositPerCanPaise: s.depositPerCanPaise,
    depositCans,
    ...price,
  };
}

/**
 * Everything the order screen needs in one call: price, charge rule, deposit, limits, the default
 * quantity (last order, else 2: D-10) and the delivery times that can still be booked.
 */
export async function orderOptions(
  db: Database,
  supplierId: string,
  customerId: string,
  addressId: string | undefined,
  channel: OrderChannel,
  now: Date,
) {
  const s = await orderSettings(db, supplierId);
  const product = await mainProduct(db, supplierId);
  const [def] = await db
    .select({ id: addresses.id })
    .from(addresses)
    .where(
      and(
        eq(addresses.customerId, customerId),
        eq(addresses.supplierId, supplierId),
        sql`${addresses.archivedAt} is null`,
      ),
    )
    .orderBy(desc(addresses.isDefault), asc(addresses.createdAt))
    .limit(1);
  const useAddress = addressId ?? def?.id;
  const address = useAddress
    ? await deliverableAddress(db, supplierId, customerId, useAddress)
    : null;
  const unit = await unitPriceFor(db, customerId, product.id, istDate(now));
  const pos = await canPosition(db, customerId);
  const [last] = await db
    .select({ qty: orders.totalQty })
    .from(orders)
    .where(and(eq(orders.customerId, customerId), eq(orders.supplierId, supplierId)))
    .orderBy(desc(orders.createdAt))
    .limit(1);
  const max = channel === 'app' ? s.maxCansPerOrder : OFFICE_MAX_CANS;
  const slots = await windowSlots(db, supplierId, {
    now,
    days: 7,
    sameDayCutoff: s.sameDayCutoff,
    ignoreCutoff: channel === 'office',
  });
  return {
    product: { id: product.id, nameEn: product.nameEn, nameMl: product.nameMl },
    addressId: address?.id ?? null,
    unitPricePaise: unit.pricePaise,
    specialPrice: unit.special,
    depositPerCanPaise: s.depositPerCanPaise,
    cansHeld: pos.held,
    depositCoverCans: pos.cover,
    delivery: address ? chargeRule(address, s) : null,
    maxCans: max,
    defaultQty: Math.min(last?.qty ?? 2, max),
    supportPhone: s.supportPhone,
    windows: channel === 'app' ? slots.filter((x) => !x.unavailable) : slots,
  };
}

export interface PlaceInput {
  clientRequestId: string;
  addressId: string;
  windowId: string;
  date: string;
  qty: number;
  expectedTotalPaise?: number;
  note?: string;
}

export async function writeHistory(
  tx: DbOrTx,
  supplierId: string,
  orderId: string,
  from: OrderStatus | null,
  to: OrderStatus,
  actor: { userId: string | null; role: TransitionActor },
  reason?: string | null,
) {
  await tx.insert(orderStatusHistory).values({
    supplierId,
    orderId,
    fromStatus: from,
    toStatus: to,
    actorUserId: actor.userId,
    actorRole: actor.role,
    reason: reason ?? null,
  });
}

/** Places an order for `customerId`. Returns `{ created: false }` when this request was already placed. */
export async function placeOrder(
  db: Database,
  ctx: TenantContext,
  customerId: string,
  input: PlaceInput,
  channel: OrderChannel,
  now: Date,
): Promise<{ created: boolean; order: OrderDetail }> {
  const id = await db.transaction(async (tx) => {
    // One order at a time per customer: also makes the duplicate check below race-free.
    const [cust] = await tx
      .select({ id: customers.id, status: customers.status })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.supplierId, ctx.supplierId)))
      .for('update');
    if (!cust) throw errors.notFound('Customer');

    const [dup] = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(eq(orders.customerId, customerId), eq(orders.clientRequestId, input.clientRequestId)),
      );
    if (dup) return { id: dup.id, created: false };

    if (cust.status !== 'active') {
      throw new AppError(
        403,
        'ACCOUNT_DISABLED',
        'This account is switched off. Please call the office.',
      );
    }

    const q = await quote(tx, ctx.supplierId, customerId, input, channel, now);
    if (input.expectedTotalPaise !== undefined && input.expectedTotalPaise !== q.totalPaise) {
      throw new AppError(
        409,
        'PRICE_CHANGED',
        'The price has changed. Please check the new total.',
        {
          totalPaise: q.totalPaise,
          unitPricePaise: q.unitPricePaise,
          deliveryChargePaise: q.deliveryChargePaise,
          depositPaise: q.depositPaise,
        },
      );
    }
    await reserveWindow(
      tx,
      ctx.supplierId,
      { windowId: input.windowId, date: input.date, qty: input.qty },
      { now, sameDayCutoff: q.settings.sameDayCutoff, ignoreCutoff: channel === 'office' },
    );

    const [{ orderNo }] = (await tx
      .update(suppliers)
      .set({ nextOrderNo: sql`${suppliers.nextOrderNo} + 1` })
      .where(eq(suppliers.id, ctx.supplierId))
      .returning({ orderNo: sql<number>`${suppliers.nextOrderNo} - 1` })) as [{ orderNo: number }];

    const a = q.address;
    const [order] = await tx
      .insert(orders)
      .values({
        supplierId: ctx.supplierId,
        orderNo,
        customerId,
        addressId: a.id,
        addressSnapshot: {
          label: a.label,
          line: a.line,
          landmark: a.landmark,
          pincode: a.pincode,
          latitude: a.latitude,
          longitude: a.longitude,
          deliveryNote: a.deliveryNote,
          areaName: a.areaName,
        },
        serviceAreaId: a.areaId,
        windowId: input.windowId,
        deliveryDate: input.date,
        status: 'PLACED',
        channel,
        totalQty: input.qty,
        subtotalPaise: q.subtotalPaise,
        deliveryChargePaise: q.deliveryChargePaise,
        depositPaise: q.depositPaise,
        totalPaise: q.totalPaise,
        note: input.note?.trim() || null,
        clientRequestId: input.clientRequestId,
        placedBy: ctx.userId,
      })
      .returning({ id: orders.id });
    await tx.insert(orderItems).values({
      orderId: order!.id,
      productId: q.product.id,
      qtyOrdered: input.qty,
      unitPricePaise: q.unitPricePaise,
      depositPerCanPaise: q.depositPerCanPaise,
      depositCans: q.depositCans,
    });
    await writeHistory(tx, ctx.supplierId, order!.id, null, 'PLACED', {
      userId: ctx.userId,
      role: ctx.role,
    });

    // D-14: app orders are accepted automatically when the setting is on; the office accepts its own.
    const acceptBy: { userId: string | null; role: TransitionActor } | null =
      channel === 'office'
        ? { userId: ctx.userId, role: ctx.role }
        : q.settings.autoAcceptOrders
          ? { userId: null, role: 'system' }
          : null;
    if (acceptBy) {
      await tx
        .update(orders)
        .set({ status: 'ACCEPTED', updatedAt: new Date() })
        .where(eq(orders.id, order!.id));
      await writeHistory(tx, ctx.supplierId, order!.id, 'PLACED', 'ACCEPTED', acceptBy);
    }
    await recordAudit(tx, ctx, {
      action: 'order.placed',
      entityType: 'order',
      entityId: order!.id,
      after: {
        orderNo,
        channel,
        qty: input.qty,
        totalPaise: q.totalPaise,
        date: input.date,
        windowId: input.windowId,
      },
    });
    return { id: order!.id, created: true };
  });
  return { created: id.created, order: await getOrder(db, ctx.supplierId, id.id) };
}

/**
 * Moves an order to ACCEPTED, REJECTED or CANCELLED, checking the state machine for this actor.
 * Cancelling or rejecting gives the booked cans back to the delivery time.
 */
export async function transitionOrder(
  db: Database,
  ctx: TenantContext,
  orderId: string,
  to: 'ACCEPTED' | 'REJECTED' | 'CANCELLED',
  reason: string | undefined,
  opts: { onlyCustomerId?: string } = {},
) {
  await db.transaction(async (tx) => {
    const [o] = await tx
      .select({
        id: orders.id,
        status: orders.status,
        customerId: orders.customerId,
        windowId: orders.windowId,
        deliveryDate: orders.deliveryDate,
        totalQty: orders.totalQty,
        capacityHeld: orders.capacityHeld,
        orderNo: orders.orderNo,
      })
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.supplierId, ctx.supplierId)))
      .for('update');
    if (!o || (opts.onlyCustomerId && o.customerId !== opts.onlyCustomerId))
      throw errors.notFound('Order');
    const check = checkOrderTransition(o.status, to, ctx.role, reason);
    if (!check.ok) {
      if (check.code === 'REASON_REQUIRED')
        throw new AppError(422, 'REASON_REQUIRED', 'Please write a reason.');
      if (ctx.role === 'customer' && to === 'CANCELLED')
        throw new AppError(
          409,
          'TOO_LATE_TO_CANCEL',
          'This order is already on the way. Please call us.',
        );
      throw new AppError(409, 'INVALID_TRANSITION', 'This order cannot be changed that way now.', {
        status: o.status,
      });
    }
    const releases = (to === 'CANCELLED' || to === 'REJECTED') && o.capacityHeld;
    await tx
      .update(orders)
      .set({ status: to, updatedAt: new Date(), ...(releases ? { capacityHeld: false } : {}) })
      .where(eq(orders.id, o.id));
    if (releases)
      await releaseWindow(tx, { windowId: o.windowId, date: o.deliveryDate, qty: o.totalQty });
    await writeHistory(
      tx,
      ctx.supplierId,
      o.id,
      o.status,
      to,
      { userId: ctx.userId, role: ctx.role },
      reason?.trim(),
    );
    await recordAudit(tx, ctx, {
      action: `order.${to.toLowerCase()}`,
      entityType: 'order',
      entityId: o.id,
      before: { status: o.status },
      after: { status: to, reason: reason?.trim() || null },
    });
  });
  return getOrder(db, ctx.supplierId, orderId);
}

export async function bulkAccept(db: Database, ctx: TenantContext, ids: string[]) {
  const accepted: string[] = [];
  const skipped: { id: string; code: string }[] = [];
  for (const id of ids) {
    try {
      await transitionOrder(db, ctx, id, 'ACCEPTED', undefined);
      accepted.push(id);
    } catch (e) {
      skipped.push({ id, code: e instanceof AppError ? e.code : 'INTERNAL_ERROR' });
    }
  }
  return { accepted: accepted.length, skipped };
}

// ---------------------------------------------------------------- reading

const listColumns = {
  id: orders.id,
  orderNo: orders.orderNo,
  status: orders.status,
  channel: orders.channel,
  deliveryDate: orders.deliveryDate,
  windowId: orders.windowId,
  windowNameEn: deliveryWindows.nameEn,
  windowNameMl: deliveryWindows.nameMl,
  windowStart: deliveryWindows.startTime,
  windowEnd: deliveryWindows.endTime,
  qty: orders.totalQty,
  totalPaise: orders.totalPaise,
  createdAt: orders.createdAt,
};

export type OrderDetail = Awaited<ReturnType<typeof getOrder>>;

export async function getOrder(db: DbOrTx, supplierId: string, orderId: string) {
  const [o] = await db
    .select({
      ...listColumns,
      customerId: orders.customerId,
      customerName: users.name,
      customerPhone: users.phone,
      address: orders.addressSnapshot,
      areaId: orders.serviceAreaId,
      subtotalPaise: orders.subtotalPaise,
      deliveryChargePaise: orders.deliveryChargePaise,
      depositPaise: orders.depositPaise,
      note: orders.note,
    })
    .from(orders)
    .innerJoin(deliveryWindows, eq(deliveryWindows.id, orders.windowId))
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(and(eq(orders.id, orderId), eq(orders.supplierId, supplierId)));
  if (!o) throw errors.notFound('Order');
  const [items, history] = await Promise.all([
    db
      .select({
        productId: orderItems.productId,
        qtyOrdered: orderItems.qtyOrdered,
        qtyDelivered: orderItems.qtyDelivered,
        unitPricePaise: orderItems.unitPricePaise,
        depositPerCanPaise: orderItems.depositPerCanPaise,
        depositCans: orderItems.depositCans,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId)),
    db
      .select({
        from: orderStatusHistory.fromStatus,
        to: orderStatusHistory.toStatus,
        actorRole: orderStatusHistory.actorRole,
        actorName: users.name,
        reason: orderStatusHistory.reason,
        at: orderStatusHistory.at,
      })
      .from(orderStatusHistory)
      .leftJoin(users, eq(users.id, orderStatusHistory.actorUserId))
      .where(eq(orderStatusHistory.orderId, orderId))
      .orderBy(asc(orderStatusHistory.id)),
  ]);
  return { ...o, canCancel: customerCanCancel(o.status), items, history };
}

/** The customer's own orders, newest first. */
export async function listCustomerOrders(db: Database, supplierId: string, customerId: string) {
  const rows = await db
    .select({ ...listColumns, address: orders.addressSnapshot })
    .from(orders)
    .innerJoin(deliveryWindows, eq(deliveryWindows.id, orders.windowId))
    .where(and(eq(orders.customerId, customerId), eq(orders.supplierId, supplierId)))
    .orderBy(desc(orders.createdAt))
    .limit(50);
  return rows.map((r) => ({ ...r, canCancel: customerCanCancel(r.status) }));
}

/** Office list: one delivery date (default today), optionally filtered and searched. */
export async function listOfficeOrders(
  db: Database,
  supplierId: string,
  f: { date: string; status?: OrderStatus[]; q?: string; customerId?: string },
) {
  const where: (SQL | undefined)[] = [eq(orders.supplierId, supplierId)];
  if (f.customerId) where.push(eq(orders.customerId, f.customerId));
  else where.push(eq(orders.deliveryDate, f.date));
  if (f.status?.length) where.push(inArray(orders.status, f.status));
  const q = f.q?.trim();
  if (q) {
    const digits = q.replace(/\D/g, '');
    const no = Number(q.replace(/^WD-?/i, ''));
    where.push(
      or(
        ilike(users.name, `%${q}%`),
        ilike(serviceAreas.name, `%${q}%`),
        digits.length >= 4 ? ilike(users.phone, `%${digits}`) : undefined,
        Number.isInteger(no) && no > 0 ? eq(orders.orderNo, no) : undefined,
      ),
    );
  }
  const rows = await db
    .select({
      ...listColumns,
      customerId: orders.customerId,
      customerName: users.name,
      customerPhone: users.phone,
      areaName: serviceAreas.name,
      areaNameMl: serviceAreas.nameMl,
      landmark: sql<string>`${orders.addressSnapshot}->>'landmark'`,
    })
    .from(orders)
    .innerJoin(deliveryWindows, eq(deliveryWindows.id, orders.windowId))
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .innerJoin(serviceAreas, eq(serviceAreas.id, orders.serviceAreaId))
    .where(and(...where))
    .orderBy(asc(deliveryWindows.startTime), asc(serviceAreas.name), asc(orders.orderNo))
    .limit(500);
  // The list shows only the last 4 digits; the full number is on the order and customer pages.
  return rows.map(({ customerPhone, ...r }) => ({ ...r, phoneLast4: customerPhone.slice(-4) }));
}
