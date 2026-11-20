import { Router } from 'express';
import { and, desc, eq, like, lt, sql } from 'drizzle-orm';
import { auditQuerySchema } from '@wtrdrop/shared';
import type { Database } from '../../db/client';
import { auditLogs, users } from '../../db/schema';
import { requireRole, tenant } from '../../middleware/auth';
import { parse } from '../../middleware/validate';

/**
 * The activity log (Phase 7): who did what and when, newest first, for the caller's own supplier.
 * Filters by day, action, record and person; "Show more" passes the last id as `before`.
 * Records were already cleaned of secrets when written (lib/redact.ts).
 */
export function auditRoutes(db: Database): Router {
  const r = Router();
  r.get('/admin/audit-logs', requireRole('admin', 'owner'), async (req, res) => {
    const ctx = tenant(req);
    const q = parse(auditQuerySchema, req.query);
    const day = sql`(${auditLogs.createdAt} at time zone 'Asia/Kolkata')::date`;
    const items = await db
      .select({
        id: auditLogs.id,
        supplierId: auditLogs.supplierId,
        actorUserId: auditLogs.actorUserId,
        actorName: users.name,
        actorRole: auditLogs.actorRole,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        before: auditLogs.before,
        after: auditLogs.after,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(
        and(
          eq(auditLogs.supplierId, ctx.supplierId),
          q.from ? sql`${day} >= ${q.from}` : undefined,
          q.to ? sql`${day} <= ${q.to}` : undefined,
          q.action ? like(auditLogs.action, `${q.action}%`) : undefined,
          q.entityType ? eq(auditLogs.entityType, q.entityType) : undefined,
          q.entityId ? eq(auditLogs.entityId, q.entityId) : undefined,
          q.actorUserId ? eq(auditLogs.actorUserId, q.actorUserId) : undefined,
          q.before ? lt(auditLogs.id, q.before) : undefined,
        ),
      )
      .orderBy(desc(auditLogs.id))
      .limit(q.limit + 1);
    const more = items.length > q.limit;
    const page = items.slice(0, q.limit);
    res.json({ items: page, nextBefore: more ? page[page.length - 1]!.id : null });
  });
  return r;
}
