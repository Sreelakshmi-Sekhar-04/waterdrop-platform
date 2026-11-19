# WtrDrop: Requirement Change Log and Decision Register

**Purpose:** No original requirement is silently lost. Every proposed change to the original requirements, and every open decision, is listed here with its status. Change the status here only when Sreelakshmi approves or rejects an item.

**Source of original requirements [ORIG]:** "WtrDrop – Master Product Development & Implementation Prompt", 19 Nov 2026 (project thread). There is no separate requirements document, as confirmed by Sreelakshmi on 19 Nov 2026.

**Status values:** `Proposed` · `Approved` · `Rejected` · `Approved with changes` · `Deferred`

Details and reasoning for each item are in `PHASE-0-ANALYSIS.md` (section shown).

---

## Part 1: Changes to original requirements

| ID | Original requirement [ORIG] | Proposed change [PROP] | Type | § | Status | Decided on / by |
|---|---|---|---|---|---|---|
| C-01 | Order lifecycle step `ACCEPTED` (manual) | Auto-accept valid orders. Manual review only for flagged ones. Configurable. | Essential | 6 R-01, 14 | Proposed | |
| C-02 | `FAILED_DELIVERY` order status | Becomes a delivery-attempt outcome. The order moves to `RESCHEDULE_PENDING`. | Essential | 6 R-02, 14 | Proposed | |
| C-03 | Lifecycle has no partial-delivery state | Record `qty_delivered`. Close with a shortfall, or add `PARTIALLY_DELIVERED`. | Essential | 6 R-03, 14 | Proposed | |
| C-04 | Reserve stock when orders are accepted | Reserve daily/slot capacity at placement. Track physical stock separately. | Essential | 6 R-04/R-05, 14 | Proposed | |
| C-05 | Staff: separate "Delivery schedule" and "Delivery confirmation" features | Merge into the route list and one Delivered screen | Recommended | 2B, 14 | Proposed | |
| C-06 | Per-stop OUT_FOR_DELIVERY updates (implied) | One "Start route" action for all stops | Recommended | 14 | Proposed | |
| C-07 | Customer cart and checkout | Single-screen order. Cart only if there is more than one product. | Recommended | 2A, 14 | Proposed | |
| C-08 | Delivery tracking (open-ended) | Status tracking + "you're stop N". No live GPS map. | Recommended | 14, 16 | Proposed | |
| C-09 | Razorpay online payments (subject to approval) | Postpone. Keep the provider interface. | Recommended | 14, 16 | Proposed | |
| C-10 | Guest checkout (option to evaluate) | Do not offer it. Phone OTP only. | Recommended | 6 R-11, 14 | Proposed | |
| C-11 | Dashboard KPI highlights | Lead with a Needs-attention inbox, KPIs second. All listed KPIs kept. | Recommended | 7, 14 | Proposed | |
| C-12 | Appium for mobile automation | Maestro, with Appium as fallback | Recommended | 12, 14 | Proposed | |
| C-13 | `supplier_documents` table | Defer until a second supplier is onboarded | Optional | 14 | Proposed | |
| C-14 | Phase order: UI → Auth → Ordering → Delivery → Inventory/Payments/Ledger → Admin → QA | Vertical slices. Ledger, payments recording and inventory built with delivery. QA in every phase. | Essential | 6 R-13/R-14, 13, 14 | Proposed | |
| C-15 | Customer and staff may share one app | Keep for MVP (confirm) | Confirm | 6 R-12 | Proposed | |
| C-16 | JMeter for performance | Keep. k6 is optional. | Optional | 14 | Proposed | |

### Original requirements kept as written

These are recorded so nothing is lost. All other original modules (customer 1–17, staff 1–12, admin 1–16), business rules (§9 of the prompt), the database table list (§10), security (§11), the QA scenarios 1–12 (§12) and the coding standards (§14) are **kept as written**. The only exceptions are the items in Part 1, where a feature is merged or simplified, never removed. Specifically:

- Staff "Delivery schedule" (B3) and "Delivery confirmation" (B11) are **merged**, not removed (C-05).
- Customer "Cart and checkout" (A7) is **simplified** while one product exists (C-07).
- Admin "Full-can and empty-can tracking" (C8) is **merged** with Inventory (C7) as two views of one can pool.
- Order statuses `REJECTED`, `CANCELLED` and `FAILED_DELIVERY` are all kept. `FAILED_DELIVERY` moves to the attempt level (C-02).

