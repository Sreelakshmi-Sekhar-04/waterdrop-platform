# ADR 0006: The Today page, reports, the activity log, complaints and customer messages

**Status:** Accepted (Phase 7, 20 Nov 2026). Follows the Phase 7 plan in `PHASE-0-ANALYSIS.md` (dashboard
inbox, reports, audit viewer, settings) and approved decisions C-11, D-11 and §11 #13 (simple complaints). The
choices below fill in details those decisions left open. None changes what was approved.

## Decision

### Today page (C-11)

- One server call (`GET /admin/dashboard`) returns three parts: **needs attention**, **today so far** and **each
  route**. The page refreshes every minute.
- "Needs attention" lists only things with something to do, each with one button to the page that does it:
  orders to accept, today's orders not given to a driver, failed deliveries to re-book, ended routes to check
  (with the cash difference), open complaints, UPI payments to check in the bank, and **low stock** (tomorrow's
  booked cans are more than the full cans at the depot and on the vans). Nothing to do shows "Nothing needs you
  right now."
- All numbers come from the same tables the other pages use (orders, attempts, payments, ledgers, stock). The
  demo fixtures used by the Phase 2 Today page are removed.

### Reports (Phase 0 §13.3)

- Six reports: **sales** (per day: deliveries, cans, sales, deposits, cash, UPI, deposit refunds), **dues** (per
  customer: due, credit limit, days owing and an age bucket 0–7, 8–30, 31–60, 61+), **cans with customers** (cans
  held against what the deposit covers, days since the last delivery or pickup), **delivery staff** (per route:
  delivered, failed, cans, empties, cash expected, handed over, difference), **deliveries** (on time, late, failed,
  and why) and **stock** (movements in the dates, plus where every can is now and whether the customer cans match
  the deliveries).
- Sales, staff, deliveries and stock take a date range (default the last 7 days, at most 366 days, `BAD_RANGE`
  otherwise). Dues and cans are "as of now".
- Every report downloads as **CSV** (UTF-8 with a byte-order mark so Excel shows ₹ and Malayalam names, CRLF lines,
  RFC 4180 quoting). Column headers are stable English keys so a spreadsheet keeps working if the language
  changes. A cell starting with `= + - @` or a tab is prefixed with `'` so a spreadsheet never runs it as a
  formula (CSV injection). Phones show only the last 4 digits.

### Activity log (audit viewer)

- The Reports page has an **Activity log** tab: who did what and when, newest first, 50 at a time ("Show more"),
  filtered by kind of action (a prefix such as `order` or `payment`) and by day. The before and after values are
  shown on request. Action names are translated; an unknown one shows its code.
- The API also filters by record and by person (`entityType`, `entityId`, `actorUserId`) for later use.

### Business settings

- Settings gains **Business details** (name, GSTIN, FSSAI licence; shown on statements) and **Business rules**
  (deposit per can, delivery charge, free delivery from, same-day cut-off, most cans in one order, minutes the
  delivery person can undo, customer help phone, accept orders automatically). Only the **owner** changes them;
  office admins see them read-only. Only the values that changed are sent, so the activity log shows exactly
  what changed. The rules installed at setup are still the DEMO values from the change log Part 4.

### Complaints (§11 #13, kept simple)

- Five kinds: can count wrong, water quality or damaged can, late delivery, payment, something else (which needs a
  few words). A complaint may name one of the customer's orders.
- The customer reports one from Help in the app; the office notes one from a phone call on the customer page.
  Each carries a `clientRequestId`, so a double tap saves one complaint (the customer row is locked first, so even
  two requests at the same moment save one).
- The office resolves it with a short note. The note is written for the customer: it appears under the complaint
  in the app and as a message. A complaint cannot be resolved twice (`ALREADY_RESOLVED`). There is no reopen; the
  customer reports again.

### Messages to customers

- Six kinds: out for delivery (when the route starts), delivered (cans, money received, amount still due), not
  delivered (with the reason), order cancelled or rejected by the office, dues reminder, complaint resolved.
- **Outbox pattern.** A message row is written in the same database transaction as the change it reports, so a
  message is never lost or sent for a change that was rolled back. After each request that changes something, a
  dispatcher claims waiting rows (`FOR UPDATE SKIP LOCKED`, so two servers never send one twice) and sends pushes.
  Each row ends as sent, no device (the customer has not allowed notifications) or failed. Pushes are not retried;
  the message is still in the app.
- The text is written by the server in the customer's language when it is read or sent, from the kind and its
  values. Messages never contain phone numbers.
- **Push provider** (`PUSH_PROVIDER`): `expo` (Expo push service, `EXPO_ACCESS_TOKEN` optional), `dev-outbox`
  (writes to a local file; refused in production) or `none`. A token the push service reports as gone is
  deleted.
- **Registering a phone for push** needs an EAS project and a built app, so the app does not yet ask for
  notification permission. The server side (`POST /me/push-tokens`) is built and tested; the app side is
  Phase 8. Until then customers read messages on the new **Messages** screen (unread count on Home); opening it
  marks them read.
- **Dues reminder** is pressed by the office on the Dues list, at most once in 24 hours per customer
  (`REMINDED_RECENTLY`), never when nothing is due (`NOTHING_DUE`). It is a push and app message, not an SMS:
  SMS needs a DLT-approved template per message, which is a launch item.

### Help in the customer app

- Call us and WhatsApp us use the business's help phone from Settings (`tel:` and `wa.me`). Without a number the
  app says so and offers "Report a problem".

## Consequences

- An office "undo" of a delivery does not take back the "Delivered" message already sent; the next message
  (for example the re-delivery) supersedes it.
- Reports are computed on request from the ledgers. At the expected size (a few hundred customers, a year of data)
  this is fast enough; materialised summaries can be added later without changing the API.
- The Today page's "low stock" compares tomorrow's bookings with full cans now; it does not predict filling.
