import { auditLogs } from '../db/schema';
import type { DbOrTx } from '../db/client';
import type { TenantContext } from './context';
import { redact } from './redact';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

/**
 * Records an important action. Call it inside the same transaction as the
 * change, so the change and its audit record are saved together or not at all.
 */
export async function recordAudit(db: DbOrTx, ctx: TenantContext, entry: AuditEntry) {
  await db.insert(auditLogs).values({
    supplierId: ctx.supplierId,
    actorUserId: ctx.userId,
    actorRole: ctx.role,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: entry.before === undefined ? null : redact(entry.before),
    after: entry.after === undefined ? null : redact(entry.after),
    requestId: ctx.requestId,
    ip: ctx.ip ?? null,
  });
}
