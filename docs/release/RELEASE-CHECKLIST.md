# WtrDrop release checklist (version 0.1.0)

Ticked items were done and checked in Phase 8 (20 Nov 2026). Unticked items need an outside account, the
owner, or the owner's approval. **Nothing is deployed or submitted without the owner's explicit go-ahead.**

## A. Built and checked (Phase 8)

- [x] Every API route checks the role on the server (route-table test, more than 90 routes)
- [x] Forged, signed-out and other-supplier tokens refused; security headers, CORS list, body limit
- [x] No stack traces, SQL or phone numbers in error answers or logs
- [x] Dependency audit: no high or critical advisory in shipped code; CI fails on one
- [x] Secret scan of the whole git history: clean
- [x] Performance with a year of data, a 300-customer rush and 50 drivers syncing (ADR 0007)
- [x] Server image starts in production mode, migrates, answers health, stops cleanly
- [x] Backup script and restore drill run on a year of data; data check passes on the restored copy
- [x] Customer can delete their account in the app (Play and App Store rule; DPDP)
- [x] Push sign-up on phones built (switches on after `eas init`)
- [x] EAS build profiles, version and build numbers, export-compliance answer
- [x] Full regression: lint, types, translations, unit and API tests, portal and app browser tests

## B. Accounts the owner needs to create (or give us access to)

- [ ] **Hosting** in Mumbai (D-18): pick a provider; managed Postgres 16 with point-in-time recovery, a
      container service, static hosting, object storage for backup copies
- [ ] **Domain** and TLS (e.g. `api.<domain>`, `admin.<domain>`)
- [ ] **MSG91** account, sender id and **DLT-approved** OTP template (Indian SMS rule)
- [ ] **Expo** account; run `eas init` in `apps/mobile` (writes the project id that switches push on)
- [ ] **Google Play** developer account (one-time fee) and **Apple Developer Program** (yearly fee)
- [ ] **GitHub**: Claude GitHub App on the repository so branches can be pushed (pushes are refused today)

## C. Before the first real customer

- [ ] Server settings set as secrets (see RUNBOOK "Server settings")
- [ ] First setup done and every DEMO value replaced by the owner (RUNBOOK "First setup")
- [ ] OWASP ZAP baseline scan against staging, no high findings
- [ ] Rush and sync runs (`scripts/perf.ts`) repeated against staging
- [ ] Nightly backup and data check scheduled, alerts going to the owner's phone or email
- [ ] First restore drill on staging
- [ ] Malayalam text reviewed by a native reader (portal and app)
- [ ] Privacy policy reviewed by a lawyer and published at a public address (stores require the link)
- [ ] **UAT** with the owner and one or two delivery staff (`UAT-SCRIPT.md`), on preview builds, all items passed
      or accepted

## D. Store submission (owner's approval needed)

- [ ] Preview APK tested on the staff's own phones
- [ ] Store listing texts and screenshots (`STORE-LISTING.md`) approved by the owner
- [ ] Play Console: data safety form (phone, name, address, approximate and precise location when the
      customer taps "Save my current location"; not shared; deletion in the app), content rating, target audience
- [ ] App Store Connect: privacy nutrition labels (same data), sign-in for review (a test customer number and
      code), account deletion path described
- [ ] `eas build --profile production` and `eas submit` for each store
- [ ] Release to internal testing / TestFlight first, then production

## E. After go-live

- [ ] Watch the first week: data check each morning, failed messages, SMS delivery
- [ ] Quarterly restore drill in the calendar
- [ ] Review dependency audit monthly
