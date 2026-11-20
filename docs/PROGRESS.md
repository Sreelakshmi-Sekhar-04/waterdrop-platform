# WtrDrop: Development Progress

Read this file first at the start of every Claude Code session. Update it at the end of every phase, and whenever a decision is made.

## Current state

| Item | Value |
|---|---|
| Current phase | **Phase 7: Admin and reports** (complete, waiting for review) |
| Phase status | Phase 6 approved 20 Nov 2026 ("start Phase 7"). Phase 7 delivered 20 Nov on branch `phase-7-admin-reports` (built on `phase-6-payments`). **Waiting for Sreelakshmi's review** before Phase 8. |
| Next step | Review the Phase 7 report below, then Phase 8 (hardening, performance, security and UAT, with the app builds and push registration). |
| Coding started? | Yes. Do not start Phase 8 until Phase 7 is reviewed. |
| Repository | `github.com/Sreelakshmi-Sekhar-04/waterdrop-platform` (public). Work on branch `phase-7-admin-reports`. |
| Docs location | Repo `docs/` is the source of truth from Phase 1. Project files `wtrdrop/docs/` hold a copy. |

## Key references

- Original requirements: the master prompt in the project thread (19 Nov 2026). There is no separate document.
- `PHASE-0-ANALYSIS.md`: the full analysis (17 sections + repo inspection).
- `REQUIREMENTS-CHANGELOG.md`: proposed changes, additions and the decision register.

## Blockers and prerequisites

1. **GitHub push access**: the Claude GitHub App is not installed on `waterdrop-platform`, so this session cannot push. Install it at https://github.com/apps/claude/installations/select_target before Phase 1.
2. **Brand assets**: none existed. Claude designed the logo (recommended: "delivery drop", alternatives B and C) and UI direction on the design canvas https://claude.ai/artifact/F5STv5tFum7Ny6mumTamoh. Palette: Drop Blue #1769E0, Deep Navy #0B2545, Mist #E6F1FC, Cloud #F4F8FC, Done Green #13795B, Attention Amber #B54708. Type: Nunito + Noto Sans Malayalam. Status: approved with the go-ahead for Phase 1 (19 Nov).
3. **Business facts**: working placeholder values are in `REQUIREMENTS-CHANGELOG.md` Part 4 (demo data, all configurable). Real values needed before launch.
4. **Lead-time items to start early**: SMS DLT registration (2 to 4 weeks), Apple/Google developer accounts in the business's name.
5. **Real SMS (from Phase 3)**: an MSG91 account in the business's name, a DLT-approved OTP template, and `MSG91_AUTH_KEY` / `MSG91_TEMPLATE_ID` set on the server. Until then only the development outbox works.

---

## Phase log

### Phase 0: Repository inspection and planning (19 Nov 2026)

1. **Completed:** Repository inspection (empty). Full 17-item analysis. Change log and decision register. This progress file.
2. **Files created:** `wtrdrop/docs/PHASE-0-ANALYSIS.md`, `REQUIREMENTS-CHANGELOG.md`, `PROGRESS.md` (project files). No repository files.
3. **Architecture and design decisions:** Proposed only (analysis §8–§11). None approved.
4. **APIs and database changes:** None implemented. Proposed ERD (§9) and API overview (§11).
5. **Tests executed:** None. This was a planning phase with no code.
6. **Actual test results:** Not applicable.
7. **Known defects and limitations:** None, since there is no code. Push access is missing (see blockers).
8. **Security considerations:** Repo is public. Decide whether it should be private before any config or data goes in.
9. **Pending decisions:** D-01–D-20 (later approved as recommended, see follow-up).
10. **Recommendations:** See analysis §14–§16. The most important are C-14 (vertical slices), A-01 to A-04 (admin orders, dues ledger, day-end reconciliation, opening balances).
11. **Deviations from original requirements:** None applied. All are proposals (C-01–C-16).
12. **Recommended next step:** Approve or adjust the decisions, install the GitHub App, then start Phase 1 (foundation).

### Phase 0 follow-up (19 Nov 2026, afternoon)

- Sreelakshmi: "go with your recommendations". D-01 to D-20 marked Approved. Business facts recorded as labelled placeholders (changelog Part 4).
- No logo or UI reference existed. Designed them on the canvas linked above: logo (3 concepts, A recommended), colour/type/button system, 5 mobile screens (customer home, order sheet, order placed, staff route, staff delivered) and the admin "Today" page. Order sheet and staff Delivered screens are clickable.
- Still no code. Phase 1 starts after approval of the logo/UI and GitHub App access.

---

### Phase 1: Project foundation (19 Nov 2026)

**1. What was completed**
- pnpm monorepo: `apps/api`, `apps/admin`, `apps/mobile`, `packages/shared`, `packages/design-tokens`; shared TypeScript, ESLint and Prettier config.
- Shared business rules: order state machine (C-01, C-02, D-05, D-14, R-08), can-ledger maths (R-06, R-07), money in paise with Indian formatting, Indian mobile number validation, the API error shape.
- Design tokens from the approved design, with an automated WCAG AA contrast check.
- PostgreSQL schema and migrations for platform tables: suppliers, users, user_roles, sessions, otp_requests, audit_logs (append-only trigger), idempotency_keys, settings. Idempotent seed with one DEMO supplier and DEMO settings.
- API skeleton: validated environment config, request ids, structured logs with phone/secret redaction, helmet security headers, strict CORS allow-list, rate limiting, JSON size limit, Bearer access-token verification, deny-by-default role checks, tenant context from the token only, Idempotency-Key duplicate protection, audit helper, single error format.
- API routes: health, `/me`, admin settings (read: admin/owner; change: owner only, audited), admin audit-log list.
- Admin portal shell: branded layout, navigation for all sections, Today page with honest empty states, live server status, English/Malayalam switch that is remembered.
- Mobile app shell: Expo SDK 58 + Expo Router, welcome screen with logo and one-tap language choice, customer and staff route groups kept apart by role, Nunito + Noto Sans Malayalam fonts.
- GitHub Actions CI: lint, typecheck, unit + integration tests on PostgreSQL 16, admin browser tests, Android bundle check.
- README, ADR 0001, docs moved into the repo.

**2. Files created** — the whole repository (first commit). Key paths: `apps/api/src/**`, `apps/api/src/db/migrations/0000_platform_foundation.sql`, `0001_audit_log_append_only.sql`, `apps/admin/src/**`, `apps/mobile/src/**`, `packages/*/src/**`, `.github/workflows/ci.yml`, `docs/adr/0001-foundation-stack.md`.

