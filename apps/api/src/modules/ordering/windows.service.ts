/**
 * Delivery windows, capacity and closed days (D-07, D-08, M-12).
 * Capacity is counted in cans per window per date and reserved when an order is placed (R-05),
 * with a single conditional UPDATE so two people can never book the same last cans.
 */
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import {
  addDays,
  dayOfWeek,
  istDate,
  istMinutes,
  minutesOf,
  windowOpenForBooking,
} from '@wtrdrop/shared';
import type { Database, DbOrTx } from '../../db/client';
import { closedDays, deliveryWindows, orders, windowBookings } from '../../db/schema';
import { AppError, errors } from '../../lib/errors';
import { recordAudit } from '../../lib/audit';
import type { TenantContext } from '../../lib/context';

export const windowColumns = {
  id: deliveryWindows.id,
  nameEn: deliveryWindows.nameEn,
  nameMl: deliveryWindows.nameMl,
  startTime: deliveryWindows.startTime,
  endTime: deliveryWindows.endTime,
  capacityCans: deliveryWindows.capacityCans,
  daysOfWeek: deliveryWindows.daysOfWeek,
  status: deliveryWindows.status,
};
export type DeliveryWindow = {
  id: string;
  nameEn: string;
  nameMl: string;
  startTime: string;
  endTime: string;
  capacityCans: number;
  daysOfWeek: number[];
  status: 'active' | 'disabled';
};

export async function listWindows(db: DbOrTx, supplierId: string, activeOnly = false) {
  return db
    .select(windowColumns)
    .from(deliveryWindows)
    .where(
      and(
        eq(deliveryWindows.supplierId, supplierId),
        activeOnly ? eq(deliveryWindows.status, 'active') : undefined,
      ),
    )
    .orderBy(asc(deliveryWindows.startTime));
}

export type Unavailable = 'CLOSED' | 'TOO_LATE' | 'FULL';

export interface WindowSlot {
  date: string;
  windowId: string;
  nameEn: string;
  nameMl: string;
  startTime: string;
  endTime: string;
  capacityCans: number;
  reservedCans: number;
  remainingCans: number;
  /** Why it cannot be booked; absent when it can. */
  unavailable?: Unavailable;
  closedReason?: string;
}

/**
 * Every active window on each day from `from` for `days` days (days the window does not run are
 * left out). `ignoreCutoff` is for the office taking a phone order: today's windows stay open
 * after the customer cut-off and after they start, until they end; closed days and capacity
 * still apply.
 */
export async function windowSlots(
  db: DbOrTx,
  supplierId: string,
  opts: { now: Date; from?: string; days: number; sameDayCutoff: string; ignoreCutoff?: boolean },
): Promise<WindowSlot[]> {
  const today = istDate(opts.now);
  const from = opts.from ?? today;
  const to = addDays(from, opts.days - 1);
  const windows = await listWindows(db, supplierId, true);
  if (!windows.length) return [];
  const [bookings, closed] = await Promise.all([
    db
      .select({
        windowId: windowBookings.windowId,
        date: windowBookings.date,
        capacityCans: windowBookings.capacityCans,
        reservedCans: windowBookings.reservedCans,
      })
      .from(windowBookings)
      .where(
        and(
          eq(windowBookings.supplierId, supplierId),
          gte(windowBookings.date, from),
          lte(windowBookings.date, to),
        ),
      ),
    db
      .select({ date: closedDays.date, windowId: closedDays.windowId, reason: closedDays.reason })
      .from(closedDays)
      .where(
        and(
          eq(closedDays.supplierId, supplierId),
          gte(closedDays.date, from),
          lte(closedDays.date, to),
        ),
      ),
  ]);

  const out: WindowSlot[] = [];
  for (let i = 0; i < opts.days; i++) {
    const date = addDays(from, i);
    const dow = dayOfWeek(date);
    for (const w of windows) {
      if (!w.daysOfWeek.includes(dow)) continue;
      const b = bookings.find((x) => x.windowId === w.id && x.date === date);
      const capacityCans = b?.capacityCans ?? w.capacityCans;
      const reservedCans = b?.reservedCans ?? 0;
      const remainingCans = Math.max(0, capacityCans - reservedCans);
      const shut = closed.find(
        (c) => c.date === date && (c.windowId === null || c.windowId === w.id),
      );
      const slot: WindowSlot = {
        date,
        windowId: w.id,
        nameEn: w.nameEn,
        nameMl: w.nameMl,
        startTime: w.startTime,
        endTime: w.endTime,
        capacityCans,
        reservedCans,
        remainingCans,
      };
      const late =
        date < today ||
        (opts.ignoreCutoff
          ? date === today && istMinutes(opts.now) >= minutesOf(w.endTime)
          : !windowOpenForBooking({
              date,
              now: opts.now,
              windowStart: w.startTime,
              sameDayCutoff: opts.sameDayCutoff,
            }));
      if (shut) {
        slot.unavailable = 'CLOSED';
        slot.closedReason = shut.reason;
      } else if (late) slot.unavailable = 'TOO_LATE';
      else if (remainingCans <= 0) slot.unavailable = 'FULL';
      out.push(slot);
    }
  }
  return out;
}

