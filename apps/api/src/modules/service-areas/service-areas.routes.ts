import { Router } from 'express';
import { z } from 'zod';
import { serviceAreaInputSchema } from '@wtrdrop/shared';
import type { Database } from '../../db/client';
import { requireAuth, requireRole, tenant } from '../../middleware/auth';
import { idempotency } from '../../middleware/idempotency';
import { parse } from '../../middleware/validate';
import { createServiceArea, listServiceAreas, updateServiceArea } from './service-areas.service';

const idParam = z.object({ id: z.string().uuid() });

export function serviceAreaRoutes(db: Database): Router {
  const r = Router();
  // Any signed-in user may see where the supplier delivers.
  r.get('/service-areas', requireAuth, async (req, res) => {
    const areas = await listServiceAreas(db, tenant(req).supplierId, true);
    res.json({ areas: areas.map(({ status: _s, ...a }) => a) });
  });
  r.get('/admin/service-areas', requireRole('admin', 'owner'), async (req, res) => {
    res.json({ areas: await listServiceAreas(db, tenant(req).supplierId, false) });
  });
  r.post(
    '/admin/service-areas',
    requireRole('admin', 'owner'),
    idempotency(db),
    async (req, res) => {
      const input = parse(serviceAreaInputSchema, req.body);
      res.status(201).json({ area: await createServiceArea(db, tenant(req), input) });
    },
  );
  r.patch(
    '/admin/service-areas/:id',
    requireRole('admin', 'owner'),
    idempotency(db),
    async (req, res) => {
      const { id } = parse(idParam, req.params);
      const input = parse(serviceAreaInputSchema.partial(), req.body);
      res.json({ area: await updateServiceArea(db, tenant(req), id, input) });
    },
  );
  return r;
}