**3. Architecture and design decisions** — see `docs/adr/0001-foundation-stack.md`. Notable: Phase 1 creates platform tables only; business tables arrive with their features (vertical slices, C-14). A null setting is stored as "absent" because jsonb columns are NOT NULL.

**4. APIs and database changes** — 5 endpoints (README table); 8 tables, 4 enums, 1 trigger function with 2 triggers.

**5. Tests executed** (all run on 19 Nov 2026 in the development container, PostgreSQL 16.15)
- `pnpm lint` (ESLint), `pnpm typecheck` (all 5 packages), `prettier --check`
- `packages/shared`: 20 unit tests (state machine incl. every invalid from×to pair, can ledger incl. 500-step random sequence, money, phone numbers)
- `packages/design-tokens`: 12 contrast tests
- `apps/api`: 29 tests against a real PostgreSQL database per test file
- `apps/admin`: 10 Playwright tests (5 scenarios × desktop and phone)
- `apps/mobile`: `expo export --platform android` bundle build, plus a web export viewed in a browser

**6. Actual test results** — all passed: 61 unit/integration tests, 10 browser tests, mobile bundle built (3 MB Hermes bundle). The API suite was run 3 times in a row with no flakiness after fixing the issues below.

**7. Known defects and limitations**
- No sign-in yet (Phase 3). The apps show clear "arrives in Phase 3" notices; there is no fake login. In development builds the mobile customer/staff screens open as a marked preview; release builds redirect to the welcome screen.
- Malayalam strings are draft translations and need a native speaker's review (§17 Q16).
- Mobile UI automation (Maestro) starts in Phase 3, when there are real flows to test.
- `expo install` could not reach Expo's servers from the development container; SDK-matched versions were installed from Expo's own `bundledNativeModules.json`. Run `npx expo-doctor` on a normal network to confirm.
- CI has not run on GitHub yet because the branch could not be pushed (see blockers).

Defects found and fixed during Phase 1: (a) clearing an optional setting (`supportPhone: null`) failed because jsonb columns are NOT NULL; now removes the setting, with a test. (b) An idle database connection dropped by the server could crash the API process; the pool now handles it.

**8. Security considerations** — secrets only from environment (start-up refuses weak JWT secrets); tokens verified for signature, issuer, audience and expiry; role re-checked against the database on `/me`; supplier from token only; audit log tamper-proof at database level; PII masked in logs and audit snapshots; repo is public, so no real data or credentials may ever be committed.

**9. Pending decisions** — none new. Phase 3 will need the OTP provider account (D-17, MSG91 recommended) and DLT registration started.

**10. Recommendations** — start SMS DLT registration and Apple/Google developer accounts now (long lead times). Consider making the repository private before real business data or production config exists.

**11. Deviations from the original requirements** — none beyond the approved change log. The original Phase 1 included "database" broadly; only platform tables were created now, per approved C-14 (vertical slices).

**12. Recommended next step** — Phase 2: build the reusable UI components (buttons, steppers, cards, status chips, inputs, empty/error/loading states) and the static key screens for both apps from the approved design, for your review.

---

### Phase 2: Design system and static screens (19 Nov 2026)

