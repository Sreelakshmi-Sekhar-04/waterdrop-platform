import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { settings } from '../../db/schema';
import type { TenantContext } from '../../lib/context';
import { recordAudit } from '../../lib/audit';
import { settingsSchema, type Settings } from './settings.schema';

export async function getSettings(db: Database, ctx: TenantContext): Promise<Partial<Settings>> {
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(eq(settings.supplierId, ctx.supplierId));
  const raw = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return settingsSchema.partial().parse(raw);
}

/** Changes settings and records the before/after values in one transaction. */
export async function updateSettings(
  db: Database,
  ctx: TenantContext,
  patch: Partial<Settings>,
): Promise<Partial<Settings>> {
  return db.transaction(async (tx) => {
    const keys = Object.keys(patch);
    const beforeRows = await tx
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(and(eq(settings.supplierId, ctx.supplierId), inArray(settings.key, keys)))
      .for('update');
    const before = Object.fromEntries(beforeRows.map((r) => [r.key, r.value]));

    for (const [key, value] of Object.entries(patch)) {
      // Clearing an optional setting (null) removes its row; jsonb columns are NOT NULL.
      if (value === null) {
        await tx
          .delete(settings)
          .where(and(eq(settings.supplierId, ctx.supplierId), eq(settings.key, key)));
        continue;
      }
      await tx
        .insert(settings)
        .values({ supplierId: ctx.supplierId, key, value, updatedBy: ctx.userId })
        .onConflictDoUpdate({
          target: [settings.supplierId, settings.key],
          set: { value, updatedBy: ctx.userId, updatedAt: new Date() },
        });
    }
    await recordAudit(tx, ctx, {
      action: 'settings.update',
      entityType: 'settings',
      entityId: ctx.supplierId,
      before,
      after: patch,
    });
    const rows = await tx
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(eq(settings.supplierId, ctx.supplierId));
    return settingsSchema.partial().parse(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  });
}