---

## Part 2: Additions not in the original requirements

| ID | Addition | Category | § | Status |
|---|---|---|---|---|
| A-01 | Admin creates orders on behalf of customers | Must Have | 5 M-01, 15 | Proposed |
| A-02 | Customer dues / account ledger + credit limit | Must Have | 5 M-02, 15 | Proposed |
| A-03 | Vehicle load-out and day-end reconciliation (cans + cash) | Must Have | 5 M-03, 15 | Proposed |
| A-04 | Opening-balance import at go-live | Must Have | 5 M-04, 15 | Proposed |
| A-05 | Deposit charge/refund rules | Must Have | 5 M-05, 15 | Proposed |
| A-06 | Damaged / lost / foreign can handling | Must Have | 5 M-06, 15 | Proposed |
| A-07 | Offline action queue for staff | Must Have | 2B, 15 | Proposed |
| A-08 | Staff undo window (10 min) | Must Have | 5, 15 | Proposed |
| A-09 | Order cut-offs, holidays, staff-absence reassignment | Must Have | 5 M-11–13, 15 | Proposed |
| A-10 | Customer delivery notes | Must Have | 5 M-17 | Proposed |
| A-11 | Forced app update | Must Have | 5 M-19 | Proposed |
| A-12 | GPS + timestamp on delivery | Recommended | 15 | Proposed |
| A-13 | Standing / recurring orders | Recommended | 15 | Proposed |
| A-14 | Walk-in / on-route sale | Recommended | 5 M-08 | Proposed |
| A-15 | Pickup-only visit | Recommended | 5 M-07 | Proposed |
| A-16 | Customer types and negotiated prices | Recommended | 5 M-09 | Proposed |
| A-17 | Simple invoices / receipts | Recommended | 5 M-10 | Proposed |
| A-18 | "Low cans" reorder nudges | Optional | 15 | Proposed |
| A-19 | WhatsApp notifications | Optional | 15 | Proposed |
| A-20 | Delivery photo | Optional | 15 | Proposed |
| A-21 | Duplicate-customer merge | Recommended | 5 M-16 | Proposed |
| A-22 | Customer deactivation / data deletion (DPDP Act) | Must Have | 5 M-15 | Proposed |
| A-23 | Order price and address snapshots | Must Have | 5 M-21, 9 | Proposed |
| A-24 | Refund records | Must Have | 5 M-22 | Proposed |

---

## Part 3: Decision register

| ID | Decision | Recommendation | Status | Answer |
|---|---|---|---|---|
| D-01 | Auth: OTP only vs guest checkout | OTP only | Approved | Recommendation accepted (Sreelakshmi, 19 Nov 2026) |
| D-02 | Staff login (OTP + device PIN); admin login | Staff OTP+PIN, admin OTP+password | Approved | Recommendation accepted (Sreelakshmi, 19 Nov 2026) |
| D-03 | Pay-later eligibility and credit limits | Per customer, warn, never block at the door | Approved | Recommendation accepted (Sreelakshmi, 19 Nov 2026) |
| D-04 | Deposit amount and rules | Per can held, warn above cover | Approved | Recommendation accepted (Sreelakshmi, 19 Nov 2026) |
| D-05 | Failed/partial delivery model | Attempt model, close with shortfall | Approved | Recommendation accepted (Sreelakshmi, 19 Nov 2026) |
| D-06 | Service-area method | Localities/pincodes + radius safety net | Approved | Recommendation accepted (Sreelakshmi, 19 Nov 2026) |
| D-07 | Slots: exact vs broad windows, same-day, cut-offs | Broad windows, same day before cut-off | Approved | Recommendation accepted (Sreelakshmi, 19 Nov 2026) |
| D-08 | Limit by stock or by delivery capacity | Capacity, with stock tracked separately | Approved | Recommendation accepted (Sreelakshmi, 19 Nov 2026) |
| D-09 | Default "empties collected" value | Equal to full delivered | Approved | Recommendation accepted (Sreelakshmi, 19 Nov 2026) |
| D-10 | Default and max order quantity | Last ordered, max 10 | Approved | Recommendation accepted (Sreelakshmi, 19 Nov 2026) |
| D-11 | Office pricing / monthly billing | Yes | Approved | Recommendation accepted (Sreelakshmi, 19 Nov 2026) |
| D-12 | Delivery charge rule | Per area, free above N | Approved | Recommendation accepted (Sreelakshmi, 19 Nov 2026) |
| D-13 | Leave-at-door | Later, per customer | Approved | Recommendation accepted (Sreelakshmi, 19 Nov 2026) |
| D-14 | Auto-accept orders | Yes | Approved | Recommendation accepted (Sreelakshmi, 19 Nov 2026) |
| D-15 | One shared customer/staff app | Confirm | Approved | Recommendation accepted (Sreelakshmi, 19 Nov 2026) |
| D-16 | Vertical-slice phase order | Approve | Approved | Recommendation accepted (Sreelakshmi, 19 Nov 2026) |
| D-17 | OTP provider | MSG91 behind an interface | Approved | Recommendation accepted (Sreelakshmi, 19 Nov 2026) |
| D-18 | Hosting | Managed, Mumbai region | Approved | Recommendation accepted (Sreelakshmi, 19 Nov 2026) |
| D-19 | Payment gateway timing | After MVP | Approved | Recommendation accepted (Sreelakshmi, 19 Nov 2026) |
| D-20 | Maestro instead of Appium | Approve | Approved | Recommendation accepted (Sreelakshmi, 19 Nov 2026) |

