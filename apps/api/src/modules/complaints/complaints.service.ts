/**
 * Complaints (Phase 0 §11 #13, kept simple): a customer picks a problem (and an order) in the app,
 * or the office notes one after a call. The office resolves it with a short note, which the
 * customer is told about.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type { ComplaintCategory, ComplaintInput, ComplaintStatus } from '@wtrdrop/shared';
import type { Database, DbOrTx } from '../../db/client';
import { complaints, customers, orders, users } from '../../db/schema';
import { AppError, errors } from '../../lib/errors';
import { recordAudit } from '../../lib/audit';
import type { TenantContext } from '../../lib/context';
import { queueNotification } from '../notifications/notifications.service';

const columns = {
  id: complaints.id,
  customerId: complaints.customerId,
  customerName: users.name,
  phoneLast4: sql<string>`right(${users.phone}, 4)`,
  orderId: complaints.orderId,
  orderNo: orders.orderNo,
  category: complaints.category,
  note: complaints.note,
  status: complaints.status,
  resolution: complaints.resolution,
  resolvedAt: complaints.resolvedAt,
  createdAt: complaints.createdAt,
};

async function one(db: DbOrTx, supplierId: string, id: string) {
  const [c] = await db
    .select(columns)
    .from(complaints)
    .innerJoin(customers, eq(customers.id, complaints.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .leftJoin(orders, eq(orders.id, complaints.orderId))
    .where(and(eq(complaints.id, id), eq(complaints.supplierId, supplierId)));
  if (!c) throw errors.notFound('Complaint');
  return c;
}

/** Saves a complaint once per `clientRequestId`. The order, if given, must be this customer's. */
export async function createComplaint(
  db: Database,
  ctx: TenantContext,
  customerId: string,
  input: ComplaintInput,
) {
  const id = await db.transaction(async (tx) => {
    // Locking the customer first makes a double tap wait, then find the first complaint.
    const [c] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.supplierId, ctx.supplierId)))
      .for('update');
    if (!c) throw errors.notFound('Customer');
    const [same] = await tx
      .select({ id: complaints.id, customerId: complaints.customerId })
      .from(complaints)
      .where(
        and(
          eq(complaints.supplierId, ctx.supplierId),
          eq(complaints.clientRequestId, input.clientRequestId),
        ),
      );
    if (same) {
      if (same.customerId !== customerId)
        throw new AppError(409, 'REQUEST_REUSED', 'This request id was already used.');
      return same.id;
    }
    if (input.orderId) {
      const [o] = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(
          and(
            eq(orders.id, input.orderId),
            eq(orders.customerId, customerId),
            eq(orders.supplierId, ctx.supplierId),
          ),
        );
      if (!o) throw errors.notFound('Order');
    }
    const [row] = await tx
      .insert(complaints)
      .values({
        supplierId: ctx.supplierId,
        customerId,
        orderId: input.orderId ?? null,
        category: input.category,
        note: input.note || null,
        clientRequestId: input.clientRequestId,
      })
      .returning({ id: complaints.id });
    await recordAudit(tx, ctx, {
      action: 'complaint.created',
      entityType: 'complaint',
      entityId: row!.id,
      after: { customerId, category: input.category, orderId: input.orderId ?? null },
    });
    return row!.id;
  });
  return one(db, ctx.supplierId, id);
}

export async function listComplaints(
  db: Database,
  supplierId: string,
  q: { status?: ComplaintStatus; customerId?: string },
) {
  const rows = await db
    .select(columns)
    .from(complaints)
    .innerJoin(customers, eq(customers.id, complaints.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .leftJoin(orders, eq(orders.id, complaints.orderId))
    .where(
      and(
        eq(complaints.supplierId, supplierId),
        q.status ? eq(complaints.status, q.status) : undefined,
        q.customerId ? eq(complaints.customerId, q.customerId) : undefined,
      ),
    )
    .orderBy(desc(complaints.createdAt))
    .limit(200);
  return rows;
}

export async function resolveComplaint(
  db: Database,
  ctx: TenantContext,
  id: string,
  resolution: string,
  now: Date,
) {
  await db.transaction(async (tx) => {
    const [c] = await tx
      .select({
        status: complaints.status,
        category: complaints.category,
        orderId: complaints.orderId,
        userId: customers.userId,
      })
      .from(complaints)
      .innerJoin(customers, eq(customers.id, complaints.customerId))
      .where(and(eq(complaints.id, id), eq(complaints.supplierId, ctx.supplierId)))
      .for('update', { of: complaints });
    if (!c) throw errors.notFound('Complaint');
    if (c.status === 'resolved')
      throw new AppError(409, 'ALREADY_RESOLVED', 'This complaint is already resolved.');
    await tx
      .update(complaints)
      .set({ status: 'resolved', resolution, resolvedBy: ctx.userId, resolvedAt: now })
      .where(eq(complaints.id, id));
    await queueNotification(tx, {
      supplierId: ctx.supplierId,
      userId: c.userId,
      kind: 'complaint_resolved',
      params: { category: c.category as ComplaintCategory, resolution },
      orderId: c.orderId,
    });
    await recordAudit(tx, ctx, {
      action: 'complaint.resolved',
      entityType: 'complaint',
      entityId: id,
      before: { status: 'open' },
      after: { status: 'resolved', resolution },
    });
  });
  return one(db, ctx.supplierId, id);
}
