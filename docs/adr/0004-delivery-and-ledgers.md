# ADR 0004: Delivery, ledgers and can stock

**Status:** Accepted (Phase 5, 20 Nov 2026). Follows approved decisions D-03, D-04, D-05, D-09 and R-07, R-10, M-03,
M-13 from `REQUIREMENTS-CHANGELOG.md`. The choices below fill in details those decisions left open. None changes
what was approved.

## Decision

### Routes (trips)

- A route is **one delivery person on one day** (`trips`, unique per supplier, person and date). There is no
  vehicles table yet: the business has one van per person. A vehicle can be added to a route later without changing
  anything else.
- The office gives accepted orders of a day to a delivery person; that creates the route if needed. Stops can be
  re-ordered (arrow buttons, manual is enough per Phase 0 §2B), taken off, or the whole route given to someone else
  (M-13) **until the route starts**. After that the office re-books failed orders instead.
- Route states: `planned → on_route → ended → reconciled`.

### The delivery person's day (R-10, D-05, D-09, R-07)

- A delivery person sees only their own route; any other route or order answers "not found" (scenario 2).
- **Start route** records how many full cans were loaded (pre-filled with the cans on the route) and moves the
  orders to "Out for delivery".
- **Delivered**: full cans given (1 to the quantity ordered), empties taken (default = min(full, cans they hold),
  D-09), and payment (cash, UPI or pay later, D-03). Fewer cans than ordered closes the order as delivered, with the
  reason in the history (D-05). Empties beyond what the customer holds are received but not taken off their
  balance; they are recorded as `extraEmpties` and shown to the office (R-07).
- **Couldn't deliver**: a reason from a fixed list (a note is needed for "Something else"). The order goes to
  "Reschedule pending" and its cans in the delivery time are given back.
- **Undo** is possible for `staffUndoWindowMinutes` (10). It writes reversing entries (never deletes) and puts the
  order back to "Out for delivery". For a failed stop it books the delivery time again without a capacity check,
  because those cans were already promised.
- **End day**: only when no stop is left. The person counts full, empty and damaged cans on the van and the cash in
  hand; the app shows what it expects. The expected and counted numbers are both stored.

### One transaction per delivery (scenario 11)

A delivery confirmation writes, in **one database transaction** with the customer row locked: the attempt, the can
ledger (delivered, returned), the deposit charge, the account charge, the payment and its credit, the quantity
delivered, the order status and history, the stock movements (van → customer full, customer → van empty) and the
audit entry. If any part fails, nothing is saved.

### Offline

- The phone keeps a queue of actions (start, delivered, couldn't deliver, end day) and the last copy of the day. With
  no signal the person keeps working; the queue sends in order when the signal returns.
- Each action carries a `clientActionId` (unique per supplier). Sending the same action again returns the first
  result, so a retry never records a second delivery.
- Undo needs a signal (it is a correction, and the time limit is checked by the server).

### Ledgers (D-03, D-04, scenario 5)

- Three append-only ledgers per customer: **cans** (held), **deposit** (money held and how many cans it covers) and
  **account** (positive = the customer owes). Each entry stores the balance after it, and the customer row keeps the
  current balances, updated in the same transaction. Tests check that the stored balances always equal the sum of
  the entries. A database trigger refuses UPDATE, DELETE and TRUNCATE on the ledgers and on stock movements.
- Mistakes are fixed with reversing entries that point at the entry they reverse.
- Deposit is charged for cans held beyond what the deposit already covers (D-04). It is **never refunded
  automatically** when cans come back; refunds are an office action (Phase 6).
- Pay later is always allowed at the door (D-03). If the balance goes above the customer's credit limit the attempt
  is flagged `overCreditLimit` and the office sees it; delivery is never blocked. The credit limit defaults to ₹0 and
  becomes editable in Phase 6.

### Can stock and day-end check (M-03)

- Stock is never a typed total. It is the sum of `stock_movements` between places (depot, van, customer, damaged,
  outside) and states (full, empty, damaged). Routes move cans automatically; the office records cans filled at the
  plant, new cans bought, damaged cans thrown away, and a depot count (the difference from the system is recorded
  with a note).
- The office checks each ended day. Any difference between expected and counted (full, empty, cash) needs a note;
  closing the day writes the difference off the van so the van count returns to 0 and every can is accounted for:
  depot + vans + customers + damaged = all cans.

### Order status

- New allowed change for the office: `RESCHEDULE_PENDING → ACCEPTED` (a new day and time, capacity booked again with
  the office rule from ADR 0003). The order then waits for a delivery person again.

## Left for later

- Walk-in sales at the depot (M-08) and a customer choosing their own new time after a failed delivery.
- Payment checking (UPI), dues lists, editing the credit limit, deposit refunds, opening balances and office
  corrections to ledgers: Phase 6.
- Vehicles, and automatic route ordering by map.

## Consequences

- Every can, rupee and deposit change has an entry that explains it, and balances can be rebuilt from the entries.
- Offline use is safe to retry, at the cost of a small queue on the phone that must be sent before signing out (the
  app blocks sign-out while it is not empty).
