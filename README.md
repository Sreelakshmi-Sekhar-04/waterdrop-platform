# WtrDrop

**Pure Water. Delivered with Care.**

WtrDrop runs a 20-litre drinking-water can delivery business: customers order and reorder in a couple of taps, delivery
staff record cans and payments at the door, and the owner sees what needs attention, who holds how many cans, and
who owes money.

> **Status: Phase 3 (sign-in, users and addresses).** Real sign-in, customer profiles and addresses, delivery areas and
> staff and office accounts are built and tested. Ordering (Phase 4) and deliveries (Phase 5) are not built yet; those
> screens show labelled demo data. See [docs/PROGRESS.md](docs/PROGRESS.md).

## Repository layout

| Path                     | What it is                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| `apps/api`               | REST API: Node 22, Express 5, TypeScript, PostgreSQL (Drizzle ORM)                       |
| `apps/admin`             | Business owner web portal: React + Vite                                                  |
| `apps/mobile`            | Customer and delivery staff app: Expo (React Native)                                     |
| `packages/shared`        | Business rules shared by all apps: order state machine, can-ledger maths, money, schemas |
| `packages/design-tokens` | Brand colours, type, spacing (approved WtrDrop design)                                   |
| `docs/`                  | Phase 0 analysis, requirement change log, progress log, architecture decisions           |
| `docs/release/`          | Release checklist, runbook, UAT script, store listing and privacy policy drafts          |
| `ops/`                   | Backup and restore-drill scripts                                                         |

## Prerequisites

- Node.js 22+ and pnpm 10 (`corepack enable`)
- PostgreSQL 16 (Docker: `pnpm db:up`, or a local install)
- For the phone app: the Expo Go app or an Android/iOS development build

## First-time setup

```bash
pnpm install
cp apps/api/.env.example apps/api/.env        # then set JWT_SECRET (openssl rand -base64 48)
cp apps/admin/.env.example apps/admin/.env
pnpm db:up                                    # starts local PostgreSQL in Docker
pnpm db:migrate
pnpm db:seed                                  # one demo supplier with DEMO settings
```

To create the first owner account, set `SEED_OWNER_PHONE` in `apps/api/.env` before seeding. The seed also adds three
DEMO delivery areas around Kochi; replace them in the portal under Settings.

### SMS codes in development

With `OTP_PROVIDER=dev-outbox` (development and tests only; refused when `NODE_ENV=production`) no SMS is sent. Each
code is appended to the file in `OTP_DEV_OUTBOX` (default `.dev-outbox/sms.jsonl`, readable only by you):

```bash
tail -n 1 apps/api/.dev-outbox/sms.jsonl
```

For real SMS set `OTP_PROVIDER=msg91`, `MSG91_AUTH_KEY` and `MSG91_TEMPLATE_ID` (a DLT-approved template). The MSG91
adapter has not yet been tried against a real MSG91 account. See `docs/adr/0002-sign-in-and-sessions.md`.

### Push messages in development

Customers' messages (on the way, delivered, couldn't deliver, payment reminder, complaint resolved) are always listed
in the app. With `PUSH_PROVIDER=dev-outbox` (refused in production) the pushes go to `PUSH_DEV_OUTBOX` (default
`.dev-outbox/push.jsonl`) instead of phones. In production use `PUSH_PROVIDER=expo` once the app is built with an EAS
project, or `none`. See `docs/adr/0006-admin-reports-and-messages.md`.

## Running

```bash
pnpm dev:api      # http://localhost:4000/api/v1/health
pnpm dev:admin    # http://localhost:5173
pnpm dev:mobile   # scan the QR code with Expo Go
```

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test          # unit tests + API integration tests (needs PostgreSQL, see below)
pnpm test:e2e         # admin portal browser tests (Playwright, real API, fresh test database)
pnpm test:e2e:mobile  # mobile screens at phone size on the Expo web build (real API, fresh test database)
pnpm check:mobile     # bundles the mobile app for Android
pnpm audit --prod --audit-level high   # dependency advisories (CI fails on high or critical)
```

Phase 8 checks (ADR 0007), run before a release:

```bash
pnpm --filter @wtrdrop/api perf             # a year of data, a 300-customer rush, 50 drivers syncing (PERF_DAYS, PERF_OUT)
pnpm --filter @wtrdrop/api check:integrity  # ledgers agree with balances, the can pool adds up (exit 1 if not)
ops/backup.sh                               # pg_dump with a checksum (DATABASE_URL, BACKUP_DIR, RETENTION_DAYS)
ops/restore-drill.sh <dump>                 # restore into a temporary database and check it (ADMIN_URL)
docker build -f apps/api/Dockerfile .       # the API server image; migrations: node dist/db/migrate.js
```

Deploying and running in production: `docs/release/RUNBOOK.md`.

API integration tests create and drop their own database per test file. Point `TEST_DATABASE_URL` at a PostgreSQL
server where the user may create databases (default `postgres://wtrdrop@localhost:5432/postgres`). With the Docker
database: `TEST_DATABASE_URL=postgres://wtrdrop:wtrdrop_local@localhost:5432/postgres pnpm test`.