**1. What was completed**
- Mobile components from the approved design: Button (primary, secondary, warning), Stepper (big − / +), Card, StatusChip (always word plus icon), ChoiceList (radio cards), TextField, Message, Header with 48 px back button, bottom navigation, loading skeleton, empty and error states (including offline).
- Customer screens: Home (2-tap reorder), Order (one screen, pre-filled), Order placed, My orders (Order again), Help (call, WhatsApp, common problems). Sign-in layout: phone number and 6-digit code screens (layout only; no code is sent).
- Staff screens: Today's route, Delivered (one screen: full cans, empties, payment, live can balance using the real ledger rule), Couldn't deliver (one tap reason; note required only for "Something else").
- Admin portal pages: Today (attention cards that link to the work, today's numbers, drivers table), Orders (filters, select orders waiting for a driver, simulated assign), Customers (search by name, area or last 4 phone digits), Customer detail (cans, deposit, dues, append-only can history with a reversal, correction dialog that requires a reason).
- Every screen is in English and Malayalam. Every page with made-up numbers shows a "Demo data" badge, and every simulated action says "Nothing was saved".

**2. Files created or changed** — `apps/mobile/src/components/*` (13 new), `apps/mobile/src/app/(auth|customer|staff)/*`, `apps/mobile/src/demo/fixtures.ts`, `apps/mobile/e2e/screens.spec.ts`, `apps/mobile/playwright.config.ts`; `apps/admin/src/components/{ui,Dialog}.tsx`, `apps/admin/src/pages/{Today,Orders,Customers,CustomerDetail}Page.tsx`, `apps/admin/src/demo/fixtures.ts`, `apps/admin/e2e/pages.spec.ts`; `packages/shared/src/schemas.ts` (phone input cleaning); `scripts/check-i18n.mjs`; CI workflow.

**3. Architecture and design decisions** — Demo data lives only in `demo/fixtures.ts` files, so Phases 3 to 7 replace them with API calls in one place. On the web the Stepper is a labelled group of two buttons; on Android/iOS it is one swipe-adjustable control for screen readers. Admin tables scroll inside their box at phone width so the page never scrolls sideways.

**4. APIs and database changes** — none. Phase 2 is screens only.

**5. Tests executed** (all run on 19 Nov 2026 in the development container)
- `pnpm lint`, `pnpm typecheck` (all packages), `prettier --check`, `pnpm check:i18n` (new: English and Malayalam have the same texts and the same placeholders; checked that it fails on a missing text and on a wrong placeholder)
- `pnpm test`: design tokens 12, shared 26 (6 new phone input cases), API 29 against PostgreSQL 16
- Admin Playwright: 18 scenarios × desktop and phone = 36, including axe WCAG 2 A/AA checks on all 4 built pages
- Mobile Playwright (new): 16 tests at Pixel 7 size on the Expo web build, including axe checks on 10 screens
- `expo export --platform android` bundle build

**6. Actual test results** — all passed: 67 unit/integration tests, 36 admin browser tests, 16 mobile browser tests, translation check, Android bundle.

Defects found by the new tests and fixed: (a) pasting "98470 12345" into the phone field cut the last digit, because the field's 10-character limit counted the space. The field now cleans spaces, dashes and +91/0 before limiting (shared `normaliseMobileInput`, with tests). (b) Light blue text on the blue home card was slightly below the contrast minimum (4.43:1); now white. (c) Radio choices did not report "selected" to the browser; fixed. (d) The route progress bar had no spoken name; fixed. (e) The "Couldn't deliver" note was labelled "optional" even when it was required; the label now says when it is needed.

**7. Known defects and limitations**
- All data is demo data; buttons that would save something only change the screen and say so. Real sign-in arrives in Phase 3, ordering in Phase 4.
- Mobile tests run in a browser, not on a real phone. Native checks (Maestro on Android) start in Phase 3.
- Malayalam texts are still draft translations and need a native speaker's review.
- Deliveries, Cans and stock, Payments, Reports and Settings in the admin portal are still placeholders for their phases.
- The branch has not been pushed and CI has not run on GitHub (GitHub App still missing, see blockers).

**8. Security considerations** — no new data paths. Phone numbers in admin lists show only the last 4 digits. No credentials or real data added.

**9. Pending decisions** — none new. Please review the screens (screenshots in project files `wtrdrop/phase-2/`).

**10. Recommendations** — have a Malayalam speaker read the screens now, before more text is added. Start SMS DLT registration if not started; Phase 3 needs it.

**11. Deviations from the original requirements** — none.

**12. Recommended next step** — Phase 3: real phone sign-in with OTP (MSG91 recommended, D-17), customer self-registration, staff and admin accounts created by the owner, and the first native app tests.

---

### Phase 3: Sign-in, users and addresses (19 Nov 2026)

**1. What was completed**
- Real sign-in for all three apps, with no fake or test login anywhere (details in `docs/adr/0002-sign-in-and-sessions.md`):
  - Customers: SMS code, then name, language and the privacy notice (DPDP), then the first delivery address. Stays signed in for 90 days of use.
  - Delivery staff: SMS code once on a phone, then a 4-digit PIN every day. Common PINs are refused before the person types it twice. 5 wrong PINs need a new SMS code.
  - Office (admin, owner): SMS code plus a password, which is created at the first sign-in.
- Sessions: 15-minute access tokens, rotating refresh tokens with theft detection, sign-out, and immediate sign-out when the office switches someone off.
- Customer profile and addresses (up to 10, one default, archived on removal, optional GPS location from the phone). An address is accepted only inside an active delivery area, and the PIN code field says so.
- Admin portal is now real for: sign-in, Customers (search by name, area, PIN code or last 4 digits; add a customer who phoned, with a duplicate-number warning; customer detail; addresses; switch off and on), Delivery staff (add, switch off and on, reset PIN), Settings (delivery areas, office accounts for the owner only, change password). Nothing is shown before sign-in.
- Mobile: phone, code, set-PIN, PIN, profile setup, address and Account screens are real. Later-phase screens (orders, route) still show demo data with a banner saying so.
- SMS providers: a development outbox (codes go to a local file, refused in production) and an MSG91 adapter for production (not yet tried against MSG91, see limitations).
- Browser tests now run against the real API and a fresh throwaway database (`apps/api/src/e2e-server.ts`), and CI gives both browser jobs a PostgreSQL service.

**2. Files created or changed**
- API: `src/db/schema.ts`, migration `0002_phase3_users_addresses.sql`, `src/modules/{auth,customers,people,service-areas}/**`, `src/providers/otp/**`, `src/lib/credentials.ts`, `src/lib/tokens.ts`, `src/middleware/auth.ts`, `src/config/env.ts`, `src/db/seed.ts` (DEMO areas), `src/e2e-server.ts`, `test/{auth,people}.test.ts`, `.env.example`.
- Shared: `packages/shared/src/people.ts` (+ tests).
- Mobile: `src/lib/{api,session,storage,errors,customer}.ts(x)`, `src/components/PinPad.tsx`, `src/app/(auth)/{phone,otp,set-pin,pin}.tsx`, `src/app/(customer)/{profile-setup,address,account,home}.tsx`, `RoleGate`, `CustomerNav`, locales, `app.json` (location permission text), `e2e/sign-in.spec.ts`.
- Admin: `src/lib/{api,auth,errors}.ts(x)`, `src/pages/{SignIn,Customers,CustomerDetail,Staff,Settings}Page.tsx`, `src/components/{TeamTable,Layout}.tsx`, locales, `vite.config.ts` (API proxy), `e2e/{signed-out,portal,support}.ts`. The Phase 2 demo customers and can-history demo were removed.
- Docs: `docs/adr/0002-sign-in-and-sessions.md`, README (API table, dev SMS outbox, browser tests), this report, change log. CI workflow.

**3. Architecture and design decisions** — see ADR 0002. In short: an SMS code is the one way in; staff add a PIN per phone and the office adds a password (D-02); refresh tokens are hashed and rotated; the server checks the session on every request; the office portal calls the API on its own address so its sign-in cookie is first-party. Browser tests sign in for real by reading the development SMS outbox, so no test-only login code exists.

**4. APIs and database changes**
- 33 new endpoints (README table): sign-in (8), customer profile and addresses (7), delivery areas (4), office management of customers and their addresses (7), staff (4) and office accounts (3).
- Database: 4 new tables (`customers`, `addresses`, `service_areas`, `staff_devices`), 1 new enum, new columns `users.password_hash`, `sessions.device_id`, `user_roles.status`, partial unique indexes for "one default address" and "one active PIN per phone".

**5. Tests executed** (all run on 19 Nov 2026 in the development container, PostgreSQL 16)
- `pnpm lint`, `pnpm typecheck` (all packages), `prettier`, `pnpm check:i18n` (admin 248 texts, mobile 215)
- `pnpm test`: design tokens 12, shared 31 (5 new), API 78 in 6 files against a real database per file (auth 27, people and addresses 17, OTP providers 5, plus the Phase 1 suites)
- Admin Playwright: 15 scenarios × desktop and phone = 30, against the real API: signed-out view, first sign-in with password creation, reload keeps the session, add a delivery area (PIN code already in another area refused), add a customer who phoned, duplicate number, search, address outside the area refused, switch off and on, add and switch off staff, owner-only office accounts, change password then sign in with the new one (old one refused), Malayalam, axe WCAG 2 A/AA on every page
- Mobile Playwright: 20 tests at Pixel 7 size against the real API, including full customer sign-up to home and account, wrong code, staff SMS code → weak PIN refused → PIN → sign out → wrong PIN → PIN sign-in, and a non-staff number refused
- `expo export --platform android` bundle build

**6. Actual test results** — all passed: 121 unit/integration tests, 30 admin browser tests, 20 mobile browser tests, translation check, Android bundle (3.8 MB).

Defects found and fixed during Phase 3: (a) reusing an old refresh token did not end the session family, because the revoke was rolled back with the error; it now commits first (test added). (b) The "we do not deliver here" message appeared off-screen; it now shows on the PIN code field. (c) A weak PIN was refused only after typing it twice; now at once. (d) The PIN dots had a spoken label the browser could not announce (accessibility check); fixed. (e) Secondary buttons on hover had text slightly below the contrast minimum (4.43:1, from Phase 2); fixed.

**7. Known defects and limitations**
- **Real SMS is not connected.** The MSG91 adapter follows MSG91's Flow API documentation but has never been run against MSG91. It needs the business's MSG91 account and a DLT-approved template.
- Native app tests (Maestro on Android) could not run here: the development container has no Android emulator. The app was tested in a phone-sized browser and the Android bundle builds. Planned to run on a device before release.
- Addresses have no map picker; only an optional "Save my current location" GPS capture.
- Customers sign in with an SMS code each time their 90-day session ends; there is no customer PIN (as approved).
- Malayalam texts are still draft translations and need a native speaker's review.
- Orders, deliveries, payments and the Today numbers are still demo data (Phases 4 to 7).
- The branch has not been pushed and CI has not run on GitHub (GitHub App still missing, see blockers).

**8. Security considerations** — no codes, PINs, passwords or refresh tokens are stored in readable form; phone numbers are masked in logs; the code request does not reveal whether an account exists; limits on codes per number and per IP; PIN and password attempts are limited; office cookie is httpOnly, SameSite=Strict and path-limited; all office changes audited; the dev outbox is refused in production; every query is limited to the signed-in supplier (another supplier's records return "not found"). The repository is public, so the MSG91 key must only ever be set on the server.

**9. Pending decisions** — none blocking. Needed before launch: the business's MSG91 account and DLT template (D-17), and the real delivery areas and PIN codes (replace the 3 DEMO areas).

**10. Recommendations** — start DLT registration now if not started, since real SMS depends on it. Have someone try sign-up on a real Android phone with Expo Go once the code is pushed. Send me the real list of delivery areas and PIN codes.

**11. Deviations from the original requirements** — none. Office sign-in uses SMS code plus password, and staff use SMS once plus a PIN, as approved in D-02.

**12. Recommended next step** — Phase 4: ordering. Customers place and repeat orders in two taps, the office creates orders for phone-in customers, delivery slots and the cut-off time, and order status from placed to assigned.

### Phase 4: Ordering and capacity (19 Nov 2026)

**1. What was completed**
- Customers order in one screen: the quantity is pre-filled with their last order (else 2), the earliest delivery time is pre-selected, and the total (cans, delivery charge, can deposit) is shown before "Place order". A double tap or a retry saves one order. If the price changed meanwhile, the app shows the new total and asks again.
- After placing: confirmation and tracking screen, order list with "Order again", and cancel (two steps) until the order is out for delivery.
- Delivery times with a number of cans each. Capacity is taken when the order is placed and given back on cancel or reject; two customers ordering at the same moment can never overbook. Same-day cut-off (DEMO 14:00) for customers. Closed days (whole day or one time) with a reason.
- Prices: standard can price with dated changes (owner only, today or later), a customer's own price, delivery charge per area with "free above N cans". Every order keeps the price and address it was placed with.
- Automatic acceptance (setting on by default). With it off, the office accepts one by one or in bulk; rejecting or cancelling needs a reason. Every status change is kept in an append-only history.
- Admin portal, now real: **Orders** (any day, capacity per delivery time, filters, search by name, area, last 4 digits or WD-number, bulk accept), **order page** (customer, address, price lines, history, accept / reject / cancel with reason), **New order** for a phone caller from the Orders page, the Today page or a customer's page, the customer's orders and own price on their page, and **Settings** for the can price, delivery times, closed days and area delivery charges.
- The demo orders were removed from the admin portal and the customer app. Today's numbers and drivers are still demo (Phases 5 to 7) and labelled.

**2. Files created or changed**
- Shared: `packages/shared/src/ordering.ts` (+ tests), `people.ts` (area charge fields).
- API: `src/db/schema.ts`, migration `0003_phase4_ordering.sql` (8 tables, 2 enums, append-only trigger), `src/db/seed.ts` (DEMO product, price and 3 delivery times), `src/modules/ordering/{catalog,windows,orders}.service.ts`, `ordering.routes.ts`, `service-areas.service.ts`, `app.ts` (clock for tests), `test/{helpers,orders.test}.ts`.
- Mobile: `src/lib/orders.ts`, `(customer)/{home,order,placed,orders}.tsx`, `RoleGate`, `Screen`, demo fixtures, locales, `e2e/{ordering.spec,screens.spec,support}.ts`.
- Admin: `src/lib/{orders,errors}.ts`, `src/pages/{Orders,OrderDetail,Settings,Today,CustomerDetail}Page.tsx`, `src/components/{NewOrderDialog,CustomerOrders,OrderingSettings,Dialog}.tsx`, `App.tsx`, `styles.css`, locales, demo fixtures, `e2e/portal.spec.ts`.
- Docs: `docs/adr/0003-ordering-and-capacity.md`, README API table, this report, change log.

**3. Architecture and design decisions** — see ADR 0003. In short: capacity is a counter per delivery time and date, taken with one conditional database update inside the order's transaction; prices are dated rows, so a price change never touches past orders; the app sends the total it showed and the server refuses a mismatch; order history is append-only in the database itself.

**4. APIs and database changes**
- 23 new endpoints (README table): customer ordering (5), office orders (6), delivery times, capacity and closed days (8), prices (4).
- Database: new tables `products`, `product_prices`, `customer_prices`, `delivery_windows`, `window_bookings`, `closed_days`, `orders`, `order_items`, `order_status_history`; enums for order status and channel; `suppliers.next_order_no`; `service_areas.delivery_charge_paise` and `free_above_cans`.

**5. Tests executed** (all run on 19 Nov 2026 in the development container, PostgreSQL 16)
- `pnpm lint`, `pnpm typecheck` (all packages), `prettier --check`, `pnpm check:i18n` (admin 392 texts, mobile 245)
- `pnpm test`: design tokens 12, shared 40 (9 new), API 97 in 7 files against a real database (19 new ordering tests: bookable times and the cut-off, price and address saved on the order, auto-accept, double submit, price changed, maximum quantity for customers versus office, area charge and free limit, switched-off customer, 4 orders at the same moment for a time with room for 2, cans given back on cancel, too late to cancel, closed days, auto-accept off with bulk accept and reject with reason, office booking after the cut-off but not after a time has ended, office list and search, owner-only dated prices, customer's own price, another customer's or supplier's orders, history cannot be edited)
- Admin Playwright: 18 scenarios × desktop and phone = 36, against the real API. New: phone order from a customer's page (3 cans, ₹570), new order from the Orders page with search, the list moving to the delivery day, cancel with a required reason, delivery time add (wrong times refused) and switch off, close a day (reason required) and open it again, owner sets a future price (bad amount refused) and the office account cannot. axe WCAG 2 A/AA and no horizontal scroll on each new page.
- Mobile Playwright: 19 tests at Pixel 7 size against the real API. New: first order (totals ₹380 → ₹570 as cans change), cancel, the maximum of 10, Malayalam.
- `expo export --platform android` bundle build.

**6. Actual test results** — all passed: 149 unit/integration tests, 36 admin browser tests, 19 mobile browser tests, translation check, Android bundle.

Defects found and fixed during Phase 4: (a) every pop-up in the admin portal had the same id for its title, so screen readers could announce the wrong title when a page has several (from Phase 2); each now has its own. (b) The office could book a delivery time that had already ended today; it now can until the time ends. (c) A badly typed date in a request could crash validation instead of returning "invalid"; fixed. (d) On the web preview of the app, the scrolling screen could not be reached with the keyboard (accessibility check); fixed. (e) The status column of the Orders table was cut off on a laptop screen; the customer column now wraps.

**7. Known defects and limitations**
- The can deposit on an order is an estimate (every can counts as new) until the can ledger in Phase 5 records cans held and returned.
- Orders cannot yet be given to a driver; "Needs a driver" fills up and waits for Phase 5. Dues and credit-limit warnings are Phase 6. Customers get no SMS or push message about their order yet.
- Closing a day does not move or cancel orders already booked; the office is told how many and phones them.
- All prices, delivery times and capacities are DEMO values; set the real ones in Settings before launch.
- Malayalam texts are still draft translations and need a native speaker's review.
- Real SMS is still not connected (Phase 3 limitation), Maestro tests on an Android device have not run, and the branch has not been pushed (GitHub App still missing).

**8. Security considerations** — every order query is limited to the signed-in supplier, and customers see only their own orders (tested). The server works out every price and total itself; the app's total is only compared, never trusted. Price changes are owner-only and audited, as are every order change, delivery time and closed day. The office order list shows only the last 4 digits of a phone number. Order history cannot be changed even by a database user of the app.

**9. Pending decisions** — none blocking. Needed before launch: the real can price, deposit, delivery charges per area, delivery times and how many cans each can take, and the same-day cut-off time.

**10. Recommendations** — enter the real price, delivery times and capacities in Settings so Phase 5 testing uses realistic numbers. Decide whether office orders should always be accepted at once (current) or follow the auto-accept setting like app orders.

**11. Deviations from the original requirements** — none. The details left open by the approved decisions are recorded in ADR 0003 and the change log.

**12. Recommended next step** — Phase 5: delivery. Give orders to drivers by area, the driver's route for the day, delivery with full and empty can counts, failed delivery and reschedule, and the can ledger that makes the deposit exact.

### Phase 5: Delivery and ledgers (20 Nov 2026)

**1. What was completed**
- **Office, Deliveries page** (portal): pick a day, tick accepted orders and give them to a delivery person in one step; see each route with progress, cans loaded, delivered and returned, cash, UPI and pay-later totals; re-order stops with arrows, take a stop off, or give a whole route to someone else (M-13) before it starts; re-book orders that could not be delivered (new day and time); check each finished day against what the app expected and close it, with a note when something differs.
- **Delivery person, phone app** (now real, no demo data): load-out count, then one big "next stop" card (cans to give, cans they hold, old due, Call, Map, Delivered, Couldn't deliver). Delivered: full cans, empties (defaults to the swap), the amount (this stop or with old due) and cash / UPI / pay later. Couldn't deliver: a reason. Undo for 10 minutes. End day: count full, empty, damaged cans and cash. Works with no signal: actions wait on the phone and are sent in order later, never twice.
- **Ledgers**: cans held, deposit and money owed for every customer, append-only, updated in the same transaction as the delivery. Shown on the customer's page in the portal, and as two tiles ("Our cans with you", "Amount due") on the customer's home screen.
- **Cans and stock page** (portal): full and empty at the depot, on vans, with customers, damaged, and the total. The office records cans filled at the plant, new cans bought, damaged cans thrown away and a depot count.
- Pay later is always allowed; a due above the credit limit is flagged, never blocked (D-03).

**2. Files created or changed**
- Shared: `packages/shared/src/delivery.ts` (+ tests), `order-status.ts` (office re-book).
- API: `src/db/schema.ts`, migration `0004_phase5_delivery_ledgers.sql` (7 tables, 9 enums, customer balance columns, append-only triggers), `src/modules/delivery/{delivery.service,ledgers,stock.service,delivery.routes}.ts`, `ordering/orders.service.ts`, `app.ts`, `test/delivery.test.ts`.
- Mobile: `src/lib/{outbox,staff}.ts`, `src/lib/customer.ts`, `(staff)/{route,deliver,not-delivered,day-end}.tsx`, `(customer)/home.tsx`, `components/{Button,RoleGate}.tsx`, locales, `e2e/{delivery.spec,office-api}.ts`, `e2e/{screens,sign-in}.spec.ts`. `src/demo/fixtures.ts` is now empty (kept, not deleted, per the no-delete rule).
- Admin: `src/pages/{Deliveries,Stock}Page.tsx`, `src/components/CustomerLedgers.tsx`, `src/lib/deliveries.ts`, `App.tsx`, `CustomerDetailPage.tsx`, `OrdersPage.tsx`, `styles.css`, locales, `e2e/{api,portal.spec}.ts`.
- Docs: `docs/adr/0004-delivery-and-ledgers.md`, README API table, this report, change log.

**3. Architecture and design decisions** — see ADR 0004. In short: a route is one person per day; every delivery is one database transaction across the order, three ledgers, payment, stock and audit; ledgers and stock are append-only and corrected only by reversing entries; stock is computed from movements, never typed; the phone queues actions with an id so retries are safe.

**4. APIs and database changes**
- 17 new endpoints (README table): delivery person (6), customer account (1), office deliveries, routes, re-booking and day check (7), ledgers (1), stock (2).
- Database: new tables `trips`, `delivery_attempts`, `can_ledger`, `deposit_ledger`, `account_ledger`, `payments`, `stock_movements`; `customers` gains cans held, deposit held and cover, balance and credit limit (with a check); `orders` gains route and stop number. A trigger refuses changes to ledger and stock rows.

**5. Tests executed** (all run on 20 Nov 2026 in the development container, PostgreSQL 16)
- `pnpm lint`, `pnpm typecheck` (all packages), `prettier --check`, `pnpm check:i18n` (admin 538 texts, mobile 290).
- `pnpm test`: design tokens 12, shared 47 (7 new), API 111 in 8 files against a real database (14 new delivery tests: assignment and staff seeing only their own route (scenario 2); stop order; start route; one-transaction delivery with audit (scenarios 11, 12); offline replay; pay later above the credit limit flagged; undo, then refused after 11 minutes; failed delivery giving capacity back; day end with ₹30 short and the check needing a reason; stock total across all places; re-book to another day and assign again; extra empties, short delivery, more than ordered refused; move a route and take a stop off; another supplier's data; ledgers cannot be edited). Every test also checks that stored balances equal the ledger entries (scenario 5).
- Admin Playwright: 22 scenarios × desktop and phone = 44, against the real API. New: give two orders to a person, re-order stops, move the route to someone else; after the day (done on the delivery person's account through the API), re-book the failed order to tomorrow and check the day (1 full can short, reason required); stock: buy, fill, count (note required); customer ledgers (₹190 charged, ₹40 paid, ₹150 due). axe WCAG 2 A/AA and no horizontal scroll on each.
- Mobile Playwright: 19 tests at Pixel 7 size against the real API. New (6): delivery person signs in and loads the van, delivers with cash, can't deliver, undoes and records again, ends the day; the office sees matching ledgers and stock; the customer's home shows 2 cans and "All paid". The 6 old tests of the demo staff screens were removed because those screens are now real.
- `expo export --platform android` bundle build.

**6. Actual test results** — all passed: 170 unit/integration tests, 44 admin browser tests, 19 mobile browser tests, translation check, Android bundle.

Defects found and fixed during Phase 5: (a) after a delivery the phone stacked a second copy of the route screen, so Back showed an old route; it now goes back. (b) The two "Undo" buttons in the done list had the same name for screen readers (and the test undid the wrong stop); each now names the customer. (c) The route showed "1 cans"; fixed in both languages. (d) A delivery recorded offline took the server's time for "recorded at"; it now uses the request time consistently. (e) The office day list sent delivery staff phone numbers it did not need; removed.

**7. Known defects and limitations**
- The credit limit is ₹0 for everyone until it can be edited (Phase 6), so every amount due is flagged "over credit limit" (flag only, never blocks).
- Payments are recorded but not yet checked (UPI reference matching), and there is no dues list, deposit refund, opening balance or office correction yet: Phase 6.
- No vehicles: a route is a person. Walk-in sales at the depot (M-08) and customers choosing their own new time after a failed delivery are not built.
- Undo needs a signal. Customers get no SMS or push message about deliveries yet.
- The offline queue was tested in the browser build; a real Android phone losing signal (Maestro) has not been tested. Real SMS is still not connected.
- Malayalam texts are draft translations and need a native speaker's review. All prices and numbers are DEMO values.
- The branch has not been pushed (GitHub App still missing); a git bundle is in project files.

**8. Security considerations** — a delivery person can read and change only their own route (other routes answer "not found", tested); customers see only their own balances. Every query is limited to the signed-in supplier (tested with a second supplier). Ledgers and stock cannot be changed or deleted even by the app's database user. The server works out every amount; the phone only sends counts and the amount collected. Office lists show only the last 4 digits of customer phones. Every delivery, undo, re-book, route change, day check and stock entry is audited.

**9. Pending decisions** — none blocking. Before launch: real credit limits (or confirm ₹0 = no credit), how many cans the business owns (opening stock count), and each existing customer's cans held, deposit and dues (opening balances, Phase 6).

**10. Recommendations** — do one real trial day with one delivery person on an Android phone, including a stretch with no signal, before Phase 6 is finished. Count the depot on the first day using "Count the depot" so the stock total starts right.

**11. Deviations from the original requirements** — none. The details left open by the approved decisions are recorded in ADR 0004 and the change log.

**12. Recommended next step** — Phase 6: payments. UPI and cash checking at day end, dues list with reminders, credit limits per customer, deposit refunds when cans come back, opening balances for existing customers, and office corrections with reasons.

### Phase 6: Payments and corrections (20 Nov 2026)

**1. What was completed**
- **Payments page** (portal), three tabs: **Dues** (who owes, how much, owing since, last paid, over limit, Record payment in one tap); **Payments by day** (cash, UPI and deposit refund totals, every payment with who collected it, "Not received" with a reason); **UPI to check** (Received after seeing it in the bank, or Not received).
- **Customer page** (portal): Record payment (cash or UPI, "Full due" in one tap), Refund deposit (only for cans that came back; cash, UPI or off the dues), Correct balances (type what is true, with a reason), credit limit (owner changes it; others see it), and Monthly statement.
- **Monthly statement** (D-11): a printable A4 page for the office (previous and next month, Print), and a "See monthly statement" screen in the customer app (24 months back, no office notes).
- **Opening balances** (M-04), owner only, on the Customers page: CSV file or paste, sample file, line errors shown before anything is sent, a server preview that saves nothing, then Import. Customers who already have entries are skipped.
- Scenario 8 (duplicate payment): five identical payment requests at once record one payment.

**2. Files created or changed**
- Shared: `packages/shared/src/payments.ts` (+ 7 tests): payment, refund, correction and opening schemas, the refund formula, the CSV reader, month helpers.
- API: `src/db/schema.ts`, migration `0005_phase6_payments.sql` (payment check, reverse and paid-on columns with back-fill, `deposit_refunds` table, `deposit_refund` account entry), `src/modules/payments/{payments.service,payments.routes}.ts`, `delivery/{ledgers,delivery.service}.ts`, `app.ts`, `test/payments.test.ts` (12 tests).
- Admin: `src/pages/{Payments,Statement}Page.tsx`, `src/components/{MoneyDialogs,OpeningImportDialog}.tsx`, `CustomerLedgers.tsx`, `CustomerDetailPage.tsx`, `CustomersPage.tsx`, `App.tsx`, `styles.css` (statement and print), locales, `e2e/portal.spec.ts`, `playwright.config.ts`.
- Mobile: `(customer)/statement.tsx`, `(customer)/home.tsx`, `components/RoleGate.tsx`, locales, `e2e/delivery.spec.ts`.
- Docs: `docs/adr/0005-payments-and-corrections.md`, README API table, change log, this report.

**3. Architecture and design decisions** — see ADR 0005. In short: money only changes through new ledger entries with a reason (never edits); office payments carry a request id so they are saved once; UPI waits for a bank check; refunds follow the cans that came back; corrections and opening balances also move stock so the can pool adds up; the statement is read from the same ledgers as everything else.

**4. APIs and database changes**
- 11 new endpoints (README table): customer statement (1), office payments, verify, not received, dues, customer payments, credit limit, deposit refund, corrections, statement, opening balances (10).
- Database: `payments` gains paid-on date, check (verified) and reverse details, note and request id (unique per supplier); new `deposit_refunds` table; new `refund_method` enum and `deposit_refund` account entry type.

**5. Tests executed** (all run on 20 Nov 2026 in the development container, PostgreSQL 16)
- `pnpm lint`, `pnpm typecheck` (all packages), `prettier --check`, `pnpm check:i18n` (admin 667 texts, mobile 315).
- `pnpm test`: design tokens 12, shared 54 (7 new), API 123 in 9 files against a real database (12 new: scenario 8 with 5 parallel requests; future date refused; roles and supplier isolation; UPI check, verify and not received; a delivery payment undone by the office and then by the delivery person is not reversed twice; dues and owner-only credit limit; opening balance preview, import and second import refused; deposit refund off the dues; corrections with stock; statement for office and customer; office pages refused to customers and staff). Every test checks that stored balances equal the ledger entries.
- Admin Playwright: 25 scenarios × desktop and phone = 50, against the real API. New: UPI payment checked in the bank, delivery cash marked not received (reason required), then paid from the Dues list; cans corrected (reason required), deposit refunded off the dues, credit limit (owner changes it, office cannot), statement for this and last month; opening balance CSV with a bad line, preview and import (owner only). axe WCAG 2 A/AA and no horizontal scroll on each.
- Mobile Playwright: 19 tests at Pixel 7 size against the real API; the customer test now opens the monthly statement (₹380 delivery, ₹380 paid, nothing due) and the previous month.
- `expo export --platform android` bundle build.

**6. Actual test results** — all passed: 189 unit/integration tests, 50 admin browser tests, 19 mobile browser tests, translation check, Android bundle.

Defects found and fixed during Phase 6: (a) a deposit refund taken off the dues showed as a plain "Correction" on the statement; it is now its own entry, "Deposit refund, off the dues". (b) A payment marked not received showed as "Undone · 1 can" on the statement; it now says "Payment not received". (c) The statement screen in the app showed the "Preview screen" banner although it is real. (d) The refund list used the server clock instead of the request time. (e) Two browsers testing at once hit the API's request limit; the test server now allows more (the limit itself is still tested in the API suite).

**7. Known defects and limitations**
- No reminders are sent to customers who owe (no SMS or push yet): Phase 7.
- No payment gateway (D-19, later). UPI is checked by hand against the bank statement; there is no bank file import.
- Opening-balance line errors from the CSV reader are in English only.
- The statement is printed from the browser (Print → Save as PDF); there is no PDF file made by the server and no GST invoice.
- Malayalam texts are draft translations and need a native speaker's review. All prices and numbers are DEMO values. Real SMS is still not connected.
- The branch has not been pushed (GitHub App still missing); a git bundle is in project files.

**8. Security considerations** — only the owner can import opening balances and change credit limits (tested); office pages answer 403 to customers and delivery staff, and another supplier's customers answer "not found" (tested). Customers see only their own statement, without the office's notes or phone numbers. Every payment, check, not received, refund, credit limit change, correction and import is audited with before and after. Money cannot be edited or deleted, even by the app's database user. Office lists show only the last 4 digits of phones.

**9. Pending decisions** — none blocking. Before launch: real credit limits for customers who may pay later, and the opening balance file (each existing customer's cans, deposit and dues).

**10. Recommendations** — prepare the opening balance file from the current notebook or spreadsheet and import it on the go-live day, right after counting the depot. Check UPI daily from the "UPI to check" tab so the list stays short.

**11. Deviations from the original requirements** — none. Dues reminders were listed with Phase 6 in the last report; they need SMS, so they move to Phase 7 notifications (recorded in the change log).

**12. Recommended next step** — Phase 7: reports (sales, collections, dues ageing, cans), the real Today page, and customer notifications (order updates and dues reminders).

### Phase 7: Admin and reports (20 Nov 2026)

**1. What was completed**
- **Today page** (portal), now real: "Needs your attention" (orders to accept, today's orders without a driver, failed deliveries to re-book, routes to check with the cash difference, open complaints, UPI to check, low stock for tomorrow), each with one button to the page that does it; "Today so far" (orders, delivered, collected cash and UPI, money due, cans with customers, full cans at the depot, cans booked for tomorrow); each driver's route with stops, cash and status. Refreshes every minute. The Phase 2 demo data is gone.
- **Reports** (portal): sales, dues (with ageing), cans with customers, delivery staff, deliveries (on time, late, failed and why), stock (with the can pool check). Date range or "as of now", Last 7 / 30 days, totals row, **Download CSV**.
- **Activity log** (Reports tab): who did what and when, filtered by kind and day, before and after on request, "Show more".
- **Complaints**: a Complaints page (open / resolved, Resolve with a note the customer sees), "Note a complaint" on the customer page, and in the app **Help → Report a problem** (kind, which order, a few words) with the office's answer shown under it.
- **Messages to customers**: out for delivery, delivered, not delivered, cancelled by the office, dues reminder, complaint resolved; in English or Malayalam. A new **Messages** screen in the app with an unread count on Home. Push sending is built on the server (Expo), ready for Phase 8.
- **Dues reminder**: "Send reminder" on the Dues list, at most once a day, showing when the last one went.
- **Settings**: Business details (name, GSTIN, FSSAI) and Business rules (deposit, delivery charge, free delivery from, cut-off, most cans, undo minutes, help phone, auto-accept). Owner changes them; office admins see them.
- **Help** in the app: Call us and WhatsApp us now use the business's help phone (no longer "preview only").
- **UAT workflows 1–6** run end to end as an automated test (see 5).

**2. Files created or changed**
- Shared: `packages/shared/src/admin.ts` (+ 3 tests): complaint, message, report, CSV, activity log and business schemas.
- API: `src/db/schema.ts`, migration `0006_phase7_admin_reports.sql` (`complaints`, `notifications`, `push_tokens`), `src/providers/push/index.ts`, `src/modules/notifications/notifications.service.ts`, `src/modules/complaints/complaints.service.ts`, `src/modules/reports/{reports.service,admin.routes}.ts`, `src/modules/audit/audit.routes.ts`, message hooks in `delivery.service.ts` and `orders.service.ts`, `payments.service.ts` (last reminder), `config/env.ts`, `app.ts`, `.env.example`; tests `test/admin.test.ts` (12), `test/uat.test.ts` (6), `test/helpers.ts`, `providers/otp/otp.test.ts`.
- Admin: `pages/{Today,Reports,Complaints}Page.tsx`, `components/{Complaints,BusinessSettings}.tsx`, `PaymentsPage.tsx`, `SettingsPage.tsx`, `CustomerDetailPage.tsx`, `MoneyDialogs.tsx`, `Layout.tsx`, `App.tsx`, `lib/api.ts` (downloads), `demo/fixtures.ts` (emptied), `styles.css`, locales, `e2e/portal.spec.ts`.
- Mobile: `(customer)/{help,report,messages,home}.tsx`, `lib/help.ts`, `components/RoleGate.tsx`, locales, `e2e/{delivery,screens}.spec.ts`, `e2e/office-api.ts`.
- Docs: `docs/adr/0006-admin-reports-and-messages.md`, README (API table, push in development), change log, this report.

**3. Architecture and design decisions** — see ADR 0006. In short: one dashboard call built from the same records as every page; reports computed on request and downloadable as safe CSV; messages written in the same transaction as the change (outbox), then pushed once; the text is made in the reader's language; complaints and reminders are idempotent and limited; only the owner changes business details and rules.

**4. APIs and database changes**
- 14 new endpoints (README table): dashboard, reports (JSON and CSV), business details (2), complaints for the office (3), dues reminder, customer complaints (2), customer messages (2), push tokens (2); the activity log endpoint gains filters and paging.
- Database: new tables `complaints` (one per `clientRequestId`), `notifications` (the outbox and the customer's messages), `push_tokens`; new enums for complaint kind and status, message kind and push status.

**5. Tests executed** (all run on 20 Nov 2026 in the development container, PostgreSQL 16)
- `pnpm lint`, `pnpm typecheck` (all packages), `prettier --check`, `pnpm check:i18n` (admin 920 texts, mobile 335).
- `pnpm test`: design tokens 12, shared 57 (3 new), API 142 in 11 files against a real database (19 new). New API tests: messages and push in English and Malayalam with no phone numbers, a customer with no phone gets them in the app only, a gone push token is removed, office cancel tells the customer, dues reminder once a day and never when nothing is due, two identical complaints at the same moment save one, resolve once and the customer is told, the dashboard numbers, each report and its CSV, a bad date range, activity log filters and paging, business details owner-only.
- **UAT workflows 1–6** (`test/uat.test.ts`): (1) a new customer signs up in the app, orders, gets 2 cans with the deposit, pays by UPI, the office checks it in the bank, the customer has the messages; (2) she reorders 3, gives back 1 empty, a deposit is charged for 2 more cans, the amount appears in Dues and the dues report, one reminder a day; (3) a failed delivery (nobody home) shows on Today, is re-booked for the next day and delivered; (4) a driver's day of 10 stops, one sent from the offline queue twice (saved once, at the time it happened), all cash handed over, the route checked, the staff report shows no difference and the can pool adds up; (5) three phone orders given to one driver in one step, the whole route moved to another driver when the first is absent; (6) a can correction by the owner shows in the activity log with the reason. Every workflow checks the ledgers add up.
- Admin Playwright: 30 scenarios × desktop and phone = 60, against the real API. New: complaint noted from a call and resolved from the Today inbox; dues reminder once a day; Today page; all six reports, CSV download (file name and header checked) and the activity log filter; business details and rules (owner changes, office read-only). axe WCAG 2 A/AA and no horizontal scroll on each.
- Mobile Playwright: 19 tests at Pixel 7 size. New: Help opens WhatsApp with the business number, Report a problem on an order, the office's answer shows under it and in Messages, the unread count clears after reading.
- `expo export --platform android` bundle build.

**6. Actual test results** — all passed: 211 unit/integration tests (including the 6 UAT workflows), 60 admin browser tests, 19 mobile browser tests, translation check, Android bundle.

Defects found and fixed during Phase 7: (a) two identical complaints sent at the same moment failed with a server error; the customer is now locked first, so one is saved. (b) The Today buttons were read out without their number ("Open: open complaint"); they now say "Open: 1 open complaint". (c) After sending a problem report, the app had two Help screens stacked; it now goes back to the one it came from. (d) The last reminder time came from the database in a format some browsers cannot read; it is now standard ISO time. (e) The production settings check did not yet cover the new push setting; a development push outbox is now refused in production.

**7. Known defects and limitations**
- Pushes reach phones only after Phase 8 (the app must be built with an EAS project and ask permission). Until then messages are in the app's Messages screen. Failed pushes are not retried.
- No SMS reminders (needs DLT templates). Reminders are pressed one customer at a time.
- An undone delivery does not take back its "Delivered" message.
- Reports have no charts; the sales report lists every day, including days with nothing. The activity log shows before/after as raw data.
- The Today title says "Good morning" at any hour (Phase 2 design). Today refreshes every minute, not instantly.
- Malayalam texts are draft translations and need a native speaker's review. All prices and numbers are DEMO values. Real SMS is still not connected.
- The branch has not been pushed (GitHub App still missing); a git bundle is in project files.

**8. Security considerations** — office pages, reports and the activity log answer 403 to customers and delivery staff; business details and rules change only for the owner (tested). Customers see only their own complaints and messages, without phone digits or the office's internal notes; messages never contain phone numbers (tested). CSV cells that a spreadsheet could run as a formula are neutralised. Push tokens belong to one user and are deleted when the push service reports them gone. The development push outbox is refused in production. Complaints, resolutions, reminders, business changes and settings changes are audited.

**9. Pending decisions** — none blocking. Before launch: the business help phone, GSTIN and FSSAI number, and the real business rules (all can be entered in Settings by the owner).

**10. Recommendations** — have the owner enter the real business rules and help phone in Settings now, so Phase 8 testing uses real values. Start the Expo (EAS) account and the Apple/Google developer accounts in the business's name; push registration and the store builds depend on them.

**11. Deviations from the original requirements** — dues reminders are push/in-app, not SMS (SMS needs DLT approval). Push registration on the phone moves to Phase 8 with the app builds. Both recorded in the change log.

**12. Recommended next step** — Phase 8: hardening, performance, security and UAT with real users, plus the app builds (EAS) with push registration, real SMS once the DLT template is approved, and backups with a restore test.
