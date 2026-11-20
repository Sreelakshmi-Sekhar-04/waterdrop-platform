/**
 * Can stock (Phase 5): counts per place are sums of stock_movements. The office records what
 * happens at the depot (cans filled at the plant, new cans bought, a physical count, damaged cans
 * thrown away); routes record load-out, deliveries, pickups and day-end automatically.
 *
 * The can pool identity (Phase 0 §9 decision 4): depot + vans + customers + damaged = every can the
 * business owns. Customers' cans come from the can ledger, so the two records check each other.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database, DbOrTx } from '../../db/client';
import { customers, stockMovements, trips, users } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { recordAudit } from '../../lib/audit';
import type { TenantContext } from '../../lib/context';
import { moveStock } from './ledgers';

type Counts = Record<'depotFull' | 'depotEmpty' | 'damaged' | 'vanFull' | 'vanEmpty', number>;

async function placeCounts(db: DbOrTx, supplierId: string): Promise<Counts> {
  const rows = await db.execute<{ place: string; state: string; qty: string }>(sql`
    select place, state, sum(qty)::text as qty from (
      select to_place as place, to_state as state, qty from stock_movements where supplier_id = ${supplierId}
      union all
      select from_place, from_state, -qty from stock_movements where supplier_id = ${supplierId}
    ) m where place in ('depot', 'trip', 'damaged') group by place, state`);
  const get = (place: string, state: string) =>
    Number(rows.rows.find((r) => r.place === place && r.state === state)?.qty ?? 0);
  return {
    depotFull: get('depot', 'full'),
    depotEmpty: get('depot', 'empty'),
    damaged: get('damaged', 'damaged'),
    vanFull: get('trip', 'full'),
    vanEmpty: get('trip', 'empty'),
  };
}

export async function stockSummary(db: Database, supplierId: string) {
  const counts = await placeCounts(db, supplierId);
  const [held] = await db
    .select({ n: sql<string>`coalesce(sum(${customers.cansHeld}), 0)::text` })
    .from(customers)
    .where(eq(customers.supplierId, supplierId));
  const withCustomers = Number(held?.n ?? 0);
  const recent = await db
    .select({
      id: stockMovements.id,
      kind: stockMovements.kind,
      fromPlace: stockMovements.fromPlace,
      fromState: stockMovements.fromState,
      toPlace: stockMovements.toPlace,
      toState: stockMovements.toState,
      qty: stockMovements.qty,
      note: stockMovements.note,
      at: stockMovements.at,
      actorName: users.name,
    })
    .from(stockMovements)
    .leftJoin(users, eq(users.id, stockMovements.actorUserId))
    .where(
      and(
        eq(stockMovements.supplierId, supplierId),
        inArray(stockMovements.kind, [
          'count',
          'filled',
          'bought',
          'discarded',
          'shortage',
          'surplus',
        ]),
      ),
    )
    .orderBy(desc(stockMovements.id))
    .limit(30);
  const vansOut = await db
    .select({ n: sql<string>`count(*)::text` })
    .from(trips)
    .where(and(eq(trips.supplierId, supplierId), inArray(trips.status, ['on_route', 'ended'])));
  return {
    ...counts,
    withCustomers,
    total:
      counts.depotFull +
      counts.depotEmpty +
      counts.damaged +
      counts.vanFull +
      counts.vanEmpty +
      withCustomers,
    routesNotChecked: Number(vansOut[0]?.n ?? 0),
    recent,
  };
}

export type StockAction =
  | { kind: 'filled'; qty: number; note?: string }
  | { kind: 'bought'; qty: number; state: 'full' | 'empty'; note?: string }
  | { kind: 'discarded'; qty: number; note: string }
  | { kind: 'count'; full: number; empty: number; damaged: number; note: string };

/** An office entry at the depot. A count records the difference from what the system expected. */
export async function recordStock(db: Database, ctx: TenantContext, a: StockAction) {
  await db.transaction(async (tx) => {
    // One stock entry at a time per supplier, so a count never races another movement.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'stock:' + ctx.supplierId}))`);
    const base = { supplierId: ctx.supplierId, actorUserId: ctx.userId, note: a.note ?? null };
    const now = await placeCounts(tx, ctx.supplierId);
    if (a.kind === 'filled') {
      if (a.qty > now.depotEmpty)
        throw new AppError(
          422,
          'NOT_ENOUGH_EMPTIES',
          'There are not that many empty cans at the depot.',
          {
            available: now.depotEmpty,
          },
        );
      await moveStock(tx, {
        ...base,
        from: ['depot', 'empty'],
        to: ['depot', 'full'],
        qty: a.qty,
        kind: 'filled',
      });
    } else if (a.kind === 'bought') {
      await moveStock(tx, {
        ...base,
        from: ['outside', a.state],
        to: ['depot', a.state],
        qty: a.qty,
        kind: 'bought',
      });
    } else if (a.kind === 'discarded') {
      if (a.qty > now.damaged)
        throw new AppError(422, 'NOT_ENOUGH_DAMAGED', 'There are not that many damaged cans.', {
          available: now.damaged,
        });
      await moveStock(tx, {
        ...base,
        from: ['damaged', 'damaged'],
        to: ['outside', 'damaged'],
        qty: a.qty,
        kind: 'discarded',
      });
    } else {
      const diffs: [['depot' | 'damaged', 'full' | 'empty' | 'damaged'], number][] = [
        [['depot', 'full'], a.full - now.depotFull],
        [['depot', 'empty'], a.empty - now.depotEmpty],
        [['damaged', 'damaged'], a.damaged - now.damaged],
      ];
      for (const [place, d] of diffs) {
        if (d > 0)
          await moveStock(tx, {
            ...base,
            from: ['outside', place[1]],
            to: place,
            qty: d,
            kind: 'count',
          });
        if (d < 0)
          await moveStock(tx, {
            ...base,
            from: place,
            to: ['outside', place[1]],
            qty: -d,
            kind: 'count',
          });
      }
    }
    await recordAudit(tx, ctx, {
      action: `stock.${a.kind}`,
      entityType: 'stock',
      entityId: ctx.supplierId,
      before: now,
      after: a,
    });
  });
  return stockSummary(db, ctx.supplierId);
}
