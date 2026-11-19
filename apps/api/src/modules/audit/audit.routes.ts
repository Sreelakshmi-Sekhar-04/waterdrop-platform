import { Router } from 'express';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../../db/client';
import { auditLogs } from '../../db/schema';
import { requireRole, tenant } from '../../middleware/auth';
import { parse } from '../../middleware/validate';

const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

/** Latest audit records for the caller's own supplier. Filters arrive with the admin portal (Phase 7). */
export function auditRoutes(db: Database): Router {
  const r = Router();
  r.get('/admin/audit-logs', requireRole('admin', 'owner'), async (req, res) => {
    const ctx = tenant(req);
    const { limit } = parse(querySchema, req.query);
    const rows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.supplierId, ctx.supplierId))
      .orderBy(desc(auditLogs.id))
      .limit(limit);
    res.json({ items: rows });
  });
  return r;
}