/** Checks one window on one date can take `qty` more cans, then reserves them atomically. */
export async function reserveWindow(
  tx: DbOrTx,
  supplierId: string,
  slot: { windowId: string; date: string; qty: number },
  check: { now: Date; sameDayCutoff: string; ignoreCutoff: boolean },
) {
  const [s] = await windowSlots(tx, supplierId, {
    now: check.now,
    from: slot.date,
    days: 1,
    sameDayCutoff: check.sameDayCutoff,
    ignoreCutoff: check.ignoreCutoff,
  }).then((all) => all.filter((x) => x.windowId === slot.windowId));
  if (!s) throw new AppError(422, 'WINDOW_NOT_AVAILABLE', 'This delivery time is not available.');
  if (s.unavailable === 'CLOSED')
    throw new AppError(422, 'DAY_CLOSED', 'We do not deliver at this time.', {
      reason: s.closedReason,
    });
  if (s.unavailable === 'TOO_LATE')
    throw new AppError(422, 'TOO_LATE_FOR_WINDOW', 'It is too late to book this delivery time.');

  await tx
    .insert(windowBookings)
    .values({ supplierId, windowId: slot.windowId, date: slot.date })
    .onConflictDoNothing();
  const updated = await tx.execute(sql`
    update window_bookings b
       set reserved_cans = b.reserved_cans + ${slot.qty}, updated_at = now()
      from delivery_windows w
     where w.id = b.window_id
       and b.window_id = ${slot.windowId}
       and b.date = ${slot.date}
       and b.reserved_cans + ${slot.qty} <= coalesce(b.capacity_cans, w.capacity_cans)
    returning b.reserved_cans`);
  if (updated.rows.length === 0) {
    throw new AppError(409, 'WINDOW_FULL', 'This delivery time is full. Please choose another.', {
      remainingCans: s.remainingCans,
    });
  }
}

export async function releaseWindow(
  tx: DbOrTx,
  slot: { windowId: string; date: string; qty: number },
) {
  await tx
    .update(windowBookings)
    .set({
      reservedCans: sql`${windowBookings.reservedCans} - ${slot.qty}`,
      updatedAt: new Date(),
    })
    .where(and(eq(windowBookings.windowId, slot.windowId), eq(windowBookings.date, slot.date)));
}

// ---------------------------------------------------------------- office settings

export interface WindowInput {
  nameEn: string;
  nameMl: string;
  startTime: string;
  endTime: string;
  capacityCans: number;
  daysOfWeek: number[];
  status?: 'active' | 'disabled';
}

function assertTimes(start: string, end: string) {
  if (start >= end) throw new AppError(422, 'WINDOW_TIMES', 'The window must end after it starts.');
}

export async function createWindow(db: Database, ctx: TenantContext, input: WindowInput) {
  assertTimes(input.startTime, input.endTime);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(deliveryWindows)
      .values({
        ...input,
        daysOfWeek: [...new Set(input.daysOfWeek)].sort(),
        supplierId: ctx.supplierId,
      })
      .onConflictDoNothing()
      .returning(windowColumns);
    if (!row)
      throw errors.conflict('WINDOW_NAME_TAKEN', 'A delivery time with this name already exists.');
    await recordAudit(tx, ctx, {
      action: 'window.created',
      entityType: 'delivery_window',
      entityId: row.id,
      after: row,
    });
    return row;
  });
}

