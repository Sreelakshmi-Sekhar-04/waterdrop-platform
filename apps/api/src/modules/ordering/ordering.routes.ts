import { Router } from 'express';
import { z } from 'zod';
import {
  ORDER_STATUSES,
  customerOrderInputSchema,
  isoDateSchema,
  istDate,
  timeOfDaySchema,
} from '@wtrdrop/shared';
import type { Database } from '../../db/client';
import { requireRole, tenant } from '../../middleware/auth';
import { idempotency } from '../../middleware/idempotency';
import { parse } from '../../middleware/validate';
import { getCustomer, ownCustomerId } from '../customers/customers.service';
import {
  catalogForOffice,
  customerPriceInfo,
  orderSettings,
  setCustomerPrice,
  setStandardPrice,
} from './catalog.service';
import {
  OFFICE_MAX_CANS,
  bulkAccept,
  getOrder,
  listCustomerOrders,
  listOfficeOrders,
  orderOptions,
  placeOrder,
  transitionOrder,
} from './orders.service';
import {
  closeDay,
  createWindow,
  listClosedDays,
  listWindows,
  reopenDay,
  setDateCapacity,
  updateWindow,
  windowSlots,
} from './windows.service';
import { errors } from '../../lib/errors';

export type Clock = () => Date;

const idParam = z.object({ id: z.string().uuid() });
const reasonSchema = z.string().trim().min(3, 'Write a short reason').max(300);
const windowInput = z.object({
  nameEn: z.string().trim().min(1).max(40),
  nameMl: z.string().trim().min(1).max(40),
  startTime: timeOfDaySchema,
  endTime: timeOfDaySchema,
  capacityCans: z.number().int().min(0).max(10_000),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  status: z.enum(['active', 'disabled']).optional(),
});

