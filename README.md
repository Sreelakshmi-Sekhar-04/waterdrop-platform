# WtrDrop

**Pure Water. Delivered with Care.**

WtrDrop runs a 20-litre drinking-water can delivery business: customers order and reorder in a couple of taps, delivery
staff record cans and payments at the door, and the owner sees what needs attention, who holds how many cans, and
who owes money.

> **Status: Phase 1 (foundation).** The platform skeleton is built and tested. Sign-in (Phase 3), ordering (Phase 4)
> and deliveries (Phase 5) are not built yet. See [docs/PROGRESS.md](docs/PROGRESS.md).

## Repository layout

| Path                     | What it is                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| `apps/api`               | REST API: Node 22, Express 5, TypeScript, PostgreSQL (Drizzle ORM)                       |
| `apps/admin`             | Business owner web portal: React + Vite                                                  |
| `apps/mobile`            | Customer and delivery staff app: Expo (React Native)                                     |
| `packages/shared`        | Business rules shared by all apps: order state machine, can-ledger maths, money, schemas |
| `packages/design-tokens` | Brand colours, type, spacing (approved WtrDrop design)                                   |
| `docs/`                  | Phase 0 analysis, requirement change log, progress log, architecture decisions           |

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

To create the first owner account, set `SEED_OWNER_PHONE` in `apps/api/.env` before seeding.

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
pnpm test:e2e      # admin portal browser tests (Playwright)
pnpm check:mobile  # bundles the mobile app for Android
```

API integration tests create and drop their own database per test file. Point `TEST_DATABASE_URL` at a PostgreSQL
server where the user may create databases (default `postgres://wtrdrop@localhost:5432/postgres`). With the Docker
database: `TEST_DATABASE_URL=postgres://wtrdrop:wtrdrop_local@localhost:5432/postgres pnpm test`.

## API (Phase 1)

| Method | Path                       | Who                                         |
| ------ | -------------------------- | ------------------------------------------- |
| GET    | `/api/v1/health`           | Anyone                                      |
| GET    | `/api/v1/me`               | Any signed-in user                          |
| GET    | `/api/v1/admin/settings`   | Admin, owner                                |
| PATCH  | `/api/v1/admin/settings`   | Owner (audited, supports `Idempotency-Key`) |
| GET    | `/api/v1/admin/audit-logs` | Admin, owner                                |

Errors always look like `{ "error": { "code", "message", "requestId", "details?" } }`.

## Rules for contributors

- Never commit secrets. Configuration comes from environment variables; `.env` files are git-ignored.
- Money is integer paise. Ledgers and audit logs are append-only; corrections are new entries.
- The supplier always comes from the signed-in user's token, never from request input.
- Do not report a test as passing unless it was run.