export async function updateWindow(
  db: Database,
  ctx: TenantContext,
  id: string,
  input: Partial<WindowInput>,
) {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select(windowColumns)
      .from(deliveryWindows)
      .where(and(eq(deliveryWindows.id, id), eq(deliveryWindows.supplierId, ctx.supplierId)))
      .for('update');
    if (!before) throw errors.notFound('Delivery time');
    const next = { ...before, ...input };
    assertTimes(next.startTime, next.endTime);
    const [after] = await tx
      .update(deliveryWindows)
      .set({
        nameEn: next.nameEn,
        nameMl: next.nameMl,
        startTime: next.startTime,
        endTime: next.endTime,
        capacityCans: next.capacityCans,
        daysOfWeek: [...new Set(next.daysOfWeek)].sort(),
        status: next.status,
        updatedAt: new Date(),
      })
      .where(eq(deliveryWindows.id, id))
      .returning(windowColumns);
    await recordAudit(tx, ctx, {
      action: 'window.updated',
      entityType: 'delivery_window',
      entityId: id,
      before,
      after,
    });
    return after!;
  });
}

/** A different capacity for one window on one date (null returns to the default). */
export async function setDateCapacity(
  db: Database,
  ctx: TenantContext,
  windowId: string,
  date: string,
  capacityCans: number | null,
) {
  return db.transaction(async (tx) => {
    const [w] = await tx
      .select({ id: deliveryWindows.id })
      .from(deliveryWindows)
      .where(and(eq(deliveryWindows.id, windowId), eq(deliveryWindows.supplierId, ctx.supplierId)));
    if (!w) throw errors.notFound('Delivery time');
    await tx
      .insert(windowBookings)
      .values({ supplierId: ctx.supplierId, windowId, date, capacityCans })
      .onConflictDoUpdate({
        target: [windowBookings.windowId, windowBookings.date],
        set: { capacityCans, updatedAt: new Date() },
      });
    await recordAudit(tx, ctx, {
      action: 'window.capacity_set',
      entityType: 'delivery_window',
      entityId: windowId,
      after: { date, capacityCans },
    });
    return { windowId, date, capacityCans };
  });
}

const OPEN_STATUSES = ['PLACED', 'ACCEPTED', 'ASSIGNED', 'RESCHEDULE_PENDING'] as const;

export async function listClosedDays(db: Database, supplierId: string, from: string) {
  return db
    .select({
      id: closedDays.id,
      date: closedDays.date,
      windowId: closedDays.windowId,
      reason: closedDays.reason,
    })
    .from(closedDays)
    .where(and(eq(closedDays.supplierId, supplierId), gte(closedDays.date, from)))
    .orderBy(asc(closedDays.date));
}

/**
 * Closes a day or one window (rain, festival). Orders already booked are not cancelled
 * automatically: the office is told how many there are so they can call those customers.
 */
export async function closeDay(
  db: Database,
  ctx: TenantContext,
  input: { date: string; windowId: string | null; reason: string },
  now: Date,
) {
  if (input.date < istDate(now))
    throw new AppError(422, 'DATE_IN_PAST', 'Choose today or a later date.');
  return db.transaction(async (tx) => {
    if (input.windowId) {
      const [w] = await tx
        .select({ id: deliveryWindows.id })
        .from(deliveryWindows)
        .where(
          and(
            eq(deliveryWindows.id, input.windowId),
            eq(deliveryWindows.supplierId, ctx.supplierId),
          ),
        );
      if (!w) throw errors.notFound('Delivery time');
    }
    const [row] = await tx
      .insert(closedDays)
      .values({ supplierId: ctx.supplierId, ...input, createdBy: ctx.userId })
      .onConflictDoNothing()
      .returning({
        id: closedDays.id,
        date: closedDays.date,
        windowId: closedDays.windowId,
        reason: closedDays.reason,
      });
    if (!row) throw errors.conflict('ALREADY_CLOSED', 'This day is already closed.');
    const affected = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.supplierId, ctx.supplierId),
          eq(orders.deliveryDate, input.date),
          inArray(orders.status, [...OPEN_STATUSES]),
          input.windowId ? eq(orders.windowId, input.windowId) : undefined,
        ),
      );
    await recordAudit(tx, ctx, {
      action: 'closed_day.created',
      entityType: 'closed_day',
      entityId: row.id,
      after: row,
    });
    return { ...row, ordersAlreadyBooked: affected.length };
  });
}

export async function reopenDay(db: Database, ctx: TenantContext, id: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .delete(closedDays)
      .where(and(eq(closedDays.id, id), eq(closedDays.supplierId, ctx.supplierId)))
      .returning({
        id: closedDays.id,
        date: closedDays.date,
        windowId: closedDays.windowId,
        reason: closedDays.reason,
      });
    if (!row) throw errors.notFound('Closed day');
    await recordAudit(tx, ctx, {
      action: 'closed_day.removed',
      entityType: 'closed_day',
      entityId: id,
      before: row,
    });
    return row;
  });
}
