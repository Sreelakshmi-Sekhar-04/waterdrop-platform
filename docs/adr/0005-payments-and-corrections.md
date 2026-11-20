# ADR 0005: Payments, dues and corrections

**Status:** Accepted (Phase 6, 20 Nov 2026). Follows approved decisions D-03, D-04, D-11, D-19 and M-04, M-05,
M-22 from `REQUIREMENTS-CHANGELOG.md`. The choices below fill in details those decisions left open. None changes
what was approved.

## Decision

### Payments the office takes

- The office records a payment (cash at the depot, or UPI paid straight to the business) from the customer page or
  the Dues list. Each payment form carries a `clientRequestId`: pressing Save twice, a retry after a lost
  connection or a second tab all record **one** payment (scenario 8). The same id for another customer is refused
  (`REQUEST_REUSED`). The route also takes an `Idempotency-Key`.
- A payment has a **paid on** date (today or earlier, never later). Delivery payments take the delivery date.
  Existing payments were back-filled from their creation time in India.
- **Cash** recorded by the office is treated as received. **UPI** stays "Check in bank" until someone presses
  Received after seeing it on the bank statement. Checking twice is harmless.
- **Not received** (cash missing from the day bag, UPI that never arrived) needs a reason. It writes a reversing
  entry on the customer's account and marks the payment; nothing is deleted, and the payment stays in the list.
  A payment already undone by the delivery person (or by the office) is never reversed twice.
- D-19: no payment gateway. Scenario 8 (duplicate callbacks) is covered by the idempotent office payment above;
  the same rule will apply to gateway callbacks when a gateway is approved.

### Dues and credit limits (D-03)

- The Dues list shows every customer who owes, largest first, with the area, the last 4 digits of the phone,
  **owing since** (the first entry after the account was last at zero or in credit), last payment date and whether
  they are over their limit. More than 30 days is marked.
- Only the **owner** sets a customer's credit limit. Above it the office and the delivery person see a warning;
  nothing is ever blocked. A limit of ₹0 means "no credit".
- Reminders to customers (SMS) are not sent yet; they come with notifications in Phase 7.

### Deposit refunds (D-04, M-05, M-22)

- The deposit can be given back only for cans that came back: refundable cans = cans the deposit covers − cans the
  customer holds. The amount is the deposit held × cans refunded ÷ cans covered (rounded down to the paisa), and a
  full refund returns everything left.
- The office chooses how: cash, UPI, or **take it off the dues**. The last writes a `deposit_refund` entry on the
  money account, shown to the customer as "Deposit refund, off the dues". Every refund is a record of its own
  (`deposit_refunds`), also listed on the Payments page for the day.

### Corrections

- The office types what is true now (cans held, deposit, cans covered, amount due) and a reason. Each difference is
  saved as an `adjustment` entry with the reason and an audit record of before and after. Past entries never change.
- A change in cans held is also a stock movement between the customer and "outside", so the can pool still adds up.

### Opening balances (M-04)

- Owner only. A CSV (`phone,name,cans_held,deposit_rupees,deposit_cans,due_rupees`, up to 2,000 lines) is checked
  in the browser first, then by the server with **nothing saved** (preview), then imported in one transaction.
- New phone numbers become customers (name needed). A customer who already has any ledger entry is skipped
  (`HAS_ENTRIES`), so the file can be run again safely. Numbers belonging to office or delivery staff are refused.
- Opening cans move from "outside" to the customer in the stock log.

### Monthly statement (D-11)

- One month of the money account: start, charged, paid and credited, end, every entry with order number, cans and
  method, plus cans delivered and returned and the deposit. The office's page prints on A4; the customer sees the
  same numbers in the app without the office's notes, for this month and the 24 before it.

## Consequences

- Every money change is a ledger entry, so the statement, the dues list and the customer page always agree.
- There are no edits or deletes of money: mistakes are fixed by new entries with a reason, visible to the owner.
- Malayalam texts for these screens are drafts and need a native speaker's review.
