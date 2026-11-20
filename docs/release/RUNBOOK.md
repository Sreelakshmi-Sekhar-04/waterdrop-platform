# WtrDrop runbook: deploy, operate, recover

For whoever runs the servers. Hosting is decision D-18: a managed setup in the Mumbai region (provider not
chosen yet). Nothing here has been deployed; every production step needs the owner's go-ahead.

## What runs where

| Part | What it is | Where |
| --- | --- | --- |
| API | `apps/api/Dockerfile` image, one container (two for no-downtime deploys) | container service, Mumbai |
| Database | PostgreSQL 16, daily backups and point-in-time recovery switched on | managed Postgres, Mumbai |
| Admin portal | static files from `pnpm --filter @wtrdrop/admin build` (`apps/admin/dist`) | static hosting, same domain as the API under `/` with `/api` sent to the API, or set `VITE_API_URL` at build time |
| Mobile app | EAS builds (`apps/mobile/eas.json`) | Play Store, App Store |
| Backups copy | `ops/backup.sh` output | object storage in another account or region |

## Server settings (environment variables)

Set these as secrets in the hosting provider, never in the repository.

| Variable | Production value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | the managed database URL, with `sslmode=require` |
| `JWT_SECRET` | 48+ random characters (`openssl rand -base64 48`); changing it signs everyone out |
| `CORS_ORIGINS` | the admin portal's address, e.g. `https://admin.<domain>` |
| `TRUST_PROXY` | `1` behind one load balancer (so rate limits see the real address) |
| `RATE_LIMIT_PER_MINUTE` | `300` (default) |
| `OTP_PROVIDER` | `msg91` (the server refuses to start in production with `dev-outbox`) |
| `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID` | from MSG91, after the DLT template is approved |
| `PUSH_PROVIDER` | `expo` once the app is built with EAS; `none` until then |
| `EXPO_ACCESS_TOKEN` | optional, if push security is switched on in Expo |
| `LOG_LEVEL` | `info` |

## First setup

1. Create the database and the API container (no traffic yet).
2. Run migrations: `node dist/db/migrate.js` (in the image, as a one-off task).
3. Create the business and the owner: `SEED_OWNER_PHONE=+91XXXXXXXXXX node dist/db/seed.js`. This makes one
   supplier with **DEMO** rules, areas, price and delivery times.
4. The owner signs in to the portal (SMS code, then sets a password) and replaces every DEMO value: Business
   details (name, GSTIN, FSSAI), Business rules (deposit, delivery charge, cut-off), delivery areas, price and
   delivery times. Then adds office admins and delivery staff, and opening balances for existing customers.
5. Run the data check (below) once; it must say `"ok": true`.

## Every release

1. CI green on the commit (lint, types, unit and API tests, both browser suites, audit, image build).
2. Take a backup (`ops/backup.sh`) or confirm the provider's backup from the last hour.
3. Run migrations with the **new** image: `node dist/db/migrate.js`. Migrations only add; the old version keeps
   working while they run.
4. Roll the API containers to the new image; the health check (`/api/v1/health`) must pass before traffic moves.
5. Upload the new admin portal files.
6. Smoke test: sign in to the portal, open Today and Reports; in the app, open Home and Orders.
7. To roll back: put the previous image back. Do not roll back migrations; they are written so the previous
   version still runs.

## Scheduled jobs

| When | Command | Alert when |
| --- | --- | --- |
| Daily 02:00 IST | `DATABASE_URL=… BACKUP_DIR=/backups ops/backup.sh`, then copy `/backups` off-site | exit code not 0 |
| Daily 03:00 IST | `node dist/ops/check-integrity.js` | exit code 1 (a ledger and a balance disagree) or 2 (could not run) |
| Quarterly | `ops/restore-drill.sh <latest dump>` with `ADMIN_URL` (and `SOURCE_URL` to compare counts) | any step fails |

The data check prints JSON. `problems` must be empty; `warnings` are for the office (messages not sent, routes
not checked for two days, depot stock below zero).

## When something goes wrong

- **API down:** the health check restarts the container. Check logs (no tokens or phone numbers are logged).
  Delivery staff keep working offline; their phones send the day's deliveries when the API is back, and a
  delivery sent twice is saved once.
- **SMS codes not arriving:** check the MSG91 dashboard and DLT template. Staff already signed in with a PIN
  on their phone are not affected; new customers and office sign-ins (code and password) wait until SMS works.
- **Data check fails:** do not edit tables by hand. Find the customer in the activity log; correct through
  the portal's ledger correction (owner), which writes a ledger entry and an activity log row.
- **Restore:** use the provider's point-in-time recovery to a new database, run the data check on it, then point
  `DATABASE_URL` at it. The off-site dumps are the fallback (`pg_restore --no-owner`).
- **A leaked secret:** rotate `JWT_SECRET` (everyone signs in again), MSG91 key, and database password; check
  the activity log for the time in question.

## Customer data requests (DPDP Act)

- A customer deletes their account in the app (Account → Delete my account). If they ask the office instead,
  settle cans, deposit and dues first, then ask them to use the app or do it with them on their phone.
- Orders, payments, ledgers and the activity log are kept for the supplier's accounts without the name or phone.
