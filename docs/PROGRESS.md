# WtrDrop: Development Progress

Read this file first at the start of every Claude Code session. Update it at the end of every phase, and whenever a decision is made.

## Current state

| Item | Value |
|---|---|
| Current phase | **Phase 2: Design system and static screens** (complete, waiting for review) |
| Phase status | Phase 1 approved 19 Nov 2026 ("go with phase 2"). Phase 2 delivered 19 Nov on branch `phase-2-ui` (built on `phase-1-foundation`). **Waiting for Sreelakshmi's review** before Phase 3. |
| Next step | Review the Phase 2 screens and report below, then Phase 3 (real sign-in with OTP, customer and staff accounts). |
| Coding started? | Yes. Do not start Phase 3 until Phase 2 is reviewed. |
| Repository | `github.com/Sreelakshmi-Sekhar-04/waterdrop-platform` (public). Work on branch `phase-2-ui`. |
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
