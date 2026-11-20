/**
 * The owner's Today page (a "needs attention" inbox first, numbers second; Phase 0 §3.5, C-11)
 * and the six core reports (Phase 0 §13.3). Every number is read from the same orders, ledgers,
 * payments and stock movements the rest of the system writes; nothing here is stored or typed.
 */
import { sql } from 'drizzle-orm';
import {
  addDays,
  ageBucket,
  AGE_BUCKETS,
  daysBetween,
  FAILURE_REASONS,
  type ReportName,
} from '@wtrdrop/shared';
import type { Database } from '../../db/client';
import { listDues } from '../payments/payments.service';
import { stockSummary } from '../delivery/stock.service';

type Row = Record<string, string | number | boolean | null>;
const n = (v: unknown) => Number(v ?? 0);

async function rows<T extends Row>(db: Database, q: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute<T>(q)).rows as T[];
}

// ---------------------------------------------------------------- Today

export async function dashboard(db: Database, supplierId: string, today: string) {
  const tomorrow = addDays(today, 1);
  const [counts] = await rows<Row>(
    db,
    sql`select
      (select count(*) from orders where supplier_id = ${supplierId} and status = 'PLACED') as to_accept,
      (select count(*) from orders where supplier_id = ${supplierId} and status = 'ACCEPTED'
         and delivery_date <= ${today}) as unassigned,
      (select count(*) from orders where supplier_id = ${supplierId} and status = 'RESCHEDULE_PENDING') as to_reschedule,
      (select count(*) from complaints where supplier_id = ${supplierId} and status = 'open') as complaints,
      (select count(*) from payments where supplier_id = ${supplierId} and method = 'upi'
         and verified_at is null and reversed_at is null) as upi_count,
      (select coalesce(sum(amount_paise), 0) from payments where supplier_id = ${supplierId}
         and method = 'upi' and verified_at is null and reversed_at is null) as upi_paise,
      (select count(*) from trips where supplier_id = ${supplierId} and status = 'ended') as routes_to_check,
      (select coalesce(sum(coalesce(cash_handed_paise, 0) - coalesce(expected_cash_paise, 0)), 0)
         from trips where supplier_id = ${supplierId} and status = 'ended') as routes_cash_diff,
      (select coalesce(sum(total_qty), 0) from orders where supplier_id = ${supplierId}
         and delivery_date = ${tomorrow} and status in ('PLACED', 'ACCEPTED', 'ASSIGNED')) as cans_tomorrow,
      (select count(*) from orders where supplier_id = ${supplierId} and delivery_date = ${today}
         and status not in ('CANCELLED', 'REJECTED')) as orders_today,
      (select count(*) from delivery_attempts where supplier_id = ${supplierId} and outcome = 'delivered'
         and undone_at is null and (happened_at at time zone 'Asia/Kolkata')::date = ${today}) as delivered_today,
      (select coalesce(sum(full_delivered), 0) from delivery_attempts where supplier_id = ${supplierId}
         and outcome = 'delivered' and undone_at is null
         and (happened_at at time zone 'Asia/Kolkata')::date = ${today}) as cans_today,
      (select coalesce(sum(amount_paise) filter (where method = 'cash'), 0) from payments
         where supplier_id = ${supplierId} and paid_on = ${today} and reversed_at is null) as cash_today,
      (select coalesce(sum(amount_paise) filter (where method = 'upi'), 0) from payments
         where supplier_id = ${supplierId} and paid_on = ${today} and reversed_at is null) as upi_today,
      (select coalesce(sum(balance_paise) filter (where balance_paise > 0), 0) from customers
         where supplier_id = ${supplierId}) as due_total,
      (select count(*) filter (where balance_paise > 0) from customers
         where supplier_id = ${supplierId}) as owing`,
  );
  const stock = await stockSummary(db, supplierId);
  const routes = await rows<Row>(
    db,
    sql`select t.id, u.name as staff_name, t.status,
        (select count(*) from delivery_attempts a where a.trip_id = t.id and a.undone_at is null and a.outcome = 'delivered') as delivered,
        (select count(*) from delivery_attempts a where a.trip_id = t.id and a.undone_at is null and a.outcome = 'failed') as failed,
        (select count(*) from orders o where o.trip_id = t.id and o.status in ('ASSIGNED', 'OUT_FOR_DELIVERY')) as remaining,
        (select coalesce(sum(a.amount_collected_paise), 0) from delivery_attempts a where a.trip_id = t.id
           and a.undone_at is null and a.payment_method = 'cash') as cash
      from trips t join users u on u.id = t.staff_user_id
      where t.supplier_id = ${supplierId} and t.date = ${today}
      order by u.name`,
  );
  const c = counts!;
  const cansTomorrow = n(c.cans_tomorrow);
  return {
    today,
    attention: {
      toAccept: n(c.to_accept),
      unassigned: n(c.unassigned),
      toReschedule: n(c.to_reschedule),
      complaints: n(c.complaints),
      upiToCheck: { count: n(c.upi_count), amountPaise: n(c.upi_paise) },
      routesToCheck: { count: n(c.routes_to_check), cashDifferencePaise: n(c.routes_cash_diff) },
      // Full cans at the depot and on vans against what tomorrow's orders need.
      lowStock:
        cansTomorrow > stock.depotFull + stock.vanFull
          ? { needed: cansTomorrow, available: stock.depotFull + stock.vanFull }
          : null,
    },
    numbers: {
      ordersToday: n(c.orders_today),
      deliveredToday: n(c.delivered_today),
      cansDeliveredToday: n(c.cans_today),
      cashTodayPaise: n(c.cash_today),
      upiTodayPaise: n(c.upi_today),
      duePaise: n(c.due_total),
      customersOwing: n(c.owing),
      cansWithCustomers: stock.withCustomers,
      depotFull: stock.depotFull,
      cansTomorrow,
    },
    routes: routes.map((r) => ({
      id: String(r.id),
      staffName: r.staff_name as string | null,
      status: r.status as string,
      delivered: n(r.delivered),
      failed: n(r.failed),
      remaining: n(r.remaining),
      cashPaise: n(r.cash),
    })),
  };
}

