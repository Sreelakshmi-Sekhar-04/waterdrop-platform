# ADR 0003: Ordering, prices and delivery capacity

**Status:** Accepted (Phase 4, 19 Nov 2026). Follows approved decisions D-07, D-08, D-10, D-11, D-12, D-14 and
R-05, R-08, M-01, M-12, M-21 from `REQUIREMENTS-CHANGELOG.md`. The choices below fill in details those decisions
left open. None changes what was approved.

## Decision

### Delivery times (D-07, D-08, M-12)

- A delivery time ("window") has a name in English and Malayalam, a start and end (`HH:MM`, IST), the days of the week
  it runs, and a number of cans it can take. A single date can get a different number of cans
  (`PUT /admin/windows/:id/capacity/:date`).
- **Customers** can book a time on a later day, or today if it is before the same-day cut-off (setting
  `sameDayCutoff`, DEMO value 14:00) **and** before the time starts. Past dates are never bookable.
- **The office** (phone orders, M-01) ignores the cut-off and can book today's time until it **ends**, for example a
  caller at 12:30 for the 11:00–15:00 time. Closed days and the number of cans still apply.
- A closed day can be the whole day or one delivery time, with a reason (3+ characters). Closing does **not** cancel
  orders already booked; the office is told how many there are so someone can phone those customers.

### Capacity is reserved when the order is placed (R-05)

- `window_bookings` keeps one row per time and date. The order takes cans with one conditional update
  (`reserved + qty <= capacity`), in the same transaction as the order. Two customers ordering at the same moment can
  never book more cans than the time can take (tested with parallel requests).
- Cans are given back when the order is cancelled or rejected (`orders.capacity_held`).

### Prices (D-11, M-21)

- The standard price is a list of dated rows: the row with the latest start date on or before the delivery date is
  the price. A new price can start today or later, never in the past; the same date again replaces that row. Only the
  owner changes prices.
- A customer can have their own price (also dated). Setting it back to "standard" adds a row with no price, so the
  history is kept.
- Every order saves its unit price, deposit per can, delivery charge, total and a copy of the address at the moment it
  is placed. Later price or address changes never change an order.

### Charges and deposit (D-04, D-12)

- Delivery charge per order: the area's value if set, otherwise the business setting. It is waived when the order has
  **more than** "free above" cans (0 = never waived).
- Can deposit: `max(0, max(cansHeld, qty) − depositCover)` new cans × `depositPerCanPaise` (DEMO ₹150). Until the can
  ledger exists (Phase 5) cans held and deposit cover are 0, so the deposit on an order is an **estimate**; the driver
  records the real number at delivery.
- The app sends the total the customer saw (`expectedTotalPaise`). If prices changed in between, the order is refused
  with `PRICE_CHANGED` and the new totals, and the app shows them before the customer taps again.

### Orders

- Quantity: customers at most `maxCansPerOrder` (DEMO 10, D-10); the office up to 100. The default quantity is the
  customer's last order, else 2.
- A retry or double tap with the same `clientRequestId` returns the same order (200) instead of a second one.
- Order numbers come from a per-supplier counter (`suppliers.next_order_no`, from 1001) and show as `WD-1001`.
- Status: `PLACED → ACCEPTED` automatically when `autoAcceptOrders` is on (D-14; recorded as "Automatic") and always
  for orders the office enters (recorded as that office user). With auto-accept off, the office accepts one by one or
  in bulk. Rejecting or cancelling by the office needs a reason. Customers can cancel until the order is
  `OUT_FOR_DELIVERY` (R-08). Every change is a row in `order_status_history`, which a database trigger makes
  append-only.
- The office list shows only the last 4 digits of a phone number; the full number is on the order page.

## Consequences

- Driver assignment, delivery, the can ledger and the real deposit arrive in Phase 5; payments and dues in Phase 6.
- Real prices, delivery times and capacities are DEMO values to replace from the Settings page before launch.
