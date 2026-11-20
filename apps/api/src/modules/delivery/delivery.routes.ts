import { Router } from 'express';
import { z } from 'zod';
import {
  deliverInputSchema,
  endTripInputSchema,
  isoDateSchema,
  istDate,
  notDeliveredInputSchema,
  startTripInputSchema,
} from '@wtrdrop/shared';
import type { Database } from '../../db/client';
import { requireRole, tenant } from '../../middleware/auth';
import { idempotency } from '../../middleware/idempotency';
import { parse } from '../../middleware/validate';
import { ownCustomerId } from '../customers/customers.service';
import type { Clock } from '../ordering/ordering.routes';
import { getOrder } from '../ordering/orders.service';
import {
  assignOrders,
  deliver,
  endTrip,
  moveTrip,
  notDelivered,
  officeDay,
  reconcileTrip,
  rescheduleOrder,
  sequenceTrip,
  staffDay,
  startTrip,
  tripsToReconcile,
  undoAttempt,
  unassignOrders,
} from './delivery.service';
import { customerLedgers } from './ledgers';
import { recordStock, stockSummary } from './stock.service';

const idParam = z.object({ id: z.uuid() });
const ids = z.array(z.uuid()).min(1).max(200);

export function deliveryRoutes(db: Database, clock: Clock): Router {
  const r = Router();
  const staff = requireRole('staff');
  const office = requireRole('admin', 'owner');
  const customer = requireRole('customer');

  // ---------------------------------------------------------------- delivery person
  // Offline actions carry their own clientActionId, so a replay returns the first result.
  r.get('/staff/day', staff, async (req, res) => {
    const { date } = parse(z.object({ date: isoDateSchema.optional() }), req.query);
    res.json(await staffDay(db, tenant(req), date ?? istDate(clock()), clock()));
  });
  r.post('/staff/trips/:id/start', staff, async (req, res) => {
    const { id } = parse(idParam, req.params);
    const input = parse(startTripInputSchema, req.body);
    await startTrip(db, tenant(req), id, input.loadFull);
    res.json({ ok: true });
  });
  r.post('/staff/orders/:id/deliver', staff, async (req, res) => {
    const { id } = parse(idParam, req.params);
    const attempt = await deliver(
      db,
      tenant(req),
      id,
      parse(deliverInputSchema, req.body),
      clock(),
    );
    res.json({ attempt });
  });
  r.post('/staff/orders/:id/not-delivered', staff, async (req, res) => {
    const { id } = parse(idParam, req.params);
    const attempt = await notDelivered(
      db,
      tenant(req),
      id,
      parse(notDeliveredInputSchema, req.body),
      clock(),
    );
    res.json({ attempt });
  });
  r.post('/staff/attempts/:id/undo', staff, async (req, res) => {
    const { id } = parse(idParam, req.params);
    await undoAttempt(db, tenant(req), id, clock());
    res.json({ ok: true });
  });
  r.post('/staff/trips/:id/end', staff, async (req, res) => {
    const { id } = parse(idParam, req.params);
    await endTrip(db, tenant(req), id, parse(endTripInputSchema, req.body));
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- customer
  r.get('/customer/account', customer, async (req, res) => {
    const ctx = tenant(req);
    const { balances } = await customerLedgers(db, ctx.supplierId, await ownCustomerId(db, ctx));
    res.json({
      cansHeld: balances.cansHeld,
      depositHeldPaise: balances.depositHeldPaise,
      balancePaise: balances.balancePaise,
    });
  });

  // ---------------------------------------------------------------- office
  r.get('/admin/deliveries', office, async (req, res) => {
    const { date } = parse(z.object({ date: isoDateSchema.optional() }), req.query);
    const ctx = tenant(req);
    res.json({
      ...(await officeDay(db, ctx.supplierId, date ?? istDate(clock()))),
      toReconcile: await tripsToReconcile(db, ctx.supplierId),
    });
  });
  r.post('/admin/deliveries/assign', office, idempotency(db), async (req, res) => {
    const input = parse(
      z.object({ date: isoDateSchema, staffUserId: z.uuid(), orderIds: ids }),
      req.body,
    );
    res.json(
      await assignOrders(db, tenant(req), { ...input, orderIds: [...new Set(input.orderIds)] }),
    );
  });
  r.post('/admin/deliveries/unassign', office, idempotency(db), async (req, res) => {
    const { orderIds } = parse(z.object({ orderIds: ids }), req.body);
    res.json(await unassignOrders(db, tenant(req), orderIds));
  });
  r.put('/admin/trips/:id/sequence', office, async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { orderIds } = parse(z.object({ orderIds: ids }), req.body);
    await sequenceTrip(db, tenant(req), id, orderIds);
    res.json({ ok: true });
  });
  r.post('/admin/trips/:id/move', office, idempotency(db), async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { staffUserId } = parse(z.object({ staffUserId: z.uuid() }), req.body);
    res.json(await moveTrip(db, tenant(req), id, staffUserId));
  });
  r.post('/admin/trips/:id/reconcile', office, idempotency(db), async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { note } = parse(z.object({ note: z.string().trim().max(300).optional() }), req.body);
    await reconcileTrip(db, tenant(req), id, note);
    res.json({ ok: true });
  });
  r.post('/admin/orders/:id/reschedule', office, idempotency(db), async (req, res) => {
    const { id } = parse(idParam, req.params);
    const slot = parse(z.object({ date: isoDateSchema, windowId: z.uuid() }), req.body);
    const ctx = tenant(req);
    await rescheduleOrder(db, ctx, id, slot, clock());
    res.json({ order: await getOrder(db, ctx.supplierId, id) });
  });
  r.get('/admin/customers/:id/ledgers', office, async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.json(await customerLedgers(db, tenant(req).supplierId, id));
  });
  r.get('/admin/stock', office, async (req, res) => {
    res.json(await stockSummary(db, tenant(req).supplierId));
  });
  r.post('/admin/stock', office, idempotency(db), async (req, res) => {
    const qty = z.number().int().min(1).max(100_000);
    const count = z.number().int().min(0).max(100_000);
    const note = z.string().trim().max(300);
    const action = parse(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('filled'), qty, note: note.optional() }),
        z.object({
          kind: z.literal('bought'),
          qty,
          state: z.enum(['full', 'empty']),
          note: note.optional(),
        }),
        z.object({ kind: z.literal('discarded'), qty, note: note.min(3) }),
        z.object({
          kind: z.literal('count'),
          full: count,
          empty: count,
          damaged: count,
          note: note.min(3),
        }),
      ]),
      req.body,
    );
    res.json(await recordStock(db, tenant(req), action));
  });
  return r;
}