// ---------------------------------------------------------------- reports

export interface Report {
  name: ReportName;
  from: string | null;
  to: string | null;
  /** Column keys in order; the portal translates them, the CSV uses them as the header. */
  columns: string[];
  rows: Row[];
  totals: Row;
  /** Extra facts shown above the table (the can-pool check, failure reasons, …). */
  facts?: Row;
}

const sum = (list: Row[], key: string) => list.reduce((t, r) => t + n(r[key]), 0);

export async function runReport(
  db: Database,
  supplierId: string,
  name: ReportName,
  range: { from: string; to: string },
  today: string,
): Promise<Report> {
  const { from, to } = range;
  switch (name) {
    case 'sales': {
      const list = await rows<Row>(
        db,
        sql`with days as (select d::date as day from generate_series(${from}::date, ${to}::date, '1 day') d),
          att as (select (happened_at at time zone 'Asia/Kolkata')::date as day, count(*) as deliveries,
                    sum(full_delivered) as cans, sum(charge_paise) as sales, sum(deposit_paise) as deposits
                  from delivery_attempts where supplier_id = ${supplierId} and outcome = 'delivered'
                    and undone_at is null group by 1),
          pay as (select paid_on as day, sum(amount_paise) filter (where method = 'cash') as cash,
                    sum(amount_paise) filter (where method = 'upi') as upi
                  from payments where supplier_id = ${supplierId} and reversed_at is null group by 1),
          ref as (select (created_at at time zone 'Asia/Kolkata')::date as day, sum(amount_paise) as refunds
                  from deposit_refunds where supplier_id = ${supplierId} and method <> 'adjust' group by 1)
        select to_char(days.day, 'YYYY-MM-DD') as date, coalesce(att.deliveries, 0) as deliveries,
          coalesce(att.cans, 0) as cans, coalesce(att.sales, 0) as sales_paise,
          coalesce(att.deposits, 0) as deposits_paise, coalesce(pay.cash, 0) as cash_paise,
          coalesce(pay.upi, 0) as upi_paise, coalesce(ref.refunds, 0) as refunds_paise
        from days left join att using (day) left join pay using (day) left join ref using (day)
        order by days.day`,
      );
      const cols = [
        'date',
        'deliveries',
        'cans',
        'sales_paise',
        'deposits_paise',
        'cash_paise',
        'upi_paise',
        'refunds_paise',
      ];
      const data = list.map((r) =>
        Object.fromEntries(cols.map((k) => [k, k === 'date' ? r[k]! : n(r[k])])),
      );
      return {
        name,
        from,
        to,
        columns: cols,
        rows: data,
        totals: Object.fromEntries(cols.slice(1).map((k) => [k, sum(data, k)])),
      };
    }
    case 'dues': {
      const { dues } = await listDues(db, supplierId);
      const data = dues.map((d) => {
        const days = d.owingSince ? Math.max(0, daysBetween(isoDay(d.owingSince), today)) : 0;
        return {
          customer: d.name ?? '',
          phone_last4: d.phoneLast4,
          area: d.areaName ?? '',
          due_paise: d.balancePaise,
          credit_limit_paise: d.creditLimitPaise,
          over_limit: d.overLimit,
          days_owing: days,
          age: ageBucket(days),
          last_paid: d.lastPaidOn ?? '',
          customer_id: d.customerId,
        };
      });
      return {
        name,
        from: null,
        to: today,
        columns: [
          'customer',
          'phone_last4',
          'area',
          'due_paise',
          'credit_limit_paise',
          'over_limit',
          'days_owing',
          'age',
          'last_paid',
        ],
        rows: data,
        totals: {
          due_paise: sum(data, 'due_paise'),
          customers: data.length,
          ...Object.fromEntries(
            AGE_BUCKETS.map((b) => [
              `age_${b}`,
              sum(
                data.filter((r) => r.age === b),
                'due_paise',
              ),
            ]),
          ),
        },
      };
    }
    case 'cans': {
      const list = await rows<Row>(
        db,
        sql`select c.id as customer_id, u.name as customer, right(u.phone, 4) as phone_last4,
            (select sa.name from addresses a join service_areas sa on sa.id = a.service_area_id
              where a.customer_id = c.id and a.archived_at is null order by a.is_default desc, a.created_at limit 1) as area,
            c.cans_held, c.deposit_cover_cans,
            (select to_char(max((l.at at time zone 'Asia/Kolkata')::date), 'YYYY-MM-DD') from can_ledger l
              where l.customer_id = c.id and l.entry_type in ('delivery', 'return', 'opening')) as last_movement
          from customers c join users u on u.id = c.user_id
          where c.supplier_id = ${supplierId} and c.cans_held > 0
          order by c.cans_held desc, u.name limit 2000`,
      );
      const data = list.map((r) => {
        const days = r.last_movement ? Math.max(0, daysBetween(String(r.last_movement), today)) : 0;
        return {
          customer: (r.customer as string | null) ?? '',
          phone_last4: String(r.phone_last4),
          area: (r.area as string | null) ?? '',
          cans_held: n(r.cans_held),
          deposit_covers: n(r.deposit_cover_cans),
          above_deposit: Math.max(0, n(r.cans_held) - n(r.deposit_cover_cans)),
          last_movement: (r.last_movement as string | null) ?? '',
          days_since: days,
          age: ageBucket(days),
          customer_id: String(r.customer_id),
        };
      });
      return {
        name,
        from: null,
        to: today,
        columns: [
          'customer',
          'phone_last4',
          'area',
          'cans_held',
          'deposit_covers',
          'above_deposit',
          'last_movement',
          'days_since',
          'age',
        ],
        rows: data,
        totals: {
          cans_held: sum(data, 'cans_held'),
          above_deposit: sum(data, 'above_deposit'),
          customers: data.length,
        },
      };
    }
    case 'staff': {
      const list = await rows<Row>(
        db,
        sql`select to_char(t.date, 'YYYY-MM-DD') as date, u.name as staff, t.status,
            (select count(*) from delivery_attempts a where a.trip_id = t.id and a.undone_at is null and a.outcome = 'delivered') as delivered,
            (select count(*) from delivery_attempts a where a.trip_id = t.id and a.undone_at is null and a.outcome = 'failed') as failed,
            (select coalesce(sum(a.full_delivered), 0) from delivery_attempts a where a.trip_id = t.id and a.undone_at is null) as cans,
            (select coalesce(sum(a.empty_collected + a.extra_empties), 0) from delivery_attempts a where a.trip_id = t.id and a.undone_at is null) as empties,
            t.expected_cash_paise, t.cash_handed_paise
          from trips t join users u on u.id = t.staff_user_id
          where t.supplier_id = ${supplierId} and t.date between ${from} and ${to}
          order by t.date, u.name`,
      );
      const data = list.map((r) => {
        const ended = r.status === 'ended' || r.status === 'reconciled';
        return {
          date: String(r.date),
          staff: (r.staff as string | null) ?? '',
          status: String(r.status),
          delivered: n(r.delivered),
          failed: n(r.failed),
          cans: n(r.cans),
          empties: n(r.empties),
          cash_expected_paise: ended ? n(r.expected_cash_paise) : null,
          cash_handed_paise: ended ? n(r.cash_handed_paise) : null,
          cash_difference_paise: ended ? n(r.cash_handed_paise) - n(r.expected_cash_paise) : null,
        };
      });
      const cols = [
        'date',
        'staff',
        'status',
        'delivered',
        'failed',
        'cans',
        'empties',
        'cash_expected_paise',
        'cash_handed_paise',
        'cash_difference_paise',
      ];
      return {
        name,
        from,
        to,
        columns: cols,
        rows: data,
        totals: Object.fromEntries(cols.slice(3).map((k) => [k, sum(data, k)])),
      };
    }
    case 'deliveries': {
      const list = await rows<Row>(
        db,
        sql`with days as (select d::date as day from generate_series(${from}::date, ${to}::date, '1 day') d),
          a as (select (a.happened_at at time zone 'Asia/Kolkata')::date as day, a.outcome, a.failure_reason,
                  (a.happened_at at time zone 'Asia/Kolkata') <= (o.delivery_date + w.end_time::time) as on_time
                from delivery_attempts a join orders o on o.id = a.order_id
                join delivery_windows w on w.id = o.window_id
                where a.supplier_id = ${supplierId} and a.undone_at is null)
        select to_char(days.day, 'YYYY-MM-DD') as date,
          count(a.*) filter (where a.outcome = 'delivered') as delivered,
          count(a.*) filter (where a.outcome = 'delivered' and a.on_time) as on_time,
          count(a.*) filter (where a.outcome = 'delivered' and not a.on_time) as late,
          count(a.*) filter (where a.outcome = 'failed') as failed
        from days left join a using (day) group by days.day order by days.day`,
      );
      const reasons = await rows<Row>(
        db,
        sql`select failure_reason as reason, count(*) as n from delivery_attempts
          where supplier_id = ${supplierId} and outcome = 'failed' and undone_at is null
            and (happened_at at time zone 'Asia/Kolkata')::date between ${from} and ${to}
          group by 1`,
      );
      const cols = ['date', 'delivered', 'on_time', 'late', 'failed'];
      const data = list.map((r) =>
        Object.fromEntries(cols.map((k) => [k, k === 'date' ? r[k]! : n(r[k])])),
      );
      return {
        name,
        from,
        to,
        columns: cols,
        rows: data,
        totals: Object.fromEntries(cols.slice(1).map((k) => [k, sum(data, k)])),
        facts: Object.fromEntries(
          FAILURE_REASONS.map((r) => [`failed_${r}`, n(reasons.find((x) => x.reason === r)?.n)]),
        ),
      };
    }
    case 'stock': {
      const s = await stockSummary(db, supplierId);
      const moves = await rows<Row>(
        db,
        sql`select kind, sum(qty) as qty, count(*) as entries from stock_movements
          where supplier_id = ${supplierId}
            and (at at time zone 'Asia/Kolkata')::date between ${from} and ${to}
          group by kind order by kind`,
      );
      // The can-pool check (Phase 0 §9): cans "with customers" in the stock log must equal the
      // cans held on the customers' can ledgers.
      const [check] = await rows<Row>(
        db,
        sql`select
          (select coalesce(sum(case when to_place = 'customer' then qty else 0 end)
                  - sum(case when from_place = 'customer' then qty else 0 end), 0)
             from stock_movements where supplier_id = ${supplierId}) as by_movements,
          (select coalesce(sum(cans_held), 0) from customers where supplier_id = ${supplierId}) as by_ledger`,
      );
      const data = moves.map((m) => ({
        kind: String(m.kind),
        cans: n(m.qty),
        entries: n(m.entries),
      }));
      return {
        name,
        from,
        to,
        columns: ['kind', 'cans', 'entries'],
        rows: data,
        totals: { cans: sum(data, 'cans'), entries: sum(data, 'entries') },
        facts: {
          depot_full: s.depotFull,
          depot_empty: s.depotEmpty,
          on_vans: s.vanFull + s.vanEmpty,
          with_customers: s.withCustomers,
          damaged: s.damaged,
          total: s.total,
          customers_by_movements: n(check?.by_movements),
          pool_adds_up: n(check?.by_movements) === n(check?.by_ledger),
        },
      };
    }
  }
}

/** A timestamp (Date or ISO text) as its day in India. */
function isoDay(at: string | Date): string {
  return new Date(new Date(at).getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}
