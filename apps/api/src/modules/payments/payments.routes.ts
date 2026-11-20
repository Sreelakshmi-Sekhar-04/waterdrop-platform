import { Router } from 'express';
import { z } from 'zod';
import {
  addMonths,
  balanceCorrectionInputSchema,
  creditLimitInputSchema,
  depositRefundInputSchema,
  isoDateSchema,
  istDate,
  monthSchema,
  officePaymentInputSchema,
  openingImportInputSchema,
  reversePaymentInputSchema,
} from '@wtrdrop/shared';
import type { Database } from '../../db/client';
import { requireRole, tenant } from '../../middleware/auth';
import { idempotency } from '../../middleware/idempotency';
import { parse } from '../../middleware/validate';
import { ownCustomerId } from '../customers/customers.service';
import type { Clock } from '../ordering/ordering.routes';
import { customerLedgers } from '../delivery/ledgers';
import {
  correctBalances,
  customerPayments,
  importOpeningBalances,
  listDues,
  listPayments,
  monthlyStatement,
  recordOfficePayment,
  refundDeposit,
  reversePayment,
  setCreditLimit,
  verifyPayment,
} from './payments.service';

const idParam = z.object({ id: z.uuid() });
const thisMonth = (now: Date) => istDate(now).slice(0, 7);

export function paymentRoutes(db: Database, clock: Clock): Router {
  const r = Router();
  const office = requireRole('admin', 'owner');
  const owner = requireRole('owner');
  const customer = requireRole('customer');

  // ---------------------------------------------------------------- customer
  r.get('/customer/statement', customer, async (req, res) => {
    const { month } = parse(z.object({ month: monthSchema.optional() }), req.query);
    const ctx = tenant(req);
    const m = month ?? thisMonth(clock());
    if (m > thisMonth(clock()) || m < addMonths(thisMonth(clock()), -24))
      return res.json({ statement: null });
    res.json({
      statement: await monthlyStatement(db, ctx.supplierId, await ownCustomerId(db, ctx), m, true),
    });
  });

  // ---------------------------------------------------------------- office
  r.get('/admin/payments', office, async (req, res) => {
    const q = parse(
      z.object({
        from: isoDateSchema.optional(),
        to: isoDateSchema.optional(),
        toCheck: z.enum(['1']).optional(),
      }),
      req.query,
    );
    const today = istDate(clock());
    const from = q.from ?? today;
    const to = q.to ?? from;
    if (to < from)
      return res.json(await listPayments(db, tenant(req).supplierId, { from, to: from }));
    // `to` is inclusive for people; the query takes the day after.
    const next = new Date(`${to}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    res.json(
      await listPayments(db, tenant(req).supplierId, {
        from,
        to: next.toISOString().slice(0, 10),
        toCheck: q.toCheck === '1',
      }),
    );
  });
  r.post('/admin/payments/:id/verify', office, async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.json({ payment: await verifyPayment(db, tenant(req), id, clock()) });
  });
  r.post('/admin/payments/:id/reverse', office, idempotency(db), async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { reason } = parse(reversePaymentInputSchema, req.body);
    res.json({ payment: await reversePayment(db, tenant(req), id, reason, clock()) });
  });
  r.get('/admin/dues', office, async (req, res) => {
    res.json(await listDues(db, tenant(req).supplierId));
  });
  r.get('/admin/customers/:id/payments', office, async (req, res) => {
    const { id } = parse(idParam, req.params);
    const ctx = tenant(req);
    await customerLedgers(db, ctx.supplierId, id); // 404 for another supplier's customer
    res.json(await customerPayments(db, ctx.supplierId, id));
  });
  r.post('/admin/customers/:id/payments', office, idempotency(db), async (req, res) => {
    const { id } = parse(idParam, req.params);
    const input = parse(officePaymentInputSchema, req.body);
    res
      .status(201)
      .json({ payment: await recordOfficePayment(db, tenant(req), id, input, clock()) });
  });
  r.put('/admin/customers/:id/credit-limit', owner, async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { creditLimitPaise } = parse(creditLimitInputSchema, req.body);
    const ctx = tenant(req);
    await setCreditLimit(db, ctx, id, creditLimitPaise);
    res.json(await customerLedgers(db, ctx.supplierId, id));
  });
  r.post('/admin/customers/:id/deposit-refund', office, idempotency(db), async (req, res) => {
    const { id } = parse(idParam, req.params);
    const input = parse(depositRefundInputSchema, req.body);
    const ctx = tenant(req);
    const refund = await refundDeposit(db, ctx, id, input, clock());
    res.status(201).json({ refund, ...(await customerLedgers(db, ctx.supplierId, id)) });
  });
  r.post('/admin/customers/:id/corrections', office, idempotency(db), async (req, res) => {
    const { id } = parse(idParam, req.params);
    const input = parse(balanceCorrectionInputSchema, req.body);
    const ctx = tenant(req);
    await correctBalances(db, ctx, id, input);
    res.json(await customerLedgers(db, ctx.supplierId, id));
  });
  r.get('/admin/customers/:id/statement', office, async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { month } = parse(z.object({ month: monthSchema.optional() }), req.query);
    res.json({
      statement: await monthlyStatement(
        db,
        tenant(req).supplierId,
        id,
        month ?? thisMonth(clock()),
      ),
    });
  });
  r.post('/admin/opening-balances', owner, idempotency(db), async (req, res) => {
    const input = parse(openingImportInputSchema, req.body);
    res.json(await importOpeningBalances(db, tenant(req), input));
  });
  return r;
}