The browser tests start the real API with `apps/api/src/e2e-server.ts`, which recreates a throwaway database
(`wtrdrop_e2e_admin` or `wtrdrop_e2e_mobile`) on the same `TEST_DATABASE_URL` server, seeds test accounts and writes SMS
codes to a local file that the tests read.

## API

All paths start with `/api/v1`. "Office" means the admin and owner roles. Every change by the office is audited.

| Method              | Path                                                                            | Who                                                     |
| ------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| GET                 | `/health`                                                                       | Anyone                                                  |
| POST                | `/auth/otp/request`                                                             | Anyone (same answer whether or not an account exists)   |
| POST                | `/auth/otp/verify`                                                              | Anyone with the code; `app` = customer, staff or admin  |
| POST                | `/auth/admin/password/setup`                                                    | Office, first sign-in only (setup token)                |
| POST                | `/auth/admin/password/change`                                                   | Office                                                  |
| POST                | `/auth/staff/pin`                                                               | Delivery staff, after an SMS code on this phone         |
| POST                | `/auth/staff/pin/sign-in`                                                       | Delivery staff on a phone with a PIN                    |
| POST                | `/auth/refresh`, `/auth/sign-out`                                               | Any session                                             |
| GET, PATCH          | `/me`                                                                           | Any signed-in user                                      |
| GET, PUT            | `/customer/profile`                                                             | Customer                                                |
| GET, POST           | `/customer/addresses`                                                           | Customer                                                |
| PATCH, DELETE       | `/customer/addresses/:id`                                                       | Customer (delete archives)                              |
| GET                 | `/service-areas`                                                                | Any signed-in user                                      |
| GET, POST, PATCH    | `/admin/service-areas[/:id]`                                                    | Office                                                  |
| GET, POST, PATCH    | `/admin/customers[/:id]`                                                        | Office                                                  |
| POST, PATCH, DELETE | `/admin/customers/:id/addresses[/:addressId]`                                   | Office                                                  |
| GET, POST, PATCH    | `/admin/staff[/:userId]`                                                        | Office                                                  |
| POST                | `/admin/staff/:userId/reset-pin`                                                | Office                                                  |
| GET, POST, PATCH    | `/admin/team[/:userId]`                                                         | Owner                                                   |
| GET                 | `/customer/order-options?addressId`                                             | Customer (price, totals, bookable delivery times)       |
| GET, POST           | `/customer/orders`                                                              | Customer (POST: 201 new, 200 same `clientRequestId`)    |
| GET                 | `/customer/orders/:id`                                                          | Customer (own orders only)                              |
| POST                | `/customer/orders/:id/cancel`                                                   | Customer, until out for delivery                        |
| GET, POST           | `/admin/orders`                                                                 | Office (list by `date` or `customerId`, `status`, `q`)  |
| GET                 | `/admin/orders/:id`                                                             | Office                                                  |
| POST                | `/admin/orders/:id/transition`                                                  | Office (accept; reject or cancel with a reason)         |
| POST                | `/admin/orders/bulk-accept`                                                     | Office                                                  |
| GET                 | `/admin/customers/:id/order-options`                                            | Office                                                  |
| GET, PUT            | `/admin/customers/:id/price`                                                    | Read: office. Change: owner                             |
| GET, POST, PATCH    | `/admin/windows[/:id]`                                                          | Office                                                  |
| PUT                 | `/admin/windows/:id/capacity/:date`                                             | Office                                                  |
| GET                 | `/admin/window-slots?from&days`                                                 | Office                                                  |
| GET, POST, DELETE   | `/admin/closed-days[/:id]`                                                      | Office                                                  |
| GET                 | `/admin/catalog`                                                                | Office                                                  |
| POST                | `/admin/catalog/prices`                                                         | Owner                                                   |
| GET, PATCH          | `/admin/settings`                                                               | Read: office. Change: owner                             |
| GET                 | `/staff/day?date`                                                               | Delivery staff (own route only)                         |
| POST                | `/staff/trips/:id/start`, `/staff/trips/:id/end`                                | Delivery staff (load-out; day-end counts)               |
| POST                | `/staff/orders/:id/deliver`                                                     | Delivery staff (same `clientActionId` = same result)    |
| POST                | `/staff/orders/:id/not-delivered`                                               | Delivery staff                                          |
| POST                | `/staff/attempts/:id/undo`                                                      | Delivery staff, within the undo time                    |
| GET                 | `/customer/account`                                                             | Customer (cans held, deposit, amount due)               |
| GET                 | `/admin/deliveries?date`                                                        | Office (routes, waiting, failed, days to check)         |
| POST                | `/admin/deliveries/assign`, `/unassign`                                         | Office                                                  |
| PUT                 | `/admin/trips/:id/sequence`                                                     | Office, before the route starts                         |
| POST                | `/admin/trips/:id/move`                                                         | Office, before the route starts                         |
| POST                | `/admin/trips/:id/reconcile`                                                    | Office (note needed if counts differ)                   |
| POST                | `/admin/orders/:id/reschedule`                                                  | Office (failed orders)                                  |
| GET                 | `/admin/customers/:id/ledgers`                                                  | Office                                                  |
| GET, POST           | `/admin/stock`                                                                  | Office (POST: filled, bought, discarded, count)         |
| GET                 | `/customer/statement?month`                                                     | Customer (own statement, last 24 months)                |
| GET                 | `/admin/payments?from&to&toCheck=1`                                             | Office (payments and refunds by day; UPI to check)      |
| POST                | `/admin/payments/:id/verify`                                                    | Office (UPI seen in the bank)                           |
| POST                | `/admin/payments/:id/reverse`                                                   | Office (not received, reason needed)                    |
| GET                 | `/admin/dues`                                                                   | Office                                                  |
| GET, POST           | `/admin/customers/:id/payments`                                                 | Office (same `clientRequestId` = one payment)           |
| PUT                 | `/admin/customers/:id/credit-limit`                                             | Owner                                                   |
| POST                | `/admin/customers/:id/deposit-refund`                                           | Office                                                  |
| POST                | `/admin/customers/:id/corrections`                                              | Office (reason needed)                                  |
| GET                 | `/admin/customers/:id/statement?month`                                          | Office                                                  |
| POST                | `/admin/opening-balances`                                                       | Owner (`dryRun: true` saves nothing)                    |
| GET                 | `/admin/dashboard`                                                              | Office (Today page)                                     |
| GET                 | `/admin/reports/:name?from&to&format=csv`                                       | Office (sales, dues, cans, staff, deliveries, stock)    |
| GET, PATCH          | `/admin/business`                                                               | Office reads; owner changes name, GSTIN, FSSAI          |
| GET                 | `/admin/complaints?status&customerId`                                           | Office                                                  |
| POST                | `/admin/customers/:id/complaints`                                               | Office (a complaint from a phone call)                  |
| POST                | `/admin/complaints/:id/resolve`                                                 | Office (the customer is told)                           |
| POST                | `/admin/customers/:id/remind`                                                   | Office (dues reminder, once a day)                      |
| GET, POST           | `/customer/complaints`                                                          | Customer (own complaints)                               |
| GET                 | `/customer/messages`                                                            | Customer (last 50, unread count)                        |
| POST                | `/customer/messages/read`                                                       | Customer (`upToId`)                                     |
| POST, DELETE        | `/me/push-tokens`                                                               | Signed-in app (Expo push token)                         |
| GET                 | `/customer/account/deletion`                                                    | Customer (what must be settled before deleting)         |
| POST                | `/customer/account/delete`                                                      | Customer (`confirm: true`; erases the person, ADR 0007) |
| GET                 | `/admin/audit-logs?from&to&action&entityType&entityId&actorUserId&before&limit` | Office (activity log, newest first)                     |

POST and PATCH routes that create or change records accept an `Idempotency-Key` header. Office requests must send
`X-WtrDrop-Client: admin`; the office refresh token is an httpOnly, SameSite=Strict cookie.

Errors always look like `{ "error": { "code", "message", "requestId", "details?" } }`.

## Rules for contributors

- Never commit secrets. Configuration comes from environment variables; `.env` files are git-ignored.
- Money is integer paise. Ledgers and audit logs are append-only; corrections are new entries.
- The supplier always comes from the signed-in user's token, never from request input.
- Do not report a test as passing unless it was run.