export function orderingRoutes(db: Database, clock: Clock): Router {
  const r = Router();
  const customer = requireRole('customer');
  const office = requireRole('admin', 'owner');
  const owner = requireRole('owner');

  // ---------------------------------------------------------------- customer app
  r.get('/customer/order-options', customer, async (req, res) => {
    const { addressId } = parse(z.object({ addressId: z.string().uuid().optional() }), req.query);
    const ctx = tenant(req);
    const customerId = await ownCustomerId(db, ctx);
    res.json(await orderOptions(db, ctx.supplierId, customerId, addressId, 'app', clock()));
  });

  r.post('/customer/orders', customer, idempotency(db), async (req, res) => {
    const input = parse(customerOrderInputSchema, req.body);
    const ctx = tenant(req);
    const customerId = await ownCustomerId(db, ctx);
    const out = await placeOrder(db, ctx, customerId, input, 'app', clock());
    res.status(out.created ? 201 : 200).json({ order: out.order });
  });

  r.get('/customer/orders', customer, async (req, res) => {
    const ctx = tenant(req);
    const customerId = await ownCustomerId(db, ctx);
    res.json({ orders: await listCustomerOrders(db, ctx.supplierId, customerId) });
  });

  r.get('/customer/orders/:id', customer, async (req, res) => {
    const { id } = parse(idParam, req.params);
    const ctx = tenant(req);
    const customerId = await ownCustomerId(db, ctx);
    const order = await getOrder(db, ctx.supplierId, id);
    if (order.customerId !== customerId) throw errors.notFound('Order');
    res.json({ order });
  });

  r.post('/customer/orders/:id/cancel', customer, idempotency(db), async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { reason } = parse(
      z.object({ reason: z.string().trim().max(300).optional() }),
      req.body ?? {},
    );
    const ctx = tenant(req);
    const customerId = await ownCustomerId(db, ctx);
    res.json({
      order: await transitionOrder(db, ctx, id, 'CANCELLED', reason, {
        onlyCustomerId: customerId,
      }),
    });
  });

  // ---------------------------------------------------------------- office: orders
  r.get('/admin/orders', office, async (req, res) => {
    const f = parse(
      z.object({
        date: isoDateSchema.optional(),
        status: z
          .string()
          .optional()
          .transform((v) => (v ? v.split(',') : undefined))
          .pipe(z.array(z.enum(ORDER_STATUSES)).optional()),
        q: z.string().max(60).optional(),
        customerId: z.string().uuid().optional(),
      }),
      req.query,
    );
    const ctx = tenant(req);
    res.json({
      orders: await listOfficeOrders(db, ctx.supplierId, {
        ...f,
        date: f.date ?? istDate(clock()),
      }),
    });
  });

  r.get('/admin/orders/:id', office, async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.json({ order: await getOrder(db, tenant(req).supplierId, id) });
  });

  r.get('/admin/customers/:id/order-options', office, async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { addressId } = parse(z.object({ addressId: z.string().uuid().optional() }), req.query);
    const ctx = tenant(req);
    await getCustomer(db, ctx.supplierId, id);
    res.json(await orderOptions(db, ctx.supplierId, id, addressId, 'office', clock()));
  });

  /** M-01: an order for a customer who phoned or sent a WhatsApp message. */
  r.post('/admin/orders', office, idempotency(db), async (req, res) => {
    const input = parse(
      customerOrderInputSchema.extend({
        customerId: z.string().uuid(),
        qty: z.number().int().min(1).max(OFFICE_MAX_CANS),
        expectedTotalPaise: z.number().int().min(0).optional(),
      }),
      req.body,
    );
    const ctx = tenant(req);
    await getCustomer(db, ctx.supplierId, input.customerId); // 404 for another supplier's customer
    const out = await placeOrder(db, ctx, input.customerId, input, 'office', clock());
    res.status(out.created ? 201 : 200).json({ order: out.order });
  });

  r.post('/admin/orders/:id/transition', office, idempotency(db), async (req, res) => {
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.discriminatedUnion('to', [
        z.object({ to: z.literal('ACCEPTED') }),
        // The office always says why, so the customer can be told.
        z.object({ to: z.literal('REJECTED'), reason: reasonSchema }),
        z.object({ to: z.literal('CANCELLED'), reason: reasonSchema }),
      ]),
      req.body,
    );
    const reason = 'reason' in body ? body.reason : undefined;
    res.json({ order: await transitionOrder(db, tenant(req), id, body.to, reason) });
  });

  r.post('/admin/orders/bulk-accept', office, idempotency(db), async (req, res) => {
    const { ids } = parse(z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }), req.body);
    res.json(await bulkAccept(db, tenant(req), [...new Set(ids)]));
  });

  // ---------------------------------------------------------------- office: delivery times
  r.get('/admin/windows', office, async (req, res) => {
    res.json({ windows: await listWindows(db, tenant(req).supplierId) });
  });
  r.post('/admin/windows', office, idempotency(db), async (req, res) => {
    res
      .status(201)
      .json({ window: await createWindow(db, tenant(req), parse(windowInput, req.body)) });
  });
  r.patch('/admin/windows/:id', office, idempotency(db), async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.json({
      window: await updateWindow(db, tenant(req), id, parse(windowInput.partial(), req.body)),
    });
  });
  r.put('/admin/windows/:id/capacity/:date', office, async (req, res) => {
    const { id, date } = parse(
      z.object({ id: z.string().uuid(), date: isoDateSchema }),
      req.params,
    );
    const { capacityCans } = parse(
      z.object({ capacityCans: z.number().int().min(0).max(10_000).nullable() }),
      req.body,
    );
    res.json(await setDateCapacity(db, tenant(req), id, date, capacityCans));
  });

  /** Booked and free cans per delivery time, for the Orders page and Settings. */
  r.get('/admin/window-slots', office, async (req, res) => {
    const q = parse(
      z.object({
        from: isoDateSchema.optional(),
        days: z.coerce.number().int().min(1).max(31).default(7),
      }),
      req.query,
    );
    const ctx = tenant(req);
    const s = await orderSettings(db, ctx.supplierId);
    res.json({
      slots: await windowSlots(db, ctx.supplierId, {
        now: clock(),
        from: q.from,
        days: q.days,
        sameDayCutoff: s.sameDayCutoff,
        ignoreCutoff: true,
      }),
    });
  });

  r.get('/admin/closed-days', office, async (req, res) => {
    res.json({ closedDays: await listClosedDays(db, tenant(req).supplierId, istDate(clock())) });
  });
  r.post('/admin/closed-days', office, idempotency(db), async (req, res) => {
    const input = parse(
      z.object({
        date: isoDateSchema,
        windowId: z.string().uuid().nullable().default(null),
        reason: reasonSchema,
      }),
      req.body,
    );
    res.status(201).json({ closedDay: await closeDay(db, tenant(req), input, clock()) });
  });
  r.delete('/admin/closed-days/:id', office, async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.json({ closedDay: await reopenDay(db, tenant(req), id) });
  });

  // ---------------------------------------------------------------- prices (owner changes them)
  r.get('/admin/catalog', office, async (req, res) => {
    res.json(await catalogForOffice(db, tenant(req).supplierId, clock()));
  });
  r.post('/admin/catalog/prices', owner, idempotency(db), async (req, res) => {
    const input = parse(
      z.object({ pricePaise: z.number().int().min(0).max(1_000_000), validFrom: isoDateSchema }),
      req.body,
    );
    res.status(201).json({ price: await setStandardPrice(db, tenant(req), input, clock()) });
  });
  r.get('/admin/customers/:id/price', office, async (req, res) => {
    const { id } = parse(idParam, req.params);
    const ctx = tenant(req);
    await getCustomer(db, ctx.supplierId, id);
    res.json(await customerPriceInfo(db, ctx.supplierId, id, clock()));
  });
  r.put('/admin/customers/:id/price', owner, async (req, res) => {
    const { id } = parse(idParam, req.params);
    const input = parse(
      z.object({
        pricePaise: z.number().int().min(0).max(1_000_000).nullable(),
        validFrom: isoDateSchema.optional(),
      }),
      req.body,
    );
    const now = clock();
    res.json({
      price: await setCustomerPrice(
        db,
        tenant(req),
        id,
        { ...input, validFrom: input.validFrom ?? istDate(now) },
        now,
      ),
    });
  });

  return r;
}