---

## Part 4: Working assumptions for business facts (placeholders, not confirmed)

These are **demo values** used for seeds, mockups and tests. Every one of them is an admin setting, not hardcoded, and is replaced with the owner's real numbers before launch.

| Fact (§17 Q) | Working assumption |
|---|---|
| Q1 Volume | ~500 customers, ~150 orders/day normal, ~300 at summer peak |
| Q2 Staff/vehicles | 3–5 staff, 2–3 vehicles, each vehicle has a home area |
| Q3 Can pool | ~1,500 cans owned |
| Q4 Prices | ₹40 per 20L can, delivery free (charge rule configurable), deposit ₹150 per can |
| Q5 Products | 20L can only at launch (dispenser/pump can be added later) |
| Q6 Hours | Mon–Sat, 7 am–7 pm. Same-day cut-off 2 pm. Sunday closed. |
| Q7 Areas | Admin-defined localities + pincodes |
| Q8 Current records | Notebook/Excel. Opening balances imported via a CSV template. |
| Q9 UPI | One business QR. Staff record the payment, the admin verifies. |
| Q10 GST/FSSAI | Fields provided in settings. Invoice rules to confirm with an accountant before invoices are built. |
| Q11 Lost/damaged can | Charged at the deposit value (configurable) |
| Q12 Competitor cans | Not accepted. Recorded as "foreign can" if collected. |
| Q13 Admin users | Owner + optional office staff role with limited permissions |
| Q14 Staff phones | Android 10+, budget phones. Design for 5.5" screens and low memory. |
| Q15 Staff language | Malayalam default for staff, switchable |
| Q16 Translation review | Native-speaker review needed before launch |
| Q17 Store accounts | Needed in the business's name before release (Phase 8) |
| Q18 Launch target | Before summer peak (target March 2027), to confirm |

## History

| Date | Change | By |
|---|---|---|
| 2026-11-19 | Log created with Phase 0 proposals C-01–C-16, A-01–A-24, D-01–D-20. All Proposed or Pending. | Claude (Phase 0) |
| 2026-11-19 | Confirmed there is no separate requirements document. The master prompt is the full [ORIG] source. | Sreelakshmi |
| 2026-11-19 | "Go with your recommendations" for §17. Read as: all decisions D-01 to D-20 approved as recommended. The business facts (prices, volumes, areas, etc.) become configurable placeholder values, clearly labelled as demo data, to be replaced by the owner's real values before launch (Part 4). | Sreelakshmi |
| 2026-11-19 | No logo or UI reference exists. Claude to design both: simple, few colours, logo conveys water delivery, comfortable for all ages, minimum clicks. | Sreelakshmi |
