import { Router } from 'express';
import { z } from 'zod';
import {
  addressInputSchema,
  customerTypeSchema,
  indianMobileSchema,
  personNameSchema,
} from '@wtrdrop/shared';
import type { Database } from '../../db/client';
import { requireRole, tenant } from '../../middleware/auth';
import { idempotency } from '../../middleware/idempotency';
import { parse } from '../../middleware/validate';
import {
  addAddress,
  archiveAddress,
  createCustomerByOffice,
  getCustomer,
  searchCustomers,
  updateAddress,
  updateCustomerByOffice,
} from '../customers/customers.service';
import { addTeamMember, listTeam, resetStaffPin, setTeamMemberStatus } from './people.service';

const uuidParam = (k: string) => z.object({ [k]: z.string().uuid() });
const statusSchema = z.object({ status: z.enum(['active', 'disabled']) });
const memberSchema = z.object({ phone: indianMobileSchema, name: personNameSchema });

export function adminPeopleRoutes(db: Database): Router {
  const r = Router();
  const office = requireRole('admin', 'owner');

  // ---- customers
  r.get('/admin/customers', office, async (req, res) => {
    const { q } = parse(z.object({ q: z.string().max(60).default('') }), req.query);
    res.json({ customers: await searchCustomers(db, tenant(req).supplierId, q) });
  });
  r.get('/admin/customers/:id', office, async (req, res) => {
    const { id } = parse(uuidParam('id'), req.params) as { id: string };
    res.json({ customer: await getCustomer(db, tenant(req).supplierId, id) });
  });
  r.post('/admin/customers', office, idempotency(db), async (req, res) => {
    const input = parse(
      z.object({
        phone: indianMobileSchema,
        name: personNameSchema,
        type: customerTypeSchema.default('household'),
        address: addressInputSchema.optional(),
      }),
      req.body,
    );
    res.status(201).json({ customer: await createCustomerByOffice(db, tenant(req), input) });
  });
  r.patch('/admin/customers/:id', office, idempotency(db), async (req, res) => {
    const { id } = parse(uuidParam('id'), req.params) as { id: string };
    const input = parse(
      z.object({
        name: personNameSchema.optional(),
        type: customerTypeSchema.optional(),
        status: z.enum(['active', 'disabled']).optional(),
      }),
      req.body,
    );
    res.json({ customer: await updateCustomerByOffice(db, tenant(req), id, input) });
  });
  r.post('/admin/customers/:id/addresses', office, idempotency(db), async (req, res) => {
    const { id } = parse(uuidParam('id'), req.params) as { id: string };
    const ctx = tenant(req);
    await getCustomer(db, ctx.supplierId, id); // 404 for other suppliers' customers
    const address = await addAddress(db, ctx, id, parse(addressInputSchema, req.body));
    res.status(201).json({ address });
  });
  r.patch(
    '/admin/customers/:id/addresses/:addressId',
    office,
    idempotency(db),
    async (req, res) => {
      const p = parse(
        z.object({ id: z.string().uuid(), addressId: z.string().uuid() }),
        req.params,
      );
      const address = await updateAddress(
        db,
        tenant(req),
        p.id,
        p.addressId,
        parse(addressInputSchema.partial(), req.body),
      );
      res.json({ address });
    },
  );
  r.delete('/admin/customers/:id/addresses/:addressId', office, async (req, res) => {
    const p = parse(z.object({ id: z.string().uuid(), addressId: z.string().uuid() }), req.params);
    await archiveAddress(db, tenant(req), p.id, p.addressId);
    res.json({ ok: true });
  });

  // ---- delivery staff (admin and owner)
  r.get('/admin/staff', office, async (req, res) => {
    res.json({ staff: await listTeam(db, tenant(req).supplierId, ['staff']) });
  });
  r.post('/admin/staff', office, idempotency(db), async (req, res) => {
    const input = parse(memberSchema, req.body);
    res.status(201).json(await addTeamMember(db, tenant(req), { ...input, role: 'staff' }));
  });
  r.patch('/admin/staff/:userId', office, idempotency(db), async (req, res) => {
    const { userId } = parse(uuidParam('userId'), req.params) as { userId: string };
    const { status } = parse(statusSchema, req.body);
    await setTeamMemberStatus(db, tenant(req), userId, 'staff', status);
    res.json({ ok: true });
  });
  r.post('/admin/staff/:userId/reset-pin', office, idempotency(db), async (req, res) => {
    const { userId } = parse(uuidParam('userId'), req.params) as { userId: string };
    await resetStaffPin(db, tenant(req), userId);
    res.json({ ok: true });
  });

  // ---- office accounts (owner only)
  const owner = requireRole('owner');
  r.get('/admin/team', owner, async (req, res) => {
    res.json({ team: await listTeam(db, tenant(req).supplierId, ['owner', 'admin']) });
  });
  r.post('/admin/team', owner, idempotency(db), async (req, res) => {
    const input = parse(memberSchema, req.body);
    res.status(201).json(await addTeamMember(db, tenant(req), { ...input, role: 'admin' }));
  });
  r.patch('/admin/team/:userId', owner, idempotency(db), async (req, res) => {
    const { userId } = parse(uuidParam('userId'), req.params) as { userId: string };
    const { status } = parse(statusSchema, req.body);
    await setTeamMemberStatus(db, tenant(req), userId, 'admin', status);
    res.json({ ok: true });
  });
  return r;
}
