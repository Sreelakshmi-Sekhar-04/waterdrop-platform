# ADR 0007: Hardening, account deletion, push sign-up and release

**Status:** Accepted (Phase 8, 20 Nov 2026). Follows the Phase 8 plan in `PHASE-0-ANALYSIS.md` §13.2
("Hardening and release") and §12 (security, QA, backups, DPDP), and approved decisions D-01 to D-20. The
choices below fill in details those decisions left open. None changes what was approved. Store submission,
hosting and production go-live still wait for the owner's approval.

## Decision

### Security regression, driven by the route table

- `apps/api/test/security.test.ts` lists every route from Express itself (more than 90) and checks each one:
  `/admin` routes refuse anonymous users (401) and customers and delivery staff (403); `/staff` routes refuse
  customers and the office; `/customer` routes refuse delivery staff and the office; the owner-only routes
  (business rules, business details, credit limits, opening balances) refuse office admins. A route added
  later without a role check fails the test.
- Also checked: a forged token, a token whose session is closed, another supplier's records (404), security
  headers, the CORS allow-list, the 100 kB body limit, and that error answers carry no stack trace or SQL.
- **Scans run here:** `pnpm audit --prod` (no high or critical; one moderate in a build-time Expo tool), a
  secret scan of the whole git history (clean). CI now fails on a high or critical advisory. **Not run here:**
  OWASP ZAP and k6 need tools this workspace cannot install; the route-table test and `scripts/perf.ts`
  cover the same ground in-process, and ZAP's baseline scan is on the release checklist against staging.

### Performance (Phase 0 §12.4)

`apps/api/scripts/perf.ts` (`pnpm --filter @wtrdrop/api perf`) drives the real API over HTTP on a throwaway
database. Targets we hold ourselves to: reads p95 under 1 s, writes p95 under 500 ms, no lost or doubled
record under load. Results of the full run on 20 Nov 2026 (one laptop-class container, Postgres on the
same machine):

| What | Size | Result |
| --- | --- | --- |
| A year of history | 400 customers, 36,500 orders, 36,500 delivery attempts, 27,375 payments | writes p50 65 ms, p95 157 ms; ledgers agree |
| Today page | that year | p95 78 ms |
| Reports over 365 days | sales, staff, deliveries, stock; dues; cans | p95 35, 872, 82, 66, 103, 61 ms |
| Lists | orders today, customer search, activity log, deliveries today | p95 under 55 ms |
| Morning rush | 300 customers order at once for a 50-can time | exactly 50 accepted, 250 told "full"; p95 1.07 s |
| Drivers syncing | 50 drivers × 10 stops, each sent twice (offline retry) | 1,000 answers OK, 500 deliveries saved, 0 doubled; p95 206 ms |

The rush answers queue on the time slot's lock, which is what keeps it exact; 1 s for the 300th customer is
acceptable. The staff report is the slowest read (first run 872 ms, then about 325 ms); a summary table can be
added later without changing the API (ADR 0006).

### Operations

- **Server image:** `apps/api/Dockerfile` (Node 22, runs as a non-root user, health check on
  `/api/v1/health`). Migrations run as a separate step (`node dist/db/migrate.js`) before the new version
  starts. The built migration runner now finds its migrations folder in the image layout.
- **Backups:** the managed database's daily backups and point-in-time recovery come first. `ops/backup.sh`
  adds a daily `pg_dump` with a checksum, kept 30 days, copied to storage in another account or region.
- **Restore drill:** `ops/restore-drill.sh` restores a dump into a temporary database, compares row counts and
  runs the data check, then drops it. Run quarterly. Run here on the year of data: 25 MB, restored in 3 s,
  data check OK.
- **Nightly data check:** `node dist/ops/check-integrity.js` (or `pnpm --filter @wtrdrop/api check:integrity`)
  checks that every customer's cans, deposit and balance equal their ledgers and that the can pool adds up.
  It exits 1 on a problem, for the scheduler to alert on. Warnings (messages stuck, routes not checked for 2
  days, negative depot stock) are printed but do not fail it.

### Customer account deletion (store rules, DPDP Act)

- **Customer → Account → Delete my account.** The screen shows what has to be settled first; when nothing is
  outstanding, one button deletes and signs out.
- **Refused while anything is outstanding:** cans with the customer, deposit held, money due or paid in advance
  (`ACCOUNT_HAS_BALANCES`), unfinished orders (`ACCOUNT_HAS_OPEN_ORDERS`), or the same phone also used for
  delivery or office work or with another supplier (`ACCOUNT_HAS_OTHER_ROLES`). These keep cans and money from
  being lost track of; the office settles them (refund, pickup, payment) first.
- **Erased:** name, phone (replaced by a placeholder that is never a number), addresses (blanked and
  archived), complaint notes, messages, push tokens; every session is closed. The customer record is switched
  off, and the activity log notes "customer deleted" with no details.
- **Kept, for the supplier's accounts (GST and tax law):** orders (with the address as it was on the order),
  payments, ledgers and the activity log. The privacy notice says so.
- The same phone can sign up again later as a new customer. The portal shows deleted customers as
  "Account deleted".
- `POST /customer/account/delete` (body `{ "confirm": true }`) and `GET /customer/account/deletion`.

### Push messages on phones (finishes ADR 0006)

- The app asks for notification permission once, on the "Order placed" screen after an order, and refreshes
  the token on Home when permission was already given. The token is removed from the server on sign-out.
- Nothing happens on the web, in a simulator, or until `eas init` has written the EAS project id into
  `app.json`, so builds without an Expo account work as before (messages stay in the app).
- `expo-notifications` and `expo-device` added at the SDK 58 versions. The notification icon is the app's
  monochrome icon.

### Release setup

- `apps/mobile/eas.json`: `development` and `preview` (installable APKs for UAT) and `production` (store
  builds, build number raised automatically). API addresses in it are placeholders ending `.invalid` until
  hosting is chosen.
- `app.json`: version 0.1.0, Android `versionCode` 1, iOS `buildNumber` 1, iOS export-compliance answered
  (standard encryption only), storage permissions the app does not need are blocked.
- Release documents in `docs/release/`: release checklist, runbook, UAT script, store listing drafts and a
  privacy policy draft (both marked DRAFT for the owner and a lawyer to review).

## Consequences

- Deleting an account cannot be undone; the office cannot restore it. A customer who comes back signs up again.
- A deleted customer's old orders still show their address on the order (needed for tax records), but the
  name and phone are gone everywhere.
- Push needs an Expo account and the store accounts (Apple, Google); until then customers read messages in the
  app.
- Performance figures come from one machine with the database on it; production (managed database in Mumbai,
  D-18) adds network time per query. The release checklist repeats the rush and sync runs against staging.
