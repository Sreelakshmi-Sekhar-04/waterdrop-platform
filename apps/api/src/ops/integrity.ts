/**
 * The nightly data check (Phase 0 §8 risk 2, §12.2 "DB validation"): the cached balances must equal
 * their ledgers, and the cans the stock log puts at customers must equal what the customers'
 * can ledgers say. Anything else worth a look is a warning.
 *
 * Run it with `node dist/check-integrity.js` (or `pnpm --filter @wtrdrop/api check:integrity`)
 * from the host's scheduler every night. It exits 1 when a problem is found, so the scheduler can
 * alert. It only reads.
 */
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';

export interface IntegrityReport {
  checkedAt: string;
  /** Must be zero. Each is a count of records that disagree. */
  problems: Record<string, number>;
  /** Worth a look, not wrong by themselves. */
  warnings: Record<string, number>;
  ok: boolean;
}

const count = async (db: Database, q: ReturnType<typeof sql>) => {
  const r = await db.execute<{ n: string }>(q);
  return Number(r.rows[0]?.n ?? 0);
};

export async function checkIntegrity(db: Database, now = new Date()): Promise<IntegrityReport> {
  const problems = {
    cansHeldNotLedger: await count(
      db,
      sql`select count(*)::text as n from customers c
          where c.cans_held <> coalesce((select sum(delta) from can_ledger where customer_id = c.id), 0)`,
    ),
    balanceNotLedger: await count(
      db,
      sql`select count(*)::text as n from customers c
          where c.balance_paise <> coalesce((select sum(delta_paise) from account_ledger where customer_id = c.id), 0)`,
    ),
    depositNotLedger: await count(
      db,
      sql`select count(*)::text as n from customers c
          where c.deposit_held_paise <> coalesce((select sum(delta_paise) from deposit_ledger where customer_id = c.id), 0)
             or c.deposit_cover_cans <> coalesce((select sum(delta_cans) from deposit_ledger where customer_id = c.id), 0)`,
    ),
    // Per supplier: cans the stock log puts at customers vs cans on the customers' ledgers.
    canPoolSuppliers: await count(
      db,
      sql`select count(*)::text as n from suppliers s
          where coalesce((select sum(case when to_place = 'customer' then qty else 0 end)
                               - sum(case when from_place = 'customer' then qty else 0 end)
                          from stock_movements where supplier_id = s.id), 0)
             <> coalesce((select sum(cans_held) from customers where supplier_id = s.id), 0)`,
    ),
    negativeCansHeld: await count(
      db,
      sql`select count(*)::text as n from customers where cans_held < 0`,
    ),
  };
  const warnings = {
    // Messages that should have been pushed within seconds.
    messagesStuckPending: await count(
      db,
      sql`select count(*)::text as n from notifications
          where push_status = 'pending' and created_at < ${new Date(now.getTime() - 3600_000)}`,
    ),
    // A day ended more than two days ago and nobody checked it.
    routesNotChecked: await count(
      db,
      sql`select count(*)::text as n from trips
          where status = 'ended' and date < (${now.toISOString()}::timestamptz at time zone 'Asia/Kolkata')::date - 2`,
    ),
    // The depot count went below zero: a fill or count was not entered.
    negativeDepotStock: await count(
      db,
      sql`select count(*)::text as n from (
            select supplier_id, to_state as state, sum(qty) as q from stock_movements where to_place = 'depot' group by 1, 2
          ) i full join (
            select supplier_id, from_state as state, sum(qty) as q from stock_movements where from_place = 'depot' group by 1, 2
          ) o using (supplier_id, state)
          where coalesce(i.q, 0) - coalesce(o.q, 0) < 0`,
    ),
  };
  return {
    checkedAt: now.toISOString(),
    problems,
    warnings,
    ok: Object.values(problems).every((v) => v === 0),
  };
}
