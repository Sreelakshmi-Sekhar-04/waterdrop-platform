import { Router } from 'express';
import { z } from 'zod';
import {
  addressInputSchema,
  customerProfileInputSchema,
  languageSchema,
  personNameSchema,
} from '@wtrdrop/shared';
import type { Database } from '../../db/client';
import { users } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { requireAuth, requireRole, tenant } from '../../middleware/auth';
import { idempotency } from '../../middleware/idempotency';
import { parse } from '../../middleware/validate';
import {
  addAddress,
  archiveAddress,
  getCustomer,
  listAddresses,
  ownCustomerId,
  updateAddress,
  updateOwnProfile,
} from './customers.service';

const idParam = z.object({ id: z.string().uuid() });

export function profileRoutes(db: Database): Router {
  const r = Router();

  // Any signed-in user: name and language.
  r.patch('/me', requireAuth, async (req, res) => {
    const body = parse(
      z
        .object({ name: personNameSchema.optional(), preferredLanguage: languageSchema.optional() })
        .refine(
          (b) => b.name !== undefined || b.preferredLanguage !== undefined,
          'Nothing to change',
        ),
      req.body,
    );
    await db
      .update(users)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(users.id, tenant(req).userId));
    res.json({ ok: true });
  });

  const customer = requireRole('customer');
  r.get('/customer/profile', customer, async (req, res) => {
    const ctx = tenant(req);
    res.json({ customer: await getCustomer(db, ctx.supplierId, await ownCustomerId(db, ctx)) });
  });
  r.put('/customer/profile', customer, async (req, res) => {
    const input = parse(customerProfileInputSchema, req.body);
    res.json({ customer: await updateOwnProfile(db, tenant(req), input) });
  });
  r.get('/customer/addresses', customer, async (req, res) => {
    const ctx = tenant(req);
    res.json({ addresses: await listAddresses(db, ctx.supplierId, await ownCustomerId(db, ctx)) });
  });
  r.post('/customer/addresses', customer, idempotency(db), async (req, res) => {
    const ctx = tenant(req);
    const input = parse(addressInputSchema, req.body);
    res
      .status(201)
      .json({ address: await addAddress(db, ctx, await ownCustomerId(db, ctx), input) });
  });
  r.patch('/customer/addresses/:id', customer, idempotency(db), async (req, res) => {
    const ctx = tenant(req);
    const { id } = parse(idParam, req.params);
    const input = parse(addressInputSchema.partial(), req.body);
    res.json({ address: await updateAddress(db, ctx, await ownCustomerId(db, ctx), id, input) });
  });
  r.delete('/customer/addresses/:id', customer, async (req, res) => {
    const ctx = tenant(req);
    const { id } = parse(idParam, req.params);
    await archiveAddress(db, ctx, await ownCustomerId(db, ctx), id);
    res.json({ ok: true });
  });
  return r;
}
