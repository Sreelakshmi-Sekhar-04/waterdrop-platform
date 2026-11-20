import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  addDays,
  businessInputSchema,
  COMPLAINT_STATUSES,
  complaintInputSchema,
  DATED_REPORTS,
  daysBetween,
  istDate,
  pushTokenInputSchema,
  REPORT_MAX_DAYS,
  reportQuerySchema,
  REPORTS,
  resolveComplaintInputSchema,
  toCsv,
} from '@wtrdrop/shared';
import type { Database } from '../../db/client';
import { suppliers } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { recordAudit } from '../../lib/audit';
import { requireAuth, requireRole, tenant } from '../../middleware/auth';
import { idempotency } from '../../middleware/idempotency';
import { parse } from '../../middleware/validate';
import type { Clock } from '../ordering/ordering.routes';
import { ownCustomerId } from '../customers/customers.service';
import {
  createComplaint,
  listComplaints,
  resolveComplaint,
} from '../complaints/complaints.service';
import {
  dropPushToken,
  listMessages,
  markRead,
  remindDues,
  savePushToken,
} from '../notifications/notifications.service';
import { dashboard, runReport } from './reports.service';

const idParam = z.object({ id: z.uuid() });

/**
 * Phase 7: the Today page, reports, business details, complaints, dues reminders, and the
 * customer's messages and push tokens.
 */
export function adminRoutes(db: Database, clock: Clock): Router {
  const r = Router();
  const office = requireRole('admin', 'owner');
  const owner = requireRole('owner');
  const customer = requireRole('customer');
  const today = () => istDate(clock());

  // ---------------------------------------------------------------- Today and reports
  r.get('/admin/dashboard', office, async (req, res) => {
    res.json(await dashboard(db, tenant(req).supplierId, today()));
  });

  r.get('/admin/reports/:name', office, async (req, res) => {
    const { name } = parse(z.object({ name: z.enum(REPORTS) }), req.params);
    const q = parse(reportQuerySchema, req.query);
    const to = q.to ?? today();
    const from = q.from ?? addDays(to, -6);
    if (DATED_REPORTS.includes(name)) {
      const days = daysBetween(from, to);
      if (days < 0 || days >= REPORT_MAX_DAYS)
        throw new AppError(
          422,
          'BAD_RANGE',
          'Choose a start date before the end, at most a year apart.',
          {
            maxDays: REPORT_MAX_DAYS,
          },
        );
    }
    const report = await runReport(db, tenant(req).supplierId, name, { from, to }, today());
    if (q.format === 'csv') {
      const file = `wtrdrop-${name}-${report.from ?? 'now'}-${report.to}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
      // A byte-order mark so spreadsheet programs read Malayalam names correctly.
      res.send(
        `\uFEFF${toCsv(
          report.columns,
          report.rows.map((row) => report.columns.map((c) => row[c])),
        )}`,
      );
      return;
    }
    res.json({ report });
  });

  // ---------------------------------------------------------------- business details
  r.get('/admin/business', office, async (req, res) => {
    const [s] = await db
      .select({ name: suppliers.name, gstin: suppliers.gstin, fssaiNo: suppliers.fssaiNo })
      .from(suppliers)
      .where(eq(suppliers.id, tenant(req).supplierId));
    res.json({ business: s });
  });
  r.patch('/admin/business', owner, idempotency(db), async (req, res) => {
    const patch = parse(businessInputSchema, req.body);
    const ctx = tenant(req);
    const business = await db.transaction(async (tx) => {
      const [before] = await tx
        .select({ name: suppliers.name, gstin: suppliers.gstin, fssaiNo: suppliers.fssaiNo })
        .from(suppliers)
        .where(eq(suppliers.id, ctx.supplierId))
        .for('update');
      const [after] = await tx
        .update(suppliers)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(suppliers.id, ctx.supplierId))
        .returning({ name: suppliers.name, gstin: suppliers.gstin, fssaiNo: suppliers.fssaiNo });
      await recordAudit(tx, ctx, {
        action: 'business.update',
        entityType: 'supplier',
        entityId: ctx.supplierId,
        before,
        after: patch,
      });
      return after;
    });
    res.json({ business });
  });

  // ---------------------------------------------------------------- complaints
  r.get('/admin/complaints', office, async (req, res) => {
    const q = parse(
      z.object({ status: z.enum(COMPLAINT_STATUSES).optional(), customerId: z.uuid().optional() }),
      req.query,
    );
    res.json({ complaints: await listComplaints(db, tenant(req).supplierId, q) });
  });
  // The office notes a complaint that came by phone.
  r.post('/admin/customers/:id/complaints', office, idempotency(db), async (req, res) => {
    const { id } = parse(idParam, req.params);
    const input = parse(complaintInputSchema, req.body);
    res.status(201).json({ complaint: await createComplaint(db, tenant(req), id, input) });
  });
  r.post('/admin/complaints/:id/resolve', office, idempotency(db), async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { resolution } = parse(resolveComplaintInputSchema, req.body);
    res.json({ complaint: await resolveComplaint(db, tenant(req), id, resolution, clock()) });
  });

  // ---------------------------------------------------------------- dues reminder
  r.post('/admin/customers/:id/remind', office, async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.status(201).json({ reminder: await remindDues(db, tenant(req), id, clock()) });
  });

  // ---------------------------------------------------------------- customer
  r.post('/customer/complaints', customer, idempotency(db), async (req, res) => {
    const input = parse(complaintInputSchema, req.body);
    const ctx = tenant(req);
    res
      .status(201)
      .json({ complaint: await createComplaint(db, ctx, await ownCustomerId(db, ctx), input) });
  });
  r.get('/customer/complaints', customer, async (req, res) => {
    const ctx = tenant(req);
    const list = await listComplaints(db, ctx.supplierId, {
      customerId: await ownCustomerId(db, ctx),
    });
    // The customer's own view: no phone digits, nothing the office noted about others.
    res.json({
      complaints: list.map(({ phoneLast4: _p, customerName: _n, ...c }) => c),
    });
  });
  r.get('/customer/messages', customer, async (req, res) => {
    res.json(await listMessages(db, tenant(req)));
  });
  r.post('/customer/messages/read', customer, async (req, res) => {
    const { upToId } = parse(z.object({ upToId: z.number().int().positive() }), req.body);
    await markRead(db, tenant(req), upToId, clock());
    res.status(204).end();
  });

  // ---------------------------------------------------------------- push tokens (any signed-in app)
  r.post('/me/push-tokens', requireAuth, async (req, res) => {
    const input = parse(pushTokenInputSchema, req.body);
    await savePushToken(db, tenant(req).userId, input);
    res.status(204).end();
  });
  r.delete('/me/push-tokens', requireAuth, async (req, res) => {
    const { token } = parse(pushTokenInputSchema.pick({ token: true }), req.body);
    await dropPushToken(db, tenant(req).userId, token);
    res.status(204).end();
  });

  return r;
}
